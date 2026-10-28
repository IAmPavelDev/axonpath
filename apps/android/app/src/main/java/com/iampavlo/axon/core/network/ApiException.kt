package com.iampavlo.axon.core.network

/**
 * A structured API failure: the D6 flat error body `{"code","message"}` plus
 * the HTTP status. Replaces the previous RpcException (no `defined` flag —
 * the REST wire has no defined/undefined error distinction).
 */
class ApiException(
    val status: Int,
    val code: String,
    message: String?,
) : RuntimeException(message ?: "API $code (HTTP $status)")
