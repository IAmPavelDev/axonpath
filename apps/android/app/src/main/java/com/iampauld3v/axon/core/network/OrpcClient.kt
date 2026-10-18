package com.iampauld3v.axon.core.network

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** A defined oRPC error from the backend, or a malformed transport failure. */
class RpcException(
    val code: String,
    message: String?,
    val defined: Boolean,
    val status: Int,
) : RuntimeException(message ?: "RPC $code (HTTP $status)")

/**
 * Port of the RN transport: oRPC RPCLink + BatchLinkPlugin (buffered) against
 * the Lambda-backed server. Wire format verified against @orpc/client dist:
 *
 *  - single: POST {base}/rpc/{path/segments}      body {"json": <input>}
 *  - batch:  POST {base}/rpc/__batch__            header x-orpc-batch: buffered
 *            body [{"url": "{base}/rpc/{path}", "body": {"json": ...}}, ...]
 *  - response item: {"index", "status"?, "body": {"json": ...}}
 *  - error item:    body.json = {"defined", "code", "status", "message", "data"}
 *
 * Parallel calls launched in the same tick coalesce into one HTTP round trip
 * (COALESCE window), mirroring the RN app's screen-mount batching; a singleton
 * batch degrades to a plain POST like BatchLinkPlugin does.
 */
class OrpcClient(
    baseUrl: String,
    private val tokenProvider: suspend () -> String?,
    private val http: OkHttpClient,
    private val scope: CoroutineScope,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val media = "application/json".toMediaType()
    private val base = baseUrl.trimEnd('/')

    private class Pending(
        val path: String,
        val input: JsonObject?,
        val deferred: CompletableDeferred<JsonElement>,
    )

    private val mutex = Mutex()
    private var queue: MutableList<Pending> = mutableListOf()
    private var drainScheduled = false

    /** [path] uses '/'-separated procedure segments, e.g. "skill/list". */
    suspend fun <T> call(path: String, input: JsonObject?, output: KSerializer<T>): T {
        val deferred = CompletableDeferred<JsonElement>()
        mutex.withLock {
            queue += Pending(path, input, deferred)
            if (!drainScheduled) {
                drainScheduled = true
                scope.launch { drain() }
            }
        }
        return json.decodeFromJsonElement(output, deferred.await())
    }

    private suspend fun drain() {
        delay(COALESCE_MS / 1_000_000)
        val batch: List<Pending> = mutex.withLock {
            val taken = queue
            queue = mutableListOf()
            drainScheduled = false
            taken
        }
        if (batch.isEmpty()) return
        val token = runCatching { tokenProvider() }.getOrNull()
        if (batch.size == 1) {
            val p = batch[0]
            try {
                p.deferred.complete(executeSingle(p, token))
            } catch (t: Throwable) {
                p.deferred.completeExceptionally(t)
            }
            return
        }
        val outcomes: List<Result<JsonElement>> = try {
            executeBatch(batch, token)
        } catch (t: Throwable) {
            batch.forEach { it.deferred.completeExceptionally(t) }
            return
        }
        batch.forEachIndexed { i, p ->
            outcomes[i].fold(
                onSuccess = { p.deferred.complete(it) },
                onFailure = { p.deferred.completeExceptionally(it) },
            )
        }
    }

    private fun inputEnvelope(input: JsonObject?): JsonObject = buildJsonObject {
        if (input != null) put("json", input)
    }

    private fun executeSingle(p: Pending, token: String?): JsonElement {
        val request = Request.Builder()
            .url("$base/rpc/${p.path}")
            .post(inputEnvelope(p.input).toString().toRequestBody(media))
            .apply { token?.let { header("authorization", "Bearer $it") } }
            .build()
        http.newCall(request).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (text.isBlank()) {
                throw RpcException("MALFORMED_RESPONSE", "Empty body (HTTP ${res.code})", false, res.code)
            }
            val root = json.parseToJsonElement(text).jsonObject
            return if (res.isSuccessful) {
                root["json"] ?: json.parseToJsonElement("{}")
            } else {
                throw rpcError(root["json"], res.code)
            }
        }
    }

    private fun executeBatch(batch: List<Pending>, token: String?): List<Result<JsonElement>> {
        val items = JsonArray(batch.map { p ->
            buildJsonObject {
                put("url", "$base/rpc/${p.path}")
                put("body", inputEnvelope(p.input))
            }
        })
        val request = Request.Builder()
            .url("$base/rpc/__batch__")
            .header("x-orpc-batch", "buffered")
            .post(items.toString().toRequestBody(media))
            .apply { token?.let { header("authorization", "Bearer $it") } }
            .build()
        http.newCall(request).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw RpcException("BATCH_HTTP_${res.code}", text.take(300), false, res.code)
            }
            val arr = json.parseToJsonElement(text).jsonArray
            val missing = { i: Int -> Result.failure<JsonElement>(RpcException("MISSING_BATCH_ITEM", "no response for index $i", false, res.code)) }
            val out = MutableList(batch.size) { i -> missing(i) }
            for (element in arr) {
                val item = element.jsonObject
                val index = item.getValue("index").jsonPrimitive.intOrNull ?: continue
                val status = item["status"]?.jsonPrimitive?.intOrNull ?: res.code
                val payload = item["body"]?.jsonObject?.get("json")
                out[index] = if (status in 200..299) {
                    Result.success(payload ?: json.parseToJsonElement("{}"))
                } else {
                    Result.failure(rpcError(payload, status))
                }
            }
            return out
        }
    }

    private fun rpcError(payload: JsonElement?, status: Int): RpcException {
        val obj = payload as? JsonObject
        return RpcException(
            code = obj?.get("code")?.jsonPrimitive?.contentOrNull ?: "INTERNAL_SERVER_ERROR",
            message = obj?.get("message")?.jsonPrimitive?.contentOrNull,
            defined = obj?.get("defined")?.jsonPrimitive?.booleanOrNull ?: false,
            status = obj?.get("status")?.jsonPrimitive?.intOrNull ?: status,
        )
    }

    private companion object {
        const val COALESCE_MS = 8_000_000L // 8 ms — one compositor tick
    }
}
