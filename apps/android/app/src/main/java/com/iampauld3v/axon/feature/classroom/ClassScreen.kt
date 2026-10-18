package com.iampauld3v.axon.feature.classroom

import androidx.activity.compose.BackHandler
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
import com.iampauld3v.axon.core.conspect.splitConspectChunks
import com.iampauld3v.axon.core.conspect.stripLanguageMarkers
import com.iampauld3v.axon.core.conspect.stripLeadingH1
import com.iampauld3v.axon.core.di.AppContainer
import com.iampauld3v.axon.core.tts.ConspectSpeechController
import com.iampauld3v.axon.core.tts.ConspectSpeechController.Status
import com.iampauld3v.axon.core.ui.theme.SourceSans3
import com.iampauld3v.axon.ui.components.ScreenHeader
import com.iampauld3v.axon.ui.components.SegmentedControl
import kotlinx.coroutines.delay

private enum class ClassTab(val label: String) { CONSPECT("Conspect"), QUIZ("Quiz") }

private const val FOLLOW_TOP = 120
private const val FOLLOW_BOTTOM = 96

/**
 * RN class/[classId]/index.tsx: collapsing title, scroll progress bar,
 * Conspect|Quiz tabs (both stay mounted — state survives flips), read-aloud
 * play/pause FAB, Ask-AI anchor mode. conspect_read/quiz analytics land in
 * the parity phase.
 */
@Composable
fun ClassScreen(
    container: AppContainer,
    classId: Int,
    onBack: () -> Unit,
    onBackToSkill: (Int) -> Unit,
    vm: ClassViewModel = viewModel(
        key = "class-$classId",
        initializer = { ClassViewModel(container.api, classId) },
    ),
) {
    val colors = MaterialTheme.colorScheme
    val context = LocalContext.current
    var tab by rememberSaveable { mutableStateOf(ClassTab.CONSPECT) }
    val scroll = rememberScrollState()
    var viewportHeightPx by remember { mutableStateOf(0) }
    val klass = vm.klass

    val speech = remember {
        ConspectSpeechController(context, container.appScope, container.modelManager)
    }
    DisposableEffect(Unit) {
        onDispose { speech.release() }
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

            // Collapsing title: shared scrollY, collapse = clamp(scrollY/140).
            val collapse = (scroll.value / 140f).coerceIn(0f, 1f)
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .height((64f + (28f - 64f) * collapse).dp),
            ) {
                Text(
                    klass?.title ?: "",
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
                    klass?.title ?: "",
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

            SegmentedControl(
                options = ClassTab.entries.map { it to it.label },
                selected = tab,
                onSelect = { tab = it },
                modifier = Modifier.padding(horizontal = 24.dp),
            )

            Box(
                Modifier
                    .fillMaxSize()
                    .onSizeChanged { viewportHeightPx = it.height },
            ) {
                // Both tabs stay composed; the hidden one collapses to zero
                // height so scroll/QA/answers survive flips (RN display flip).
                Box(
                    Modifier
                        .fillMaxWidth()
                        .then(
                            if (tab == ClassTab.CONSPECT) Modifier.fillMaxSize()
                            else Modifier.height(0.dp),
                        ),
                ) {
                    Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
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
                                scroll = scroll,
                                viewportHeightPx = viewportHeightPx,
                            )
                        }
                    }
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .then(
                            if (tab == ClassTab.QUIZ) Modifier.fillMaxSize()
                            else Modifier.height(0.dp),
                        ),
                ) {
                    QuizView(vm = vm, onContinue = { vm.klass?.skillId?.let(onBackToSkill) })
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
            "Finding a video… Usually takes a minute.",
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
