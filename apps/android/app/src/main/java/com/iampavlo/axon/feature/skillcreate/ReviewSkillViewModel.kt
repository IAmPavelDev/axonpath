package com.iampavlo.axon.feature.skillcreate

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.iampavlo.axon.data.api.AxonApi
import com.iampavlo.axon.data.dto.SkillDetail
import kotlinx.coroutines.launch

/**
 * RN ReviewSkill: poll skill.get at 1s, adopt the AI draft field-by-field
 * until the user edits that field; accept arms first-lesson generation.
 */
class ReviewSkillViewModel(private val api: AxonApi, val skillId: Int) : ViewModel() {

    var skill by mutableStateOf<SkillDetail?>(null)
        private set
    var title by mutableStateOf("")
        private set
    var description by mutableStateOf("")
        private set
    var busy by mutableStateOf(false)
        private set
    var retrying by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    private var titleTouched = false
    private var descriptionTouched = false

    val isFailed: Boolean
        get() = skill?.status == "FAILED"

    val isPreparing: Boolean
        get() = !isFailed && !titleTouched && skill?.description.isNullOrEmpty()

    fun refresh() {
        viewModelScope.launch {
            runCatching { api.skillGet(skillId) }.onSuccess { s ->
                skill = s
                if (!titleTouched) title = s.topic
                if (!descriptionTouched) description = s.description
            }
        }
    }

    fun onTitle(value: String) {
        titleTouched = true
        title = value
    }

    fun onDescription(value: String) {
        descriptionTouched = true
        description = value
    }

    fun retry() {
        if (retrying) return
        retrying = true
        viewModelScope.launch {
            runCatching { api.skillRetry(skillId) }
            refresh()
            retrying = false
        }
    }

    fun accept(onAccepted: () -> Unit) {
        val trimmedTitle = title.trim()
        if (busy || trimmedTitle.isEmpty()) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                api.skillEdit(skillId, trimmedTitle, description.trim())
                busy = false
                onAccepted()
            } catch (e: Exception) {
                busy = false
                error = e.message ?: "Something went wrong — try again."
            }
        }
    }
}
