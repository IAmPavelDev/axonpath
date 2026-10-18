package com.iampauld3v.axon.feature.home

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.iampauld3v.axon.core.data.PinsStore
import com.iampauld3v.axon.data.api.AxonApi
import com.iampauld3v.axon.data.dto.SkillListItem
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** RN index.tsx states: skeleton → list | empty | error(+retry); silent background refresh. */
class HomeViewModel(
    private val api: AxonApi,
    private val pins: PinsStore,
) : ViewModel() {

    sealed interface State {
        data object Loading : State
        data class Failed(val message: String) : State
        data class Ready(val skills: List<SkillListItem>) : State
    }

    var state by mutableStateOf<State>(State.Loading)
        private set
    var refreshing by mutableStateOf(false)
        private set

    val pinnedIds: StateFlow<List<Int>> = pins.pinnedIds

    init {
        load()
    }

    /** Initial load — failure surfaces the error state with retry. */
    fun load() {
        viewModelScope.launch {
            state = try {
                State.Ready(api.skillList())
            } catch (e: Exception) {
                State.Failed(e.message ?: "Something went wrong — try again.")
            }
        }
    }

    /** Pull-to-refresh and 10s poll — errors keep stale data (manual spinner only, RN parity). */
    fun refresh() {
        if (refreshing) return
        refreshing = true
        viewModelScope.launch {
            runCatching { api.skillList() }.onSuccess { state = State.Ready(it) }
            refreshing = false
        }
    }

    /** FAILED rows: skill.retry then refresh the list ("Retrying…" handled by disabling). */
    fun retrySkill(id: Int) {
        viewModelScope.launch {
            runCatching { api.skillRetry(id) }
            runCatching { api.skillList() }.onSuccess { state = State.Ready(it) }
        }
    }

    fun togglePin(id: Int) = pins.toggle(id)
}
