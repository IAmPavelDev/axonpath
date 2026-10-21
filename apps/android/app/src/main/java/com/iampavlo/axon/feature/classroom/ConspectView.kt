package com.iampavlo.axon.feature.classroom

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.ScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.unit.dp
import com.iampavlo.axon.core.conspect.ChunkMarkdown
import com.iampavlo.axon.core.conspect.chunkExcerpt
import com.iampavlo.axon.core.conspect.splitConspectChunks
import com.iampavlo.axon.core.conspect.stripLanguageMarkers
import com.iampavlo.axon.core.conspect.stripLeadingH1
import com.iampavlo.axon.core.di.AppContainer
import com.iampavlo.axon.core.tts.ConspectSpeechController
import com.iampavlo.axon.core.tts.ConspectSpeechController.Status
import com.iampavlo.axon.core.ui.theme.LabelStyle
import androidx.compose.ui.layout.boundsInParent
import com.iampavlo.axon.data.dto.QaBlock

/**
 * RN ConspectView + ClassConspect: chunked markdown with the active spoken
 * word highlighted, video clips anchored per paragraph, QA groups (optimistic
 * ask, 1.6s pending poll, retry), anchor mode + composer sheet, and
 * scroll-follow that keeps the spoken chunk in the comfort band.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConspectView(
    container: AppContainer,
    vm: ClassViewModel,
    speech: ConspectSpeechController?,
    scroll: ScrollState,
    viewportHeightPx: Int,
) {
    val klass = vm.klass ?: return
    val colors = MaterialTheme.colorScheme

    val contentMd = remember(klass.contentMd) {
        stripLanguageMarkers(stripLeadingH1(klass.contentMd))
    }
    val chunks = remember(contentMd) { splitConspectChunks(contentMd) }

    // Chunk tops in content coordinates — the scroll-follow band math.
    val chunkTops = remember { mutableMapOf<Int, Float>() }
    val wordIndex = speech?.wordIndex ?: -1
    val speechStatus = speech?.status ?: Status.IDLE
    val activeWord = speech?.plan?.words?.getOrNull(wordIndex)
    var followedChunk by remember { mutableStateOf(-1) }

    LaunchedEffect(wordIndex, speechStatus, viewportHeightPx) {
        val controller = speech ?: return@LaunchedEffect
        if (controller.status != Status.PLAYING) return@LaunchedEffect
        val word = controller.plan.words.getOrNull(wordIndex) ?: return@LaunchedEffect
        if (word.chunk == followedChunk) return@LaunchedEffect
        val target = chunkTops[word.chunk] ?: return@LaunchedEffect
        if (viewportHeightPx <= 0) return@LaunchedEffect
        val y = scroll.value.toFloat()
        val inBand = target >= y + FOLLOW_TOP && target <= y + viewportHeightPx - FOLLOW_BOTTOM
        if (!inBand) {
            scroll.animateScrollTo((target - viewportHeightPx / 3f).toInt().coerceAtLeast(0))
        }
        followedChunk = word.chunk
    }

    Column(Modifier.padding(horizontal = 24.dp)) {
        chunks.forEachIndexed { index, chunk ->
            val activeRange = activeWord
                ?.takeIf { it.chunk == index }
                ?.let { it.chunkStart until it.chunkEnd }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .onGloballyPositioned { coords -> chunkTops[index] = coords.boundsInParent().top }
                    .then(
                        if (vm.anchorMode) {
                            Modifier.clickable { vm.openComposer(index, chunkExcerpt(chunk), null) }
                        } else {
                            Modifier
                        },
                    ),
            ) {
                ChunkMarkdown(
                    chunk,
                    activeWordRange = activeRange,
                    selectedRange = vm.selection?.takeIf { it.first == index }?.second,
                    onLongPressText = { start, end -> vm.onTextSelected(index, start until end) },
                )
            }

            klass.videoClips.filter { it.anchorParagraph == index }.forEach { clip ->
                Spacer(Modifier.height(16.dp))
                VideoPlayerCard(
                    container = container,
                    videoId = clip.videoId,
                    title = clip.title,
                    channel = clip.channel,
                    startSeconds = clip.startSeconds,
                    endSeconds = clip.endSeconds,
                )
            }

            vm.qaBlocks.filter { it.anchorParagraph == index }.forEach { block ->
                Spacer(Modifier.height(16.dp))
                QaBlockCard(block, vm)
            }
            vm.tempAsks.filter { it.anchorParagraph == index }.forEach { temp ->
                Spacer(Modifier.height(16.dp))
                TempAskCard(temp, vm)
            }
        }

        // Stale anchors render as a tail group after the last chunk (RN parity).
        val tailBlocks = vm.qaBlocks.filter { it.anchorParagraph >= chunks.size }
        val tailTemps = vm.tempAsks.filter { it.anchorParagraph >= chunks.size }
        if (tailBlocks.isNotEmpty() || tailTemps.isNotEmpty()) {
            Spacer(Modifier.height(24.dp))
            Text("Earlier conversation in this lesson", style = LabelStyle, color = colors.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
            tailBlocks.forEach { QaBlockCard(it, vm); Spacer(Modifier.height(16.dp)) }
            tailTemps.forEach { TempAskCard(it, vm); Spacer(Modifier.height(16.dp)) }
        }

        Spacer(Modifier.height(96.dp)) // FAB clearance
    }

    vm.composer?.let { state ->
        ComposerSheet(
            excerpt = state.excerpt,
            onSend = { text ->
                vm.sendQuestionText(state.anchorParagraph, state.anchorText, text, state.excerpt)
            },
            onDismiss = vm::closeComposer,
        )
    }
}

private const val FOLLOW_TOP = 120
private const val FOLLOW_BOTTOM = 96

@Composable
private fun QaBlockCard(block: QaBlock, vm: ClassViewModel) {
    val colors = MaterialTheme.colorScheme
    val ext = com.iampavlo.axon.core.ui.theme.axonExtended()
    Column(
        Modifier
            .fillMaxWidth()
            .border(1.dp, ext.border, RoundedCornerShape(10.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("✦", color = colors.primary, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.size(6.dp))
            Text(
                block.anchorText ?: "Anchored to this paragraph",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
                maxLines = 2,
                modifier = Modifier.weight(1f),
            )
        }
        Text(block.question, style = MaterialTheme.typography.titleMedium, color = colors.onBackground)
        when (block.status) {
            "ANSWERED" -> {
                block.answer?.let { answer -> ChunkMarkdown(stripLanguageMarkers(answer)) }
                Text(
                    "Ask follow-up",
                    style = MaterialTheme.typography.labelLarge,
                    color = colors.primary,
                    modifier = Modifier.clickable {
                        vm.openComposer(block.anchorParagraph, block.anchorText ?: "", block.anchorText)
                    },
                )
            }
            "PENDING" -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SkeletonLine(0.9f)
                SkeletonLine(0.7f)
            }
            else -> {
                Text(
                    "The tutor couldn't answer this one.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.onSurfaceVariant.copy(alpha = 0.7f),
                )
                Text(
                    "Try again",
                    style = MaterialTheme.typography.labelLarge,
                    color = colors.primary,
                    modifier = Modifier.clickable { vm.qaRetry(block.id) },
                )
            }
        }
    }
}

@Composable
private fun TempAskCard(temp: ClassViewModel.TempAsk, vm: ClassViewModel) {
    val colors = MaterialTheme.colorScheme
    val ext = com.iampavlo.axon.core.ui.theme.axonExtended()
    Column(
        Modifier
            .fillMaxWidth()
            .border(1.dp, ext.border, RoundedCornerShape(10.dp))
            .padding(16.dp)
            .alpha(if (temp.failed) 0.6f else 1f),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("✦", color = colors.primary, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.size(6.dp))
            Text(
                temp.anchorText ?: "Anchored to this paragraph",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
                maxLines = 2,
                modifier = Modifier.weight(1f),
            )
        }
        Text(temp.question, style = MaterialTheme.typography.titleMedium, color = colors.onBackground)
        if (temp.failed) {
            Text(
                "The tutor couldn't answer this one.",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
            )
            Text(
                "Try again",
                style = MaterialTheme.typography.labelLarge,
                color = colors.primary,
                modifier = Modifier.clickable { vm.retryAsk(temp) },
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SkeletonLine(0.9f)
                SkeletonLine(0.7f)
            }
        }
    }
}

@Composable
private fun SkeletonLine(fraction: Float) {
    Box(
        Modifier
            .fillMaxWidth(fraction)
            .height(14.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(6.dp)),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ComposerSheet(
    excerpt: String,
    onSend: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    var text by rememberSaveable { mutableStateOf("") }
    val canSend = text.length in 1..4000

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp)) {
            Box(Modifier.fillMaxWidth().height(4.dp), contentAlignment = Alignment.Center) {
                Box(
                    Modifier
                        .size(width = 40.dp, height = 4.dp)
                        .background(colors.onSurfaceVariant.copy(alpha = 0.4f), RoundedCornerShape(2.dp)),
                )
            }
            Spacer(Modifier.height(12.dp))
            Text(
                "Anchored to: “${excerpt.take(160)}”",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
                maxLines = 2,
            )
            Spacer(Modifier.height(12.dp))
            TextField(
                value = text,
                onValueChange = { if (it.length <= 4000) text = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Ask about this part…", color = colors.onSurfaceVariant) },
                minLines = 3,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = colors.surface,
                    unfocusedContainerColor = colors.surface,
                    focusedTextColor = colors.onBackground,
                    unfocusedTextColor = colors.onBackground,
                    focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                    unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                ),
                shape = RoundedCornerShape(10.dp),
            )
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${text.length}/4000",
                    style = com.iampavlo.axon.core.ui.theme.MetaStyle,
                    color = colors.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                OutlinedButton(
                    onClick = { if (canSend) onSend(text.trim()) },
                    enabled = canSend,
                    shape = RoundedCornerShape(8.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, colors.outline),
                ) {
                    Text("Ask AI", style = MaterialTheme.typography.labelLarge, color = colors.onBackground)
                }
            }
        }
    }
}
