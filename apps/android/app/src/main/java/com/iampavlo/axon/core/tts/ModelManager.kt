package com.iampavlo.axon.core.tts

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

/**
 * Downloads the Kokoro model on first run into filesDir — never bundled in
 * the APK or committed to git (bundle-size decision in docs/MIGRATION_PLAN.md).
 * The k2-fsa archive currently ships the FP32 model.onnx only (~345 MB); the
 * driver prefers int8 when a future archive ships it.
 */
class ModelManager(private val context: Context, private val scope: CoroutineScope) {

    enum class State { NOT_INSTALLED, DOWNLOADING, EXTRACTING, READY, FAILED }

    val modelDir: File get() = File(context.filesDir, "tts/kokoro-en-v0_19")

    private val http = OkHttpClient.Builder().build()

    private val _state = MutableStateFlow(initialState())
    val state: StateFlow<State> = _state.asStateFlow()

    val progress = MutableStateFlow(0f)

    fun modelFile(): File? = when {
        File(modelDir, "model.int8.onnx").isFile -> File(modelDir, "model.int8.onnx")
        File(modelDir, "model.onnx").isFile -> File(modelDir, "model.onnx")
        else -> null
    }

    private fun initialState(): State =
        if (requiredFilesExist()) State.READY else State.NOT_INSTALLED

    fun requiredFilesExist(): Boolean =
        modelFile() != null &&
            File(modelDir, "voices.bin").isFile &&
            File(modelDir, "tokens.txt").isFile &&
            File(modelDir, "espeak-ng-data").isDirectory

    fun installIfNeeded() {
        val current = _state.value
        if (current == State.READY || current == State.DOWNLOADING || current == State.EXTRACTING) return
        scope.launch {
            _state.value = State.DOWNLOADING
            progress.value = 0f
            try {
                val archive = withContext(Dispatchers.IO) { download() }
                _state.value = State.EXTRACTING
                withContext(Dispatchers.IO) { extract(archive) }
                _state.value = if (requiredFilesExist()) State.READY else State.FAILED
            } catch (e: Exception) {
                _state.value = State.FAILED
            }
        }
    }

    private fun download(): File {
        val out = File(context.cacheDir, "kokoro-en-v0_19.tar.bz2")
        val request = Request.Builder().url(MODEL_URL).build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("Model download failed: HTTP ${response.code}")
            val body = response.body ?: error("Model download: empty body")
            val total = body.contentLength()
            body.byteStream().use { input ->
                FileOutputStream(out).use { output ->
                    val buffer = ByteArray(1 shl 16)
                    var read: Int
                    var written = 0L
                    while (input.read(buffer).also { read = it } >= 0) {
                        output.write(buffer, 0, read)
                        written += read
                        if (total > 0) progress.value = (written.toFloat() / total).coerceIn(0f, 1f)
                    }
                }
            }
        }
        return out
    }

    private fun extract(archive: File) {
        modelDir.deleteRecursively()
        modelDir.mkdirs()
        TarArchiveInputStream(BZip2CompressorInputStream(FileInputStream(archive))).use { tar ->
            while (true) {
                val entry = tar.nextTarEntry ?: break
                val name = entry.name.removePrefix("./")
                val rel = name.substringAfter("kokoro-en-v0_19/", "")
                if (rel.isEmpty()) continue
                val target = File(modelDir, rel)
                if (entry.isDirectory) {
                    target.mkdirs()
                } else {
                    target.parentFile?.mkdirs()
                    target.outputStream().use { output -> tar.copyTo(output) }
                }
            }
        }
        archive.delete()
    }

    private companion object {
        const val MODEL_URL =
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2"
    }
}
