package com.iampauld3v.axon.core.tts
import android.content.Context
import android.speech.tts.TextToSpeech
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * RN system-driver port: Android TTS with onRangeStart word boundaries
 * (API 26+; below that, a 340 ms/word estimate after an 1800 ms grace).
 * Android has no true pause → stop + re-speak from the current word.
 */
class SystemTtsDriver(
    context: Context,
    private val scope: CoroutineScope,
    private val hooks: Hooks,
) {
    interface Hooks {
        fun onPlaying()
        fun onWord(globalIndex: Int)
        fun onDone()
        fun onFail()
    }

    companion object {
        private const val ESTIMATE_MS_PER_WORD = 340
        private const val BOUNDARY_GRACE_MS = 1800L
        fun bcp47(lang: String?): String? = when (lang) {
            "en" -> "en-US"
            "uk" -> "uk-UA"
            "vi" -> "vi-VN"
            null -> null
            else -> lang
        }
    }

    private var tts: TextToSpeech? = null
    private var ready = false
    private var runToken = 0
    private var plan: SpeechPlan? = null
    private var untilWord = Int.MAX_VALUE
    private var estimateJob: Job? = null

    init {
        tts = TextToSpeech(context.applicationContext) { status ->
            ready = status == TextToSpeech.SUCCESS
            if (!ready) hooks.onFail()
        }
    }

    fun speakFrom(plan: SpeechPlan, fromWord: Int, untilWord: Int = Int.MAX_VALUE) {
        stop()
        runToken++
        val token = runToken
        this.plan = plan
        this.untilWord = untilWord
        if (!ready) {
            // Engine still initializing; retry once it flips ready.
            scope.launch {
                delay(300)
                if (token == runToken) {
                    if (ready) speakChunkFrom(plan, fromWord, token) else hooks.onFail()
                }
            }
            return
        }
        speakChunkFrom(plan, fromWord, token)
    }

    private fun speakChunkFrom(plan: SpeechPlan, fromWord: Int, token: Int) {
        val chunk = findChunkForWord(plan, fromWord)
        if (chunk == null || chunk.firstWord >= untilWord) {
            hooks.onDone()
            return
        }
        val local = fromWord - chunk.firstWord
        val offset = chunk.starts[local.coerceIn(0, chunk.starts.lastIndex)]
        val spoken = chunk.text.substring(offset)
        val rebasedStarts = chunk.starts.drop(local).map { it - offset }
        var lastEmitted = -1

        hooks.onPlaying()

        val language = bcp47(chunk.lang)
        tts?.let { engine ->
            if (language != null) engine.language = Locale.forLanguageTag(language)
            engine.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
                override fun onStart(id: String?) {
                    if (token != runToken) return
                    if (android.os.Build.VERSION.SDK_INT < 26) startEstimate(token, rebasedStarts, chunk, local)
                }

                override fun onRangeStart(id: String?, start: Int, end: Int, frame: Int) {
                    if (token != runToken) return
                    estimateJob?.cancel()
                    var wordLocal = 0
                    for (k in rebasedStarts.indices) {
                        if (rebasedStarts[k] <= start) wordLocal = k else break
                    }
                    if (wordLocal != lastEmitted) {
                        lastEmitted = wordLocal
                        hooks.onWord(chunk.firstWord + local + wordLocal)
                    }
                }

                @Deprecated("Deprecated in Java")
                override fun onDone(id: String?) {
                    if (token != runToken) return
                    estimateJob?.cancel()
                    val next = findChunkForWord(plan, chunk.firstWord + local + rebasedStarts.size)
                    if (next != null && next.firstWord < untilWord) {
                        speakChunkFrom(plan, next.firstWord.coerceAtLeast(fromWord), token)
                    } else {
                        hooks.onDone()
                    }
                }

                override fun onError(id: String?) {
                    if (token != runToken) return
                    hooks.onFail()
                }
            })
            engine.speak(spoken, TextToSpeech.QUEUE_FLUSH, null, "axon-tts-$token")
        } ?: hooks.onFail()
    }

    /** Pre-API-26 fallback: estimate one word per 340 ms after the grace window. */
    private fun startEstimate(
        token: Int,
        rebasedStarts: List<Int>,
        chunk: SpeechChunk,
        local: Int,
    ) {
        estimateJob?.cancel()
        estimateJob = scope.launch {
            delay(BOUNDARY_GRACE_MS)
            var wordLocal = 0
            while (isActive && token == runToken && wordLocal < rebasedStarts.size) {
                hooks.onWord(chunk.firstWord + local + wordLocal)
                wordLocal++
                delay(ESTIMATE_MS_PER_WORD.toLong())
            }
        }
    }

    fun stop() {
        runToken++
        estimateJob?.cancel()
        tts?.stop()
    }

    fun release() {
        stop()
        tts?.shutdown()
        tts = null
    }
}
