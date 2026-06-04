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

class MavinPlayerModule : Module() {

    companion object {
        private const val TAG = "MavinPlayerModule"

        // Singleton NewPlayer instance — lives at Application scope
        // so it survives Activity recreation and runs in background
        @Volatile private var newPlayer: NewPlayerImpl? = null
        @Volatile private var repository: MavinMediaRepository? = null

        private val okHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    private val moduleScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun definition() = ModuleDefinition {
        Name("MavinPlayer")

        Events(
            "onPlaybackStateChanged",  // { state, isPlaying, playMode }
            "onPositionChanged",       // { position, duration, bufferedPercent }
            "onTrackChanged",          // { item }
            "onError",                 // { message }
            "onPlaylistChanged"        // { playlist: string[] }
        )

        OnCreate {
            initNewPlayer()
            observeNewPlayer()
        }

        OnDestroy {
            moduleScope.cancel()
        }

        // ── Core playback ──────────────────────────────────────────────────────

        /**
         * Primary entry point from MusicPlayerContext.
         * Pass the videoId — NewPlayer calls MavinMediaRepository.getStreams(videoId)
         * which extracts DASH/HLS via MavinEngine and returns them with YouTube headers.
         */
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

        /**
         * Primary remote-track entry point.
         * JS passes the URLs already resolved by MavinEngine — no re-extraction happens.
         * Arms the repository's resolver lambda, then immediately fires player.playStream().
         * getStreams() picks up the lambda, returns the streams, clears it. One extraction,
         * one play. Mirrors exactly how the download path works.
         */
        AsyncFunction("resolveAndPlay") { videoId: String, dashManifestUrl: String?, hlsManifestUrl: String?, progressiveAudioUrl: String? ->
            val player = newPlayer ?: throw IllegalStateException("NewPlayer not initialized")
            val repo   = repository ?: throw IllegalStateException("Repository not initialized")
            moduleScope.launch {
                repo.resolveAndPlay(
                    player              = player,
                    videoId             = videoId,
                    dashManifestUrl     = dashManifestUrl,
                    hlsManifestUrl      = hlsManifestUrl,
                    progressiveAudioUrl = progressiveAudioUrl,
                    progressiveAudioBitrate = 128000,
                    progressiveAudioFormat  = "webm",
                    playMode            = PlayMode.FULLSCREEN_AUDIO
                )
            }
            mapOf("success" to true)
        }

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
            newPlayer?.release()
            mapOf("success" to true)
        }

        AsyncFunction("seekTo") { positionMs: Double ->
            newPlayer?.currentPosition = positionMs.toLong()
            mapOf("success" to true)
        }

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
            // Set via ExoPlayer directly since NewPlayer doesn't expose speed API
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

        AsyncFunction("getState") {
            val player = newPlayer ?: return@AsyncFunction mapOf(
                "isPlaying" to false,
                "position" to 0.0,
                "duration" to 0.0,
                "bufferedPercent" to 0,
                "playMode" to "IDLE",
                "repeatMode" to "off",
                "shuffle" to false,
                "currentItem" to ""
            )
            mapOf(
                "isPlaying"       to (player.playWhenReady),
                "position"        to player.currentPosition.toDouble(),
                "duration"        to player.duration.coerceAtLeast(0L).toDouble(),
                "bufferedPercent" to player.bufferedPercentage,
                "playMode"        to player.playBackMode.value.name,
                "repeatMode"      to when (player.repeatMode) {
                    RepeatMode.REPEAT_ONE -> "one"
                    RepeatMode.REPEAT_ALL -> "all"
                    else -> "off"
                },
                "shuffle"         to player.shuffle,
                "currentItem"     to (player.currentlyPlaying.value?.mediaId ?: "")
            )
        }
    }

    // ── Init ───────────────────────────────────────────────────────────────────

    private fun initNewPlayer() {
        if (newPlayer != null) {
            Log.i(TAG, "NewPlayer already initialized")
            return
        }

        val app = appContext.reactContext?.applicationContext as? Application
            ?: run { Log.e(TAG, "Cannot get Application context"); return }

        val repo = MavinMediaRepository(app, okHttpClient)
            .also { repository = it }

        // NewPlayerImpl constructor — NO Hilt needed, plain constructor
        newPlayer = NewPlayerImpl(
            app = app,
            playerActivityClass = getMainActivityClass(app),
            repository = repo,
            notificationIcon = IconCompat.createWithResource(
                app,
                android.R.drawable.ic_media_play
            )
        )

        Log.i(TAG, "NewPlayer initialized successfully")
    }

    private fun getMainActivityClass(app: Application): Class<out android.app.Activity> {
        return try {
            // Resolve MainActivity from the app's package
            @Suppress("UNCHECKED_CAST")
            Class.forName("${app.packageName}.MainActivity") as Class<out android.app.Activity>
        } catch (e: Exception) {
            Log.w(TAG, "Could not find MainActivity, using fallback: ${e.message}")
            android.app.Activity::class.java
        }
    }

    // ── Observe NewPlayer state and bridge to JS ───────────────────────────────

    private fun observeNewPlayer() {
        val player = newPlayer ?: return

        // Playback mode changes (IDLE, EMBEDDED_VIDEO, FULLSCREEN_AUDIO, PIP, etc.)
        player.playBackMode
            .onEach { mode ->
                sendEvent("onPlaybackStateChanged", mapOf(
                    "state"      to if (player.playWhenReady) "playing" else "paused",
                    "isPlaying"  to player.playWhenReady,
                    "playMode"   to mode.name
                ))
            }
            .launchIn(moduleScope)

        // Currently playing track changes
        player.currentlyPlaying
            .onEach { mediaItem ->
                val item = mediaItem?.mediaId ?: ""
                sendEvent("onTrackChanged", mapOf("item" to item))
            }
            .launchIn(moduleScope)

        // Playlist changes
        player.playlist
            .onEach { playlist ->
                val items = playlist.map { it.mediaId }
                sendEvent("onPlaylistChanged", mapOf("playlist" to items))
            }
            .launchIn(moduleScope)

        // ExoPlayer events — position, buffering
        player.onExoPlayerEvent
            .onEach { (exo, _) ->
                sendEvent("onPositionChanged", mapOf(
                    "position"        to exo.currentPosition.toDouble(),
                    "duration"        to exo.duration.coerceAtLeast(0L).toDouble(),
                    "bufferedPercent" to exo.bufferedPercentage
                ))
            }
            .launchIn(moduleScope)

        // Unrecoverable errors
        player.errorFlow
            .onEach { error ->
                Log.e(TAG, "NewPlayer error: ${error.message}", error)
                sendEvent("onError", mapOf("message" to (error.message ?: "Unknown error")))
            }
            .launchIn(moduleScope)
    }
}