package com.iampavlo.axon.feature.home

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.iampavlo.axon.core.data.PinsStore
import com.iampavlo.axon.data.api.AxonApi
import com.iampavlo.axon.data.dto.SkillListItem
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

    /** Row with a delete request in flight, null when idle. */
    var deletingId by mutableStateOf<Int?>(null)
        private set
    var deleteError by mutableStateOf<String?>(null)
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

    /**
     * Pull-to-refresh and focus refresh. Errors keep stale data; the spinner
     * is manual-pull only (RN parity) — [silent] skips it for focus returns.
     */
    fun refresh(silent: Boolean = false) {
        if (inFlight) return
        inFlight = true
        refreshing = !silent
        viewModelScope.launch {
            runCatching { api.skillList() }.onSuccess { state = State.Ready(it) }
            refreshing = false
            inFlight = false
        }
    }
    private var inFlight = false

    /** FAILED rows: skill.retry then refresh the list ("Retrying…" handled by disabling). */
    fun retrySkill(id: Int) {
        viewModelScope.launch {
            runCatching { api.skillRetry(id) }
            runCatching { api.skillList() }.onSuccess { state = State.Ready(it) }
        }
    }

    fun togglePin(id: Int) = pins.toggle(id)

    /** Permanent: server cascades lessons, answers, progress, and vectors. */
    fun deleteSkill(id: Int) {
        if (deletingId != null) return
        deletingId = id
        deleteError = null
        viewModelScope.launch {
            try {
                api.skillDelete(id)
                pins.remove(id)
                (state as? State.Ready)?.let { s ->
                    state = s.copy(skills = s.skills.filterNot { it.id == id })
                }
            } catch (e: Exception) {
                deleteError = e.message ?: "Couldn't delete the skill — try again."
            } finally {
                deletingId = null
            }
        }
    }

    /** Clears a surfaced delete failure so a reopened confirm dialog starts clean. */
    fun dismissDelete() {
        deleteError = null
    }
}
