package expo.modules.mavinplayer

import android.app.Application
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import net.newpipe.newplayer.NewPlayerImpl
import net.newpipe.newplayer.data.PlayMode
import net.newpipe.newplayer.data.RepeatMode
import okhttp3.OkHttpClient
import androidx.core.graphics.drawable.IconCompat
import java.util.concurrent.TimeUnit

/**
 * MavinPlayerModule — Expo native module bridging JS to NewPlayer.
 *
 * The complete one-cycle architecture:
 *
 *   JS calls loadAndPlay(videoId, bundle):
 *     1. Module deserializes the bundle (URLs + HTTP context from MavinEngine)
 *     2. Module calls repository.storeBundle(bundle) — atomic handoff
 *     3. Module calls newPlayer.playStream(videoId, playMode)
 *     4. NewPlayer calls repository.getStreams()              → URLs from bundle
 *     5. NewPlayer calls repository.getHttpDataSourceFactory() → OkHttp with engine's session
 *     6. ExoPlayer fetches CDN using engine's exact cookies/headers
 *
 * resolveAndPlay() is REMOVED. It was calling a method that did not exist.
 * The new loadAndPlay() is the single entry point for remote playback.
 *
 * OkHttpClient construction:
 *   - NO cookie jar. Cookies come from the bundle as raw headers.
 *   - HTTP/2 enabled by default in OkHttp — no override needed.
 *   - Connection pool shared across all tracks for HTTP/2 multiplexing.
 *   - Same client instance for all segment requests (CDN session affinity).
 */
class MavinPlayerModule : Module() {

    companion object {
        private const val TAG = "MavinPlayerModule"

        @Volatile private var newPlayer: NewPlayerImpl? = null
        @Volatile private var repository: MavinMediaRepository? = null

        // Single OkHttpClient shared across all tracks.
        // NO cookie jar — bundle cookies are injected as raw headers.
        // HTTP/2 is enabled by default. Connection pool preserves CDN affinity.
        private val okHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            // Explicitly no cookie jar — null means OkHttp will not store
            // or send any cookies automatically. All cookies from the bundle
            // are injected as raw "Cookie" header values in the data source factory.
            .cookieJar(okhttp3.CookieJar.NO_COOKIES)
            .build()
    }

    private val moduleScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun definition() = ModuleDefinition {
        Name("MavinPlayer")

        Events(
            "onPlaybackStateChanged",
            "onPositionChanged",
            "onTrackChanged",
            "onError",
            "onPlaylistChanged"
        )

        OnCreate {
            initNewPlayer()
            observeNewPlayer()
        }

        OnDestroy {
            moduleScope.cancel()
        }

        // ── PRIMARY ENTRY POINT ───────────────────────────────────────────────
        //
        // loadAndPlay — the industry standard one-cycle handoff.
        //
        // JS calls this with:
        //   videoId     — the YouTube video ID
        //   dashUrl     — DASH manifest URL from MavinEngine (preferred)
        //   hlsUrl      — HLS manifest URL from MavinEngine (fallback)
        //   audioUrl    — progressive audio URL (last resort, only when no manifests)
        //   httpContext — the exact HTTP session MavinEngine used during extraction:
        //                 cookie, origin, referer, userAgent, clientName, clientVersion
        //
        // This function:
        //   1. Deserializes the HTTP context from the JS map
        //   2. Builds a ResolvedBundle and stores it in the repository (atomic)
        //   3. Calls newPlayer.playStream() — which triggers getStreams() and
        //      getHttpDataSourceFactory() on the repository immediately
        //
        // The repository serves both calls from the same bundle snapshot.
        // No race. No stale data. One session. One cycle.

        AsyncFunction("loadAndPlay") { videoId: String,
                                       dashUrl: String?,
                                       hlsUrl: String?,
                                       audioUrl: String?,
                                       httpContextMap: Map<String, String>? ->

            val player = newPlayer ?: throw IllegalStateException("NewPlayer not initialized")
            val repo   = repository ?: throw IllegalStateException("Repository not initialized")

            // Deserialize the HTTP context the engine used during extraction.
            // Default values match YouTube's expected headers if any field is missing.
            val httpCtx = BundleHttpContext(
                cookie               = httpContextMap?.get("cookie")               ?: "",
                origin               = httpContextMap?.get("origin")               ?: "https://www.youtube.com",
                referer              = httpContextMap?.get("referer")               ?: "https://www.youtube.com/",
                acceptLanguage       = httpContextMap?.get("acceptLanguage")        ?: "en-US,en;q=0.9",
                xYoutubeClientName   = httpContextMap?.get("xYoutubeClientName")   ?: "3",
                xYoutubeClientVersion = httpContextMap?.get("xYoutubeClientVersion") ?: "",
                userAgent            = httpContextMap?.get("userAgent")
                    ?: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )

            // Bundle validation — ensure at least one URL is present.
            if (dashUrl.isNullOrEmpty() && hlsUrl.isNullOrEmpty() && audioUrl.isNullOrEmpty()) {
                throw IllegalArgumentException(
                    "loadAndPlay: at least one of dashUrl, hlsUrl, or audioUrl must be non-empty"
                )
            }

            val bundle = ResolvedBundle(
                videoId             = videoId,
                dashManifestUrl     = dashUrl?.takeIf { it.isNotEmpty() },
                hlsManifestUrl      = hlsUrl?.takeIf { it.isNotEmpty() },
                progressiveAudioUrl = audioUrl?.takeIf { it.isNotEmpty() },
                title               = videoId, // metadata is enriched via getMetaInfo
                artist              = null,
                thumbnailUrl        = null,
                httpContext         = httpCtx
            )

            // Atomic handoff: repository now holds the bundle before playStream() fires.
            repo.storeBundle(bundle)

            Log.i(TAG, "loadAndPlay: bundle stored, triggering playStream for videoId=$videoId " +
                "hasDash=${!dashUrl.isNullOrEmpty()} hasHls=${!hlsUrl.isNullOrEmpty()} " +
                "hasProgressive=${!audioUrl.isNullOrEmpty()}")

            // Fire playStream on the main dispatcher — NewPlayer requires main thread.
            moduleScope.launch {
                player.playStream(videoId, PlayMode.FULLSCREEN_AUDIO)
            }

            mapOf("success" to true)
        }

        // ── loadAndPlayVideo — same cycle, video play mode ────────────────────

        AsyncFunction("loadAndPlayVideo") { videoId: String,
                                            dashUrl: String?,
                                            hlsUrl: String?,
                                            audioUrl: String?,
                                            httpContextMap: Map<String, String>? ->

            val player = newPlayer ?: throw IllegalStateException("NewPlayer not initialized")
            val repo   = repository ?: throw IllegalStateException("Repository not initialized")

            val httpCtx = BundleHttpContext(
                cookie               = httpContextMap?.get("cookie")               ?: "",
                origin               = httpContextMap?.get("origin")               ?: "https://www.youtube.com",
                referer              = httpContextMap?.get("referer")               ?: "https://www.youtube.com/",
                acceptLanguage       = httpContextMap?.get("acceptLanguage")        ?: "en-US,en;q=0.9",
                xYoutubeClientName   = httpContextMap?.get("xYoutubeClientName")   ?: "3",
                xYoutubeClientVersion = httpContextMap?.get("xYoutubeClientVersion") ?: "",
                userAgent            = httpContextMap?.get("userAgent")
                    ?: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )

            if (dashUrl.isNullOrEmpty() && hlsUrl.isNullOrEmpty() && audioUrl.isNullOrEmpty()) {
                throw IllegalArgumentException("loadAndPlayVideo: at least one URL required")
            }

            val bundle = ResolvedBundle(
                videoId             = videoId,
                dashManifestUrl     = dashUrl?.takeIf { it.isNotEmpty() },
                hlsManifestUrl      = hlsUrl?.takeIf { it.isNotEmpty() },
                progressiveAudioUrl = audioUrl?.takeIf { it.isNotEmpty() },
                title               = videoId,
                artist              = null,
                thumbnailUrl        = null,
                httpContext         = httpCtx
            )

            repo.storeBundle(bundle)

            Log.i(TAG, "loadAndPlayVideo: bundle stored for videoId=$videoId")

            moduleScope.launch {
                player.playStream(videoId, PlayMode.EMBEDDED_VIDEO)
            }

            mapOf("success" to true)
        }

        // ── Legacy playStream — kept for queue advance and playlist auto-play ─
        // These calls come from NewPlayer's internal queue management after the
        // first track in a playlist is already playing. For these cases NewPlayer
        // calls repository.getStreams() which will throw if no bundle is stored.
        // JS must call loadAndPlay() before any playStream() for a new videoId.

        AsyncFunction("playStream") { videoId: String ->
            val player = newPlayer ?: throw IllegalStateException("NewPlayer not initialized")
            moduleScope.launch {
                player.playStream(videoId, PlayMode.FULLSCREEN_AUDIO)
            }
            mapOf("success" to true)
        }

        AsyncFunction("playStreamEmbedded") { videoId: String ->
            val player = newPlayer ?: throw IllegalStateException("NewPlayer not initialized")
            moduleScope.launch {
                player.playStream(videoId, PlayMode.EMBEDDED_AUDIO)
            }
            mapOf("success" to true)
        }

        AsyncFunction("playStreamVideo") { videoId: String ->
            val player = newPlayer ?: throw IllegalStateException("NewPlayer not initialized")
            moduleScope.launch {
                player.playStream(videoId, PlayMode.EMBEDDED_VIDEO)
            }
            mapOf("success" to true)
        }

        // ── Queue management ──────────────────────────────────────────────────

        AsyncFunction("addToPlaylist") { videoId: String ->
            val player = newPlayer ?: throw IllegalStateException("NewPlayer not initialized")
            player.addToPlaylist(videoId)
            mapOf("success" to true)
        }

        AsyncFunction("removeFromPlaylist") { uniqueId: Double ->
            val player = newPlayer ?: throw IllegalStateException("NewPlayer not initialized")
            player.removePlaylistItem(uniqueId.toLong())
            mapOf("success" to true)
        }

        AsyncFunction("movePlaylistItem") { fromIndex: Int, toIndex: Int ->
            val player = newPlayer ?: throw IllegalStateException("NewPlayer not initialized")
            player.movePlaylistItem(fromIndex, toIndex)
            mapOf("success" to true)
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
            repository?.clearBundle()
            newPlayer?.release()
            mapOf("success" to true)
        }

        AsyncFunction("seekTo") { positionMs: Double ->
            newPlayer?.currentPosition = positionMs.toLong()
            mapOf("success" to true)
        }

        // ── Settings ──────────────────────────────────────────────────────────

        AsyncFunction("setRepeatMode") { mode: String ->
            val player = newPlayer ?: throw IllegalStateException("NewPlayer not initialized")
            player.repeatMode = when (mode) {
                "one"  -> RepeatMode.REPEAT_ONE
                "all"  -> RepeatMode.REPEAT_ALL
                else   -> RepeatMode.DO_NOT_REPEAT
            }
            mapOf("success" to true)
        }

        AsyncFunction("setShuffle") { enabled: Boolean ->
            val player = newPlayer ?: throw IllegalStateException("NewPlayer not initialized")
            player.shuffle = enabled
            mapOf("success" to true)
        }

        AsyncFunction("setPlaybackSpeed") { speed: Double ->
            newPlayer?.exoPlayer?.value?.setPlaybackSpeed(speed.toFloat())
            mapOf("success" to true)
        }

        AsyncFunction("selectChapter") { index: Int ->
            newPlayer?.selectChapter(index)
            mapOf("success" to true)
        }

        AsyncFunction("skipToPlaylistItem") { index: Int ->
            newPlayer?.currentlyPlayingPlaylistItem = index
            mapOf("success" to true)
        }

        // ── State ─────────────────────────────────────────────────────────────

        AsyncFunction("getState") {
            val player = newPlayer ?: return@AsyncFunction mapOf(
                "isPlaying"       to false,
                "position"        to 0.0,
                "duration"        to 0.0,
                "bufferedPercent" to 0,
                "playMode"        to "IDLE",
                "repeatMode"      to "off",
                "shuffle"         to false,
                "currentItem"     to ""
            )
            mapOf(
                "isPlaying"       to player.playWhenReady,
                "position"        to player.currentPosition.toDouble(),
                "duration"        to player.duration.coerceAtLeast(0L).toDouble(),
                "bufferedPercent" to player.bufferedPercentage,
                "playMode"        to player.playBackMode.value.name,
                "repeatMode"      to when (player.repeatMode) {
                    RepeatMode.REPEAT_ONE -> "one"
                    RepeatMode.REPEAT_ALL -> "all"
                    else                  -> "off"
                },
                "shuffle"         to player.shuffle,
                "currentItem"     to (player.currentlyPlaying.value?.mediaId ?: "")
            )
        }
    }

    // ── Initialization ────────────────────────────────────────────────────────

    private fun initNewPlayer() {
        if (newPlayer != null) {
            Log.i(TAG, "NewPlayer already initialized")
            return
        }

        val app = appContext.reactContext?.applicationContext as? Application
            ?: run { Log.e(TAG, "Cannot get Application context"); return }

        val repo = MavinMediaRepository(app, okHttpClient)
            .also { repository = it }

        newPlayer = NewPlayerImpl(
            app                 = app,
            playerActivityClass = getMainActivityClass(app),
            repository          = repo,
            notificationIcon    = IconCompat.createWithResource(
                app,
                android.R.drawable.ic_media_play
            )
        )

        Log.i(TAG, "NewPlayer initialized")
    }

    private fun getMainActivityClass(app: Application): Class<out android.app.Activity> {
        return try {
            @Suppress("UNCHECKED_CAST")
            Class.forName("${app.packageName}.MainActivity") as Class<out android.app.Activity>
        } catch (e: Exception) {
            Log.w(TAG, "Could not find MainActivity: ${e.message}")
            android.app.Activity::class.java
        }
    }

    // ── Event observation ─────────────────────────────────────────────────────

    private fun observeNewPlayer() {
        val player = newPlayer ?: return

        player.playBackMode
            .onEach { mode ->
                sendEvent("onPlaybackStateChanged", mapOf(
                    "state"     to if (player.playWhenReady) "playing" else "paused",
                    "isPlaying" to player.playWhenReady,
                    "playMode"  to mode.name
                ))
            }
            .launchIn(moduleScope)

        player.currentlyPlaying
            .onEach { mediaItem ->
                sendEvent("onTrackChanged", mapOf(
                    "item" to (mediaItem?.mediaId ?: "")
                ))
            }
            .launchIn(moduleScope)

        player.playlist
            .onEach { playlist ->
                sendEvent("onPlaylistChanged", mapOf(
                    "playlist" to playlist.map { it.mediaId }
                ))
            }
            .launchIn(moduleScope)

        player.onExoPlayerEvent
            .onEach { (exo, _) ->
                sendEvent("onPositionChanged", mapOf(
                    "position"        to exo.currentPosition.toDouble(),
                    "duration"        to exo.duration.coerceAtLeast(0L).toDouble(),
                    "bufferedPercent" to exo.bufferedPercentage
                ))
            }
            .launchIn(moduleScope)

        player.errorFlow
            .onEach { error ->
                Log.e(TAG, "NewPlayer error: ${error.message}", error)
                sendEvent("onError", mapOf("message" to (error.message ?: "Unknown error")))
            }
            .launchIn(moduleScope)
    }
}