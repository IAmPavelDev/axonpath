package com.iampavlo.axon.feature.skilldetail

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.iampavlo.axon.data.api.AxonApi
import com.iampavlo.axon.data.dto.RecommendationVideo
import kotlinx.coroutines.launch

/** RN RecommendationsList: poll 5s while PENDING+focused; FAILED → refresh+refetch. */
class RecommendationsViewModel(
    private val api: AxonApi,
    private val skillId: Int,
) : ViewModel() {

    enum class Status { LOADING, PENDING, READY, FAILED, ERROR }

    var status by mutableStateOf(Status.LOADING)
        private set
    var videos by mutableStateOf<List<RecommendationVideo>>(emptyList())
        private set

    fun poll() {
        viewModelScope.launch {
            when (status) {
                Status.LOADING, Status.ERROR, Status.FAILED -> fetch()
                Status.PENDING, Status.READY -> fetch()
            }
        }
    }

    private suspend fun fetch() {
        runCatching { api.recommendations(skillId) }.fold(
            onSuccess = { envelope ->
                videos = envelope.videos
                status = when (envelope.status) {
                    "PENDING" -> Status.PENDING
                    "FAILED" -> Status.FAILED
                    else -> Status.READY
                }
            },
            onFailure = { if (status == Status.LOADING) status = Status.ERROR },
        )
    }

    /** FAILED path: recommendations.refresh triggers server retry, then refetch. */
    fun refreshRecommendations() {
        viewModelScope.launch {
            runCatching { api.recommendationsRefresh(skillId) }
            fetch()
        }
    }
}
