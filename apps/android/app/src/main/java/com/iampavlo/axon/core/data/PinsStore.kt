package com.iampavlo.axon.core.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * RN lib/pins.ts: device-local skill pin order, key 'axon.pinned-skills'.
 * Corrupt storage → empty list; non-numeric fragments dropped on load.
 */
class PinsStore(private val context: Context, private val scope: CoroutineScope) {

    private val key = stringPreferencesKey("axon.pinned-skills")

    val pinnedIds: StateFlow<List<Int>> = context.axonDataStore.data
        .map { prefs ->
            prefs[key]
                ?.split(',')
                ?.mapNotNull { it.trim().toIntOrNull() }
                .orEmpty()
        }
        .stateIn(scope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** Appends when absent, removes when present — pin order = insertion order. */
    fun toggle(id: Int) {
        scope.launch {
            context.axonDataStore.edit { prefs ->
                val current = prefs[key]
                    ?.split(',')
                    ?.mapNotNull { it.trim().toIntOrNull() }
                    .orEmpty()
                prefs[key] = (
                    if (id in current) current - id else current + id
                    ).joinToString(",")
            }
        }
    }

    /** Drops one id (deleted skill), keeping the remaining pin order. */
    fun remove(id: Int) {
        scope.launch {
            context.axonDataStore.edit { prefs ->
                val current = prefs[key]
                    ?.split(',')
                    ?.mapNotNull { it.trim().toIntOrNull() }
                    .orEmpty()
                if (id in current) prefs[key] = (current - id).joinToString(",")
            }
        }
    }
}
