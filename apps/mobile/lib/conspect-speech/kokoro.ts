/**
 * Kokoro-82M on-device TTS driving the conspect read-aloud. The int8 model
 * ships inside the APK (Android assets); sherpa-onnx synthesizes small
 * sentence-bounded playback units, expo-audio plays the resulting WAV files
 * back-to-back, and fast-mode word timestamps drive the word highlight.
 *
 * Latency design: sound can only start after the first unit is synthesized,
 * so units are small (~220 chars) and the next unit is always prefetched
 * while the current one plays. Audio and word timings are cached on disk
 * keyed by text hash, so replays and rereads are instant.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import type { EventSubscription } from 'expo-modules-core';
import { createTTS, saveAudioToFile, type TtsEngine } from 'react-native-sherpa-onnx/tts';
import type { SpeechPlan } from './word-map';
import { buildUnits, mapStarts, unitWordTexts, type Unit, type UnitAudio } from './unit-map';

const cacheDir = new Directory(Paths.cache, 'conspect-tts');

/** Player position events drive the highlight (ms). */
const POSITION_INTERVAL_MS = 100;
/** Bundled int8 Kokoro model inside the APK's android assets. */
const MODEL_ASSET_PATH = 'models/kokoro-en-v0_19';
/** Bound the wait for a player's first load event; a wedged loader then
 * degrades into playback from position 0 instead of eternal silence. */
const LOAD_TIMEOUT_MS = 2500;


export type KokoroDriverHooks = {
  /** The word highlight moves. */
  onWord: (globalWordIndex: number) => void;
  /** Audio is being synthesized (play button shows progress). */
  onLoading: () => void;
  /** Sound is audible. */
  onPlaying: () => void;
  /** The final word finished. */
  onDone: () => void;
  /** The engine or playback failed mid-session; caller degrades to the
   * system engine. */
  onFail: () => void;
};

// --- engine (kept warm for the app session once initialized) ---

let enginePromise: Promise<TtsEngine> | null = null;

const ensureEngine = (): Promise<TtsEngine> => {
  enginePromise ??= createTTS({
    modelPath: { type: 'asset', path: MODEL_ASSET_PATH },
    modelType: 'kokoro',
    numThreads: 2,
  }).catch((err: unknown) => {
    enginePromise = null;
    throw err;
  });
  return enginePromise;
};

const hash = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** Synthesizes one unit (disk-cached by text hash) → WAV + word timings. */
const synthesize = async (plan: SpeechPlan, unit: Unit): Promise<UnitAudio> => {
  const chunk = plan.chunks[unit.chunkIdx];
  const text = chunk.text.slice(unit.offset, unit.offset + unit.length).trim();
  if (!cacheDir.exists) cacheDir.create({ intermediates: true, idempotent: true });
  const wav = new File(cacheDir, `${hash(text)}.wav`);
  const meta = new File(cacheDir, `${hash(text)}.json`);
  if (wav.exists && meta.exists) {
    try {
      const cached = (await meta.json()) as { starts: number[]; duration: number };
      return { uri: wav.uri, starts: cached.starts, duration: cached.duration };
    } catch {}
  }
  const tts = await ensureEngine();
  const audio = await tts.generateSpeechWithTimestamps(text, {
    speed: 1,
    subtitles: { mode: 'fast', granularity: 'word' },
  });
  const starts = mapStarts(audio.subtitles, unitWordTexts(chunk.text, chunk.starts, unit));
  await saveAudioToFile(audio, wav.uri);
  const duration = audio.samples.length / Math.max(1, audio.sampleRate);
  meta.write(JSON.stringify({ starts, duration }));
  return { uri: wav.uri, starts, duration };
};

const waitForLoad = (player: AudioPlayer): Promise<void> => {
  if (player.isLoaded) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  const sub = player.addListener('playbackStatusUpdate', (st: AudioStatus) => {
    if (st.isLoaded) settle();
  });
  const timer = setTimeout(settle, LOAD_TIMEOUT_MS);
  function settle() {
    clearTimeout(timer);
    sub.remove();
    resolve();
  }
  return promise;
};

/**
 * Plays a speech plan back-to-back on the bundled Kokoro engine: small
 * sentence-bounded units, prefetched one ahead, word timestamps mapped onto
 * the plan's global word list. True pause/resume via the audio player.
 */
export class KokoroDriver {
  private plan: SpeechPlan | null = null;
  private units: Unit[] = [];
  private idx = -1;
  private player: AudioPlayer | null = null;
  private statusSub: EventSubscription | null = null;
  /** Global word index of the playing unit's first word. */
  private baseGlobal = 0;
  /** Word start times (unit-local seconds) of the playing unit. */
  private starts: number[] = [];
  private lastWord = -1;
  /** Bumped on every start/stop; stale async continuations bail out. */
  private runToken = 0;
  private prefetchIdx = -1;
  private prefetchPromise: Promise<UnitAudio> | null = null;

  constructor(private readonly hooks: KokoroDriverHooks) {}

  /** Starts reading `plan` from global word `fromWord`. Throws when engine
   * init or synthesis fails — the caller falls back to the system engine. */
  async start(plan: SpeechPlan, fromWord: number): Promise<void> {
    const token = ++this.runToken;
    this.player?.pause();
    this.plan = plan;
    this.units = buildUnits(plan);
    if (this.units.length === 0) {
      this.hooks.onDone();
      return;
    }
    this.idx = this.units.findIndex((u) => fromWord < u.firstGlobal + u.wordCount);
    if (this.idx < 0) this.idx = this.units.length - 1;
    await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    await this.playUnit(this.idx, fromWord, token);
  }

  /** Pauses playback (position preserved). */
  pause(): void {
    this.player?.pause();
  }

  /** Continues from the paused position. */
  resume(_plan: SpeechPlan, _word: number): void {
    this.player?.play();
  }

  stop(): void {
    this.runToken++;
    this.player?.pause();
    this.lastWord = -1;
  }

  /** Releases the player; the engine stays warm for the next session. */
  dispose(): void {
    this.stop();
    this.statusSub?.remove();
    this.statusSub = null;
    this.player?.remove();
    this.player = null;
  }

  private async playUnit(k: number, fromWord: number | null, token: number): Promise<void> {
    const unit = this.units[k];
    if (!unit || !this.plan || token !== this.runToken) return;
    this.hooks.onLoading();
    let audio: UnitAudio;
    try {
      audio = await (this.takePrefetch(k) ??
        synthesize(this.plan, unit).catch((err: unknown) => {
          this.hooks.onFail();
          throw err;
        }));
      this.kickPrefetch(k + 1, token);
    } catch (err) {
      if (token === this.runToken) this.hooks.onFail();
      throw err;
    }
    if (token !== this.runToken) return;
    this.idx = k;
    this.baseGlobal = unit.firstGlobal;
    this.starts = audio.starts;
    this.lastWord = -1;

    if (!this.player) {
      this.player = createAudioPlayer({ uri: audio.uri }, { updateInterval: POSITION_INTERVAL_MS });
      this.statusSub = this.player.addListener('playbackStatusUpdate', (st) => this.onStatus(st));
    } else {
      this.player.replace({ uri: audio.uri });
    }
    await waitForLoad(this.player);
    if (token !== this.runToken) return;
    if (fromWord !== null) {
      const local = Math.max(0, Math.min(fromWord - unit.firstGlobal, this.starts.length - 1));
      await this.player.seekTo(Math.max(0, (this.starts[local] ?? 0) - 0.02));
    }
    if (token !== this.runToken) return;
    this.player.play();
    this.hooks.onPlaying();
  }

  private takePrefetch(k: number): Promise<UnitAudio> | null {
    if (this.prefetchPromise && this.prefetchIdx === k) {
      const promise = this.prefetchPromise;
      this.prefetchPromise = null;
      this.prefetchIdx = -1;
      return promise;
    }
    return null;
  }

  private kickPrefetch(k: number, token: number): void {
    if (this.prefetchPromise || !this.plan || token !== this.runToken) return;
    const unit = this.units[k];
    if (!unit) return;
    this.prefetchIdx = k;
    this.prefetchPromise = synthesize(this.plan, unit).catch((err: unknown) => {
      // Prefetch is opportunistic; the unit re-synthesizes on demand, which
      // surfaces the failure through playUnit's own error path.
      this.prefetchPromise = null;
      this.prefetchIdx = -1;
      throw err;
    });
  }

  private onStatus(st: AudioStatus): void {
    if (st.didJustFinish) {
      if (this.player?.playing) return;
      const next = this.idx + 1;
      if (next >= this.units.length) {
        this.hooks.onDone();
        return;
      }
      void this.playUnit(next, null, this.runToken).catch(() => {});
      return;
    }
    if (!st.playing) return;
    let lo = 0;
    let hi = this.starts.length - 1;
    let local = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid] <= st.currentTime) {
        local = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (local !== this.lastWord) {
      this.lastWord = local;
      this.hooks.onWord(this.baseGlobal + local);
    }
  }
}
