package expo.modules.mavinplayer

import android.content.ComponentName
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.mavinplayer.audio.MavinAudioPlayer
import expo.modules.mavinplayer.audio.TrackData
import expo.modules.mavinplayer.service.MavinPlaybackService

/**
 * MavinPlayerModule
 *
 * Expo module that owns the MavinAudioPlayer (ExoPlayer + DSP) and bridges
 * its API to JavaScript.
 *
 * JS API surface mirrors RNTP's API closely for easy migration:
 *   initPlayer()                     — setup (replaces TrackPlayer.setupPlayer)
 *   load(track)                      — single track
 *   setQueue(tracks, startIndex?)    — full queue
 *   addToQueue(track)
 *   play() / pause() / stop()
 *   seekTo(positionMs)
 *   skipToNext() / skipToPrevious() / skipToIndex(index)
 *   getPosition() / getDuration() / getCurrentTrack()
 *   setVolume(0..1)
 *   setRepeatMode(0|1|2)
 *   setShuffleMode(bool)
 *   setEQEnabled(bool)
 *   setEQBand(index, gainDb)
 *   applyEQBands(gains[31])
 *   resetEQ()
 *   release()
 *
 * Events emitted to JS:
 *   onPlaybackStateChanged  { state: "idle"|"buffering"|"ready"|"ended" }
 *   onTrackChanged          { index: number }
 *   onError                 { message: string, code: string }
 *   onProgress              { position: number, duration: number, buffered: number }
 */
@UnstableApi
class MavinPlayerModule : Module() {

    companion object {
        private const val TAG = "MavinPlayerModule"
        private const val PROGRESS_INTERVAL_MS = 1000L

        /** Singleton player — shared with MavinPlaybackService */
        @Volatile var playerInstance: MavinAudioPlayer? = null
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var progressRunnable: Runnable? = null

    override fun definition() = ModuleDefinition {
        Name("MavinPlayer")

        // ── Events ────────────────────────────────────────────────────────────
        Events(
            "onPlaybackStateChanged",
            "onTrackChanged",
            "onError",
            "onProgress"
        )

        // ── initPlayer ────────────────────────────────────────────────────────
        /**
         * Creates the ExoPlayer instance with the DSP chain.
         * Must be called once at app startup before any other method.
         * Safe to call multiple times — idempotent.
         */
        AsyncFunction("initPlayer") { promise: Promise ->
            runOnMain {
                try {
                    if (playerInstance != null) {
                        Log.i(TAG, "initPlayer: reusing existing player")
                        promise.resolve(null)
                        return@runOnMain
                    }

                    val ctx = appContext.reactContext
                        ?: return@runOnMain promise.reject(
                            "NO_CONTEXT", "ReactContext not available", null
                        )

                    val player = MavinAudioPlayer(ctx)

                    // Wire events → JS
                    player.onPlaybackStateChanged = { state ->
                        val stateName = when (state) {
                            Player.STATE_IDLE      -> "idle"
                            Player.STATE_BUFFERING -> "buffering"
                            Player.STATE_READY     -> "ready"
                            Player.STATE_ENDED     -> "ended"
                            else                   -> "unknown"
                        }
                        sendEvent("onPlaybackStateChanged", mapOf("state" to stateName))
                        if (state == Player.STATE_READY) startProgressTimer(player)
                        if (state == Player.STATE_IDLE || state == Player.STATE_ENDED) stopProgressTimer()
                    }
                    player.onTrackChanged = { index ->
                        sendEvent("onTrackChanged", mapOf("index" to index))
                    }
                    player.onError = { message, code ->
                        sendEvent("onError", mapOf("message" to message, "code" to code))
                    }

                    playerInstance = player

                    // Start the foreground service (handles background playback + lock screen)
                    val serviceIntent = Intent(ctx, MavinPlaybackService::class.java)
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                        ctx.startForegroundService(serviceIntent)
                    } else {
                        ctx.startService(serviceIntent)
                    }

                    Log.i(TAG, "✅ initPlayer complete")
                    promise.resolve(null)

                } catch (e: Exception) {
                    Log.e(TAG, "initPlayer failed", e)
                    promise.reject("INIT_ERROR", e.message ?: "initPlayer failed", e)
                }
            }
        }

        // ── load ──────────────────────────────────────────────────────────────
        AsyncFunction("load") { trackMap: Map<String, Any?>, promise: Promise ->
            runOnMain {
                val player = requirePlayer(promise) ?: return@runOnMain
                try {
                    player.load(trackMap.toTrackData())
                    promise.resolve(null)
                } catch (e: Exception) {
                    promise.reject("LOAD_ERROR", e.message, e)
                }
            }
        }

        // ── setQueue ──────────────────────────────────────────────────────────
        AsyncFunction("setQueue") { tracksRaw: List<Map<String, Any?>>, startIndex: Int?, promise: Promise ->
            runOnMain {
                val player = requirePlayer(promise) ?: return@runOnMain
                try {
                    val tracks = tracksRaw.map { it.toTrackData() }
                    player.setQueue(tracks, startIndex ?: 0)
                    promise.resolve(null)
                } catch (e: Exception) {
                    promise.reject("QUEUE_ERROR", e.message, e)
                }
            }
        }

        // ── addToQueue ────────────────────────────────────────────────────────
        AsyncFunction("addToQueue") { trackMap: Map<String, Any?>, promise: Promise ->
            runOnMain {
                val player = requirePlayer(promise) ?: return@runOnMain
                try {
                    player.addToQueue(trackMap.toTrackData())
                    promise.resolve(null)
                } catch (e: Exception) {
                    promise.reject("QUEUE_ERROR", e.message, e)
                }
            }
        }

        // ── Transport controls ────────────────────────────────────────────────
        AsyncFunction("play") { promise: Promise ->
            runOnMain { requirePlayer(promise)?.play(); promise.resolve(null) }
        }

        AsyncFunction("pause") { promise: Promise ->
            runOnMain { requirePlayer(promise)?.pause(); promise.resolve(null) }
        }

        AsyncFunction("stop") { promise: Promise ->
            runOnMain { requirePlayer(promise)?.stop(); promise.resolve(null) }
        }

        AsyncFunction("seekTo") { positionMs: Double, promise: Promise ->
            runOnMain { requirePlayer(promise)?.seekTo(positionMs.toLong()); promise.resolve(null) }
        }

        AsyncFunction("skipToNext") { promise: Promise ->
            runOnMain { requirePlayer(promise)?.skipToNext(); promise.resolve(null) }
        }

        AsyncFunction("skipToPrevious") { promise: Promise ->
            runOnMain { requirePlayer(promise)?.skipToPrevious(); promise.resolve(null) }
        }

        AsyncFunction("skipToIndex") { index: Int, promise: Promise ->
            runOnMain { requirePlayer(promise)?.skipToIndex(index); promise.resolve(null) }
        }

        AsyncFunction("setVolume") { volume: Double, promise: Promise ->
            runOnMain { requirePlayer(promise)?.setVolume(volume.toFloat()); promise.resolve(null) }
        }

        AsyncFunction("setRepeatMode") { mode: Int, promise: Promise ->
            runOnMain { requirePlayer(promise)?.setRepeatMode(mode); promise.resolve(null) }
        }

        AsyncFunction("setShuffleMode") { enabled: Boolean, promise: Promise ->
            runOnMain { requirePlayer(promise)?.setShuffleModeEnabled(enabled); promise.resolve(null) }
        }

        // ── State reads ───────────────────────────────────────────────────────
        AsyncFunction("getPosition") { promise: Promise ->
            runOnMain { promise.resolve(playerInstance?.getCurrentPosition()?.toDouble() ?: 0.0) }
        }

        AsyncFunction("getDuration") { promise: Promise ->
            runOnMain { promise.resolve(playerInstance?.getDuration()?.toDouble() ?: 0.0) }
        }

        AsyncFunction("getCurrentTrack") { promise: Promise ->
            runOnMain { promise.resolve(playerInstance?.getCurrentTrackInfo()) }
        }

        AsyncFunction("isPlaying") { promise: Promise ->
            runOnMain { promise.resolve(playerInstance?.isPlaying() ?: false) }
        }

        AsyncFunction("getQueueSize") { promise: Promise ->
            runOnMain { promise.resolve(playerInstance?.getQueueSize() ?: 0) }
        }

        // ── EQ API ────────────────────────────────────────────────────────────
        AsyncFunction("setEQEnabled") { enabled: Boolean, promise: Promise ->
            playerInstance?.setEQEnabled(enabled)
            promise.resolve(null)
        }

        AsyncFunction("setEQBand") { band: Int, gainDb: Double, promise: Promise ->
            playerInstance?.setEQBand(band, gainDb.toFloat())
            promise.resolve(null)
        }

        AsyncFunction("applyEQBands") { gains: List<Double>, promise: Promise ->
            playerInstance?.applyEQBands(FloatArray(gains.size) { gains[it].toFloat() })
            promise.resolve(null)
        }

        AsyncFunction("resetEQ") { promise: Promise ->
            playerInstance?.resetEQ()
            promise.resolve(null)
        }

        // ── release ───────────────────────────────────────────────────────────
        AsyncFunction("release") { promise: Promise ->
            runOnMain {
                stopProgressTimer()
                playerInstance?.release()
                playerInstance = null
                val ctx = appContext.reactContext
                ctx?.stopService(Intent(ctx, MavinPlaybackService::class.java))
                promise.resolve(null)
            }
        }
    }

    // ── Progress timer ────────────────────────────────────────────────────────

    private fun startProgressTimer(player: MavinAudioPlayer) {
        stopProgressTimer()
        progressRunnable = object : Runnable {
            override fun run() {
                if (player.isPlaying()) {
                    sendEvent("onProgress", mapOf(
                        "position"  to player.getCurrentPosition().toDouble(),
                        "duration"  to player.getDuration().toDouble(),
                        "buffered"  to player.getBufferedPosition().toDouble(),
                    ))
                }
                mainHandler.postDelayed(this, PROGRESS_INTERVAL_MS)
            }
        }
        mainHandler.postDelayed(progressRunnable!!, PROGRESS_INTERVAL_MS)
    }

    private fun stopProgressTimer() {
        progressRunnable?.let { mainHandler.removeCallbacks(it) }
        progressRunnable = null
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block()
        else mainHandler.post(block)
    }

    private fun requirePlayer(promise: Promise): MavinAudioPlayer? {
        val p = playerInstance
        if (p == null) {
            promise.reject("PLAYER_NOT_READY", "Call initPlayer() first", null)
        }
        return p
    }

    private fun Map<String, Any?>.toTrackData(): TrackData = TrackData(
        id         = (get("id") as? String) ?: System.currentTimeMillis().toString(),
        uri        = get("uri") as? String ?: get("url") as? String
                     ?: throw IllegalArgumentException("track must have 'uri' or 'url'"),
        title      = get("title") as? String,
        artist     = get("artist") as? String,
        album      = get("album") as? String,
        artworkUri = get("artwork") as? String ?: get("artworkUri") as? String,
        duration   = (get("duration") as? Number)?.toLong(),
        headers    = @Suppress("UNCHECKED_CAST") (get("headers") as? Map<String, String>),
    )
}