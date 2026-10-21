package com.iampavlo.axon.feature.skilldetail

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.iampavlo.axon.core.analytics.Analytics
import com.iampavlo.axon.core.di.AppContainer
import com.iampavlo.axon.core.ui.theme.Heading28Medium
import com.iampavlo.axon.core.ui.theme.MetaStyle
import com.iampavlo.axon.data.dto.ClassListItem
import com.iampavlo.axon.ui.components.Hairline
import com.iampavlo.axon.ui.components.LabeledArea
import com.iampavlo.axon.ui.components.LabeledField
import com.iampavlo.axon.ui.components.SegmentedControl
import com.iampavlo.axon.ui.components.ScreenHeader
import com.iampavlo.axon.util.relativeDate
import com.iampavlo.axon.util.secondsSince
import kotlin.math.roundToInt

private enum class Tab(val label: String) { LESSONS("Lessons"), VIDEOS("Videos") }

/** RN skill/[skillId].tsx → SkillDetail: overview + lessons/videos tabs. */
@Composable
fun SkillDetailScreen(
    container: AppContainer,
    skillId: Int,
    onBack: () -> Unit,
    onOpenClass: (Int) -> Unit,
    vm: SkillDetailViewModel = viewModel(
        key = "skill-$skillId",
        initializer = { SkillDetailViewModel(container.api, skillId) },
    ),
) {
    val colors = MaterialTheme.colorScheme
    val ext = com.iampavlo.axon.core.ui.theme.axonExtended()
    var tab by rememberSaveable { mutableStateOf(Tab.LESSONS) }
    var descriptionExpanded by rememberSaveable { mutableStateOf(false) }
    var showDeleteConfirm by rememberSaveable { mutableStateOf(false) }

    // Focus-gated 10s polling of skill + lessons + progress (RN parity).
    LaunchedEffect(skillId) {
        vm.refresh(initial = true)
        while (true) {
            kotlinx.coroutines.delay(10_000)
            vm.refresh()
        }
    }

    when {
        skillId <= 0 -> CenteredMessage("Invalid skill id.", colors.onSurfaceVariant)

        vm.skill == null && vm.loadError != null -> Column(
            Modifier.fillMaxSize().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(vm.loadError ?: "", style = MaterialTheme.typography.bodyMedium, color = colors.onSurfaceVariant)
            Spacer(Modifier.height(12.dp))
            OutlinedButton(
                onClick = { vm.refresh(initial = true) },
                shape = MaterialTheme.shapes.medium,
                border = androidx.compose.foundation.BorderStroke(1.dp, ext.border),
            ) { Text("Try again", style = MaterialTheme.typography.labelLarge, color = colors.onBackground) }
        }

        else -> Column(Modifier.fillMaxSize().background(colors.background)) {
            ScreenHeader(
                onBack = onBack,
                right = {
                    if (!vm.editing && vm.skill != null) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TextButton(onClick = vm::startEdit) {
                                Text("Edit", style = MaterialTheme.typography.labelLarge, color = colors.primary)
                            }
                            IconButton(onClick = { showDeleteConfirm = true }) {
                                Icon(
                                    Icons.Outlined.Delete,
                                    contentDescription = "Delete skill",
                                    tint = colors.error,
                                )
                            }
                        }
                    }
                },
            )

            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp)) {
                if (vm.editing) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        LabeledField(
                            label = "Topic",
                            value = vm.editTopic,
                            onValueChange = vm::onEditTopic,
                            placeholder = "Skill title",
                            enabled = !vm.saving,
                        )
                        LabeledArea(
                            label = "Description",
                            value = vm.editDescription,
                            onValueChange = vm::onEditDescription,
                            placeholder = "What this skill covers",
                            enabled = !vm.saving,
                        )
                        vm.saveError?.let {
                            Text(it, style = MaterialTheme.typography.bodyMedium, color = colors.error)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            OutlinedButton(
                                onClick = vm::cancelEdit,
                                enabled = !vm.saving,
                                shape = MaterialTheme.shapes.medium,
                                border = androidx.compose.foundation.BorderStroke(1.dp, ext.border),
                            ) { Text("Cancel", style = MaterialTheme.typography.labelLarge, color = colors.onBackground) }
                            Button(
                                onClick = vm::saveEdit,
                                enabled = !vm.saving && vm.editTopic.trim().isNotEmpty(),
                                shape = MaterialTheme.shapes.medium,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = colors.primary,
                                    contentColor = colors.onPrimary,
                                ),
                            ) {
                                Text(
                                    if (vm.saving) "Saving…" else "Save changes",
                                    style = MaterialTheme.typography.labelLarge,
                                )
                            }
                        }
                    }
                } else {
                    Text(
                        vm.skill?.topic ?: "",
                        style = Heading28Medium,
                        color = colors.onBackground,
                    )
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                vm.skill?.description ?: "",
                                style = MaterialTheme.typography.bodyMedium,
                                color = colors.onSurfaceVariant,
                                maxLines = if (descriptionExpanded) Int.MAX_VALUE else 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (vm.isFailed) {
                                Text(
                                    "Drafting this skill failed. Retrying usually fixes it.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = colors.error,
                                )
                                OutlinedButton(
                                    onClick = vm::retryGeneration,
                                    enabled = !vm.retrying,
                                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
                                    shape = MaterialTheme.shapes.medium,
                                    border = androidx.compose.foundation.BorderStroke(1.dp, ext.border),
                                ) {
                                    Text(
                                        if (vm.retrying) "Retrying…" else "Try again",
                                        style = MetaStyle,
                                        color = colors.onBackground,
                                    )
                                }
                            }
                        }
                        Icon(
                            Icons.Filled.KeyboardArrowDown,
                            contentDescription = if (descriptionExpanded) "Collapse" else "Expand",
                            tint = colors.onSurfaceVariant,
                            modifier = Modifier
                                .size(16.dp)
                                .rotate(if (descriptionExpanded) 180f else 0f)
                                .clickable { descriptionExpanded = !descriptionExpanded },
                        )
                    }
                }

                Spacer(Modifier.height(12.dp))
                SegmentedControl(
                    options = Tab.entries.map { it to it.label },
                    selected = tab,
                    onSelect = { tab = it }
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    if (tab == Tab.LESSONS) "Lessons" else "Recommended videos",
                    style = MetaStyle,
                    color = colors.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
            }

            when (tab) {
                Tab.LESSONS -> LessonsSection(
                    vm = vm,
                    onOpenClass = onOpenClass,
                    analytics = container.analytics,
                    modifier = Modifier.fillMaxSize(),
                )
                Tab.VIDEOS -> RecommendationsSection(
                    container = container,
                    skillId = skillId,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { if (!vm.deleting) showDeleteConfirm = false },
            title = {
                Text("Delete skill?", style = MaterialTheme.typography.titleMedium, color = colors.onBackground)
            },
            text = {
                Column {
                    Text(
                        "\"${vm.skill?.topic}\" and all of its lessons, answers, and progress will be removed permanently.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.onSurfaceVariant,
                    )
                    vm.deleteError?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(it, style = MaterialTheme.typography.bodyMedium, color = colors.error)
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.deleteSkill {
                            showDeleteConfirm = false
                            onBack()
                        }
                    },
                    enabled = !vm.deleting,
                ) {
                    Text(
                        if (vm.deleting) "Deleting…" else "Delete",
                        style = MaterialTheme.typography.labelLarge,
                        color = colors.error,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }, enabled = !vm.deleting) {
                    Text("Cancel", style = MaterialTheme.typography.labelLarge, color = colors.onBackground)
                }
            },
            containerColor = colors.surface,
        )
    }
}

@Composable
private fun LessonsSection(
    vm: SkillDetailViewModel,
    onOpenClass: (Int) -> Unit,
    analytics: Analytics,
    modifier: Modifier = Modifier,
) {
    val classes = vm.classes
    val sorted = remember(classes) {
        classes.sortedWith(
            compareByDescending { it.createdAt },
        )
    }
    when {
        vm.isGenerating -> Column(Modifier.padding(horizontal = 24.dp)) {
            LessonRowSkeleton()
            Hairline()
        }
        !vm.isGenerating && sorted.isEmpty() -> CenteredMessage("No lessons yet.", MaterialTheme.colorScheme.onSurfaceVariant)
        else -> LazyColumn(modifier = modifier, contentPadding = PaddingValues(bottom = 24.dp)) {
            items(sorted, key = { it.id }) { item ->
                LessonRow(
                    item = item,
                    accuracy = vm.accuracyFor(item.id),
                    onClick = {
                        // How soon after generation does the learner open the lesson?
                        analytics.track(
                            "lesson_opened",
                            mapOf(
                                "class_id" to item.id,
                                "seconds_since_created" to secondsSince(item.createdAt),
                            ),
                        )
                        onOpenClass(item.id)
                    },
                )
                Hairline()
            }
        }
    }
}

@Composable
private fun LessonRow(item: ClassListItem, accuracy: Double?, onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val accuracyText = accuracy?.let { "${(it * 100).roundToInt()}% right" } ?: "No answers yet"
    val activityText = if (item.lastActivityAt != null) {
        "Last studied ${relativeDate(item.lastActivityAt)}"
    } else {
        "Created ${relativeDate(item.createdAt)}"
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                item.title,
                style = MaterialTheme.typography.titleMedium,
                color = colors.onBackground,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.size(8.dp))
            Icon(
                Icons.Filled.ChevronRight,
                contentDescription = null,
                tint = colors.onSurfaceVariant,
                modifier = Modifier.size(16.dp),
            )
        }
        Text(
            "$accuracyText · $activityText",
            style = MetaStyle,
            color = colors.onSurfaceVariant,
        )
    }
}

@Composable
private fun LessonRowSkeleton() {
    val track = MaterialTheme.colorScheme.surfaceVariant
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.fillMaxWidth(0.8f).height(20.dp).background(track, RoundedCornerShape(6.dp)))
        Box(Modifier.fillMaxWidth(0.5f).height(14.dp).background(track, RoundedCornerShape(6.dp)))
    }
}

@Composable
private fun CenteredMessage(message: String, color: androidx.compose.ui.graphics.Color) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(message, style = MaterialTheme.typography.bodyMedium, color = color)
    }
}
