package com.iampavlo.axon.core.tts

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.io.File

/**
 * Port of RN hooks/use-conspect-speech.ts: status + wordIndex state, kokoro↔
 * system run chaining by language, permanent degrade to system TTS only after
 * a real Kokoro failure (never while the model is merely downloading — fresh
 * installs gate on [ModelManager] readiness).
 */
class ConspectSpeechController(
    context: Context,
    private val scope: CoroutineScope,
    private val modelManager: ModelManager,
) {
    enum class Status { IDLE, LOADING, PLAYING, PAUSED, DONE }

    var status by mutableStateOf(Status.IDLE)
        private set
    var wordIndex by mutableStateOf(-1)
        private set
    var plan by mutableStateOf(SpeechPlan(emptyList(), emptyList()))
        private set
    var useSystemOnly by mutableStateOf(false)
        private set

    val hasAudio: Boolean
        get() = plan.words.isNotEmpty()

    private val appContext: Context = context.applicationContext
    private val ttsCacheDir: File = File(appContext.cacheDir, "conspect-tts")

    private var kokoro: KokoroDriver? = null
    private var system: SystemTtsDriver? = null
    private var enabled = false
    private var gatedStartPending = false

    private val hooks = object : KokoroDriver.Hooks, SystemTtsDriver.Hooks {
        override fun onLoading() {
            status = Status.LOADING
        }

        override fun onPlaying() {
            status = Status.PLAYING
        }

        override fun onWord(globalIndex: Int) {
            wordIndex = globalIndex
        }

        override fun onDone() {
            advanceFromNextRun()
        }

        override fun onFail() {
            if (!useSystemOnly) {
                // Whole-session degrade to system TTS, RN parity.
                useSystemOnly = true
                kokoro?.release()
                kokoro = null
                startRun(wordIndex.coerceAtLeast(0), allowKokoro = false)
            } else {
                status = Status.IDLE
                wordIndex = -1
            }
        }
    }

    fun setContent(chunkTexts: List<String>, baseLanguage: String?) {
        plan = buildSpeechPlan(chunkTexts, baseLanguage)
    }

    fun setEnabled(value: Boolean) {
        if (enabled == value) return
        enabled = value
        if (!value && status != Status.IDLE) stop()
    }

    fun toggle() {
        when (status) {
            Status.PLAYING -> {
                when (val driver = activeDriver()) {
                    is KokoroDriver -> driver.pause()
                    is SystemTtsDriver -> driver.stop() // Android TTS has no true pause
                    else -> {}
                }
                status = Status.PAUSED
            }
            Status.PAUSED -> {
                status = Status.LOADING
                // Kokoro disk cache makes restart instant; system TTS re-speaks.
                startRun(wordIndex.coerceAtLeast(0))
            }
            Status.LOADING -> stop()
            Status.IDLE, Status.DONE -> beginStart()
        }
    }

    /** Fresh installs must finish the ~350 MB model download before Kokoro can
     *  initialize; degrade only after a FAILED install, never while pending. */
    private fun beginStart() {
        val from = wordIndex.coerceAtLeast(0)
        when (modelManager.state.value) {
            ModelManager.State.READY -> startRun(from)
            ModelManager.State.FAILED -> startRun(from, allowKokoro = false)
            else -> {
                status = Status.LOADING
                gatedStartPending = true
                modelManager.installIfNeeded()
                scope.launch {
                    modelManager.state.collect { st ->
                        if (!gatedStartPending) return@collect
                        when (st) {
                            ModelManager.State.READY -> {
                                gatedStartPending = false
                                startRun(from)
                                return@collect
                            }
                            ModelManager.State.FAILED -> {
                                gatedStartPending = false
                                startRun(from, allowKokoro = false)
                                return@collect
                            }
                            else -> {}
                        }
                    }
                }
            }
        }
    }

    fun stop() {
        gatedStartPending = false
        when (val driver = activeDriver()) {
            is KokoroDriver -> driver.stop()
            is SystemTtsDriver -> driver.stop()
            else -> {}
        }
        status = Status.IDLE
        wordIndex = -1
    }

    fun release() {
        stop()
        kokoro?.release()
        kokoro = null
        system?.release()
        system = null
    }

    private fun activeDriver(): Any? = if (useSystemOnly) system else kokoro ?: system

    /** Language runs: kokoro speaks English, system everything else. */
    private fun languageRuns(allowKokoro: Boolean): List<Triple<Boolean, Int, Int>> {
        val runs = mutableListOf<Triple<Boolean, Int, Int>>() // kokoro?, from, until(exclusive)
        for (chunk in plan.chunks) {
            val kokoroSpeaks = chunk.lang == "en" && allowKokoro && !useSystemOnly
            val last = runs.lastOrNull()
            if (last != null && last.first == kokoroSpeaks) {
                runs[runs.lastIndex] = Triple(last.first, last.second, chunk.firstWord + chunk.starts.size)
            } else {
                runs += Triple(kokoroSpeaks, chunk.firstWord, chunk.firstWord + chunk.starts.size)
            }
        }
        return runs
    }

    private fun startRun(fromWord: Int, allowKokoro: Boolean = true) {
        if (plan.words.isEmpty()) {
            status = Status.IDLE
            return
        }
        val run = languageRuns(allowKokoro).firstOrNull { it.second <= fromWord && fromWord < it.third }
            ?: languageRuns(allowKokoro).firstOrNull { it.third > fromWord }
        if (run == null) {
            status = Status.DONE
            wordIndex = -1
            return
        }
        val effectiveFrom = maxOf(fromWord, run.second)
        if (run.first) {
            val modelFile = modelManager.modelFile()
            if (modelFile == null) {
                hooks.onFail()
                return
            }
            val driver = kokoro ?: KokoroDriver(
                modelFile = modelFile,
                cacheDir = ttsCacheDir,
                scope = scope,
                hooks = hooks,
            ).also { kokoro = it }
            driver.start(plan, effectiveFrom, run.third)
        } else {
            val driver = system ?: SystemTtsDriver(appContext, scope, hooks).also { system = it }
            driver.speakFrom(plan, effectiveFrom, run.third)
        }
    }

    /** Position-based chaining: resume from wordIndex+1 in the next run. */
    private fun advanceFromNextRun() {
        val nextFrom = wordIndex + 1
        val allowKokoro = !useSystemOnly && modelManager.state.value == ModelManager.State.READY
        val run = languageRuns(allowKokoro).firstOrNull { it.third > nextFrom && it.third > it.second }
        if (run == null || nextFrom >= plan.words.size) {
            status = Status.DONE
            wordIndex = -1
            return
        }
        startRun(maxOf(nextFrom, run.second), allowKokoro)
    }
}
