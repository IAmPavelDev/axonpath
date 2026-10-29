package com.iampavlo.axon.feature.skilldetail

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.iampavlo.axon.data.api.AxonApi
import com.iampavlo.axon.data.dto.ClassListItem
import com.iampavlo.axon.data.dto.SkillDetail
import com.iampavlo.axon.data.dto.SkillProgress
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.launch

/**
 * RN SkillDetail: three focus-gated 10s polls (skill, class list, progress);
 * edit mode fires skill.edit twice (topic, description) trimmed.
 */
class SkillDetailViewModel(
    private val api: AxonApi,
    val skillId: Int,
) : ViewModel() {

    var skill by mutableStateOf<SkillDetail?>(null)
        private set
    var classes by mutableStateOf<List<ClassListItem>>(emptyList())
        private set
    var progress by mutableStateOf<SkillProgress?>(null)
        private set
    var loadError by mutableStateOf<String?>(null)
        private set
    var refreshing by mutableStateOf(false)
        private set

    var editing by mutableStateOf(false)
        private set
    var editTopic by mutableStateOf("")
        private set
    var editDescription by mutableStateOf("")
        private set
    var saving by mutableStateOf(false)
        private set
    var saveError by mutableStateOf<String?>(null)
        private set
    var retrying by mutableStateOf(false)
        private set
    var deleting by mutableStateOf(false)
        private set
    var deleteError by mutableStateOf<String?>(null)
        private set

    val isGenerating: Boolean
        get() = skill?.status == "GENERATING"

    val isFailed: Boolean
        get() = skill?.status == "FAILED"

    fun refresh(initial: Boolean = false) {
        viewModelScope.launch {
            if (initial) loadError = null
            refreshing = true
            try {
                val skillDeferred = async { runCatching { api.skillGet(skillId) } }
                val classesDeferred = async { runCatching { api.classList(skillId) } }
                val progressDeferred = async { runCatching { api.skillProgress(skillId) } }
                awaitAll(skillDeferred, classesDeferred, progressDeferred)

                val s = skillDeferred.await().getOrNull()
                if (s != null) skill = s
                classesDeferred.await().onSuccess { classes = it }
                progressDeferred.await().onSuccess { progress = it }

                if (initial && s == null) {
                    loadError = skillDeferred.await().exceptionOrNull()?.message
                        ?: "Something went wrong — try again."
                }
                maybeEnsureLessons()
            } finally {
                refreshing = false
            }
        }
    }

    /**
     * The user never waits stuck: a skill with zero lessons must always be
     * generating. One fire per screen visit (until lessons land or the skill
     * fails) — the endpoint is idempotent and the 10s poll + sweeper cover
     * anything the capped in-request drain leaves running.
     */
    private var ensureInFlight = false
    private var ensuredOnce = false
    private fun maybeEnsureLessons() {
        val s = skill ?: return
        if (classes.isNotEmpty()) {
            ensuredOnce = false
            return
        }
        if (ensuredOnce || ensureInFlight) return
        if (s.status != "ACTIVE" && s.status != "GENERATING") return
        ensureInFlight = true
        ensuredOnce = true
        viewModelScope.launch {
            try {
                runCatching { api.skillEnsureLessons(skillId) }
                if (classes.isEmpty()) refresh()
            } finally {
                ensureInFlight = false
            }
        }
    }

    fun accuracyFor(classId: Int): Double? =
        progress?.classes?.firstOrNull { it.classId == classId }?.accuracy

    fun startEdit() {
        editTopic = skill?.topic ?: ""
        editDescription = skill?.description ?: ""
        saveError = null
        editing = true
    }

    fun cancelEdit() {
        editing = false
    }

    fun onEditTopic(value: String) {
        editTopic = value
    }

    fun onEditDescription(value: String) {
        editDescription = value
    }

    /** RN fires two trimmed skill.edit calls; editor collapses when both succeed. */
    fun saveEdit() {
        if (saving) return
        val topic = editTopic.trim()
        val description = editDescription.trim()
        saving = true
        saveError = null
        viewModelScope.launch {
            try {
                api.skillEdit(skillId, topic, null)
                api.skillEdit(skillId, null, description)
                editing = false
                refresh()
            } catch (e: Exception) {
                saveError = e.message ?: "Something went wrong — try again."
            } finally {
                saving = false
            }
        }
    }

    fun retryGeneration() {
        if (retrying) return
        retrying = true
        viewModelScope.launch {
            runCatching { api.skillRetry(skillId) }
            // The retry armed a new generation attempt — allow ensure again.
            ensuredOnce = false
            refresh()
            retrying = false
        }
    }

    /** Permanent: server cascades lessons, answers, progress, and vectors. */
    fun deleteSkill(onDeleted: () -> Unit) {
        if (deleting) return
        deleting = true
        viewModelScope.launch {
            try {
                api.skillDelete(skillId)
                onDeleted()
            } catch (e: Exception) {
                deleteError = e.message ?: "Couldn't delete the skill — try again."
            } finally {
                deleting = false
            }
        }
    }
 }
