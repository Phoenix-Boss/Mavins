package expo.modules.mavinplayer

import android.app.Activity
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.newpipe.newplayer.NewPlayer
import net.newpipe.newplayer.NewPlayerImpl
import net.newpipe.newplayer.data.PlayMode
import net.newpipe.newplayer.service.NewPlayerService

// ─── Fixes applied in this version ────────────────────────────────────────────
//
// FIX 1 — CRASH: "Player is accessed on the wrong thread"
//   Root cause: observeNewPlayer() collected onExoPlayerEvent on a coroutine bound
//   to Dispatchers.Main (Android main thread). ExoPlayer was created on the React
//   Native JS thread ('mqt_v_js'), which becomes its applicationLooper thread.
//   ExoPlayer.verifyApplicationThread() checks that every call comes from that
//   specific looper thread, not just *any* main-equivalent thread.
//   withContext(Dispatchers.Main) was a no-op when the scope was already on Main
//   and did nothing to switch to the ExoPlayer looper.
//
//   Fix: Read ExoPlayer state (currentPosition, duration, bufferedPercentage) by
//   posting a Runnable to exoPlayer.applicationLooper directly, capturing the
//   values in a suspendCoroutine callback, then emitting the event from any thread.
//   Helper: suspendReadExoState() below.
//
//   Same fix applied to getState() AsyncFunction which also reads those fields.
//
// FIX 2 — WARN: View manager name mismatch
//   expo-modules-core registers views under the name "<ModuleName>_<ViewClassName>".
//   The module name is "MavinPlayer" and the view class is MavinPlayerVideoView, so
//   the exported manager name is "MavinPlayer_MavinPlayerVideoView". The JS side
//   was calling requireNativeViewManager('MavinPlayerVideoView') — wrong name.
//   Fix is in index.ts (requireNativeViewManager('MavinPlayer_MavinPlayerVideoView')).
//   No change needed on the Kotlin side; the View() DSL name is correct.
//
// FIX 3 — Scope resilience: Job() → SupervisorJob()
//   playerScope used raw Job(). If any single coroutine threw an uncaught exception
//   it would cancel the entire scope and silence all subsequent observer coroutines
//   (position ticks, state changes, errors). SupervisorJob() isolates failures so
//   one dead observer doesn't take down the others.
//
// ─────────────────────────────────────────────────────────────────────────────

private const val TAG = "MavinPlayerModule"

class MavinPlayerModule : Module() {

    private var newPlayer: NewPlayer? = null
    // FIX 3: SupervisorJob() so individual observer failures don't cancel the scope.
    private val playerScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var currentVideoId: String? = null
    private var currentPlayMode: PlayMode = PlayMode.FULLSCREEN_AUDIO
    private var repository: MavinMediaRepository? = null

    // ── Companion: ExoPlayer reference for video surface attachment ───────────
    companion object {
        @Volatile
        private var currentExoPlayer: androidx.media3.exoplayer.ExoPlayer? = null

        fun getExoPlayerForSurface(): androidx.media3.exoplayer.ExoPlayer? = currentExoPlayer

        private fun updateExoPlayer(player: androidx.media3.exoplayer.ExoPlayer?) {
            currentExoPlayer = player
        }
    }

    // ── FIX 1 helper ─────────────────────────────────────────────────────────
    //
    // Read position/duration/buffered from ExoPlayer on its own applicationLooper
    // thread, then return the captured values to the calling coroutine.
    //
    // ExoPlayer.verifyApplicationThread() requires that every state-read comes from
    // the looper that was active when the player was built. On React Native that
    // looper belongs to 'mqt_v_js', not to the Android main thread. We post a
    // Runnable to that specific looper via Handler and suspend until it completes.
    //
    // This is the correct cross-thread ExoPlayer access pattern recommended in:
    // https://developer.android.com/guide/topics/media/issues/player-accessed-on-wrong-thread

    private data class ExoState(
        val position: Double,
        val duration: Double,
        val buffered: Int
    )

    private suspend fun suspendReadExoState(
        exoPlayer: androidx.media3.exoplayer.ExoPlayer
    ): ExoState = kotlinx.coroutines.suspendCancellableCoroutine { cont ->
        val handler = android.os.Handler(exoPlayer.applicationLooper)
        handler.post {
            try {
                val state = ExoState(
                    position = exoPlayer.currentPosition.toDouble(),
                    duration = exoPlayer.duration.coerceAtLeast(0L).toDouble(),
                    buffered = exoPlayer.bufferedPercentage
                )
                cont.resume(state) {}
            } catch (e: Exception) {
                cont.resumeWith(Result.failure(e))
            }
        }
    }

    // ── Read isPlaying safely — same looper constraint applies ────────────────

    private suspend fun suspendReadIsPlaying(
        exoPlayer: androidx.media3.exoplayer.ExoPlayer
    ): Boolean = kotlinx.coroutines.suspendCancellableCoroutine { cont ->
        val handler = android.os.Handler(exoPlayer.applicationLooper)
        handler.post {
            try {
                cont.resume(exoPlayer.isPlaying) {}
            } catch (e: Exception) {
                cont.resume(false) {}
            }
        }
    }

    override fun definition() = ModuleDefinition {

        Name("MavinPlayer")

        Events(
            "onPlaybackStateChanged",
            "onPositionChanged",
            "onTrackChanged",
            "onPlaylistChanged",
            "onError"
        )

        // ── Lifecycle ─────────────────────────────────────────────────────────

        OnCreate {
            initializePlayer()
        }

        OnDestroy {
            releasePlayer()
        }

        // ── Video surface view registration ───────────────────────────────────
        //
        // expo-modules-core registers this view under the key:
        //   "MavinPlayer_MavinPlayerVideoView"
        // (pattern: "<ModuleName>_<ViewClassName>")
        // The JS side must use requireNativeViewManager('MavinPlayer_MavinPlayerVideoView').

        View(MavinPlayerVideoView::class) {
            Prop("contentFit") { view: MavinPlayerVideoView, value: String ->
                view.setContentFit(value)
            }
            Prop("allowsPictureInPicture") { view: MavinPlayerVideoView, value: Boolean ->
                view.setAllowsPictureInPicture(value)
            }
            Events("onFirstFrameRender", "onPictureInPictureStart", "onPictureInPictureStop")
        }

        // ── PRIMARY ENTRY POINT — loadAndPlay ─────────────────────────────────

        AsyncFunction("loadAndPlay") { videoId: String, dashUrl: String?, hlsUrl: String?,
                                       progressiveUrl: String?, httpContext: PlayerHttpContext? ->
            ensurePlayerInitialized()
            loadAndPlayInternal(videoId, dashUrl, hlsUrl, progressiveUrl,
                httpContext, PlayMode.FULLSCREEN_AUDIO)
        }

        AsyncFunction("loadAndPlayVideo") { videoId: String, dashUrl: String?, hlsUrl: String?,
                                            progressiveUrl: String?, httpContext: PlayerHttpContext? ->
            ensurePlayerInitialized()
            loadAndPlayInternal(videoId, dashUrl, hlsUrl, progressiveUrl,
                httpContext, PlayMode.FULLSCREEN_VIDEO)
        }

        // ── Legacy playStream ─────────────────────────────────────────────────

        AsyncFunction("playStream") { videoId: String ->
            ensurePlayerInitialized()
            playStreamInternal(videoId, PlayMode.FULLSCREEN_AUDIO)
        }

        AsyncFunction("playStreamEmbedded") { videoId: String ->
            ensurePlayerInitialized()
            playStreamInternal(videoId, PlayMode.EMBEDDED_AUDIO)
        }

        AsyncFunction("playStreamVideo") { videoId: String ->
            ensurePlayerInitialized()
            playStreamInternal(videoId, PlayMode.FULLSCREEN_VIDEO)
        }

        // ── Core playback controls ────────────────────────────────────────────

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

        // ── Queue management ──────────────────────────────────────────────────

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

        // ── Settings ──────────────────────────────────────────────────────────

        AsyncFunction("setRepeatMode") { mode: String ->
            val repeatMode = when (mode) {
                "off" -> net.newpipe.newplayer.data.RepeatMode.DO_NOT_REPEAT
                "one" -> net.newpipe.newplayer.data.RepeatMode.REPEAT_ONE
                "all" -> net.newpipe.newplayer.data.RepeatMode.REPEAT_ALL
                else  -> net.newpipe.newplayer.data.RepeatMode.DO_NOT_REPEAT
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

        // ── State ─────────────────────────────────────────────────────────────
        //
        // FIX 1 applied here: exoPlayer state fields are read via suspendReadExoState()
        // which posts to the player's applicationLooper, satisfying ExoPlayer's
        // verifyApplicationThread() check regardless of which thread calls getState().

        AsyncFunction("getState") {
            val exo = newPlayer?.exoPlayer?.value as? androidx.media3.exoplayer.ExoPlayer
            if (exo != null) {
                val state = suspendReadExoState(exo)
                val isPlaying = suspendReadIsPlaying(exo)
                mapOf(
                    "isPlaying"       to isPlaying,
                    "position"        to state.position,
                    "duration"        to state.duration,
                    "bufferedPercent" to state.buffered,
                    "playMode"        to currentPlayMode.name,
                    "repeatMode"      to when (newPlayer?.repeatMode) {
                        net.newpipe.newplayer.data.RepeatMode.DO_NOT_REPEAT -> "off"
                        net.newpipe.newplayer.data.RepeatMode.REPEAT_ONE    -> "one"
                        net.newpipe.newplayer.data.RepeatMode.REPEAT_ALL    -> "all"
                        else                                                 -> "off"
                    },
                    "shuffle"         to (newPlayer?.shuffle ?: false),
                    "currentItem"     to (currentVideoId ?: "")
                )
            } else {
                mapOf(
                    "isPlaying"       to false,
                    "position"        to 0.0,
                    "duration"        to 0.0,
                    "bufferedPercent" to 0,
                    "playMode"        to currentPlayMode.name,
                    "repeatMode"      to "off",
                    "shuffle"         to false,
                    "currentItem"     to (currentVideoId ?: "")
                )
            }
        }

        AsyncFunction("isInitialized") {
            mapOf("initialized" to (newPlayer != null))
        }

        AsyncFunction("getVersion") {
            mapOf("version" to "1.0.0", "library" to "NewPlayer")
        }
    }

    // ── Private methods ───────────────────────────────────────────────────────

    private fun initializePlayer() {
        if (newPlayer != null) return

        try {
            val appContext = appContext.reactContext?.applicationContext ?: run {
                Log.e(TAG, "Cannot initialize player: application context is null")
                return
            }

            val okHttpClient = okhttp3.OkHttpClient.Builder()
                .cookieJar(okhttp3.CookieJar.NO_COOKIES)
                .build()

            val repo = MavinMediaRepository(appContext, okHttpClient)
            repository = repo

            val playerActivityClass = getMainActivityClass() ?: run {
                Log.e(TAG, "Cannot initialize player: MainActivity class not found")
                return
            }

            val application = appContext as android.app.Application

            newPlayer = NewPlayerImpl(
                app = application,
                playerActivityClass = playerActivityClass,
                repository = repo,
                rescueStreamFault = { item, _, exception, _ ->
                    Log.e(TAG, "Stream fault for item=$item: ${exception.message}")
                    net.newpipe.newplayer.logic.NoResponse()
                }
            )

            newPlayer?.let { NewPlayerService.setNewPlayer(it) }

            // Track live ExoPlayer reference for the video surface view.
            playerScope.launch {
                newPlayer?.exoPlayer?.collectLatest { player ->
                    val exo = player as? androidx.media3.exoplayer.ExoPlayer
                    updateExoPlayer(exo)
                    if (exo != null) {
                        Log.d(TAG, "ExoPlayer reference updated for surface attachment")
                    }
                }
            }

            observeNewPlayer()

            newPlayer?.prepare()
            Log.i(TAG, "NewPlayer initialized successfully")

        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize NewPlayer", e)
        }
    }

    private fun observeNewPlayer() {
        val player = newPlayer ?: return

        // Playback mode / isPlaying state changes.
        // isPlaying is read via suspendReadIsPlaying() to respect ExoPlayer's looper.
        playerScope.launch {
            player.playBackMode.collectLatest { mode ->
                val exo = player.exoPlayer.value as? androidx.media3.exoplayer.ExoPlayer
                val playing = if (exo != null) suspendReadIsPlaying(exo) else false
                sendEvent("onPlaybackStateChanged", mapOf(
                    "state"     to mode.name,
                    "isPlaying" to playing,
                    "playMode"  to mode.name
                ))
            }
        }

        // FIX 1: Position ticks — read ExoPlayer state on its own applicationLooper.
        //
        // The previous code used withContext(Dispatchers.Main) which ran on the
        // Android main thread. ExoPlayer's verifyApplicationThread() rejected this
        // because the player was created on 'mqt_v_js' (the React Native JS thread)
        // and that thread's looper became the player's applicationLooper.
        //
        // suspendReadExoState() posts to exoPlayer.applicationLooper directly, so
        // the read always happens on the correct thread regardless of which
        // coroutine dispatcher is currently active.
        playerScope.launch {
            player.onExoPlayerEvent.collectLatest { (exoPlayer, _) ->
                try {
                    val state = suspendReadExoState(exoPlayer as androidx.media3.exoplayer.ExoPlayer)
                    sendEvent("onPositionChanged", mapOf(
                        "position"        to state.position,
                        "duration"        to state.duration,
                        "bufferedPercent" to state.buffered
                    ))
                } catch (e: Exception) {
                    Log.w(TAG, "observeNewPlayer: failed to read ExoPlayer state: ${e.message}")
                }
            }
        }

        // Track / playlist changes
        playerScope.launch {
            player.currentlyPlaying.collectLatest { mediaItem ->
                val item = mediaItem?.mediaId ?: return@collectLatest
                sendEvent("onTrackChanged", mapOf("item" to item))
            }
        }

        playerScope.launch {
            player.playlist.collectLatest { playlist ->
                sendEvent("onPlaylistChanged", mapOf(
                    "playlist" to playlist.map { it.mediaId }
                ))
            }
        }

        // Error flow
        playerScope.launch {
            player.errorFlow.collectLatest { exception ->
                Log.e(TAG, "NewPlayer error: ${exception.message}")
                sendEvent("onError", mapOf("message" to (exception.message ?: "Unknown error")))
            }
        }
    }

    private fun ensurePlayerInitialized() {
        if (newPlayer == null) initializePlayer()
    }

    private fun releasePlayer() {
        newPlayer?.release()
        newPlayer = null
        repository = null
        updateExoPlayer(null)
        currentVideoId = null
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
        val repo = repository ?: run {
            Log.e(TAG, "loadAndPlayInternal: repository is null")
            return mapOf("success" to false, "error" to "Repository not initialized")
        }
        val player = newPlayer ?: run {
            Log.e(TAG, "loadAndPlayInternal: player is null")
            return mapOf("success" to false, "error" to "Player not initialized")
        }

        currentVideoId = videoId
        currentPlayMode = playMode

        val bundle = ResolvedBundle(
            videoId   = videoId,
            dashManifestUrl      = dashUrl?.takeIf { it.isNotEmpty() },
            hlsManifestUrl       = hlsUrl?.takeIf { it.isNotEmpty() },
            progressiveAudioUrl  = progressiveUrl?.takeIf { it.isNotEmpty() },
            title     = "",
            artist    = null,
            thumbnailUrl = null,
            httpContext = httpContext?.let { ctx ->
                BundleHttpContext(
                    cookie               = ctx.cookie,
                    origin               = ctx.origin,
                    referer              = ctx.referer,
                    acceptLanguage       = ctx.acceptLanguage,
                    xYoutubeClientName   = ctx.xYoutubeClientName,
                    xYoutubeClientVersion = ctx.xYoutubeClientVersion,
                    userAgent            = ctx.userAgent
                )
            } ?: BundleHttpContext()
        )
        repo.storeBundle(bundle)

        return try {
            player.playStream(videoId, playMode)
            Log.i(TAG, "loadAndPlayInternal: playStream dispatched for $videoId " +
                "mode=${playMode.name} hasDash=${dashUrl != null} hasHls=${hlsUrl != null} " +
                "cookiePresent=${httpContext?.cookie?.isNotEmpty() == true}")
            mapOf("success" to true)
        } catch (e: Exception) {
            Log.e(TAG, "loadAndPlayInternal: playStream failed for $videoId", e)
            mapOf("success" to false, "error" to (e.message ?: "playStream failed"))
        }
    }

    private fun playStreamInternal(videoId: String, playMode: PlayMode): Map<String, Any> {
        val player = newPlayer ?: return mapOf("success" to false, "error" to "Player not initialized")

        currentVideoId = videoId
        currentPlayMode = playMode

        return try {
            player.playStream(videoId, playMode)
            Log.i(TAG, "playStreamInternal: playStream dispatched for $videoId mode=${playMode.name}")
            mapOf("success" to true)
        } catch (e: Exception) {
            Log.e(TAG, "playStreamInternal: failed for $videoId", e)
            mapOf("success" to false, "error" to (e.message ?: "Unknown error"))
        }
    }

    private fun getMainActivityClass(): Class<out Activity>? {
        return try {
            Class.forName("com.mavins.player.MainActivity").asSubclass(Activity::class.java)
        } catch (e: ClassNotFoundException) {
            Log.e(TAG, "MainActivity class not found", e)
            null
        }
    }

    // ── PlayerHttpContext ─────────────────────────────────────────────────────

    class PlayerHttpContext : expo.modules.kotlin.records.Record {
        @expo.modules.kotlin.records.Field
        var cookie: String = ""

        @expo.modules.kotlin.records.Field
        var origin: String = ""

        @expo.modules.kotlin.records.Field
        var referer: String = ""

        @expo.modules.kotlin.records.Field
        var acceptLanguage: String = ""

        @expo.modules.kotlin.records.Field
        var xYoutubeClientName: String = ""

        @expo.modules.kotlin.records.Field
        var xYoutubeClientVersion: String = ""

        @expo.modules.kotlin.records.Field
        var userAgent: String = ""
    }
}