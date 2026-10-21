package com.iampavlo.axon.feature.classroom

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.view.View
import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import coil.compose.AsyncImage
import coil.compose.AsyncImagePainter
import coil.request.ImageRequest
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.PlayerConstants
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.YouTubePlayer
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.listeners.AbstractYouTubePlayerListener
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.listeners.FullscreenListener
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.options.IFramePlayerOptions
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.views.YouTubePlayerView
import com.iampavlo.axon.core.di.AppContainer
import com.iampavlo.axon.core.ui.theme.MetaStyle
import com.iampavlo.axon.data.dto.SponsorSegment
import kotlin.math.min

/**
 * RN VideoPlayerCard port on the official android-youtube-player (IFrame API
 * with robust plumbing — same mechanism RN's youtube_iframe used). Thumbnail
 * + spinner until the player reports ready; embed errors revert to the
 * thumbnail with retry. Sponsor-segment skip + clip-end pause run off the
 * library's onCurrentSecond listener (no hand-rolled JS bridge). Fullscreen is
 * the player's own button (fs=1) + FullscreenListener window plumbing — no
 * custom player UI. Height = min(234, (width−48)·9/16). Used by the Videos
 * tab AND lesson clips.
 */
@Composable
fun VideoPlayerCard(
    container: AppContainer,
    videoId: String,
    title: String,
    channel: String,
    startSeconds: Double = 0.0,
    endSeconds: Double? = null,
) {
    val colors = MaterialTheme.colorScheme
    var playing by remember(videoId) { mutableStateOf(false) }
    var embedReady by remember(videoId) { mutableStateOf(false) }
    var embedFailed by remember(videoId) { mutableStateOf(false) }
    var segments by remember(videoId) { mutableStateOf<List<SponsorSegment>>(emptyList()) }

    LaunchedEffect(videoId) {
        runCatching { container.api.sponsorSegments(videoId) }
            .onSuccess { segments = it.segments }
    }

    Column {
        BoxWithHeight { height ->
            when {
                !playing || embedFailed -> Thumbnail(
                    videoId = videoId,
                    title = title,
                    height = height,
                    loading = playing && !embedFailed, // spinner while the player warms up
                    onClick = {
                        embedFailed = false
                        playing = true
                    },
                )

                else -> LibraryEmbed(
                    videoId = videoId,
                    startSeconds = startSeconds,
                    segmentsState = remember(videoId) { mutableStateOf(segments to endSeconds) },
                    onReady = { embedReady = true },
                    onEmbedError = { embedFailed = true },
                    modifier = Modifier.fillMaxWidth().height(height),
                )
            }
        }
        Text(
            title,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.onBackground,
            maxLines = 2,
            modifier = Modifier.padding(top = 8.dp),
        )
        Text(
            if (endSeconds != null) "$channel · from ${formatTimestamp(startSeconds)}" else channel,
            style = MetaStyle,
            color = colors.onSurfaceVariant,
        )
    }
}

@Composable
private fun Thumbnail(
    videoId: String,
    title: String,
    height: androidx.compose.ui.unit.Dp,
    loading: Boolean,
    onClick: () -> Unit,
) {
    val ctx = LocalContext.current
    var retryKey by remember(videoId) { mutableIntStateOf(0) }
    var thumbState by remember(videoId, retryKey) {
        mutableStateOf<AsyncImagePainter.State>(AsyncImagePainter.State.Empty)
    }
    val request = remember(videoId, retryKey, ctx) {
        ImageRequest.Builder(ctx)
            .data("https://i.ytimg.com/vi/$videoId/hqdefault.jpg")
            .setParameter("retry", retryKey)
            .build()
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(10.dp))
            .background(Color.Black)
            .clickable(onClick = onClick),
    ) {
        AsyncImage(
            model = request,
            contentDescription = title,
            contentScale = ContentScale.Crop,
            onState = { thumbState = it },
            modifier = Modifier.fillMaxWidth().height(height),
        )
        if (thumbState is AsyncImagePainter.State.Error && !loading) {
            Text(
                "Tap to retry",
                style = MetaStyle,
                color = Color.White.copy(alpha = 0.8f),
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 6.dp),
            )
        }
        if (loading) {
            CircularProgressIndicator(
                color = Color.White,
                modifier = Modifier.align(Alignment.Center).size(28.dp),
                strokeWidth = 2.dp,
            )
        } else {
            Icon(
                Icons.Filled.PlayArrow,
                contentDescription = "Play video: $title",
                tint = Color.White.copy(alpha = 0.9f),
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(48.dp)
                    .background(Color.Black.copy(alpha = 0.7f), CircleShape)
                    .padding(4.dp),
            )
        }
    }
}

/**
 * The library's player. [segmentsState] is read at callback time (not
 * captured at factory time) so late-arriving sponsor segments still apply.
 *
 * Fullscreen is the library's built-in feature: `fs=1` shows the player's own
 * fullscreen button, and tapping it routes through WebChromeClient custom-view
 * fullscreen to [FullscreenListener]. The listener is the mandatory window
 * plumbing (the library throws without one): it hosts the player's fullscreen
 * surface over the activity content, hides the system bars and rotates to
 * landscape. Back press exits via the player's own exit callback; the player's
 * fullscreen UI can also exit on its own.
 */
@Composable
private fun LibraryEmbed(
    videoId: String,
    startSeconds: Double,
    segmentsState: androidx.compose.runtime.State<Pair<List<SponsorSegment>, Double?>>,
    onReady: () -> Unit,
    onEmbedError: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val readyCb = remember { { onReady() } }
    val errorCb = remember { { onEmbedError() } }
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    val context = LocalContext.current
    val hostActivity = remember(context) { context.findActivity() }
    var fullscreenView by remember { mutableStateOf<View?>(null) }
    var pendingExit by remember { mutableStateOf<(() -> Unit)?>(null) }

    BackHandler(enabled = pendingExit != null) { pendingExit?.invoke() }

    DisposableEffect(Unit) {
        onDispose {
            val view = fullscreenView
            val exit = pendingExit
            fullscreenView = null
            pendingExit = null
            if (view != null) {
                hostActivity?.let { leaveFullscreenChrome(it, view) }
                runCatching { exit?.invoke() } // no-op if the player is already released
            }
        }
    }

    AndroidView(
        factory = { ctx ->
            YouTubePlayerView(ctx).apply {
                lifecycleOwner.lifecycle.addObserver(this)
                enableAutomaticInitialization = false
                addFullscreenListener(object : FullscreenListener {
                    override fun onEnterFullscreen(view: View, exit: () -> Unit) {
                        val activity = hostActivity ?: run {
                            exit() // can't fullscreen without a window; stay inline
                            return
                        }
                        enterFullscreenChrome(activity, view)
                        fullscreenView = view
                        pendingExit = exit
                    }

                    override fun onExitFullscreen() {
                        val view = fullscreenView
                        val activity = hostActivity
                        if (view != null && activity != null) leaveFullscreenChrome(activity, view)
                        fullscreenView = null
                        pendingExit = null
                    }
                })
                initialize(object : AbstractYouTubePlayerListener() {
                    override fun onReady(p: YouTubePlayer) {
                        readyCb()
                        p.loadVideo(videoId, startSeconds.toFloat())
                    }

                    override fun onCurrentSecond(p: YouTubePlayer, second: Float) {
                        val (segments, clipEnd) = segmentsState.value
                        if (clipEnd != null && second >= clipEnd - 0.3) {
                            p.pause()
                            return
                        }
                        val hit = segments.firstOrNull {
                            second >= it.startSeconds - 0.2 && second < it.endSeconds - 0.05
                        }
                        if (hit != null) p.seekTo(hit.endSeconds.toFloat())
                    }

                    override fun onError(p: YouTubePlayer, error: PlayerConstants.PlayerError) {
                        errorCb()
                    }
                }, handleNetworkEvents = false,
                    playerOptions = IFramePlayerOptions.Builder(ctx)
                        .controls(1)
                        .fullscreen(1)
                        .build(),
                    videoId = null)
            }
        },
        onRelease = { view ->
            lifecycleOwner.lifecycle.removeObserver(view)
            view.release()
        },
        modifier = modifier,
    )
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** Fullscreen on: player's custom view over the activity content, immersive bars, landscape. */
private fun enterFullscreenChrome(activity: Activity, view: View) {
    activity.findViewById<ViewGroup>(android.R.id.content).addView(
        view,
        ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ),
    )
    view.keepScreenOn = true
    val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
    controller.systemBarsBehavior =
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    controller.hide(WindowInsetsCompat.Type.systemBars())
    activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
}

/** Fullscreen off: detach the player's custom view, restore bars and orientation. */
private fun leaveFullscreenChrome(activity: Activity, view: View) {
    (view.parent as? ViewGroup)?.removeView(view)
    WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        .show(WindowInsetsCompat.Type.systemBars())
    activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
}

private fun formatTimestamp(seconds: Double): String {
    val total = seconds.toInt()
    return "%d:%02d".format(total / 60, total % 60)
}

@Composable
private fun BoxWithHeight(content: @Composable (androidx.compose.ui.unit.Dp) -> Unit) {
    androidx.compose.foundation.layout.BoxWithConstraints {
        val cardWidth = maxWidth - 48.dp
        val height = min(234f, cardWidth.value * 9f / 16f)
        content(height.dp)
    }
}
