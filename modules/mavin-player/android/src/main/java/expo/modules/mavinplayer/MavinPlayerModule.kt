package expo.modules.mavinplayer

import android.app.Activity
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import net.newpipe.newplayer.NewPlayer
import net.newpipe.newplayer.NewPlayerImpl
import net.newpipe.newplayer.data.PlayMode
import net.newpipe.newplayer.service.NewPlayerService

// ─── What changed from the previous version ───────────────────────────────────
//
// 1. Removed the entire bypass architecture (playStreamWithResolvedUrl, storedDashUrl,
//    storedHlsUrl, storedProgressiveUrl, storedHttpContext, direct ExoPlayer manipulation).
//    That bypass skipped NewPlayer's playStream() and therefore never called
//    repository.getHttpDataSourceFactory() — meaning CDN requests went out with no
//    headers and caused 403s.
//
// 2. loadAndPlayInternal() now:
//      a. Stores the bundle in MavinMediaRepository (unchanged).
//      b. Calls newPlayer.playStream(videoId, playMode) — the correct NewPlayer API.
//    NewPlayer.playStream() → repository.getStreams() → AutoStreamSelector → MediaSourceBuilder
//    → repository.getHttpDataSourceFactory() → OkHttpDataSource.Factory with all YouTube
//    session headers. This is the one-cycle industry-standard path.
//
// 3. PlayMode enum values corrected:
//      AUDIO    → PlayMode.FULLSCREEN_AUDIO
//      VIDEO    → PlayMode.FULLSCREEN_VIDEO
//      EMBEDDED → PlayMode.EMBEDDED_AUDIO
//    These are the exact values defined in NewPlayer's PlayMode enum.
//
// 4. playStreamInternal() simplified: it stores the bundle (if present) then delegates
//    to newPlayer.playStream(). The old "if we have a stored bundle use it" special-case
//    is gone — the repository already handles that correctly.
//
// 5. observeNewPlayer() wired into OnCreate so JS events fire as soon as the module loads.
//    ExoPlayer reference is updated whenever NewPlayer's exoPlayer StateFlow emits,
//    so the video surface always gets the live instance even after a player rebuild.
//
// 6. getState() now reads position/duration from exoPlayer.value instead of a cached field,
//    and converts Long milliseconds to Double for JS consistency.
//
// 7. PlayerHttpContext data class kept here — it is the bridge type that JS passes over
//    the React Native bridge. It is separate from BundleHttpContext (Kotlin-internal).
//
// ─────────────────────────────────────────────────────────────────────────────

private const val TAG = "MavinPlayerModule"

class MavinPlayerModule : Module() {

    private var newPlayer: NewPlayer? = null
    private val playerScope = CoroutineScope(Dispatchers.Main + Job())
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
        // The View() DSL registers MavinPlayerVideoView with expo-modules-core so
        // requireNativeViewManager('MavinPlayerVideoView') resolves on the JS side.
        // Props and events declared here are the only ones the component exposes.

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
        //
        // Industry-standard one-cycle flow:
        //   JS resolves once via MavinEngine → gets URLs + HTTP context
        //   JS calls loadAndPlay() with the complete bundle
        //   Kotlin stores bundle in MavinMediaRepository
        //   newPlayer.playStream() calls repository.getStreams() (zero network)
        //   MediaSourceBuilder calls repository.getHttpDataSourceFactory() (zero network)
        //   ExoPlayer fetches CDN segments with the exact same session that extracted
        //
        // httpContext travels as one inseparable package with the URLs.
        // OkHttpDataSource.Factory injects all YouTube session headers on every
        // CDN segment request. YouTube sees one continuous authenticated session.

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

        // ── Legacy playStream — kept for backwards compatibility ───────────────
        //
        // Will only work if a bundle is already stored in the repository
        // (i.e. a prior loadAndPlay() was called in this process lifecycle).
        // The cold-restore path in MusicPlayerContext now uses loadAndPlay()
        // via moduleLevelLoadAndPlay(), so this is only hit by edge-cases.

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

        AsyncFunction("getState") {
            val exo = newPlayer?.exoPlayer?.value
            mapOf(
                "isPlaying"      to (exo?.isPlaying ?: false),
                "position"       to (exo?.currentPosition?.toDouble() ?: 0.0),
                "duration"       to (exo?.duration?.coerceAtLeast(0L)?.toDouble() ?: 0.0),
                "bufferedPercent" to (exo?.bufferedPercentage ?: 0),
                "playMode"       to currentPlayMode.name,
                "repeatMode"     to when (newPlayer?.repeatMode) {
                    net.newpipe.newplayer.data.RepeatMode.DO_NOT_REPEAT -> "off"
                    net.newpipe.newplayer.data.RepeatMode.REPEAT_ONE    -> "one"
                    net.newpipe.newplayer.data.RepeatMode.REPEAT_ALL    -> "all"
                    else                                                 -> "off"
                },
                "shuffle"        to (newPlayer?.shuffle ?: false),
                "currentItem"    to (currentVideoId ?: "")
            )
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

            // OkHttpClient with NO cookie jar.
            // All cookies are injected as raw "Cookie" headers from the bundle context.
            // This prevents OkHttp from silently overriding bundle cookies with stale
            // values from a built-in cookie store.
            val okHttpClient = okhttp3.OkHttpClient.Builder()
                .cookieJar(okhttp3.CookieJar.NO_COOKIES)
                .build()

            val repo = MavinMediaRepository(appContext, okHttpClient)
            repository = repo

            val playerActivityClass = getMainActivityClass() ?: run {
                Log.e(TAG, "Cannot initialize player: MainActivity class not found")
                return
            }

            // NewPlayerImpl requires Application, not Context.
            // applicationContext IS the Application instance on Android.
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

            // Store the NewPlayer instance in NewPlayerService companion holder so the
            // MediaSessionService can retrieve it when Android starts it for background playback.
            newPlayer?.let { NewPlayerService.setNewPlayer(it) }

            // Observe NewPlayer's ExoPlayer StateFlow so the companion reference stays
            // current even if NewPlayer rebuilds ExoPlayer internally (e.g. after release).
            playerScope.launch {
                newPlayer?.exoPlayer?.collectLatest { player ->
                    val exo = player as? androidx.media3.exoplayer.ExoPlayer
                    updateExoPlayer(exo)
                    if (exo != null) {
                        Log.d(TAG, "ExoPlayer reference updated for surface attachment")
                    }
                }
            }

            // Observe playback state and position to fire JS events.
            observeNewPlayer()

            newPlayer?.prepare()
            Log.i(TAG, "NewPlayer initialized successfully")

        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize NewPlayer", e)
        }
    }

    private fun observeNewPlayer() {
        val player = newPlayer ?: return

        // Playback mode / isPlaying state changes
        playerScope.launch {
            player.playBackMode.collectLatest { mode ->
                val exo = player.exoPlayer.value
                sendEvent("onPlaybackStateChanged", mapOf(
                    "state"     to mode.name,
                    "isPlaying" to (exo?.isPlaying ?: false),
                    "playMode"  to mode.name
                ))
            }
        }

        // Position + duration + buffered ticks from ExoPlayer events
        playerScope.launch {
            player.onExoPlayerEvent.collectLatest { (exoPlayer, _) ->
                sendEvent("onPositionChanged", mapOf(
                    "position"       to exoPlayer.currentPosition.toDouble(),
                    "duration"       to exoPlayer.duration.coerceAtLeast(0L).toDouble(),
                    "bufferedPercent" to exoPlayer.bufferedPercentage
                ))
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

    // ── loadAndPlayInternal ───────────────────────────────────────────────────
    //
    // This is the one-cycle handoff. It does two things:
    //   1. Stores the complete bundle (URLs + HTTP context) in MavinMediaRepository.
    //   2. Calls newPlayer.playStream(videoId, playMode).
    //
    // NewPlayer.playStream() then:
    //   → calls repository.getStreams(videoId)          ← reads from stored bundle
    //   → AutoStreamSelector picks DASH > HLS > progressive
    //   → MediaSourceBuilder calls repository.getHttpDataSourceFactory(videoId)
    //                                                   ← builds OkHttpDataSource.Factory
    //                                                      with all YouTube session headers
    //   → ExoPlayer receives a MediaSource backed by that factory
    //   → CDN segment requests carry Cookie, Origin, Referer, User-Agent
    //   → YouTube CDN sees one continuous authenticated session → no 403
    //
    // This is the correct path. The previous version bypassed this entirely
    // by calling exoPlayer.setMediaItem() directly, which skipped the factory.

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

        // Step 1 — Store the bundle. This is an in-memory atomic swap.
        // repository.getStreams() and repository.getHttpDataSourceFactory() both read
        // from this same snapshot so they are always consistent with each other.
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

        // Step 2 — Delegate to NewPlayer. This triggers the full one-cycle path:
        // getStreams() → AutoStreamSelector → MediaSourceBuilder → getHttpDataSourceFactory()
        // → OkHttpDataSource.Factory → ExoPlayer with authenticated session.
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

    // ── playStreamInternal ────────────────────────────────────────────────────
    //
    // Legacy path. Assumes the repository already has a bundle stored from a prior
    // loadAndPlay() call. Delegates directly to newPlayer.playStream() — same
    // one-cycle path as loadAndPlayInternal, just without storing a new bundle.

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
    //
    // Bridge type: this is what crosses the React Native bridge from JS.
    // It is mapped to BundleHttpContext (the Kotlin-internal type) inside
    // loadAndPlayInternal(). Keeping them separate means the bridge type can
    // change independently of the internal storage type.

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