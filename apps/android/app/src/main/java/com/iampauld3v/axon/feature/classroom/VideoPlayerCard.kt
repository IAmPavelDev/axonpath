package com.iampauld3v.axon.feature.classroom

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import coil.compose.AsyncImage
import coil.compose.AsyncImagePainter
import coil.request.ImageRequest
import com.iampauld3v.axon.core.di.AppContainer
import com.iampauld3v.axon.core.ui.theme.MetaStyle
import com.iampauld3v.axon.data.dto.SponsorSegment
import kotlinx.coroutines.delay
import kotlin.math.min

/**
 * RN VideoPlayerCard: click-to-play YouTube embed with sponsor-segment skip
 * (watchdog seek) and optional clip bounds (start at startSeconds, pause at
 * endSeconds−0.3). Height = min(234, (width−48)·9/16). The thumbnail stays
 * visible with a progress spinner until the embed reports ready; embed
 * errors revert to the thumbnail instead of a black screen. After ready,
 * the embed shows YouTube's own play button (RN parity) — one in-player tap
 * starts playback.
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
    val mainHandler = remember { Handler(Looper.getMainLooper()) }

    LaunchedEffect(videoId) {
        runCatching { container.api.sponsorSegments(videoId) }
            .onSuccess { segments = it.segments }
    }

    Column {
        BoxWithHeight { height ->
            val showEmbed = playing && embedReady && !embedFailed
            when {
                !playing || embedFailed -> Thumbnail(
                    videoId = videoId,
                    title = title,
                    height = height,
                    loading = playing && !embedFailed, // spinner while embed warms up
                    onClick = {
                        embedFailed = false
                        playing = true
                    },
                )

                else -> YouTubeEmbed(
                    videoId = videoId,
                    startSeconds = startSeconds,
                    segments = segments,
                    endSeconds = endSeconds,
                    mainHandler = mainHandler,
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

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun YouTubeEmbed(
    videoId: String,
    startSeconds: Double,
    segments: List<SponsorSegment>,
    endSeconds: Double?,
    mainHandler: Handler,
    onReady: () -> Unit,
    onEmbedError: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val readyCb = remember { { onReady() } }
    val errorCb = remember { { onEmbedError() } }
    val webViewRef = remember { mutableStateOf<WebView?>(null) }
    val bridge = remember(videoId, segments, endSeconds) {
        object {
            @JavascriptInterface
            fun onReady() {
                mainHandler.post { readyCb() }
            }

            @JavascriptInterface
            fun onEmbedError() {
                mainHandler.post { errorCb() }
            }

            @JavascriptInterface
            fun onTime(seconds: Double, state: Int) {
                mainHandler.post {
                    val wv = webViewRef.value ?: return@post
                    if (endSeconds != null && state == 1 && seconds >= endSeconds - 0.3) {
                        wv.evaluateJavascript("typeof player!=='undefined'&&player.pauseVideo()", null)
                        return@post
                    }
                    if (state == 1) {
                        val hit = segments.firstOrNull {
                            seconds >= it.startSeconds - 0.2 && seconds < it.endSeconds - 0.05
                        }
                        if (hit != null) {
                            wv.evaluateJavascript(
                                "typeof player!=='undefined'&&player.seekTo(${hit.endSeconds},true)",
                                null,
                            )
                        }
                    }
                }
            }
        }
    }

    val html = remember(videoId, startSeconds) {
        """
        <!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;padding:0;background:#000;overflow:hidden}
        #player{position:absolute;top:0;left:0;width:100%;height:100%}</style></head>
        <body><div id="player"></div>
        <script src="https://www.youtube.com/iframe_api"></script>
        <script>
        var player; var ready = false;
        function onYouTubeIframeAPIReady() {
          player = new YT.Player('player', {
            videoId: '$videoId',
            playerVars: {autoplay: 1, start: ${startSeconds.toInt()}, modestbranding: 1, rel: 0, playsinline: 1},
            events: {
              onReady: function() { ready = true; Android.onReady(); },
              onError: function() { Android.onEmbedError(); }
            }
          });
        }
        setInterval(function() {
          if (ready && player && player.getCurrentTime) {
            Android.onTime(player.getCurrentTime(), player.getPlayerState ? player.getPlayerState() : -1);
          }
        }, 250);
        </script></body></html>
        """.trimIndent()
    }

    AndroidView(
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                settings.domStorageEnabled = true
                addJavascriptInterface(bridge, "Android")
                loadDataWithBaseURL("https://www.youtube.com", html, "text/html", "utf-8", null)
                webViewRef.value = this
            }
        },
        onRelease = { it.destroy() },
        modifier = modifier.aspectRatio(16f / 9f).background(Color.Black),
    )
}
