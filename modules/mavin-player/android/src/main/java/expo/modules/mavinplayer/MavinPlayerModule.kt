package expo.modules.mavinplayer

import android.app.Activity
import android.util.Log
import expo.modules.kotlin.functions.Queues
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

// ─── Threading model ──────────────────────────────────────────────────────────
//
// ExoPlayer must be created AND accessed on the Android main thread (Looper.main).
//
// expo-modules-core calls OnCreate / OnDestroy and AsyncFunction lambdas on a
// background thread ('expo.modules.AsyncFunctionQueue'). NewPlayerImpl has NO
// internal thread-switching — its entire public API (play, pause, prepare,
// playStream, etc.) assumes the caller is already on the main thread, because
// its own playerScope is Dispatchers.Main.
//
// ── Official solution (docs.expo.dev/modules/module-api) ─────────────────────
//
// Option A — .runOnQueue(Queues.MAIN)
//   Makes the entire AsyncFunction body run on the Android main thread.
//   Used by expo's own first-party modules (expo-navigation-bar, expo-system-ui).
//   Best for fire-and-forget calls: play, pause, seekTo, loadAndPlay, etc.
//
//     AsyncFunction("play") { newPlayer?.play() }.runOnQueue(Queues.MAIN)
//
// Option B — AsyncFunction("name") Coroutine { ... }
//   Runs the body as a suspend function in the module's coroutine scope.
//   withContext(Dispatchers.Main) { ... } is valid inside.
//   Best when you need to return a computed value from ExoPlayer (getState).
//
//     AsyncFunction("getState") Coroutine {
//         withContext(Dispatchers.Main) { mapOf(...) }
//     }
//
// NEVER use runBlocking { withContext(Dispatchers.Main) { ... } }:
//   Blocks AsyncFunctionQueue while waiting for the main thread, which can
//   deadlock if the main thread is dispatching back to the same queue.
//
// ─── ExoPlayer construction thread ───────────────────────────────────────────
//
// initializePlayer() launches prepare() via playerScope (Dispatchers.Main) so
// ExoPlayer is built on the main thread and records it as its applicationLooper.
// All .runOnQueue(Queues.MAIN) calls and withContext(Dispatchers.Main) blocks
// then satisfy ExoPlayer's verifyApplicationThread() check.
//
// ─────────────────────────────────────────────────────────────────────────────

private const val TAG = "MavinPlayerModule"

class MavinPlayerModule : Module() {

    private var newPlayer: NewPlayer? = null
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
            // NOTE: No Events() call here. The three EventDispatcher fields on
            // MavinPlayerVideoView (onFirstFrameRender, onPictureInPictureStart,
            // onPictureInPictureStop) are discovered automatically by expo-modules-core
            // via reflection when this View() block is processed. An explicit Events()
            // call alongside EventDispatcher fields collides with the module-level
            // Events() block, causing NativeViewManagerAdapter to mis-report the view
            // config to the JS bridge — producing:
            //   "Unable to get the view config for MavinPlayer_MavinPlayerVideoView
            //    from module default view"
        }

        // ── PRIMARY ENTRY POINT — loadAndPlay ─────────────────────────────────
        //
        // .runOnQueue(Queues.MAIN) ensures the entire lambda runs on the Android
        // main thread. NewPlayerImpl.playStream() dispatches internally via its
        // own Dispatchers.Main playerScope, so it must be called from main thread.

        AsyncFunction("loadAndPlay") { videoId: String, dashUrl: String?, hlsUrl: String?,
                                       progressiveUrl: String?, httpContext: PlayerHttpContext? ->
            ensurePlayerInitialized()
            loadAndPlayInternal(videoId, dashUrl, hlsUrl, progressiveUrl,
                httpContext, PlayMode.FULLSCREEN_AUDIO)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("loadAndPlayVideo") { videoId: String, dashUrl: String?, hlsUrl: String?,
                                            progressiveUrl: String?, httpContext: PlayerHttpContext? ->
            ensurePlayerInitialized()
            loadAndPlayInternal(videoId, dashUrl, hlsUrl, progressiveUrl,
                httpContext, PlayMode.FULLSCREEN_VIDEO)
        }.runOnQueue(Queues.MAIN)

        // ── Legacy playStream ─────────────────────────────────────────────────

        AsyncFunction("playStream") { videoId: String ->
            ensurePlayerInitialized()
            playStreamInternal(videoId, PlayMode.FULLSCREEN_AUDIO)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("playStreamEmbedded") { videoId: String ->
            ensurePlayerInitialized()
            playStreamInternal(videoId, PlayMode.EMBEDDED_AUDIO)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("playStreamVideo") { videoId: String ->
            ensurePlayerInitialized()
            playStreamInternal(videoId, PlayMode.FULLSCREEN_VIDEO)
        }.runOnQueue(Queues.MAIN)

        // ── Core playback controls ────────────────────────────────────────────
        //
        // Each AsyncFunction runs on Queues.MAIN. NewPlayerImpl.play/pause/prepare
        // call ExoPlayer directly without any internal thread switch — they require
        // the caller to already be on the main thread.

        AsyncFunction("play") {
            newPlayer?.play()
            mapOf("success" to true)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("pause") {
            newPlayer?.pause()
            mapOf("success" to true)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("prepare") {
            newPlayer?.prepare()
            mapOf("success" to true)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("release") {
            releasePlayer()
            mapOf("success" to true)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("seekTo") { positionMs: Int ->
            newPlayer?.currentPosition = positionMs.toLong()
            mapOf("success" to true)
        }.runOnQueue(Queues.MAIN)

        // ── Queue management ──────────────────────────────────────────────────

        AsyncFunction("addToPlaylist") { videoId: String ->
            newPlayer?.addToPlaylist(videoId)
            mapOf("success" to true)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("removeFromPlaylist") { uniqueId: Int ->
            newPlayer?.removePlaylistItem(uniqueId.toLong())
            mapOf("success" to true)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("movePlaylistItem") { fromIndex: Int, toIndex: Int ->
            newPlayer?.movePlaylistItem(fromIndex, toIndex)
            mapOf("success" to true)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("skipToPlaylistItem") { index: Int ->
            newPlayer?.currentlyPlayingPlaylistItem = index
            mapOf("success" to true)
        }.runOnQueue(Queues.MAIN)

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
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("setShuffle") { enabled: Boolean ->
            newPlayer?.shuffle = enabled
            mapOf("success" to true)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("setPlaybackSpeed") { speed: Float ->
            val exo = newPlayer?.exoPlayer?.value as? androidx.media3.exoplayer.ExoPlayer
            exo?.setPlaybackSpeed(speed)
            mapOf("success" to true)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("selectChapter") { index: Int ->
            try {
                newPlayer?.selectChapter(index)
                mapOf("success" to true)
            } catch (e: IndexOutOfBoundsException) {
                mapOf("success" to false, "error" to e.message)
            }
        }.runOnQueue(Queues.MAIN)

        // ── State ─────────────────────────────────────────────────────────────
        //
        // getState reads multiple ExoPlayer properties, so we use the Coroutine
        // body form (Option B) with withContext(Dispatchers.Main) rather than
        // .runOnQueue(Queues.MAIN). Both are correct; this form avoids tying up
        // the main thread for the duration of a potentially heavier read.
        //
        // Syntax: AsyncFunction("name") Coroutine { ... }
        // — runs in the module's coroutine scope
        // — withContext(Dispatchers.Main) is valid here because it IS a suspend fn

        AsyncFunction("getState") Coroutine {
            val exo = newPlayer?.exoPlayer?.value as? androidx.media3.exoplayer.ExoPlayer
            if (exo != null) {
                withContext(Dispatchers.Main) {
                    mapOf(
                        "isPlaying"       to exo.isPlaying,
                        "position"        to exo.currentPosition.toDouble(),
                        "duration"        to exo.duration.coerceAtLeast(0L).toDouble(),
                        "bufferedPercent" to exo.bufferedPercentage,
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
                }
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

            // CRITICAL: prepare() calls setupNewExoplayer() → ExoPlayer.Builder.build().
            // ExoPlayer records the looper of the thread it's built on as its
            // applicationLooper. We must build it on Dispatchers.Main (the Android main
            // thread) so that all subsequent main-thread accesses pass
            // verifyApplicationThread(). OnCreate fires on mqt_v_js — if we called
            // prepare() directly here, ExoPlayer would record mqt_v_js as its looper
            // and reject every Dispatchers.Main access with "wrong thread".
            playerScope.launch { newPlayer?.prepare() }
            Log.i(TAG, "NewPlayer initialized successfully")

        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize NewPlayer", e)
        }
    }

    private fun observeNewPlayer() {
        val player = newPlayer ?: return

        // Playback mode / isPlaying state changes — read isPlaying on the main thread.
        playerScope.launch {
            player.playBackMode.collectLatest { mode ->
                val exo = player.exoPlayer.value as? androidx.media3.exoplayer.ExoPlayer
                val playing = if (exo != null) {
                    withContext(Dispatchers.Main) { exo.isPlaying }
                } else false
                sendEvent("onPlaybackStateChanged", mapOf(
                    "state"     to mode.name,
                    "isPlaying" to playing,
                    "playMode"  to mode.name
                ))
            }
        }

        // Position ticks — read ExoPlayer state on the main thread (where it was built).
        playerScope.launch {
            player.onExoPlayerEvent.collectLatest { (exoPlayer, _) ->
                try {
                    val exo = exoPlayer as androidx.media3.exoplayer.ExoPlayer
                    val (position, duration, buffered) = withContext(Dispatchers.Main) {
                        Triple(
                            exo.currentPosition.toDouble(),
                            exo.duration.coerceAtLeast(0L).toDouble(),
                            exo.bufferedPercentage
                        )
                    }
                    sendEvent("onPositionChanged", mapOf(
                        "position"        to position,
                        "duration"        to duration,
                        "bufferedPercent" to buffered
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