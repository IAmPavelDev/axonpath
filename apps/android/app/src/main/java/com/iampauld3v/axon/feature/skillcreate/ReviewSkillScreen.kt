package com.iampauld3v.axon.feature.skillcreate

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.iampauld3v.axon.core.di.AppContainer
import com.iampauld3v.axon.core.ui.theme.Heading28Medium
import com.iampauld3v.axon.core.ui.theme.LabelStyle
import com.iampauld3v.axon.ui.components.LabeledArea
import com.iampauld3v.axon.ui.components.LabeledField
import com.iampauld3v.axon.ui.components.ScreenHeader
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import androidx.compose.runtime.LaunchedEffect

/** RN ReviewSkill: 1s poll → preparing skeleton | review form (+FAILED retry). */
@Composable
fun ReviewSkillScreen(
    container: AppContainer,
    skillId: Int,
    onBack: () -> Unit,
    onAccepted: (Int) -> Unit,
    vm: ReviewSkillViewModel = viewModel(
        key = "review-$skillId",
        initializer = { ReviewSkillViewModel(container.api, skillId) },
    ),
) {
    val colors = MaterialTheme.colorScheme
    val ext = com.iampauld3v.axon.core.ui.theme.axonExtended()

    LaunchedEffect(skillId) {
        while (isActive) {
            vm.refresh()
            delay(1_000)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(colors.background)
            .imePadding(),
    ) {
        ScreenHeader(onBack = onBack)

        Box(Modifier.fillMaxWidth().weight(1f)) {
            when {
                skillId <= 0 -> Text(
                    "Invalid skill id.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.Center).padding(horizontal = 32.dp),
                )

                vm.isPreparing -> Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp)
                        .align(Alignment.Center),
                    verticalArrangement = Arrangement.spacedBy(40.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Step 2 of 2", style = LabelStyle, color = colors.onSurfaceVariant)
                        Text(
                            "Writing your title and description",
                            style = Heading28Medium,
                            color = colors.onBackground,
                        )
                    }
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .border(1.dp, ext.border, MaterialTheme.shapes.medium)
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            PulsingDot()
                            Text(
                                "Drafting from your description…",
                                style = MaterialTheme.typography.bodyMedium,
                                color = colors.onSurfaceVariant,
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            SkeletonBar(fraction = 0.66f, height = 24.dp)
                            SkeletonBar(fraction = 1f, height = 16.dp)
                            SkeletonBar(fraction = 0.83f, height = 16.dp)
                        }
                    }
                }

                else -> Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp)
                        .align(Alignment.Center),
                    verticalArrangement = Arrangement.spacedBy(24.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Step 2 of 2", style = LabelStyle, color = colors.onSurfaceVariant)
                        Text("Review your skill", style = Heading28Medium, color = colors.onBackground)
                        Text(
                            "Drafted from your description. Edit anything — your first lesson " +
                                "is generated after you start.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.onSurfaceVariant,
                        )
                    }
                    LabeledField(
                        label = "Title",
                        value = vm.title,
                        onValueChange = vm::onTitle,
                        placeholder = "Skill title",
                        enabled = !vm.busy,
                    )
                    LabeledArea(
                        label = "Description",
                        value = vm.description,
                        onValueChange = vm::onDescription,
                        placeholder = "What this skill covers",
                        enabled = !vm.busy,
                    )
                    if (vm.isFailed) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                "Drafting your title and description failed. Retrying usually fixes it.",
                                style = MaterialTheme.typography.bodyLarge,
                                color = colors.error,
                            )
                            OutlinedButton(
                                onClick = vm::retry,
                                enabled = !vm.retrying,
                                contentPadding = androidx.compose.foundation.layout.PaddingValues(
                                    horizontal = 16.dp, vertical = 6.dp,
                                ),
                                shape = MaterialTheme.shapes.medium,
                                border = androidx.compose.foundation.BorderStroke(1.dp, ext.border),
                            ) {
                                Text(
                                    if (vm.retrying) "Retrying…" else "Try again",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = colors.onBackground,
                                )
                            }
                        }
                    }
                }
            }
        }

        vm.error?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.error,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
            )
        }

        Button(
            onClick = { vm.accept { onAccepted(skillId) } },
            enabled = !vm.busy && !vm.isPreparing && !vm.isFailed && vm.title.trim().isNotEmpty(),
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, bottom = 24.dp)
                .height(48.dp),
            shape = MaterialTheme.shapes.medium,
            colors = ButtonDefaults.buttonColors(
                containerColor = colors.primary,
                contentColor = colors.onPrimary,
            ),
        ) {
            Text(
                if (vm.busy) "Starting…" else "Start learning",
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}

@Composable
private fun PulsingDot(color: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.primary) {
    val transition = rememberInfiniteTransition(label = "pulse")
    val alpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = 0.25f,
        animationSpec = infiniteRepeatable(tween(700), RepeatMode.Reverse),
        label = "alpha",
    )
    Box(
        Modifier
            .size(8.dp)
            .alpha(alpha)
            .background(color, CircleShape),
    )
}
@Composable
private fun SkeletonBar(fraction: Float, height: Dp) {
    Box(
        Modifier
            .fillMaxWidth(fraction)
            .height(height)
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(6.dp)),
    )
}
