package com.iampauld3v.axon.feature.skillcreate

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.iampauld3v.axon.data.api.AxonApi
import kotlinx.coroutines.launch

class CreateSkillViewModel(private val api: AxonApi) : ViewModel() {

    var prompt by mutableStateOf("")
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    fun onPrompt(value: String) {
        prompt = value
    }

    fun submit(onCreated: (Int) -> Unit) {
        val trimmed = prompt.trim()
        if (busy || trimmed.isEmpty()) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                val created = api.skillCreate(trimmed)
                busy = false
                onCreated(created.id)
            } catch (e: Exception) {
                busy = false
                error = e.message ?: "Something went wrong — try again."
            }
        }
    }
}
