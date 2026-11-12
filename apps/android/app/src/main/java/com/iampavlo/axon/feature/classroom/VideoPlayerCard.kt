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
 * custom player UI; the fullscreen lifecycle lives in [VideoFullscreenSession]
 * (shared per list) so list-item disposal mid-fullscreen can't kill it.
 * Height = min(234, (width−48)·9/16). Used by the Videos tab AND lesson clips.
 */
@Composable
fun VideoPlayerCard(
    container: AppContainer,
    videoId: String,
    title: String,
    channel: String,
    startSeconds: Double = 0.0,
    endSeconds: Double? = null,
    fullscreenSession: VideoFullscreenSession? = null,
) {
    val colors = MaterialTheme.colorScheme
    var playing by remember(videoId) { mutableStateOf(false) }
    var embedFailed by remember(videoId) { mutableStateOf(false) }
    var segments by remember(videoId) { mutableStateOf<List<SponsorSegment>>(emptyList()) }
    // One fullscreen session per card unless the list shares one; either way it
    // must live ABOVE the Thumbnail→Embed switch (and above list-item disposal).
    val session = fullscreenSession ?: remember(videoId) { VideoFullscreenSession() }
    if (fullscreenSession == null) {
        // A shared session registers its back handler at list level — once, and
        // guaranteed present even when every composed card has been disposed.
        session.backHandler()
    }
    DisposableEffect(session) {
        onDispose {
            // Only the creator cleans up a card-local session; a shared session
            // is disposed by its owning list.
            if (fullscreenSession == null) session.teardown()
        }
    }

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
                    onEmbedError = { embedFailed = true },
                    session = session,
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
 * fullscreen to [FullscreenListener]. The listener hands the session to
 * [VideoFullscreenSession] — the session, not this composable, owns the
 * fullscreen chrome and the back press. That matters because this composable
 * can be DISPOSED mid-fullscreen: the containing LazyColumn virtualizes items,
 * and the forced-landscape re-layout can push the playing card out of the
 * viewport the moment fullscreen starts. Without the session, disposal tore
 * the fullscreen down and released the player, kicking the user back to the
 * list with the video dead. With it, the player is handed off (kept alive,
 * released on exit) and fullscreen survives.
 */
@Composable
private fun LibraryEmbed(
    videoId: String,
    startSeconds: Double,
    segmentsState: androidx.compose.runtime.State<Pair<List<SponsorSegment>, Double?>>,
    onEmbedError: () -> Unit,
    session: VideoFullscreenSession,
    modifier: Modifier = Modifier,
) {
    val errorCb = remember { { onEmbedError() } }
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    val context = LocalContext.current
    val hostActivity = remember(context) { context.findActivity() }

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
                        session.enter(view, exit, this@apply, lifecycleOwner)
                        enterFullscreenChrome(activity, view)
                    }

                    override fun onExitFullscreen() {
                        session.teardown()
                    }
                })
                initialize(object : AbstractYouTubePlayerListener() {
                    override fun onReady(p: YouTubePlayer) {
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
                        session.teardown() // no-op unless this player is fullscreen
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
            // Handoff: this card's fullscreen session is still running (the
            // list virtualized the item away mid-fullscreen). Keep the player
            // alive; the session releases it when fullscreen exits. Otherwise
            // the card owns a plain finished embed — release it.
            if (!session.orphanIfOwner(view)) {
                lifecycleOwner.lifecycle.removeObserver(view)
                view.release()
            }
        },
        modifier = modifier,
    )
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/**
 * Fullscreen state for one video list, created above list-item scope so it
 * survives the disposal of the card that entered fullscreen.
 *
 * Why it exists: entering fullscreen rotates the activity to landscape, and
 * the list re-layout can push the playing card out of the (now short)
 * viewport — the LazyColumn then disposes the card mid-fullscreen. With the
 * session owning the fullscreen chrome and the player handoff, that disposal
 * no longer tears fullscreen down or kills playback: [orphanIfOwner] keeps the
 * player alive until [teardown] releases it on exit.
 */
class VideoFullscreenSession {
    internal var fullscreenView: View? = null
        private set
    internal var exitFullscreen: (() -> Unit)? = null
        private set
    internal var playerView: YouTubePlayerView? = null
        private set
    private var playerLifecycle: androidx.lifecycle.LifecycleOwner? = null
    private var playerOrphaned = false

    val active: Boolean get() = fullscreenView != null

    internal fun enter(
        view: View,
        exit: () -> Unit,
        player: YouTubePlayerView,
        lifecycle: androidx.lifecycle.LifecycleOwner,
    ) {
        fullscreenView = view
        exitFullscreen = exit
        playerView = player
        playerLifecycle = lifecycle
        playerOrphaned = false
    }

    /**
     * The card that entered fullscreen is being disposed while the session is
     * running. Keep chrome and player alive; [teardown] releases the player.
     *
     * @return true when ownership was taken (caller must NOT release the view).
     */
    internal fun orphanIfOwner(player: YouTubePlayerView): Boolean {
        if (playerView !== player) return false
        playerOrphaned = true
        return true
    }

    /** Player-initiated exit (its own fullscreen button, or back press). */
    fun exit() {
        exitFullscreen?.invoke()
    }

    /**
     * End the session: restore window chrome; release the player iff it was
     * handed off by a disposed card (a live card's embed releases itself).
     * Idempotent — no-op when fullscreen isn't running.
     */
    internal fun teardown() {
        val view = fullscreenView ?: return
        fullscreenView = null
        exitFullscreen = null
        view.context.findActivity()?.let { leaveFullscreenChrome(it, view) }
        val player = playerView
        val lifecycle = playerLifecycle
        playerView = null
        playerLifecycle = null
        if (player != null && playerOrphaned) {
            lifecycle?.lifecycle?.removeObserver(player)
            player.release()
        }
        playerOrphaned = false
    }
}

/** Back press exits the running fullscreen session for this list. */
@Composable
fun VideoFullscreenSession.backHandler() {
    BackHandler(enabled = active) { exit() }
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
