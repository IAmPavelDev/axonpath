package com.iampavlo.axon.feature.classroom

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.iampavlo.axon.core.conspect.splitConspectChunks
import com.iampavlo.axon.core.conspect.stripLanguageMarkers
import com.iampavlo.axon.core.conspect.stripLeadingH1
import com.iampavlo.axon.core.di.AppContainer
import com.iampavlo.axon.core.tts.ConspectSpeechController
import com.iampavlo.axon.core.tts.ConspectSpeechController.Status
import com.iampavlo.axon.core.ui.theme.SourceSans3
import com.iampavlo.axon.ui.components.ScreenHeader
import com.iampavlo.axon.ui.components.SegmentedControl
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

private enum class ClassTab(val label: String) { CONSPECT("Conspect"), QUIZ("Quiz") }

private const val FOLLOW_TOP = 120
private const val FOLLOW_BOTTOM = 96

/**
 * RN class/[classId]/index.tsx: collapsing title, scroll progress bar,
 * Conspect|Quiz tabs (both stay mounted — state survives flips), read-aloud
 * play/pause FAB, Ask-AI anchor mode + long-press selection ask, and the
 * class analytics set (class_view / conspect_read / quiz_opened /
 * quiz_completed; lesson_opened fires on the skill-detail lesson row).
 */
@Composable
fun ClassScreen(
    container: AppContainer,
    classId: Int,
    onBack: () -> Unit,
    onBackToSkill: (Int) -> Unit,
    vm: ClassViewModel = viewModel(
        key = "class-$classId",
        initializer = { ClassViewModel(container.api, container.analytics, classId) },
    ),
) {
    val colors = MaterialTheme.colorScheme
    val context = LocalContext.current
    var tab by rememberSaveable { mutableStateOf(ClassTab.CONSPECT) }
    val scrollConspect = rememberScrollState(0)
    val scrollQuiz = rememberScrollState(0)

    // Collapsing title + progress bar track whichever tab is active.
    val scroll = if (tab == ClassTab.CONSPECT) scrollConspect else scrollQuiz

    var conspectFocusAt by remember { mutableStateOf(System.currentTimeMillis()) }

    // Reading-session analytics (RN parity): conspect_read fires on tab-away
    // and on unmount while reading; quiz events ride the view model.
    fun fireConspectRead(now: Long) {
        val max = scrollConspect.maxValue
        val progress = if (max > 0) (scrollConspect.value.toFloat() / max).coerceIn(0f, 1f) else 0f
        container.analytics.track(
            "conspect_read",
            mapOf(
                "class_id" to classId,
                "seconds" to (now - conspectFocusAt) / 1000,
                "scroll_progress" to (progress * 100).roundToInt() / 100.0,
            ),
        )
    }

    fun onTabChange(next: ClassTab) {
        if (next == tab) return
        val now = System.currentTimeMillis()
        if (tab == ClassTab.CONSPECT) fireConspectRead(now)
        if (next == ClassTab.QUIZ) vm.onQuizOpened(now) else conspectFocusAt = now
        tab = next
    }

    var viewportHeightPx by remember { mutableStateOf(0) }
    val klass = vm.klass

    val speech = remember {
        ConspectSpeechController(context, container.appScope, container.modelManager)
    }
    DisposableEffect(Unit) {
        onDispose { speech.release() }
    }
    // Leaving the screen mid-read still reports the reading session (RN
    // unmount effect).
    DisposableEffect(Unit) {
        onDispose {
            if (tab == ClassTab.CONSPECT) fireConspectRead(System.currentTimeMillis())
        }
    }

    val contentMd = klass?.contentMd
    LaunchedEffect(contentMd) {
        if (contentMd != null) {
            val chunks = splitConspectChunks(stripLanguageMarkers(stripLeadingH1(contentMd)))
            speech.setContent(chunks, klass?.baseLanguage)
        }
    }
    LaunchedEffect(tab) {
        speech.setEnabled(tab == ClassTab.CONSPECT)
    }

    // Class polls every 5s only while the clip gate is pending (RN parity).
    LaunchedEffect(classId) {
        vm.refreshClass(initial = true)
        while (true) {
            delay(if (vm.isPreparing) 5_000 else 60_000)
            vm.refreshClass()
        }
    }
    // QA polls every 1.6s while anything is pending/awaiting; quiet otherwise.
    LaunchedEffect(classId) {
        while (true) {
            vm.refreshQa()
            val busy = vm.qaBlocks.any { it.status == "PENDING" } ||
                    vm.tempAsks.any { !it.failed && it.awaitingBlockId == null }
            delay(if (busy) 1_600 else 60_000)
        }
    }

    BackHandler(enabled = vm.anchorMode) { vm.cancelAnchorMode() }

    Box(Modifier.fillMaxSize().background(colors.background)) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader(onBack = onBack)

            CollapsingClassHeader(title = klass?.title ?: "", scroll = scroll)

            SegmentedControl(
                options = ClassTab.entries.map { it to it.label },
                selected = tab,
                onSelect = { onTabChange(it) },
                modifier = Modifier.padding(horizontal = 24.dp),
            )

            Box(
                Modifier
                    .fillMaxSize()
                    .onSizeChanged { viewportHeightPx = it.height },
            ) {
                TabPane(visible = tab == ClassTab.CONSPECT) {
                    Column(Modifier.fillMaxSize().verticalScroll(scrollConspect)) {
                        if (klass == null && vm.loadError != null) {
                            Text(
                                "Failed to load class: ${vm.loadError}",
                                style = MaterialTheme.typography.bodyMedium,
                                color = colors.onSurfaceVariant,
                                modifier = Modifier.padding(24.dp),
                            )
                        } else if (vm.isPreparing || klass == null) {
                            PreparingGate()
                        } else {
                            ConspectView(
                                container = container,
                                vm = vm,
                                speech = speech,
                                scroll = scrollConspect,
                                viewportHeightPx = viewportHeightPx,
                            )
                        }
                    }
                }
                TabPane(visible = tab == ClassTab.QUIZ) {
                    QuizView(
                        vm = vm,
                        scroll = scrollQuiz,
                        onContinue = { vm.klass?.skillId?.let(onBackToSkill) },
                    )
                }
            }
        }

        if (tab == ClassTab.CONSPECT && !vm.isPreparing && klass != null) {
            // Read-aloud FAB (48dp circle) sits above the Ask-AI pill, RN parity.
            SpeechFab(
                speech = speech,
                modifier = Modifier.align(Alignment.BottomEnd).padding(end = 24.dp, bottom = 84.dp),
            )
            if (vm.anchorMode) {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = colors.surface,
                    shadowElevation = 8.dp,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(top = 8.dp)
                        .padding(horizontal = 24.dp),
                ) {
                    Row(
                        Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "Tap the paragraph to anchor your question",
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.onBackground,
                            modifier = Modifier.weight(1f),
                        )
                        Icon(
                            Icons.Filled.Close,
                            contentDescription = "Cancel anchor mode",
                            tint = colors.onSurfaceVariant,
                            modifier = Modifier
                                .size(16.dp)
                                .clickable { vm.cancelAnchorMode() },
                        )
                    }
                }
                AskAiPill(
                    label = "Cancel",
                    secondary = true,
                    onClick = vm::cancelAnchorMode,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(24.dp),
                )
            } else {
                AskAiPill(
                    label = "✦ Ask AI",
                    secondary = false,
                    onClick = vm::startAnchorMode,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(24.dp),
                )
            }
            if (vm.selection != null) {
                SelectionAskPill(
                    onAsk = vm::askSelected,
                    onClear = vm::clearSelection,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 24.dp),
                )
            }
        }
    }
}

@Composable
private fun SpeechFab(speech: ConspectSpeechController, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    val status = speech.status
    Surface(
        shape = CircleShape,
        color = colors.primary,
        shadowElevation = 6.dp,
        modifier = modifier
            .size(48.dp)
            .clickable { speech.toggle() },
    ) {
        Box(contentAlignment = Alignment.Center) {
            when (status) {
                Status.LOADING -> CircularProgressIndicator(
                    color = colors.onPrimary,
                    modifier = Modifier.size(22.dp),
                    strokeWidth = 2.dp,
                )

                Status.PLAYING -> Icon(
                    Icons.Filled.Pause,
                    contentDescription = "Pause reading",
                    tint = colors.onPrimary,
                    modifier = Modifier.size(18.dp),
                )

                else -> Icon(
                    Icons.Filled.PlayArrow,
                    contentDescription = "Read aloud",
                    tint = colors.onPrimary,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

@Composable
private fun PreparingGate() {
    val colors = MaterialTheme.colorScheme
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(color = colors.primary)
        Spacer(Modifier.height(16.dp))
        Text("Preparing your lesson…", style = MaterialTheme.typography.titleMedium, color = colors.onBackground)
        Spacer(Modifier.height(6.dp))
        Text(
            "Looking for a content… Usually takes a few minutes.",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.onSurfaceVariant,
        )
    }
}

@Composable
private fun AskAiPill(
    label: String,
    secondary: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    Surface(
        shape = CircleShape,
        color = if (secondary) colors.surface else colors.primary,
        shadowElevation = 6.dp,
        modifier = modifier.clickable(onClick = onClick),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = if (secondary) colors.onBackground else colors.onPrimary,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 14.dp),
        )
    }
}

/** Long-press selection Ask-AI (RN native-menu parity): ✕ clears, tap asks. */
@Composable
private fun SelectionAskPill(
    onAsk: () -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    Surface(
        shape = CircleShape,
        color = colors.primary,
        shadowElevation = 6.dp,
        modifier = modifier,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Filled.Close,
                contentDescription = "Clear selection",
                tint = colors.onPrimary,
                modifier = Modifier
                    .padding(start = 18.dp)
                    .size(16.dp)
                    .clickable(onClick = onClear),
            )
            Text(
                "✦ Ask AI",
                style = MaterialTheme.typography.labelLarge,
                color = colors.onPrimary,
                modifier = Modifier
                    .clickable(onClick = onAsk)
                    .padding(start = 10.dp, end = 20.dp, top = 14.dp, bottom = 14.dp),
            )
        }
    }
}

/**
 * Collapsing title + scroll progress bar, driven by the active tab's scroll
 * state: each tab owns a ScrollState and the tab switch swaps the one feeding
 * this header, so both tabs collapse/progress independently and keep their
 * position across flips. Collapse = clamp(scrollY/140) (RN parity); the
 * expanded title fades out in the first 22%, the collapsed one returns in the
 * last 10%.
 */
@Composable
private fun CollapsingClassHeader(
    title: String,
    scroll: ScrollState,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    Column(modifier) {
        val collapse = (scroll.value / 140f).coerceIn(0f, 1f)
        Box(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .height((64f + (28f - 64f) * collapse).dp),
        ) {
            Text(
                title,
                style = TextStyle(
                    fontFamily = SourceSans3,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 20.sp,
                    lineHeight = 26.sp,
                ),
                color = colors.onBackground,
                maxLines = 2,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .alpha((1f - collapse / 0.22f).coerceIn(0f, 1f)),
            )
            Text(
                title,
                style = TextStyle(
                    fontFamily = SourceSans3,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    lineHeight = 20.sp,
                ),
                color = colors.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .alpha(((collapse - 0.9f) / 0.1f).coerceIn(0f, 1f)),
            )
        }

        Spacer(Modifier.height(8.dp))
        // Scroll progress bar, origin left.
        val progress = if (scroll.maxValue > 0) scroll.value.toFloat() / scroll.maxValue else 0f
        Box(Modifier.fillMaxWidth().height(4.dp).background(colors.surfaceVariant)) {
            Box(
                Modifier
                    .fillMaxWidth(progress)
                    .height(4.dp)
                    .background(colors.primary),
            )
        }
        Spacer(Modifier.height(8.dp))
    }
}

/** Hidden-tab pane: stays composed at zero height so scroll position, QA
 * polling and quiz answers survive tab flips (RN display flip). */
@Composable
private fun TabPane(
    visible: Boolean,
    content: @Composable () -> Unit,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .then(if (visible) Modifier.fillMaxSize() else Modifier.height(0.dp)),
    ) {
        content()
    }
}
