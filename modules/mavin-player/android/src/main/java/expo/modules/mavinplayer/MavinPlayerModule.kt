package expo.modules.mavinplayer

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.upstream.HttpDataSource
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import net.newpipe.newplayer.NewPlayer
import net.newpipe.newplayer.NewPlayerImpl
import net.newpipe.newplayer.data.PlayMode
import net.newpipe.newplayer.service.NewPlayerService

private const val TAG = "MavinPlayerModule"

class MavinPlayerModule : Module() {

    private var newPlayer: NewPlayer? = null
    private var playerScope = CoroutineScope(Dispatchers.Main + Job())
    private var currentVideoId: String? = null
    private var currentPlayMode: PlayMode = PlayMode.AUDIO

    // Stored bundle from loadAndPlay
    private var storedDashUrl: String? = null
    private var storedHlsUrl: String? = null
    private var storedProgressiveUrl: String? = null
    private var storedHttpContext: PlayerHttpContext? = null

    // Static reference for surface attachment
    companion object {
        @Volatile
        private var currentExoPlayer: ExoPlayer? = null

        fun getExoPlayerForSurface(): ExoPlayer? {
            return currentExoPlayer
        }

        private fun updateExoPlayer(player: ExoPlayer?) {
            currentExoPlayer = player
        }
    }

    override fun definition() = ModuleDefinition {
        Name("MavinPlayer")

        // ─────────────────────────────────────────────────────────────────────────
        // INITIALIZATION
        // ─────────────────────────────────────────────────────────────────────────

        OnCreate {
            initializePlayer()
        }

        OnDestroy {
            releasePlayer()
        }

        // ─────────────────────────────────────────────────────────────────────────
        // VIEW MANAGER REGISTRATION - FIX FOR MavinPlayerVideoView WARNING
        // ─────────────────────────────────────────────────────────────────────────
        // This registers the native video surface component so that
        // requireNativeViewManager('MavinPlayerVideoView') can find it.
        // The view name must match exactly what is used in index.ts

        View(MavinPlayerVideoViewManager.define())

        // ─────────────────────────────────────────────────────────────────────────
        // PRIMARY ENTRY POINT - loadAndPlay
        // ─────────────────────────────────────────────────────────────────────────

        AsyncFunction("loadAndPlay") { videoId: String, dashUrl: String?, hlsUrl: String?, progressiveUrl: String?, httpContext: PlayerHttpContext? ->
            ensurePlayerInitialized()
            loadAndPlayInternal(videoId, dashUrl, hlsUrl, progressiveUrl, httpContext, PlayMode.AUDIO)
        }

        AsyncFunction("loadAndPlayVideo") { videoId: String, dashUrl: String?, hlsUrl: String?, progressiveUrl: String?, httpContext: PlayerHttpContext? ->
            ensurePlayerInitialized()
            loadAndPlayInternal(videoId, dashUrl, hlsUrl, progressiveUrl, httpContext, PlayMode.VIDEO)
        }

        // ─────────────────────────────────────────────────────────────────────────
        // LEGACY playStream - kept for backwards compatibility
        // ─────────────────────────────────────────────────────────────────────────

        AsyncFunction("playStream") { videoId: String ->
            ensurePlayerInitialized()
            playStreamInternal(videoId, PlayMode.AUDIO)
        }

        AsyncFunction("playStreamEmbedded") { videoId: String ->
            ensurePlayerInitialized()
            playStreamInternal(videoId, PlayMode.EMBEDDED)
        }

        AsyncFunction("playStreamVideo") { videoId: String ->
            ensurePlayerInitialized()
            playStreamInternal(videoId, PlayMode.VIDEO)
        }

        // ─────────────────────────────────────────────────────────────────────────
        // CORE PLAYBACK CONTROLS
        // ─────────────────────────────────────────────────────────────────────────

        AsyncFunction("play") {
            newPlayer?.play()
            mapOf("success" to true)
        }

        AsyncFunction("pause") {
            newPlayer?.pause()
            mapOf("success" to true)
        }

        AsyncFunction("prepare") {
            newPlayer?.prepare()
            mapOf("success" to true)
        }

        AsyncFunction("release") {
            releasePlayer()
            mapOf("success" to true)
        }

        AsyncFunction("seekTo") { positionMs: Int ->
            newPlayer?.currentPosition = positionMs.toLong()
            mapOf("success" to true)
        }

        // ─────────────────────────────────────────────────────────────────────────
        // QUEUE MANAGEMENT
        // ─────────────────────────────────────────────────────────────────────────

        AsyncFunction("addToPlaylist") { videoId: String ->
            newPlayer?.addToPlaylist(videoId)
            mapOf("success" to true)
        }

        AsyncFunction("removeFromPlaylist") { uniqueId: Int ->
            newPlayer?.removePlaylistItem(uniqueId.toLong())
            mapOf("success" to true)
        }

        AsyncFunction("movePlaylistItem") { fromIndex: Int, toIndex: Int ->
            newPlayer?.movePlaylistItem(fromIndex, toIndex)
            mapOf("success" to true)
        }

        AsyncFunction("skipToPlaylistItem") { index: Int ->
            newPlayer?.currentlyPlayingPlaylistItem = index
            mapOf("success" to true)
        }

        // ─────────────────────────────────────────────────────────────────────────
        // SETTINGS
        // ─────────────────────────────────────────────────────────────────────────

        AsyncFunction("setRepeatMode") { mode: String ->
            val repeatMode = when (mode) {
                "off" -> net.newpipe.newplayer.data.RepeatMode.DO_NOT_REPEAT
                "one" -> net.newpipe.newplayer.data.RepeatMode.REPEAT_ONE
                "all" -> net.newpipe.newplayer.data.RepeatMode.REPEAT_ALL
                else -> net.newpipe.newplayer.data.RepeatMode.DO_NOT_REPEAT
            }
            newPlayer?.repeatMode = repeatMode
            mapOf("success" to true)
        }

        AsyncFunction("setShuffle") { enabled: Boolean ->
            newPlayer?.shuffle = enabled
            mapOf("success" to true)
        }

        AsyncFunction("setPlaybackSpeed") { speed: Float ->
            newPlayer?.exoPlayer?.value?.setPlaybackSpeed(speed)
            mapOf("success" to true)
        }

        AsyncFunction("selectChapter") { index: Int ->
            try {
                newPlayer?.selectChapter(index)
                mapOf("success" to true)
            } catch (e: IndexOutOfBoundsException) {
                mapOf("success" to false, "error" to e.message)
            }
        }

        // ─────────────────────────────────────────────────────────────────────────
        // STATE
        // ─────────────────────────────────────────────────────────────────────────

        AsyncFunction("getState") {
            val player = newPlayer?.exoPlayer?.value
            mapOf(
                "isPlaying" to (player?.isPlaying ?: false),
                "position" to (player?.currentPosition?.toDouble() ?: 0.0),
                "duration" to (player?.duration?.toDouble() ?: 0.0),
                "bufferedPercent" to (player?.bufferedPercentage ?: 0),
                "playMode" to currentPlayMode.name,
                "repeatMode" to when (newPlayer?.repeatMode) {
                    net.newpipe.newplayer.data.RepeatMode.DO_NOT_REPEAT -> "off"
                    net.newpipe.newplayer.data.RepeatMode.REPEAT_ONE -> "one"
                    net.newpipe.newplayer.data.RepeatMode.REPEAT_ALL -> "all"
                    else -> "off"
                },
                "shuffle" to (newPlayer?.shuffle ?: false),
                "currentItem" to (currentVideoId ?: "")
            )
        }

        // ─────────────────────────────────────────────────────────────────────────
        // HELPER FUNCTIONS
        // ─────────────────────────────────────────────────────────────────────────

        AsyncFunction("isInitialized") {
            mapOf("initialized" to (newPlayer != null))
        }

        AsyncFunction("getVersion") {
            mapOf("version" to "1.0.0", "library" to "NewPlayer")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE METHODS
    // ─────────────────────────────────────────────────────────────────────────

    private fun initializePlayer() {
        if (newPlayer != null) return

        try {
            val appContext = appContext.reactContext?.applicationContext ?: run {
                Log.e(TAG, "Cannot initialize player: application context is null")
                return
            }

            val okHttpClient = net.okhttp3.OkHttpClient.Builder()
                .cookieJar(net.okhttp3.CookieJar.NO_COOKIES)
                .build()

            val repository = MavinMediaRepository(appContext, okHttpClient)
            val playerActivityClass = getMainActivityClass()

            if (playerActivityClass == null) {
                Log.e(TAG, "Cannot initialize player: MainActivity class not found")
                return
            }

            newPlayer = NewPlayerImpl(
                app = appContext,
                playerActivityClass = playerActivityClass,
                repository = repository,
                rescueStreamFault = { item, mediaItem, exception, repo ->
                    Log.e(TAG, "Stream fault: ${exception.message}")
                    net.newpipe.newplayer.logic.NoResponse()
                }
            )

            // CRITICAL FIX: Store the NewPlayer instance in NewPlayerService companion holder
            // This ensures the service can retrieve it when Android starts it for background playback
            val playerInstance = newPlayer
            if (playerInstance != null) {
                NewPlayerService.setNewPlayer(playerInstance)
                Log.i(TAG, "NewPlayer instance stored in NewPlayerService companion holder")
            }

            // Update companion ExoPlayer reference for surface attachment
            newPlayer?.exoPlayer?.value?.let { exoPlayer ->
                updateExoPlayer(exoPlayer)
                Log.i(TAG, "ExoPlayer reference stored for surface attachment")
            }

            newPlayer?.prepare()
            Log.i(TAG, "NewPlayer initialized successfully")

        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize NewPlayer", e)
        }
    }

    private fun ensurePlayerInitialized() {
        if (newPlayer == null) {
            initializePlayer()
        }
    }

    private fun releasePlayer() {
        newPlayer?.release()
        newPlayer = null
        updateExoPlayer(null)
        currentVideoId = null
        storedDashUrl = null
        storedHlsUrl = null
        storedProgressiveUrl = null
        storedHttpContext = null
        Log.i(TAG, "NewPlayer released")
    }

    private fun loadAndPlayInternal(
        videoId: String,
        dashUrl: String?,
        hlsUrl: String?,
        progressiveUrl: String?,
        httpContext: PlayerHttpContext?,
        playMode: PlayMode
    ): Map<String, Any> {
        currentVideoId = videoId
        currentPlayMode = playMode

        // Store the bundle for potential future use
        storedDashUrl = dashUrl
        storedHlsUrl = hlsUrl
        storedProgressiveUrl = progressiveUrl
        storedHttpContext = httpContext

        // Build the stream URL based on priority: DASH > HLS > Progressive
        val streamUrl = when {
            !dashUrl.isNullOrEmpty() -> {
                Log.i(TAG, "Using DASH manifest for $videoId")
                dashUrl
            }
            !hlsUrl.isNullOrEmpty() -> {
                Log.i(TAG, "Using HLS manifest for $videoId")
                hlsUrl
            }
            !progressiveUrl.isNullOrEmpty() -> {
                Log.i(TAG, "Using progressive URL for $videoId (may have limited quality)")
                progressiveUrl
            }
            else -> {
                Log.e(TAG, "No stream URL provided for $videoId")
                return mapOf("success" to false, "error" to "No stream URL provided")
            }
        }

        // Store the resolved bundle in the repository
        val bundle = ResolvedBundle(
            videoId = videoId,
            dashManifestUrl = dashUrl,
            hlsManifestUrl = hlsUrl,
            progressiveAudioUrl = progressiveUrl,
            title = "",
            artist = null,
            thumbnailUrl = null,
            httpContext = httpContext?.let { ctx ->
                BundleHttpContext(
                    cookie = ctx.cookie,
                    origin = ctx.origin,
                    referer = ctx.referer,
                    acceptLanguage = ctx.acceptLanguage,
                    xYoutubeClientName = ctx.xYoutubeClientName,
                    xYoutubeClientVersion = ctx.xYoutubeClientVersion,
                    userAgent = ctx.userAgent
                )
            } ?: BundleHttpContext()
        )

        val repository = (newPlayer as? NewPlayerImpl)?.repository as? MavinMediaRepository
        repository?.storeBundle(bundle)

        val success = playStreamWithResolvedUrl(videoId, streamUrl, httpContext, playMode)

        return mapOf("success" to success)
    }

    private fun playStreamWithResolvedUrl(
        videoId: String,
        streamUrl: String,
        httpContext: PlayerHttpContext?,
        playMode: PlayMode
    ): Boolean {
        return try {
            val exoPlayer = newPlayer?.exoPlayer?.value
            if (exoPlayer == null) {
                Log.e(TAG, "ExoPlayer is null, cannot play")
                return false
            }

            // Update companion reference for surface attachment
            updateExoPlayer(exoPlayer)

            // Build MediaItem with custom headers if httpContext is provided
            val mediaItemBuilder = MediaItem.Builder()
                .setUri(Uri.parse(streamUrl))
                .setMediaId(videoId)

            // Add custom headers from httpContext if present
            httpContext?.let { ctx ->
                val headers = mutableMapOf<String, String>()
                if (ctx.cookie.isNotEmpty()) {
                    headers["Cookie"] = ctx.cookie
                }
                if (ctx.origin.isNotEmpty()) {
                    headers["Origin"] = ctx.origin
                }
                if (ctx.referer.isNotEmpty()) {
                    headers["Referer"] = ctx.referer
                }
                if (ctx.userAgent.isNotEmpty()) {
                    headers["User-Agent"] = ctx.userAgent
                }
                if (headers.isNotEmpty()) {
                    mediaItemBuilder.setCustomHeaders(headers)
                }
                Log.d(TAG, "Added ${headers.size} custom headers to MediaItem")
            }

            val mediaItem = mediaItemBuilder.build()

            // Clear existing items and set the new one
            exoPlayer.clearMediaItems()
            exoPlayer.setMediaItem(mediaItem)
            exoPlayer.prepare()
            exoPlayer.play()

            Log.i(TAG, "Playing $videoId with ${if (httpContext != null) "session context" else "no session context"}")
            true

        } catch (e: Exception) {
            Log.e(TAG, "Failed to play stream with resolved URL", e)
            false
        }
    }

    private fun playStreamInternal(videoId: String, playMode: PlayMode): Map<String, Any> {
        currentVideoId = videoId
        currentPlayMode = playMode

        // If we have stored bundle from loadAndPlay, use it
        if (!storedDashUrl.isNullOrEmpty() || !storedHlsUrl.isNullOrEmpty() || !storedProgressiveUrl.isNullOrEmpty()) {
            val streamUrl = when {
                !storedDashUrl.isNullOrEmpty() -> storedDashUrl
                !storedHlsUrl.isNullOrEmpty() -> storedHlsUrl
                else -> storedProgressiveUrl
            }
            if (!streamUrl.isNullOrEmpty()) {
                val success = playStreamWithResolvedUrl(videoId, streamUrl, storedHttpContext, playMode)
                return mapOf("success" to success)
            }
        }

        // Fallback: let NewPlayer resolve it via repository
        try {
            newPlayer?.playStream(videoId, playMode)
            // Update companion reference for surface attachment
            newPlayer?.exoPlayer?.value?.let { updateExoPlayer(it) }
            Log.i(TAG, "Playing $videoId via NewPlayer repository resolution")
            return mapOf("success" to true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to play stream $videoId", e)
            return mapOf("success" to false, "error" to e.message)
        }
    }

    private fun getMainActivityClass(): Class<out Activity>? {
        return try {
            val appContext = appContext.reactContext?.applicationContext ?: return null
            Class.forName("com.mavins.player.MainActivity").asSubclass(Activity::class.java)
        } catch (e: ClassNotFoundException) {
            Log.e(TAG, "MainActivity class not found", e)
            null
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DATA CLASSES
    // ─────────────────────────────────────────────────────────────────────────

    data class PlayerHttpContext(
        val cookie: String,
        val origin: String,
        val referer: String,
        val acceptLanguage: String,
        val xYoutubeClientName: String,
        val xYoutubeClientVersion: String,
        val userAgent: String
    )
}