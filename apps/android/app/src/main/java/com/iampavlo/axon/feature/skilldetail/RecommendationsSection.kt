package com.iampavlo.axon.feature.skilldetail

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.iampavlo.axon.core.ui.theme.MetaStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.iampavlo.axon.core.di.AppContainer
import com.iampavlo.axon.feature.classroom.VideoPlayerCard
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/**
 * RN RecommendationsList: poll 5s while PENDING+focused; READY → whole-video
 * cards; trailing "Refresh recommendations"; explicit failure copy.
 */
@Composable
fun RecommendationsSection(
    container: AppContainer,
    skillId: Int,
    modifier: Modifier = Modifier,
    vm: RecommendationsViewModel = viewModel(
        key = "recs-$skillId",
        initializer = { RecommendationsViewModel(container.api, skillId) },
    ),
) {
    val colors = MaterialTheme.colorScheme
    val status = vm.status

    // Focused polling: every 5s only while generating/pending; idle otherwise.
    LaunchedEffect(skillId) {
        while (isActive) {
            vm.poll()
            val wait = if (status == RecommendationsViewModel.Status.PENDING ||
                status == RecommendationsViewModel.Status.LOADING
            ) {
                5_000L
            } else {
                60_000L
            }
            delay(wait)
        }
    }

    when (status) {
        RecommendationsViewModel.Status.LOADING, RecommendationsViewModel.Status.PENDING -> Column(
            modifier = modifier.padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            repeat(3) { RecommendationSkeleton() }
            Text("Generating…", style = MetaStyle, color = colors.onSurfaceVariant)
        }

        RecommendationsViewModel.Status.FAILED, RecommendationsViewModel.Status.ERROR -> Column(
            modifier = modifier.padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Could not load video recommendations right now.",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
            )
            TextButton(onClick = vm::refreshRecommendations) {
                Text("Try again", style = MaterialTheme.typography.labelLarge, color = colors.primary)
            }
        }

        RecommendationsViewModel.Status.READY -> {
            if (vm.videos.isEmpty()) {
                Column(modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        "No good videos found for this topic yet.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.onSurfaceVariant,
                    )
                    TextButton(onClick = vm::refreshRecommendations) {
                        Text("Try again", style = MaterialTheme.typography.labelLarge, color = colors.primary)
                    }
                }
            } else {
                LazyColumn(
                    modifier = modifier,
                    contentPadding = PaddingValues(horizontal = 24.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    itemsIndexed(vm.videos, key = { _, v -> v.videoId + v.rank }) { index, video ->
                        VideoPlayerCard(
                            container = container,
                            videoId = video.videoId,
                            title = video.title,
                            channel = video.channel,
                        )
                        if (index == vm.videos.lastIndex) {
                            TextButton(onClick = vm::refreshRecommendations) {
                                Text(
                                    "Refresh recommendations",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = colors.primary,
                                    textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RecommendationSkeleton() {
    val track = MaterialTheme.colorScheme.surfaceVariant
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.fillMaxWidth().height(180.dp).background(track, RoundedCornerShape(10.dp)))
        Box(Modifier.fillMaxWidth(0.8f).height(16.dp).background(track, RoundedCornerShape(6.dp)))
        Box(Modifier.fillMaxWidth(0.5f).height(14.dp).background(track, RoundedCornerShape(6.dp)))
    }
}
