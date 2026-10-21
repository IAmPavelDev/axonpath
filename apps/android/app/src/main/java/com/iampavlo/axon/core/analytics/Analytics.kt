package com.iampavlo.axon.core.analytics

import android.content.Context
import android.os.Bundle
import com.google.firebase.analytics.FirebaseAnalytics

/**
 * Port of RN lib/analytics.ts: thin wrapper over Firebase Analytics. Values
 * Firebase can't store are dropped or coerced; every call is best-effort —
 * analytics must never crash the app (missing google-services.json → the
 * instance is null and everything is inert, like Expo Go on RN).
 */
class Analytics(context: Context) {

    private val instance: FirebaseAnalytics? by lazy {
        runCatching { FirebaseAnalytics.getInstance(context.applicationContext) }.getOrNull()
    }

    fun track(event: String, params: Map<String, Any?> = emptyMap()) {
        val bundle = Bundle()
        for ((key, value) in params) {
            when (value) {
                null -> {}
                is String -> bundle.putString(key, value)
                is Int -> bundle.putInt(key, value)
                is Long -> bundle.putLong(key, value)
                is Double -> bundle.putDouble(key, value)
                is Float -> bundle.putFloat(key, value)
                else -> bundle.putString(key, value.toString())
            }
        }
        runCatching { instance?.logEvent(event, bundle) }
    }

    /** RN trackScreen: native auto-reporting can't see app routes; manual screen_view. */
    fun screen(name: String) {
        val bundle = Bundle().apply {
            putString(FirebaseAnalytics.Param.SCREEN_NAME, name)
            putString(FirebaseAnalytics.Param.SCREEN_CLASS, name)
        }
        runCatching { instance?.logEvent(FirebaseAnalytics.Event.SCREEN_VIEW, bundle) }
    }
}
