package com.iampauld3v.axon.core.tts

import android.media.AudioAttributes
import android.media.MediaPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Kokoro on-device driver — port of RN lib/conspect-speech/kokoro.ts. Speaks
 * one playback unit at a time through MediaPlayer (wav cached on disk by
 * content hash), estimates word starts from unit duration, polls playback
 * position every 100 ms and emits global word indexes. The engine stays warm;
 * a stale-token guard drops late async continuations; every MediaPlayer touch
 * is race-safe against stop()/release() from another thread.
 */
class KokoroDriver(
    private val modelFile: File,
    private val cacheDir: File,
    private val scope: CoroutineScope,
    private val hooks: Hooks,
) {
    interface Hooks {
        fun onLoading()
        fun onPlaying()
        fun onWord(globalIndex: Int)
        fun onDone()
        fun onFail()
    }

    private class UnitJob(
        val position: Int,
        val text: String,
        val firstGlobal: Int,
    )

    private var tts: com.k2fsa.sherpa.onnx.OfflineTts? = null
    private var player: MediaPlayer? = null
    private var runToken = 0
    private var unitJobs: List<UnitJob> = emptyList()
    private var currentUnit = 0
    private var currentStarts: List<Int> = emptyList()
    private var currentBase = 0
    private var lastWord = -1
    private var pollJob: Job? = null
    private var prefetchJob: Job? = null
    private val prefetch = HashMap<Int, Pair<File, Int>>() // unit position -> wav + durationMs

    fun ensureEngine(): Boolean {
        if (tts != null) return true
        tts = runCatching {
            com.k2fsa.sherpa.onnx.OfflineTts(
                assetManager = null,
                config = com.k2fsa.sherpa.onnx.OfflineTtsConfig(
                    model = com.k2fsa.sherpa.onnx.OfflineTtsModelConfig(
                        kokoro = com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig(
                            model = modelFile.absolutePath,
                            voices = File(modelFile.parentFile, "voices.bin").absolutePath,
                            tokens = File(modelFile.parentFile, "tokens.txt").absolutePath,
                            dataDir = File(modelFile.parentFile, "espeak-ng-data").absolutePath,
                        ),
                    ),
                    ruleFsts = "",
                    ruleFars = "",
                ),
            )
        }.getOrNull()
        return tts != null
    }

    fun start(plan: SpeechPlan, fromWord: Int, untilWord: Int = Int.MAX_VALUE) {
        stop()
        runToken++
        val token = runToken

        if (!ensureEngine()) {
            hooks.onFail()
            return
        }
        hooks.onLoading()

        val runnable = buildUnits(plan).filter { it.lang == "en" && it.firstGlobal < untilWord }
        if (runnable.isEmpty()) {
            hooks.onDone()
            return
        }
        unitJobs = runnable.mapIndexed { position, unit ->
            val chunk = plan.chunks[unit.chunkIdx]
            UnitJob(
                position = position,
                text = chunk.text.substring(unit.offset, unit.offset + unit.length),
                firstGlobal = unit.firstGlobal,
            )
        }
        currentUnit = unitJobs.indexOfFirst { job ->
            val unit = runnable[job.position]
            unit.firstGlobal + unit.wordCount > fromWord
        }.let { if (it < 0) unitJobs.lastIndex else it }
        playCurrent(token, fromWord)
    }

    private fun playCurrent(token: Int, fromWord: Int?) {
        val job = unitJobs.getOrNull(currentUnit) ?: run {
            hooks.onDone()
            return
        }
        scope.launch {
            val (wav, durationMs) = obtain(job, token)
            if (token != runToken) return@launch
            if (wav == null) {
                hooks.onFail()
                return@launch
            }
            currentStarts = estimateStarts(job.text.split(' ').filter { it.isNotBlank() }, durationMs)
            currentBase = job.firstGlobal
            lastWord = -1
            withContext(Dispatchers.Main) {
                if (token != runToken) return@withContext
                playWav(wav, token, fromWord)
            }
            kickPrefetch(token)
        }
    }

    private fun obtain(job: UnitJob, token: Int): Pair<File?, Int> {
        prefetch[job.position]?.let { return it }
        val engine = tts ?: return null to 0
        val hash = djb2(job.text).toString(36)
        val wav = File(cacheDir.apply { mkdirs() }, "$hash.wav")
        if (!wav.isFile) {
            val audio = runCatching { engine.generate(job.text, 0, 1.0f) }.getOrNull() ?: return null to 0
            if (!audio.save(wav.absolutePath)) return null to 0
        }
        val duration = runCatching {
            val probe = MediaPlayer()
            probe.setDataSource(wav.absolutePath)
            probe.prepare()
            val d = probe.duration
            probe.release()
            d
        }.getOrDefault(0)
        val pair = wav to duration
        if (token == runToken) prefetch[job.position] = pair
        return pair
    }

    private fun kickPrefetch(token: Int) {
        val next = unitJobs.getOrNull(currentUnit + 1) ?: return
        if (prefetch.containsKey(next.position)) return
        prefetchJob?.cancel()
        prefetchJob = scope.launch(Dispatchers.Default) {
            if (token != runToken) return@launch
            obtain(next, token)
        }
    }

    private fun playWav(wav: File, token: Int, fromWord: Int?) {
        releasePlayer()
        val mp = MediaPlayer()
        player = mp
        mp.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )
        mp.setDataSource(wav.absolutePath)
        mp.prepare()
        if (fromWord != null && currentStarts.isNotEmpty()) {
            val job = unitJobs.getOrNull(currentUnit)
            if (job != null) {
                val local = (fromWord - job.firstGlobal).coerceIn(0, currentStarts.lastIndex)
                mp.seekTo((currentStarts[local] - 20).coerceAtLeast(0))
            }
        }
        mp.setOnCompletionListener {
            if (token != runToken) return@setOnCompletionListener
            currentUnit++
            if (currentUnit < unitJobs.size) {
                hooks.onLoading()
                playCurrent(token, null)
            } else {
                hooks.onDone()
            }
        }
        hooks.onPlaying()
        mp.start()
        startPolling(token)
    }

    /** Race-safe position polling: stop()/release() from other threads must
     *  never crash this loop — MediaPlayer throws in torn-down states. */
    private fun startPolling(token: Int) {
        pollJob?.cancel()
        pollJob = scope.launch {
            while (isActive && token == runToken) {
                val mp = player
                if (mp != null) {
                    val playing = runCatching { mp.isPlaying }.getOrDefault(false)
                    val positionMs = runCatching { mp.currentPosition }.getOrDefault(0)
                    if (playing) {
                        var local = 0
                        for (k in currentStarts.indices) {
                            if (currentStarts[k] <= positionMs) local = k else break
                        }
                        val global = currentBase + local
                        if (global != lastWord) {
                            lastWord = global
                            hooks.onWord(global)
                        }
                    }
                }
                delay(100)
            }
        }
    }

    private fun releasePlayer() {
        val mp = player
        player = null
        mp?.run {
            runCatching { stop() }
            release()
        }
    }

    fun pause() {
        val mp = player
        runCatching { if (mp?.isPlaying == true) mp.pause() }
        pollJob?.cancel()
    }

    fun resume() {
        val mp = player
        runCatching { if (mp != null && !mp.isPlaying) mp.start() }
        startPolling(runToken)
    }

    fun stop() {
        runToken++
        pollJob?.cancel()
        prefetchJob?.cancel()
        releasePlayer()
        lastWord = -1
    }

    fun release() {
        stop()
        runCatching { tts?.release() }
        tts = null
    }

    private fun djb2(text: String): Long {
        var hash = 5381L
        for (c in text) hash = ((hash shl 5) + hash + c.code).toLong()
        return hash
    }
}
