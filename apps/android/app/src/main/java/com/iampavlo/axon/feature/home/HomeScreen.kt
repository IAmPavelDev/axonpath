@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.iampavlo.axon.feature.home

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.iampavlo.axon.core.di.AppContainer
import com.iampavlo.axon.core.ui.theme.Heading28Medium
import com.iampavlo.axon.core.ui.theme.MetaStyle
import com.iampavlo.axon.core.ui.theme.SourceSans3
import com.iampavlo.axon.data.dto.SkillListItem
import com.iampavlo.axon.ui.components.Hairline
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import com.iampavlo.axon.util.relativeDate

private val RowTopic = TextStyle(
    fontFamily = SourceSans3,
    fontWeight = FontWeight.Medium,
    fontSize = 19.sp,
    lineHeight = 26.sp,
)

private const val STATUS_GENERATING = "GENERATING"
private const val STATUS_FAILED = "FAILED"

/** RN index.tsx (Library): list | empty | error, 10s focus-gated poll, device-local pins. */
@Composable
fun HomeScreen(
    container: AppContainer,
    onOpenSkill: (Int) -> Unit,
    onCreateSkill: () -> Unit,
    onOpenSettings: () -> Unit,
    vm: HomeViewModel = viewModel(initializer = { HomeViewModel(container.api, container.pins) }),
) {
    val colors = MaterialTheme.colorScheme
    val state = vm.state
    // RN refetches on focus (useFocusEffect). Nav Compose disposes remember
    // slots when a destination leaves composition, so this re-runs on every
    // return to HOME — picking up deletes, edits, and newly created skills.
    LaunchedEffect(Unit) { vm.refresh(silent = true) }

    PullToRefreshBox(
        isRefreshing = vm.refreshing,
        onRefresh = vm::refresh,
        modifier = Modifier.fillMaxSize().background(colors.background),
    ) {
        when (state) {
            HomeViewModel.State.Loading -> HomeSkeleton()

            is HomeViewModel.State.Failed -> Column(
                modifier = Modifier.fillMaxSize().padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    text = state.message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedButton(
                    onClick = vm::load,
                    shape = MaterialTheme.shapes.medium,
                    border = androidx.compose.foundation.BorderStroke(1.dp, colors.outline),
                ) { Text("Try again", style = MaterialTheme.typography.labelLarge) }
            }

            is HomeViewModel.State.Ready -> {
                val pinned by vm.pinnedIds.collectAsStateWithLifecycle()
                val sorted = remember(state.skills, pinned) {
                    state.skills.sortedBy { skill ->
                        pinned.indexOf(skill.id).let { if (it >= 0) it else Int.MAX_VALUE }
                    }
                }
                if (sorted.isEmpty()) {
                    EmptyLibrary(
                        onCreateSkill = onCreateSkill,
                        onOpenSettings = onOpenSettings,
                    )
                } else {
                    SkillList(
                        skills = sorted,
                        pinned = pinned,
                        onTogglePin = vm::togglePin,
                        onOpenSkill = onOpenSkill,
                        onCreateSkill = onCreateSkill,
                        onOpenSettings = onOpenSettings,
                        onRetry = vm::retrySkill,
                        deletingId = vm.deletingId,
                        deleteError = vm.deleteError,
                        onDelete = vm::deleteSkill,
                        onDismissDelete = vm::dismissDelete,
                    )
                }
            }
        }
    }
}


@Composable
private fun SkillList(
    skills: List<SkillListItem>,
    pinned: List<Int>,
    onTogglePin: (Int) -> Unit,
    onOpenSkill: (Int) -> Unit,
    onCreateSkill: () -> Unit,
    onOpenSettings: () -> Unit,
    onRetry: (Int) -> Unit,
    deletingId: Int?,
    deleteError: String?,
    onDelete: (Int) -> Unit,
    onDismissDelete: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item(key = "header") {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 24.dp, end = 12.dp, top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Library", style = Heading28Medium, color = colors.onBackground)
                    Text(
                        "${skills.size} skills",
                        style = MetaStyle,
                        color = colors.onSurfaceVariant,
                    )
                }
                IconButton(onClick = onOpenSettings) {
                    Icon(
                        Icons.Outlined.Settings,
                        contentDescription = "Settings",
                        tint = colors.onBackground,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
            Hairline()
        }
        items(skills, key = { it.id }) { skill ->
            SkillRow(
                skill = skill,
                pinned = skill.id in pinned,
                deleting = deletingId == skill.id,
                deleteError = deleteError,
                onOpen = { onOpenSkill(skill.id) },
                onTogglePin = { onTogglePin(skill.id) },
                onDelete = { onDelete(skill.id) },
                onDismissDelete = onDismissDelete,
                onRetry = { onRetry(skill.id) },
            )
            Hairline()
        }
        item(key = "footer") {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .combinedClickable(onClick = onCreateSkill)
                    .padding(horizontal = 24.dp, vertical = 16.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Filled.Add,
                    contentDescription = null,
                    tint = colors.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.size(6.dp))
                Text("New skill", style = MaterialTheme.typography.labelLarge, color = colors.onBackground)
            }
        }
    }
}

@Composable
private fun SkillRow(
    skill: SkillListItem,
    pinned: Boolean,
    deleting: Boolean,
    deleteError: String?,
    onOpen: () -> Unit,
    onTogglePin: () -> Unit,
    onDelete: () -> Unit,
    onDismissDelete: () -> Unit,
    onRetry: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    var retrying by remember(skill.id) { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(
            modifier = Modifier
                .weight(1f)
                .combinedClickable(onClick = onOpen)
                .padding(start = 24.dp, top = 14.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (pinned) {
                    Icon(
                        Icons.Filled.PushPin,
                        contentDescription = "Pinned",
                        tint = colors.onSurfaceVariant,
                        modifier = Modifier.size(13.dp).padding(end = 2.dp),
                    )
                }
                Text(
                    text = skill.topic,
                    style = RowTopic,
                    color = colors.onBackground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (skill.status == STATUS_GENERATING) {
                    Spacer(Modifier.size(6.dp))
                    PulseDot()
                }
            }
            Text(
                text = "Started ${relativeDate(skill.createdAt)} · Last studied ${relativeDate(skill.lastActivityAt)}",
                style = MetaStyle,
                color = colors.onSurfaceVariant,
            )
            when (skill.status) {
                STATUS_GENERATING -> Text(
                    "Preparing…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.onSurfaceVariant,
                )
                STATUS_FAILED -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Failed to prepare",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.onSurfaceVariant,
                    )
                    Spacer(Modifier.size(10.dp))
                    OutlinedButton(
                        onClick = { retrying = true; onRetry() },
                        enabled = !retrying,
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 2.dp),
                        shape = CircleShape,
                        border = androidx.compose.foundation.BorderStroke(1.dp, colors.outline),
                    ) {
                        Text(
                            if (retrying) "Retrying…" else "Retry",
                            style = MetaStyle,
                            color = colors.onBackground,
                        )
                    }
                }
                else -> Text(
                    "${skill.lessonCount} lesson${if (skill.lessonCount == 1) "" else "s"} · " +
                        "${skill.completedLessons} done · ${skill.learnedPoints} learned",
                    style = MetaStyle,
                    color = colors.onSurfaceVariant,
                )
            }
        }
        Box {
            IconButton(onClick = { menuOpen = true }) {
                Icon(
                    Icons.Filled.MoreVert,
                    contentDescription = "Skill options",
                    tint = colors.onSurfaceVariant,
                )
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text(if (pinned) "Unpin" else "Pin", color = colors.onBackground) },
                    onClick = {
                        menuOpen = false
                        onTogglePin()
                    },
                )
                DropdownMenuItem(
                    text = { Text("Delete", color = colors.error) },
                    onClick = {
                        menuOpen = false
                        showDeleteConfirm = true
                    },
                )
            }
        }
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = {
                if (!deleting) {
                    showDeleteConfirm = false
                    onDismissDelete()
                }
            },
            title = {
                Text("Delete skill?", style = MaterialTheme.typography.titleMedium, color = colors.onBackground)
            },
            text = {
                Column {
                    Text(
                        "\"${skill.topic}\" and all of its lessons, answers, and progress will be removed permanently.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.onSurfaceVariant,
                    )
                    deleteError?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(it, style = MaterialTheme.typography.bodyMedium, color = colors.error)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = onDelete, enabled = !deleting) {
                    Text(
                        if (deleting) "Deleting…" else "Delete",
                        style = MaterialTheme.typography.labelLarge,
                        color = colors.error,
                    )
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showDeleteConfirm = false
                        onDismissDelete()
                    },
                    enabled = !deleting,
                ) {
                    Text("Cancel", style = MaterialTheme.typography.labelLarge, color = colors.onBackground)
                }
            },
            containerColor = colors.surface,
        )
    }
}

@Composable
private fun EmptyLibrary(onCreateSkill: () -> Unit, onOpenSettings: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Box(Modifier.fillMaxSize()) {
        IconButton(onClick = onOpenSettings, modifier = Modifier.align(Alignment.TopEnd).padding(top = 8.dp, end = 12.dp)) {
            Icon(
                Icons.Outlined.Settings,
                contentDescription = "Settings",
                tint = colors.onBackground,
                modifier = Modifier.size(20.dp),
            )
        }
        Column(
            modifier = Modifier.fillMaxSize().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("What will you learn?", style = Heading28Medium, color = colors.onBackground)
            Spacer(Modifier.height(6.dp))
            Text(
                "Name any topic — Axon builds the lessons and quizzes.",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
            )
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = onCreateSkill,
                modifier = Modifier.height(48.dp),
                shape = MaterialTheme.shapes.medium,
                colors = ButtonDefaults.buttonColors(
                    containerColor = colors.primary,
                    contentColor = colors.onPrimary,
                ),
            ) {
                Text("Start learning", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun HomeSkeleton() {
    val colors = MaterialTheme.colorScheme
    val track = colors.surfaceVariant
    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp)) {
        Spacer(
            Modifier
                .padding(top = 16.dp, bottom = 20.dp)
                .size(width = 140.dp, height = 44.dp)
                .background(track, RoundedCornerShape(8.dp)),
        )
        repeat(4) {
            Column(
                Modifier.fillMaxWidth().padding(vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.fillMaxWidth(0.7f).height(20.dp).background(track, RoundedCornerShape(6.dp)))
                Box(Modifier.fillMaxWidth(0.45f).height(14.dp).background(track, RoundedCornerShape(6.dp)))
            }
            Hairline()
        }
    }
}

/** RN PulseDot: small primary dot with a breathing alpha (GENERATING marker). */
@Composable
private fun PulseDot(color: Color = MaterialTheme.colorScheme.primary) {
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
