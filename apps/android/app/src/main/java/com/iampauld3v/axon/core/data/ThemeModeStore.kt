package com.iampauld3v.axon.core.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** RN lib/theme-mode.ts: system|light|dark, persisted 'axon.theme-mode', corrupt → system. */
enum class ThemeMode { SYSTEM, LIGHT, DARK }

class ThemeModeStore(private val context: Context, private val scope: CoroutineScope) {

    private val key = stringPreferencesKey("axon.theme-mode")

    val mode: StateFlow<ThemeMode> = context.axonDataStore.data
        .map { prefs ->
            prefs[key]?.let { stored ->
                runCatching { ThemeMode.valueOf(stored) }.getOrNull()
            } ?: ThemeMode.SYSTEM
        }
        .stateIn(scope, SharingStarted.WhileSubscribed(5_000), ThemeMode.SYSTEM)

    fun set(value: ThemeMode) {
        scope.launch { context.axonDataStore.edit { it[key] = value.name } }
    }
}
