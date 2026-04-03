package expo.modules.mavinplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.Rating
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import expo.modules.mavinplayer.audio.EqualizerProcessor
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.mavinplayer.audio.MavinAudioPlayer
import expo.modules.mavinplayer.audio.TrackData
import expo.modules.mavinplayer.service.MavinPlaybackService
import java.util.concurrent.ConcurrentHashMap

// ─────────────────────────────────────────────────────────────────────────────
// Playback state constants
// ─────────────────────────────────────────────────────────────────────────────

private object PlaybackState {
    const val STATE_NONE    = 0
    const val STATE_PLAYING = 3
    const val STATE_PAUSED  = 2
    const val STATE_STOPPED = 1
    const val STATE_ERROR   = 7
}

@UnstableApi
class MavinPlayerModule : Module(), AudioManager.OnAudioFocusChangeListener {

    companion object {
        private const val TAG                     = "MavinPlayerModule"
        private const val SPECTRUM_INTERVAL_MS    = 100L
        private const val NOTIFICATION_CHANNEL_ID = "mavin_player_channel"
        private const val NOTIFICATION_ID         = 1
        private const val QUEUE_PREFS             = "mavin_queue_prefs"
        private const val QUEUE_KEY               = "persisted_queue"
        private const val POSITION_KEY            = "last_position"
        private const val TRACK_INDEX_KEY         = "current_track_index"

        /**
         * Stable, non-empty MediaSession ID — matches the constant in MavinPlaybackService.
         *
         * IMPORTANT: Both this module and MavinPlaybackService build a MediaSession
         * against the SAME ExoPlayer instance.  They must use different IDs or Media3
         * will throw "Session ID must be unique" when the service starts.
         *
         * • MavinPlayerModule  → "mavin-module-session"   (used for remote-control wiring)
         * • MavinPlaybackService → "mavin-playback-session" (used for lock-screen / notification)
         *
         * Using distinct non-empty IDs eliminates the duplicate-ID crash that happens
         * when either component is recreated before the previous instance tears down.
         */
        private const val MEDIA_SESSION_ID = "mavin-module-session"

        @Volatile var playerInstance: MavinAudioPlayer? = null

        // FIX: mediaSession was in companion, which means it leaks across module instances
        // (hot-reload, re-mount). Keeping it here is fine because setupMediaSession()
        // explicitly releases the old one before building a new one.
        private var mediaSession       : MediaSession?      = null
        private var audioManager       : AudioManager?      = null
        private var audioFocusRequest  : AudioFocusRequest? = null
        private var hasAudioFocus      = false
        private var isForegroundService = false
        private val eventDebouncers    = ConcurrentHashMap<String, Debouncer>()
    }

    private val mainHandler   = Handler(Looper.getMainLooper())
    private var progressRunnable : Runnable? = null
    private var spectrumRunnable : Runnable? = null
    private var currentTrackIndex = 0
    private var lastKnownPosition = 0L

    @Volatile private var currentPlaybackState = PlaybackState.STATE_NONE

    // ─────────────────────────────────────────────────────────────────────────
    // MODULE DEFINITION
    // ─────────────────────────────────────────────────────────────────────────

    override fun definition() = ModuleDefinition {
        Name("MavinPlayer")

        Events(
            // ── Playback ────────────────────────────────────────────────────
            "onPlaybackStateChanged",
            "onTrackChanged",                    // deprecated — kept for compat
            "onPlaybackActiveTrackChanged",      // RNTP PlaybackActiveTrackChanged
            "onPlaybackQueueEnded",              // RNTP PlaybackQueueEnded
            "onPlaybackPlayWhenReadyChanged",    // RNTP PlaybackPlayWhenReadyChanged
            "onError",
            "onProgress",
            // ── DSP / hardware ──────────────────────────────────────────────
            "onSpectrum",
            "onPeakMeter",
            "onReplayGainApplied",
            "onUsbDacConnected",
            "onUsbDacDisconnected",
            // ── Audio focus ──────────────────────────────────────────────────
            "onAudioFocusLost",
            "onAudioFocusGranted",
            // ── Remote controls ─────────────────────────────────────────────
            "onRemotePlay",
            "onRemotePause",
            "onRemoteStop",
            "onRemoteNext",
            "onRemotePrevious",
            "onRemoteSeek",
            "onRemoteSkip",
            "onRemotePlayId",
            "onRemotePlaySearch",
            "onRemoteSetRating",
            "onRemoteJumpForward",
            "onRemoteJumpBackward",
            "onRemoteDuck",
            // ── Metadata ────────────────────────────────────────────────────
            "onAudioCommonMetadataReceived",
            "onAudioTimedMetadataReceived"
        )

        // ─────────────────────────────────────────────────────────────────────
        // LIFECYCLE
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("initPlayer") { options: Map<String, Any?>?, promise: Promise ->
            runOnMain {
                try {
                    if (playerInstance != null) {
                        restoreState()
                        promise.resolve(null)
                        return@runOnMain
                    }
                    val ctx = appContext.reactContext
                        ?: return@runOnMain promise.reject("NO_CONTEXT", "ReactContext not available", null)

                    audioManager   = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                    val player     = MavinAudioPlayer(ctx)
                    playerInstance = player

                    if (options != null) {
                        val usage       = options["audioUsage"] as? String
                        val contentType = options["audioContentType"] as? String
                        if (usage != null || contentType != null) {
                            player.configureAudioAttributes(usage, contentType)
                            player.applyAudioAttributes()
                        }
                    }

                    setupMediaSession(ctx, player, options)
                    setupPlayerCallbacks(player)
                    requestAudioFocus()
                    restoreState()
                    startForegroundService(ctx)

                    Log.i(TAG, "✅ initPlayer complete")
                    promise.resolve(null)
                } catch (e: Exception) {
                    Log.e(TAG, "initPlayer failed", e)
                    promise.reject("INIT_ERROR", e.message ?: "initPlayer failed", e)
                }
            }
        }

        AsyncFunction("release") { promise: Promise ->
            runOnMain {
                stopAllTimers()
                playerInstance?.let { saveState(it); it.release() }
                playerInstance = null
                // FIX: release module-owned MediaSession before stopping the service,
                // so its ID is freed independently of MavinPlaybackService's session.
                mediaSession?.release()
                mediaSession = null
                abandonAudioFocus()
                appContext.reactContext?.let { ctx ->
                    ctx.stopService(Intent(ctx, MavinPlaybackService::class.java))
                    if (isForegroundService) {
                        (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                            .cancel(NOTIFICATION_ID)
                        isForegroundService = false
                    }
                }
                promise.resolve(null)
            }
        }

        // ── NEW: stopService — called from JS releasePlayerGlobal() ─────────
        // Stops MavinPlaybackService so its MediaSession is released and its
        // session ID ("mavin-playback-session") is freed before any potential
        // hot-reload re-creation. Called by playerSetup.ts before player.release().
        AsyncFunction("stopService") { promise: Promise ->
            runOnMain {
                try {
                    appContext.reactContext?.let { ctx ->
                        ctx.stopService(Intent(ctx, MavinPlaybackService::class.java))
                        Log.i(TAG, "MavinPlaybackService stopped via stopService()")
                    }
                    promise.resolve(null)
                } catch (e: Exception) {
                    // Non-fatal: log and resolve so JS side doesn't hang.
                    Log.w(TAG, "stopService error (non-fatal): ${e.message}")
                    promise.resolve(null)
                }
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // PLAYBACK CONTROL
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("load") { trackMap: Map<String, Any?>, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                try {
                    val track = trackMap.toTrackData()
                    p.load(track)
                    updateMediaMetadata(track, 0)
                    persistQueue(listOf(trackMap), 0)
                    promise.resolve(null)
                } catch (e: Exception) { promise.reject("LOAD_ERROR", e.message, e) }
            }
        }

        AsyncFunction("setQueue") { tracksRaw: List<Map<String, Any?>>, startIndex: Int?, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                try {
                    p.setQueue(tracksRaw.map { it.toTrackData() }, startIndex ?: 0)
                    persistQueue(tracksRaw, startIndex ?: 0)
                    promise.resolve(null)
                } catch (e: Exception) { promise.reject("QUEUE_ERROR", e.message, e) }
            }
        }

        AsyncFunction("addToQueue") { trackMap: Map<String, Any?>, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                try {
                    p.addToQueue(trackMap.toTrackData())
                    loadPersistedQueue()?.let { persistQueue(it + trackMap, currentTrackIndex) }
                    promise.resolve(null)
                } catch (e: Exception) { promise.reject("QUEUE_ERROR", e.message, e) }
            }
        }

        AsyncFunction("addToQueueAt") { trackMap: Map<String, Any?>, index: Int, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                try {
                    p.addToQueueAt(trackMap.toTrackData(), index)
                    promise.resolve(null)
                } catch (e: Exception) { promise.reject("QUEUE_ERROR", e.message, e) }
            }
        }

        AsyncFunction("removeTrack") { index: Int, promise: Promise ->
            runOnMain {
                requirePlayer(promise)?.removeTrack(index)
                promise.resolve(null)
            }
        }

        AsyncFunction("removeUpcomingTracks") { promise: Promise ->
            runOnMain { requirePlayer(promise)?.removeUpcomingTracks(); promise.resolve(null) }
        }

        AsyncFunction("moveTrack") { fromIndex: Int, toIndex: Int, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                try {
                    p.moveTrack(fromIndex, toIndex)
                    promise.resolve(null)
                } catch (e: Exception) { promise.reject("MOVE_ERROR", e.message, e) }
            }
        }

        AsyncFunction("updateTrack") { index: Int, trackMap: Map<String, Any?>, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                try {
                    p.updateTrackMetadata(index, trackMap.toTrackData())
                    promise.resolve(null)
                } catch (e: Exception) { promise.reject("UPDATE_TRACK_ERROR", e.message, e) }
            }
        }

        AsyncFunction("getTrack") { index: Int, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                promise.resolve(p.getTrack(index))
            }
        }

        AsyncFunction("getQueue") { promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                promise.resolve(p.getAllTracks())
            }
        }

        AsyncFunction("updateNowPlayingMetadata") { trackMap: Map<String, Any?>, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                try {
                    p.updateNowPlayingMetadata(trackMap.toTrackData())
                    promise.resolve(null)
                } catch (e: Exception) { promise.reject("METADATA_ERROR", e.message, e) }
            }
        }

        AsyncFunction("reset") { promise: Promise ->
            runOnMain {
                requirePlayer(promise)?.reset()
                currentPlaybackState = PlaybackState.STATE_NONE
                promise.resolve(null)
            }
        }

        AsyncFunction("play") { promise: Promise ->
            runOnMain {
                requirePlayer(promise)?.play()
                requestAudioFocus()
                currentPlaybackState = PlaybackState.STATE_PLAYING
                promise.resolve(null)
            }
        }

        AsyncFunction("pause") { promise: Promise ->
            runOnMain {
                requirePlayer(promise)?.pause()
                currentPlaybackState = PlaybackState.STATE_PAUSED
                promise.resolve(null)
            }
        }

        AsyncFunction("stop") { promise: Promise ->
            runOnMain {
                requirePlayer(promise)?.stop()
                currentPlaybackState = PlaybackState.STATE_STOPPED
                promise.resolve(null)
            }
        }

        AsyncFunction("skipToNext")     { promise: Promise -> runOnMain { requirePlayer(promise)?.skipToNext();     promise.resolve(null) } }
        AsyncFunction("skipToPrevious") { promise: Promise -> runOnMain { requirePlayer(promise)?.skipToPrevious(); promise.resolve(null) } }
        AsyncFunction("seekTo")         { ms: Double, promise: Promise -> runOnMain { requirePlayer(promise)?.seekTo(ms.toLong()); promise.resolve(null) } }
        AsyncFunction("skipToIndex")    { idx: Int, promise: Promise -> runOnMain { requirePlayer(promise)?.skipToIndex(idx); currentTrackIndex = idx; promise.resolve(null) } }
        AsyncFunction("setVolume")      { vol: Double, promise: Promise -> runOnMain { requirePlayer(promise)?.setVolume(vol.toFloat()); promise.resolve(null) } }
        AsyncFunction("setRepeatMode")  { mode: Int, promise: Promise -> runOnMain { requirePlayer(promise)?.setRepeatMode(mode); promise.resolve(null) } }
        AsyncFunction("setShuffleMode") { en: Boolean, promise: Promise -> runOnMain { requirePlayer(promise)?.setShuffleModeEnabled(en); promise.resolve(null) } }

        AsyncFunction("skip") { seconds: Int, promise: Promise ->
            runOnMain { requirePlayer(promise)?.skipRelative(seconds); promise.resolve(null) }
        }

        // ─────────────────────────────────────────────────────────────────────
        // PLAY-WHEN-READY  (RNTP 4.x parity)
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setPlayWhenReady") { playWhenReady: Boolean, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                p.setPlayWhenReady(playWhenReady)
                sendEvent("onPlaybackPlayWhenReadyChanged", mapOf("playWhenReady" to playWhenReady))
                promise.resolve(null)
            }
        }

        AsyncFunction("getPlayWhenReady") { promise: Promise ->
            runOnMain {
                promise.resolve(playerInstance?.getPlayWhenReady() ?: true)
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // STATE GETTERS
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("getPosition")         { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getCurrentPosition()?.toDouble() ?: 0.0) } }
        AsyncFunction("getDuration")         { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getDuration()?.toDouble() ?: 0.0) } }
        AsyncFunction("getBufferedPosition") { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getBufferedPosition()?.toDouble() ?: 0.0) } }
        AsyncFunction("getCurrentTrack")     { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getCurrentTrackInfo()) } }
        AsyncFunction("isPlaying")           { promise: Promise -> runOnMain { promise.resolve(playerInstance?.isPlaying() ?: false) } }
        AsyncFunction("getQueueSize")        { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getQueueSize() ?: 0) } }
        AsyncFunction("getVolume")           { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getVolume()?.toDouble() ?: 1.0) } }
        AsyncFunction("getRepeatMode")       { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getRepeatMode() ?: 0) } }
        AsyncFunction("getShuffleMode")      { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getShuffleMode() ?: false) } }
        AsyncFunction("getAudioFocus")       { promise: Promise -> promise.resolve(hasAudioFocus) }

        AsyncFunction("getActiveTrack") { promise: Promise ->
            runOnMain { promise.resolve(playerInstance?.getCurrentTrackInfo()) }
        }

        AsyncFunction("getActiveTrackIndex") { promise: Promise ->
            runOnMain {
                val info = playerInstance?.getCurrentTrackInfo()
                promise.resolve(info?.get("index") as? Int)
            }
        }

        AsyncFunction("getProgress") { promise: Promise ->
            runOnMain {
                val p = playerInstance
                promise.resolve(if (p != null) mapOf(
                    "position" to p.getCurrentPosition().toDouble(),
                    "duration" to p.getDuration().toDouble(),
                    "buffered" to p.getBufferedPosition().toDouble()
                ) else mapOf("position" to 0.0, "duration" to 0.0, "buffered" to 0.0))
            }
        }

        AsyncFunction("getPlaybackState") { promise: Promise ->
            runOnMain {
                val state = playerInstance?.getPlaybackStateString() ?: "none"
                promise.resolve(mapOf("state" to state))
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // CONFIGURATION
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setProgressUpdateInterval") { ms: Double, promise: Promise ->
            playerInstance?.setProgressIntervalMs(ms.toLong())
            promise.resolve(null)
        }
        AsyncFunction("getProgressUpdateInterval") { promise: Promise ->
            promise.resolve(playerInstance?.getProgressIntervalMs()?.toDouble() ?: 1000.0)
        }

        AsyncFunction("setCacheConfig") { options: Map<String, Any?>, promise: Promise ->
            runOnMain {
                val sizeBytes = (options["sizeMB"] as? Number)?.toLong()?.times(1024 * 1024)
                    ?: (options["sizeBytes"] as? Number)?.toLong()
                    ?: (200L * 1024 * 1024)
                playerInstance?.updateCacheConfig(sizeBytes)
                promise.resolve(null)
            }
        }

        AsyncFunction("setWakeMode") { mode: Int, promise: Promise ->
            runOnMain { playerInstance?.setWakeMode(mode); promise.resolve(null) }
        }

        AsyncFunction("setAudioAttributes") { options: Map<String, Any?>, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                val usage       = options["usage"] as? String
                val contentType = options["contentType"] as? String
                p.configureAudioAttributes(usage, contentType)
                p.applyAudioAttributes()
                promise.resolve(null)
            }
        }

        AsyncFunction("updateOptions") { options: Map<String, Any?>, promise: Promise ->
            runOnMain {
                try {
                    val ctx = appContext.reactContext
                        ?: return@runOnMain promise.reject("NO_CONTEXT", "ReactContext not available", null)
                    val p = playerInstance
                    // FIX: always release the old session before rebuilding to prevent
                    // duplicate-ID crash when updateOptions is called more than once.
                    mediaSession?.release()
                    mediaSession = null
                    if (p != null) setupMediaSession(ctx, p, options)
                    promise.resolve(null)
                } catch (e: Exception) { promise.reject("UPDATE_OPTIONS_ERROR", e.message, e) }
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // PLAYBACK SPEED + PITCH
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setPlaybackSpeed") { speed: Double, promise: Promise ->
            playerInstance?.setPlaybackSpeed(speed.toFloat()); promise.resolve(null)
        }
        AsyncFunction("getPlaybackSpeed") { promise: Promise ->
            promise.resolve(playerInstance?.getPlaybackSpeed()?.toDouble() ?: 1.0)
        }
        AsyncFunction("setPlaybackPitch") { pitch: Double, promise: Promise ->
            playerInstance?.setPlaybackPitch(pitch.toFloat()); promise.resolve(null)
        }
        AsyncFunction("getPlaybackPitch") { promise: Promise ->
            promise.resolve(playerInstance?.getPlaybackPitch()?.toDouble() ?: 1.0)
        }
        AsyncFunction("setPlaybackParameters") { speed: Double, pitch: Double, promise: Promise ->
            playerInstance?.setPlaybackParameters(speed.toFloat(), pitch.toFloat())
            promise.resolve(null)
        }

        // ─────────────────────────────────────────────────────────────────────
        // CROSSFADE
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setCrossfadeEnabled")  { enabled: Boolean, promise: Promise -> playerInstance?.setCrossfadeEnabled(enabled); promise.resolve(null) }
        AsyncFunction("isCrossfadeEnabled")   { promise: Promise -> promise.resolve(playerInstance?.isCrossfadeEnabled() ?: false) }
        AsyncFunction("setCrossfadeDuration") { durationMs: Double, promise: Promise -> playerInstance?.setCrossfadeDurationMs(durationMs.toLong()); promise.resolve(null) }
        AsyncFunction("getCrossfadeDuration") { promise: Promise -> promise.resolve(playerInstance?.getCrossfadeDurationMs()?.toDouble() ?: 2000.0) }

        // ─────────────────────────────────────────────────────────────────────
        // OFFLINE MODE
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setOfflineMode") { enabled: Boolean, promise: Promise -> playerInstance?.setOfflineMode(enabled); promise.resolve(null) }
        AsyncFunction("isOfflineMode")  { promise: Promise -> promise.resolve(playerInstance?.isOfflineMode() ?: false) }

        // ─────────────────────────────────────────────────────────────────────
        // 64-BIT PROCESSING
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("set64BitProcessingEnabled") { enabled: Boolean, promise: Promise -> playerInstance?.set64BitProcessingEnabled(enabled); promise.resolve(null) }
        AsyncFunction("is64BitProcessingEnabled")  { promise: Promise -> promise.resolve(playerInstance?.is64BitProcessingEnabled() ?: false) }

        // ─────────────────────────────────────────────────────────────────────
        // USB DAC
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("isUsbDacConnected") { promise: Promise -> promise.resolve(playerInstance?.isUsbDacConnected() ?: false) }

        AsyncFunction("getCurrentDacInfo") { promise: Promise ->
            val d = playerInstance?.getCurrentDacInfo()
            if (d != null) promise.resolve(mapOf(
                "name" to d.name, "vendorId" to d.vendorId, "productId" to d.productId,
                "isConnected" to d.isConnected, "hasAudioOutput" to d.hasAudioOutput,
                "supportedSampleRates" to d.supportedSampleRates, "maxBitDepth" to d.maxBitDepth,
                "maxChannels" to d.maxChannels, "isNativeDirectSupported" to d.isNativeDirectSupported
            ))
            else promise.resolve(null)
        }

        AsyncFunction("getDacCapabilities") { promise: Promise ->
            val c = playerInstance?.getDacCapabilities()
            if (c != null) promise.resolve(mapOf(
                "sampleRates" to c.sampleRates, "bitDepths" to c.bitDepths,
                "channelCounts" to c.channelCounts, "supportsFloatOutput" to c.supportsFloatOutput,
                "supportsHdAudio" to c.supportsHdAudio, "nativeSampleRate" to c.nativeSampleRate,
                "nativeBitDepth" to c.nativeBitDepth
            ))
            else promise.resolve(null)
        }

        AsyncFunction("enableDirectUsbRouting")    { enabled: Boolean, promise: Promise -> promise.resolve(playerInstance?.enableDirectUsbRouting(enabled) ?: false) }
        AsyncFunction("isDirectUsbRoutingEnabled") { promise: Promise -> promise.resolve(playerInstance?.isDirectUsbRoutingEnabled() ?: false) }
        AsyncFunction("setPreferredDacSampleRate") { rate: Int, promise: Promise -> promise.resolve(playerInstance?.setPreferredDacSampleRate(rate) ?: false) }
        AsyncFunction("setPreferredDacBitDepth")   { depth: Int, promise: Promise -> promise.resolve(playerInstance?.setPreferredDacBitDepth(depth) ?: false) }
        AsyncFunction("rescanUsbDevices")          { promise: Promise -> playerInstance?.rescanUsbDevices(); promise.resolve(null) }

        // ─────────────────────────────────────────────────────────────────────
        // AUDIO FORMAT DETECTION
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("getAudioCapabilities") { promise: Promise ->
            val c = playerInstance?.getAudioCapabilities()
            if (c != null) promise.resolve(mapOf(
                "maxSampleRate" to c.maxSampleRate, "maxBitDepth" to c.maxBitDepth,
                "supportsFloat" to c.supportsFloat, "supportsHdAudio" to c.supportsHdAudio,
                "supportsUltraHdAudio" to c.supportsUltraHdAudio,
                "supportedSampleRates" to c.supportedSampleRates,
                "supportedBitDepths" to c.supportedBitDepths, "isHiResCapable" to c.isHiResCapable
            ))
            else promise.resolve(null)
        }

        AsyncFunction("getOptimalAudioFormat") { promise: Promise ->
            val f = playerInstance?.getOptimalAudioFormat()
            if (f != null) promise.resolve(mapOf(
                "sampleRate" to f.sampleRate, "bitDepth" to f.bitDepth,
                "encoding" to f.encoding, "isFloat" to f.isFloat,
                "isHiRes" to f.isHiRes, "channelCount" to f.channelCount
            ))
            else promise.resolve(null)
        }

        AsyncFunction("isHiResAudioCapable") { promise: Promise -> promise.resolve(playerInstance?.isHiResAudioCapable() ?: false) }
        AsyncFunction("getMaxSampleRate")    { promise: Promise -> promise.resolve(playerInstance?.getMaxSampleRate() ?: 48000) }
        AsyncFunction("getMaxBitDepth")      { promise: Promise -> promise.resolve(playerInstance?.getMaxBitDepth() ?: 16) }

        // ─────────────────────────────────────────────────────────────────────
        // CONVOLUTION
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("loadImpulseResponse") { filePath: String, promise: Promise ->
            if (playerInstance?.loadImpulseResponse(filePath) == true) promise.resolve(null)
            else promise.reject("LOAD_IR_FAILED", "Failed to load impulse response from $filePath", null)
        }
        AsyncFunction("clearImpulseResponse")    { promise: Promise -> playerInstance?.clearImpulseResponse(); promise.resolve(null) }
        AsyncFunction("isImpulseResponseLoaded") { promise: Promise -> promise.resolve(playerInstance?.isImpulseResponseLoaded() ?: false) }
        AsyncFunction("getIrLength")             { promise: Promise -> promise.resolve(playerInstance?.getIrLength() ?: 0) }
        AsyncFunction("setConvolutionEnabled")   { enabled: Boolean, promise: Promise -> playerInstance?.setConvolutionEnabled(enabled); promise.resolve(null) }
        AsyncFunction("isConvolutionEnabled")    { promise: Promise -> promise.resolve(playerInstance?.isConvolutionEnabled() ?: false) }

        // ─────────────────────────────────────────────────────────────────────
        // EQ — GRAPHIC
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setEQEnabled") { en: Boolean, promise: Promise -> playerInstance?.setEQEnabled(en); promise.resolve(null) }
        AsyncFunction("setEQBand")    { band: Int, gainDb: Double, promise: Promise -> playerInstance?.setEQBand(band, gainDb.toFloat()); promise.resolve(null) }
        AsyncFunction("applyEQBands") { gains: List<Double>, promise: Promise -> playerInstance?.applyEQBands(gains.toFloatArray()); promise.resolve(null) }
        AsyncFunction("setEQPreamp")  { gainDb: Double, promise: Promise -> playerInstance?.setEQPreamp(gainDb.toFloat()); promise.resolve(null) }
        AsyncFunction("setEQBandQ")   { band: Int, q: Double, promise: Promise -> playerInstance?.setEQBandQ(band, q.toFloat()); promise.resolve(null) }
        AsyncFunction("resetEQ")      { promise: Promise -> playerInstance?.resetEQ(); promise.resolve(null) }

        // ─────────────────────────────────────────────────────────────────────
        // EQ — PARAMETRIC
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setParametricBandGain") { band: Int, gainDb: Double, promise: Promise -> playerInstance?.setParametricBandGain(band, gainDb.toFloat()); promise.resolve(null) }
        AsyncFunction("applyParametricBands")  { gains: List<Double>, promise: Promise -> playerInstance?.applyParametricBands(gains.toFloatArray()); promise.resolve(null) }
        AsyncFunction("setParametricBandFreq") { band: Int, freqHz: Double, promise: Promise -> playerInstance?.setParametricBandFreq(band, freqHz); promise.resolve(null) }
        AsyncFunction("resetParametric")       { promise: Promise -> playerInstance?.resetParametric(); promise.resolve(null) }
        AsyncFunction("setEQMode")             { mode: String, promise: Promise -> playerInstance?.setEQMode(mode); promise.resolve(null) }

        // ─────────────────────────────────────────────────────────────────────
        // EQ — DITHER / SMOOTHING
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setDitherMode")    { mode: String, promise: Promise -> playerInstance?.setDitherMode(mode); promise.resolve(null) }
        AsyncFunction("getDitherMode")    { promise: Promise -> promise.resolve(playerInstance?.getDitherMode() ?: "E_WEIGHTED") }
        AsyncFunction("setSmoothingRamp") { ms: Double, promise: Promise -> playerInstance?.setSmoothingRamp(ms); promise.resolve(null) }

        // ─────────────────────────────────────────────────────────────────────
        // COMPRESSOR (DRC)
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setCompressorEnabled")    { enabled: Boolean, promise: Promise -> playerInstance?.setCompressorEnabled(enabled); promise.resolve(null) }
        AsyncFunction("isCompressorEnabled")     { promise: Promise -> promise.resolve(playerInstance?.isCompressorEnabled() ?: false) }
        AsyncFunction("setCompressorThreshold")  { db: Double, promise: Promise -> playerInstance?.setCompressorThreshold(db); promise.resolve(null) }
        AsyncFunction("setCompressorRatio")      { ratio: Double, promise: Promise -> playerInstance?.setCompressorRatio(ratio); promise.resolve(null) }
        AsyncFunction("setCompressorAttack")     { ms: Double, promise: Promise -> playerInstance?.setCompressorAttackMs(ms); promise.resolve(null) }
        AsyncFunction("setCompressorRelease")    { ms: Double, promise: Promise -> playerInstance?.setCompressorReleaseMs(ms); promise.resolve(null) }
        AsyncFunction("setCompressorKnee")       { db: Double, promise: Promise -> playerInstance?.setCompressorKneeWidth(db); promise.resolve(null) }
        AsyncFunction("setCompressorMakeupGain") { db: Double, promise: Promise -> playerInstance?.setCompressorMakeupGain(db); promise.resolve(null) }
        AsyncFunction("getCompressorReduction")  { promise: Promise -> promise.resolve(playerInstance?.getCompressorReductionDb()?.toDouble() ?: 0.0) }
        AsyncFunction("getCompressorThreshold")  { promise: Promise -> promise.resolve(playerInstance?.getCompressorThreshold() ?: -24.0) }
        AsyncFunction("getCompressorRatio")      { promise: Promise -> promise.resolve(playerInstance?.getCompressorRatio() ?: 4.0) }
        AsyncFunction("getCompressorAttack")     { promise: Promise -> promise.resolve(playerInstance?.getCompressorAttackMs() ?: 5.0) }
        AsyncFunction("getCompressorRelease")    { promise: Promise -> promise.resolve(playerInstance?.getCompressorReleaseMs() ?: 100.0) }

        // ─────────────────────────────────────────────────────────────────────
        // CROSSFEED
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setCrossfeedEnabled")  { enabled: Boolean, promise: Promise -> playerInstance?.setCrossfeedEnabled(enabled); promise.resolve(null) }
        AsyncFunction("isCrossfeedEnabled")   { promise: Promise -> promise.resolve(playerInstance?.isCrossfeedEnabled() ?: false) }
        AsyncFunction("setCrossfeedStrength") { strength: Double, promise: Promise -> playerInstance?.setCrossfeedStrength(strength.toFloat()); promise.resolve(null) }
        AsyncFunction("setCrossfeedCutoff")   { hz: Double, promise: Promise -> playerInstance?.setCrossfeedCutoff(hz); promise.resolve(null) }
        AsyncFunction("getCrossfeedStrength") { promise: Promise -> promise.resolve(playerInstance?.getCrossfeedStrength()?.toDouble() ?: 0.7) }
        AsyncFunction("getCrossfeedCutoff")   { promise: Promise -> promise.resolve(playerInstance?.getCrossfeedCutoff() ?: 700.0) }
        AsyncFunction("setCrossfeedDelayMs")  { ms: Double, promise: Promise -> playerInstance?.setCrossfeedDelayMs(ms); promise.resolve(null) }
        AsyncFunction("getCrossfeedDelayMs")  { promise: Promise -> promise.resolve(playerInstance?.getCrossfeedDelayMs() ?: 0.3) }

        // ─────────────────────────────────────────────────────────────────────
        // PEAK METER
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setPeakHoldMs")    { ms: Double, promise: Promise -> playerInstance?.setPeakHoldMs(ms); promise.resolve(null) }
        AsyncFunction("setPeakReleaseMs") { ms: Double, promise: Promise -> playerInstance?.setPeakReleaseMs(ms); promise.resolve(null) }
        AsyncFunction("getCurrentPeaks") { promise: Promise ->
            val peaks = playerInstance?.getCurrentPeaks() ?: floatArrayOf(0f, 0f)
            promise.resolve(mapOf(
                "left"  to peaks.getOrElse(0) { 0f }.toDouble(),
                "right" to peaks.getOrElse(1) { 0f }.toDouble()
            ))
        }
        AsyncFunction("getHeldPeaks") { promise: Promise ->
            val peaks = playerInstance?.getHeldPeaks() ?: floatArrayOf(0f, 0f)
            promise.resolve(mapOf(
                "left"  to peaks.getOrElse(0) { 0f }.toDouble(),
                "right" to peaks.getOrElse(1) { 0f }.toDouble()
            ))
        }
        AsyncFunction("resetPeaks") { promise: Promise -> playerInstance?.resetPeaks(); promise.resolve(null) }

        // ─────────────────────────────────────────────────────────────────────
        // REPLAY GAIN
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setReplayGainMode")    { mode: String, promise: Promise -> playerInstance?.setReplayGainMode(mode); promise.resolve(null) }
        AsyncFunction("setReplayGainPreamp")  { gainDb: Double, promise: Promise -> playerInstance?.setReplayGainPreamp(gainDb.toFloat()); promise.resolve(null) }
        AsyncFunction("setReplayGainFromMap") { tags: Map<String, String>, promise: Promise -> playerInstance?.setReplayGainFromMap(tags); promise.resolve(null) }
        AsyncFunction("getReplayGainInfo")    { promise: Promise -> promise.resolve(playerInstance?.getReplayGainInfo()) }

        // ─────────────────────────────────────────────────────────────────────
        // PRESETS
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("applyPreset") { name: String, promise: Promise ->
            if (playerInstance?.applyPresetByName(name) == true) promise.resolve(null)
            else promise.reject("PRESET_NOT_FOUND", "Preset '$name' not found", null)
        }
        AsyncFunction("savePreset")           { name: String, promise: Promise -> playerInstance?.saveCurrentAsPreset(name); promise.resolve(null) }
        AsyncFunction("listPresets")          { promise: Promise -> promise.resolve(playerInstance?.listPresets() ?: emptyList<String>()) }
        AsyncFunction("deletePreset")         { name: String, promise: Promise -> promise.resolve(playerInstance?.deletePreset(name) ?: false) }
        AsyncFunction("exportPreset")         { name: String, promise: Promise -> promise.resolve(playerInstance?.exportPreset(name)) }
        AsyncFunction("importPreset")         { json: String, promise: Promise ->
            if (playerInstance?.importPreset(json) == true) promise.resolve(null)
            else promise.reject("IMPORT_ERROR", "Failed to parse preset JSON", null)
        }
        AsyncFunction("assignTrackPreset")    { mediaId: String, presetName: String?, promise: Promise -> playerInstance?.assignTrackPreset(mediaId, presetName); promise.resolve(null) }
        AsyncFunction("getTrackPreset")       { mediaId: String, promise: Promise -> promise.resolve(playerInstance?.getTrackPreset(mediaId)) }
        AsyncFunction("setAutoSwitchPresets") { enabled: Boolean, promise: Promise -> playerInstance?.setAutoSwitchPresets(enabled); promise.resolve(null) }

        // ─────────────────────────────────────────────────────────────────────
        // EQ STATE GETTERS
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("getEQGains") { promise: Promise ->
            promise.resolve(playerInstance?.getEQGains()?.mapIndexed { i, g ->
                mapOf("band" to i, "gain" to g.toDouble())
            } ?: emptyList<Map<String, Any>>())
        }
        AsyncFunction("getEQPreamp")  { promise: Promise -> promise.resolve(playerInstance?.getEQPreamp()?.toDouble() ?: 0.0) }
        AsyncFunction("isEQEnabled")  { promise: Promise -> promise.resolve(playerInstance?.isEQEnabled() ?: false) }
        AsyncFunction("getEQQValues") { promise: Promise ->
            promise.resolve(playerInstance?.getEQQValues()?.mapIndexed { i, q ->
                mapOf("band" to i, "q" to q.toDouble())
            } ?: emptyList<Map<String, Any>>())
        }
        AsyncFunction("getParametricGains") { promise: Promise ->
            promise.resolve(playerInstance?.getParametricGains()?.mapIndexed { i, g ->
                mapOf("band" to i, "gain" to g.toDouble())
            } ?: emptyList<Map<String, Any>>())
        }
        AsyncFunction("getParametricFreqs") { promise: Promise ->
            promise.resolve(playerInstance?.getParametricFreqs()?.mapIndexed { i, f ->
                mapOf("band" to i, "freqHz" to f)
            } ?: emptyList<Map<String, Any>>())
        }
        AsyncFunction("getEQMode")     { promise: Promise -> promise.resolve(playerInstance?.getEQMode() ?: "GRAPHIC") }
        AsyncFunction("getLoudnessDb") { promise: Promise -> promise.resolve(playerInstance?.getLoudnessDb()?.toDouble() ?: 0.0) }

        // ─────────────────────────────────────────────────────────────────────
        // SPECTRUM & AUTO-EQ
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("getSpectrumMagnitudes") { promise: Promise ->
            promise.resolve(playerInstance?.getSpectrumMagnitudes()?.mapIndexed { i, m ->
                mapOf("bin" to i, "magnitude" to m.toDouble())
            } ?: emptyList<Map<String, Any>>())
        }
        AsyncFunction("computeAutoEQ") { promise: Promise ->
            val suggestion = playerInstance?.computeAutoEQ()
            promise.resolve(suggestion?.mapIndexed { i, g ->
                mapOf("band" to i, "gain" to g.toDouble(), "freqHz" to EqualizerProcessor.ISO_FREQ_CENTERS[i])
            } ?: emptyList<Map<String, Any>>())
        }

        // ─────────────────────────────────────────────────────────────────────
        // FX PROCESSOR
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setFxEnabled")  { enabled: Boolean, promise: Promise -> playerInstance?.setFxEnabled(enabled); promise.resolve(null) }
        AsyncFunction("isFxEnabled")   { promise: Promise -> promise.resolve(playerInstance?.isFxEnabled() ?: false) }
        AsyncFunction("setFxMode")     { mode: String, promise: Promise -> playerInstance?.setFxMode(mode); promise.resolve(null) }
        AsyncFunction("getFxMode")     { promise: Promise -> promise.resolve(playerInstance?.getFxMode() ?: "REVERB") }
        AsyncFunction("setFxMix")      { mix: Double, promise: Promise -> playerInstance?.setFxMix(mix); promise.resolve(null) }
        AsyncFunction("getFxMix")      { promise: Promise -> promise.resolve(playerInstance?.getFxMix() ?: 30.0) }
        AsyncFunction("setFxBypass")   { bypass: Boolean, promise: Promise -> playerInstance?.setFxBypass(bypass); promise.resolve(null) }
        AsyncFunction("isFxBypassed")  { promise: Promise -> promise.resolve(playerInstance?.isFxBypassed() ?: false) }

        AsyncFunction("setReverbRoomSize") { value: Double, promise: Promise -> playerInstance?.setReverbRoomSize(value); promise.resolve(null) }
        AsyncFunction("setReverbDecay")    { value: Double, promise: Promise -> playerInstance?.setReverbDecay(value); promise.resolve(null) }
        AsyncFunction("setReverbPreDelay") { value: Double, promise: Promise -> playerInstance?.setReverbPreDelay(value); promise.resolve(null) }
        AsyncFunction("setReverbDamping")  { value: Double, promise: Promise -> playerInstance?.setReverbDamping(value); promise.resolve(null) }
        AsyncFunction("setDelayTime")      { value: Double, promise: Promise -> playerInstance?.setDelayTime(value); promise.resolve(null) }
        AsyncFunction("setDelayFeedback")  { value: Double, promise: Promise -> playerInstance?.setDelayFeedback(value); promise.resolve(null) }
        AsyncFunction("setDelayLowCut")    { value: Double, promise: Promise -> playerInstance?.setDelayLowCut(value); promise.resolve(null) }
        AsyncFunction("setDelayHighCut")   { value: Double, promise: Promise -> playerInstance?.setDelayHighCut(value); promise.resolve(null) }
        AsyncFunction("setModRate")        { value: Double, promise: Promise -> playerInstance?.setModRate(value); promise.resolve(null) }
        AsyncFunction("setModDepth")       { value: Double, promise: Promise -> playerInstance?.setModDepth(value); promise.resolve(null) }
        AsyncFunction("setModPhase")       { value: Double, promise: Promise -> playerInstance?.setModPhase(value); promise.resolve(null) }
        AsyncFunction("setModFeedback")    { value: Double, promise: Promise -> playerInstance?.setModFeedback(value); promise.resolve(null) }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MEDIA SESSION (Media3)
    // ─────────────────────────────────────────────────────────────────────────

    private fun setupMediaSession(context: Context, player: MavinAudioPlayer, options: Map<String, Any?>?) {
        val ratingType: Int = when ((options?.get("ratingType") as? String)?.uppercase()) {
            "HEART"      -> Rating.RATING_HEART
            "THUMB"      -> Rating.RATING_THUMB_UP_DOWN
            "STAR_3"     -> Rating.RATING_3_STARS
            "STAR_4"     -> Rating.RATING_4_STARS
            "STAR_5"     -> Rating.RATING_5_STARS
            "PERCENTAGE" -> Rating.RATING_PERCENTAGE
            else         -> Rating.RATING_NONE
        }

        // FIX: always release any existing session before building a new one.
        // Without this, calling setupMediaSession() twice (e.g. via updateOptions)
        // throws "Session ID must be unique" for the same MEDIA_SESSION_ID.
        mediaSession?.release()
        mediaSession = null

        val sessionBuilder = MediaSession.Builder(context, player.player)
            .setId(MEDIA_SESSION_ID)
            .setCallback(object : MediaSession.Callback {
                override fun onConnect(
                    session: MediaSession,
                    controller: MediaSession.ControllerInfo
                ): MediaSession.ConnectionResult {
                    // FIX: use DEFAULT_SESSION_AND_LIBRARY_COMMANDS instead of
                    // DEFAULT_SESSION_COMMANDS to include all standard commands
                    // including library-browsing commands needed for Android Auto.
                    val sessionCommands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS
                        .buildUpon()
                        .apply {
                            add(SessionCommand("mavin.action.TOGGLE_EQ",            Bundle.EMPTY))
                            add(SessionCommand("mavin.action.RESET_EQ",             Bundle.EMPTY))
                            add(SessionCommand("mavin.action.TOGGLE_EQ_MODE",       Bundle.EMPTY))
                            add(SessionCommand("mavin.action.TOGGLE_COMPRESSOR",    Bundle.EMPTY))
                            add(SessionCommand("mavin.action.INCREASE_COMPRESSION", Bundle.EMPTY))
                            add(SessionCommand("mavin.action.DECREASE_COMPRESSION", Bundle.EMPTY))
                            add(SessionCommand("mavin.action.TOGGLE_CROSSFEED",     Bundle.EMPTY))
                            add(SessionCommand("mavin.action.TOGGLE_FX",            Bundle.EMPTY))
                            add(SessionCommand("mavin.action.CYCLE_FX_MODE",        Bundle.EMPTY))
                            add(SessionCommand("mavin.action.NEXT_PRESET",          Bundle.EMPTY))
                            add(SessionCommand("mavin.action.PREV_PRESET",          Bundle.EMPTY))
                            add(SessionCommand("mavin.action.APPLY_PRESET",         Bundle.EMPTY))
                            add(SessionCommand("mavin.action.TOGGLE_REPLAY_GAIN",   Bundle.EMPTY))
                            add(SessionCommand("mavin.action.SPEED_UP",             Bundle.EMPTY))
                            add(SessionCommand("mavin.action.SLOW_DOWN",            Bundle.EMPTY))
                            add(SessionCommand("mavin.action.RESET_SPEED",          Bundle.EMPTY))
                            add(SessionCommand("mavin.action.TOGGLE_CROSSFADE",     Bundle.EMPTY))
                            add(SessionCommand("mavin.action.INCREASE_CROSSFADE",   Bundle.EMPTY))
                            add(SessionCommand("mavin.action.DECREASE_CROSSFADE",   Bundle.EMPTY))
                            add(SessionCommand("mavin.action.TOGGLE_OFFLINE",       Bundle.EMPTY))
                            add(SessionCommand("mavin.action.TOGGLE_64BIT",         Bundle.EMPTY))
                            add(SessionCommand("mavin.action.TOGGLE_CONVOLUTION",   Bundle.EMPTY))
                            add(SessionCommand("mavin.action.TOGGLE_USB_DIRECT",    Bundle.EMPTY))
                        }
                        .build()

                    // FIX: use AcceptedResultBuilder (Media3 ≥ 1.1) instead of the
                    // deprecated MediaSession.ConnectionResult.accept(). The old form
                    // silently discards player commands on newer Media3 versions.
                    return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                        .setAvailableSessionCommands(sessionCommands)
                        .build()
                }
            })

        mediaSession = sessionBuilder.build()
        Log.i(TAG, "Media3 MediaSession created (id=$MEDIA_SESSION_ID, ratingType=$ratingType)")
    }

    private fun updateMediaMetadata(track: TrackData, index: Int) {
        Log.d(TAG, "updateMediaMetadata: ${track.title} idx=$index")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AUDIO FOCUS
    // ─────────────────────────────────────────────────────────────────────────

    @Suppress("DEPRECATION")
    private fun requestAudioFocus(): Boolean {
        val ctx = appContext.reactContext ?: return false
        audioManager = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setOnAudioFocusChangeListener(this@MavinPlayerModule)
                .build()
            val result = audioManager?.requestAudioFocus(request)
            if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                audioFocusRequest = request
                hasAudioFocus = true
                sendEvent("onAudioFocusGranted", emptyMap<String, Any>())
                true
            } else false
        } else {
            val result = audioManager?.requestAudioFocus(
                this@MavinPlayerModule, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN
            )
            if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                hasAudioFocus = true
                sendEvent("onAudioFocusGranted", emptyMap<String, Any>())
                true
            } else false
        }
    }

    private fun abandonAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager?.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            audioManager?.abandonAudioFocus(this@MavinPlayerModule)
        }
        hasAudioFocus = false
    }

    override fun onAudioFocusChange(focusChange: Int) {
        when (focusChange) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                // FIX: restore volume to 1.0 when focus is regained after a duck.
                // Without this, volume stays at 0.3 after the interruption ends.
                playerInstance?.setVolume(1.0f)
                sendEvent("onAudioFocusGranted", emptyMap<String, Any>())
                hasAudioFocus = true
            }
            AudioManager.AUDIOFOCUS_LOSS -> {
                playerInstance?.pause()
                currentPlaybackState = PlaybackState.STATE_PAUSED
                sendEvent("onAudioFocusLost", mapOf("type" to "loss"))
                sendEvent("onRemoteDuck", mapOf("permanent" to true, "paused" to true))
                hasAudioFocus = false
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                playerInstance?.pause()
                currentPlaybackState = PlaybackState.STATE_PAUSED
                sendEvent("onAudioFocusLost", mapOf("type" to "transient"))
                sendEvent("onRemoteDuck", mapOf("permanent" to false, "paused" to true))
                hasAudioFocus = false
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                playerInstance?.setVolume(0.3f)
                sendEvent("onAudioFocusLost", mapOf("type" to "duck"))
                sendEvent("onRemoteDuck", mapOf("permanent" to false, "paused" to false))
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FOREGROUND SERVICE + NOTIFICATION
    // ─────────────────────────────────────────────────────────────────────────

    private fun startForegroundService(context: Context) {
        if (isForegroundService) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) createNotificationChannel(context)
        val serviceIntent = Intent(context, MavinPlaybackService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(serviceIntent)
        else context.startService(serviceIntent)
        isForegroundService = true
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun createNotificationChannel(context: Context) {
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            "Mavin Player Playback",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Controls for Mavin Player audio playback"
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(channel)
    }

    fun buildMediaNotification(context: Context): Notification {
        val launchIntent = context.packageManager
            .getLaunchIntentForPackage(context.packageName)
            ?.apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP }

        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

        val pendingIntent = PendingIntent.getActivity(context, 0, launchIntent, pendingFlags)

        val iconResId = context.resources.getIdentifier(
            "notification_icon", "drawable", context.packageName
        ).takeIf { it != 0 } ?: android.R.drawable.ic_media_play

        val trackInfo = playerInstance?.getCurrentTrackInfo()
        val title     = trackInfo?.get("title")  as? String ?: "Mavin Player"
        val artist    = trackInfo?.get("artist") as? String ?: "Ready to play"
        val isPlaying = playerInstance?.isPlaying() ?: false

        return NotificationCompat.Builder(context, NOTIFICATION_CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(artist)
            .setSmallIcon(iconResId)
            .setContentIntent(pendingIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(isPlaying)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun buildNotificationAction(
        context: Context,
        iconRes: Int,
        title: String,
        action: String,
        requestCode: Int,
        pendingFlags: Int
    ): NotificationCompat.Action {
        val intent = Intent(action).setPackage(context.packageName)
        val pi = PendingIntent.getBroadcast(context, requestCode, intent, pendingFlags)
        return NotificationCompat.Action(iconRes, title, pi)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PLAYER CALLBACKS
    // ─────────────────────────────────────────────────────────────────────────

    private fun setupPlayerCallbacks(player: MavinAudioPlayer) {

        player.onPlaybackStateChanged = { state ->
            val name = when (state) {
                Player.STATE_IDLE      -> "idle"
                Player.STATE_BUFFERING -> "buffering"
                Player.STATE_READY     -> "ready"
                Player.STATE_ENDED     -> "ended"
                else                   -> "unknown"
            }
            sendDebouncedEvent("onPlaybackStateChanged", mapOf("state" to name), 50)
            if (state == Player.STATE_READY) {
                currentPlaybackState = PlaybackState.STATE_PLAYING
                startProgressTimer(player)
                startSpectrumTimer(player)
            }
            if (state == Player.STATE_IDLE || state == Player.STATE_ENDED) {
                currentPlaybackState = PlaybackState.STATE_NONE
                stopAllTimers()
            }
        }

        player.onTrackChanged = { index ->
            currentTrackIndex = index
            sendDebouncedEvent("onTrackChanged", mapOf("index" to index), 100)
            val trackInfo = playerInstance?.getCurrentTrackInfo() ?: emptyMap<String, Any?>()
            sendDebouncedEvent(
                "onPlaybackActiveTrackChanged",
                mapOf("index" to index, "track" to trackInfo),
                100
            )
        }

        player.onError = { message, code ->
            sendEvent("onError", mapOf("message" to message, "code" to code))
            currentPlaybackState = PlaybackState.STATE_ERROR
        }

        player.onQueueEnded = { position ->
            sendEvent("onPlaybackQueueEnded", mapOf("position" to position.toDouble()))
        }

        player.onPlayWhenReadyChanged = { playWhenReady ->
            sendEvent("onPlaybackPlayWhenReadyChanged", mapOf("playWhenReady" to playWhenReady))
        }

        player.onReplayGainApplied = { trackGain, albumGain, appliedDb ->
            val payload = mutableMapOf<String, Any>()
            trackGain?.let  { payload["trackGain"]  = it }
            albumGain?.let  { payload["albumGain"]  = it }
            payload["appliedDb"] = appliedDb
            sendDebouncedEvent("onReplayGainApplied", payload, 200)
        }

        player.onUsbDacConnected = { dacInfo ->
            sendEvent("onUsbDacConnected", mapOf(
                "name"                    to dacInfo.name,
                "vendorId"                to dacInfo.vendorId,
                "productId"               to dacInfo.productId,
                "hasAudioOutput"          to dacInfo.hasAudioOutput,
                "supportedSampleRates"    to dacInfo.supportedSampleRates,
                "maxBitDepth"             to dacInfo.maxBitDepth,
                "maxChannels"             to dacInfo.maxChannels,
                "isNativeDirectSupported" to dacInfo.isNativeDirectSupported
            ))
        }

        player.onUsbDacDisconnected = {
            sendEvent("onUsbDacDisconnected", emptyMap<String, Any>())
        }

        player.onRemoteStop = {
            sendEvent("onRemoteStop", emptyMap<String, Any>())
        }

        player.onRemoteSkip = { index ->
            sendEvent("onRemoteSkip", mapOf("index" to index))
        }

        player.onRemotePlayId = { id ->
            sendEvent("onRemotePlayId", mapOf("id" to id))
        }

        player.onRemotePlaySearch = { query, extras ->
            val payload = mutableMapOf<String, Any>("query" to query)
            extras.forEach { (k, v) -> if (v != null) payload[k] = v }
            sendEvent("onRemotePlaySearch", payload)
        }

        player.onRemoteSetRating = { rating ->
            sendEvent("onRemoteSetRating", mapOf("rating" to rating.toDouble()))
        }

        player.onRemoteJumpForward = { interval ->
            sendEvent("onRemoteJumpForward", mapOf("interval" to interval))
        }

        player.onRemoteJumpBackward = { interval ->
            sendEvent("onRemoteJumpBackward", mapOf("interval" to interval))
        }

        player.onRemoteDuck = { permanent, paused ->
            sendEvent("onRemoteDuck", mapOf("permanent" to permanent, "paused" to paused))
        }

        player.onAudioCommonMetadata = { metadata ->
            sendEvent("onAudioCommonMetadataReceived", mapOf("metadata" to metadata))
        }

        player.onAudioTimedMetadata = { metadata ->
            sendEvent("onAudioTimedMetadataReceived", mapOf("metadata" to metadata))
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROGRESS + SPECTRUM TIMERS
    // ─────────────────────────────────────────────────────────────────────────

    private fun startProgressTimer(player: MavinAudioPlayer) {
        stopProgressTimer()
        progressRunnable = object : Runnable {
            override fun run() {
                if (player.isPlaying() && hasAudioFocus) {
                    val position = player.getCurrentPosition()
                    if (Math.abs(position - lastKnownPosition) >= 500) {
                        lastKnownPosition = position
                        sendDebouncedEvent("onProgress", mapOf(
                            "position" to position.toDouble(),
                            "duration" to player.getDuration().toDouble(),
                            "buffered" to player.getBufferedPosition().toDouble()
                        ), 200)
                    }
                }
                mainHandler.postDelayed(this, player.getProgressIntervalMs())
            }
        }
        mainHandler.postDelayed(progressRunnable!!, player.getProgressIntervalMs())
    }

    private fun startSpectrumTimer(player: MavinAudioPlayer) {
        stopSpectrumTimer()
        spectrumRunnable = object : Runnable {
            override fun run() {
                if (player.isPlaying() && hasAudioFocus) {
                    val magnitudes = player.getSpectrumMagnitudes()
                    if (magnitudes.isNotEmpty()) {
                        sendDebouncedEvent("onSpectrum",
                            mapOf("magnitudes" to magnitudes.map { it.toDouble() }), 300)
                    }
                    val peaks = player.getCurrentPeaks()
                    if (peaks.size >= 2) {
                        sendDebouncedEvent("onPeakMeter",
                            mapOf("left" to peaks[0].toDouble(), "right" to peaks[1].toDouble()), 300)
                    }
                }
                mainHandler.postDelayed(this, SPECTRUM_INTERVAL_MS)
            }
        }
        mainHandler.postDelayed(spectrumRunnable!!, SPECTRUM_INTERVAL_MS)
    }

    private fun stopProgressTimer() { progressRunnable?.let { mainHandler.removeCallbacks(it) }; progressRunnable = null }
    private fun stopSpectrumTimer()  { spectrumRunnable?.let  { mainHandler.removeCallbacks(it) }; spectrumRunnable  = null }
    private fun stopAllTimers()      { stopProgressTimer(); stopSpectrumTimer() }

    // ─────────────────────────────────────────────────────────────────────────
    // DEBOUNCED EVENT EMISSION
    // ─────────────────────────────────────────────────────────────────────────

    private class Debouncer(
        private val delayMs: Long,
        private val callback: (Map<String, Any>) -> Unit
    ) {
        private val handler = Handler(Looper.getMainLooper())
        private var lastTask: Runnable? = null
        fun trigger(data: Map<String, Any>) {
            lastTask?.let { handler.removeCallbacks(it) }
            val task = Runnable { callback(data) }
            lastTask = task
            handler.postDelayed(task, delayMs)
        }
        fun cancel() { lastTask?.let { handler.removeCallbacks(it) }; lastTask = null }
    }

    private fun sendDebouncedEvent(eventName: String, data: Map<String, Any>, debounceMs: Long) {
        eventDebouncers.getOrPut(eventName) { Debouncer(debounceMs) { sendEvent(eventName, it) } }.trigger(data)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // QUEUE PERSISTENCE
    // ─────────────────────────────────────────────────────────────────────────

    private fun persistQueue(tracks: List<Map<String, Any?>>, currentIndex: Int) {
        try {
            val ctx   = appContext.reactContext ?: return
            val prefs = ctx.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE)
            val json  = org.json.JSONArray(tracks.map { org.json.JSONObject(it) }).toString()
            prefs.edit()
                .putString(QUEUE_KEY, json)
                .putInt(TRACK_INDEX_KEY, currentIndex)
                .putLong(POSITION_KEY, playerInstance?.getCurrentPosition() ?: 0)
                .apply()
        } catch (e: Exception) { Log.w(TAG, "Failed to persist queue", e) }
    }

    private fun loadPersistedQueue(): List<Map<String, Any?>>? {
        return try {
            val ctx   = appContext.reactContext ?: return null
            val prefs = ctx.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE)
            val json  = prefs.getString(QUEUE_KEY, null) ?: return null
            val array = org.json.JSONArray(json)
            List(array.length()) { i ->
                val obj = array.getJSONObject(i)
                obj.keys().asSequence().associateWith { key ->
                    when (val v = obj.get(key)) {
                        is org.json.JSONArray  -> v.toList()
                        is org.json.JSONObject -> v.toMap()
                        else -> v
                    }
                }
            }
        } catch (e: Exception) { Log.w(TAG, "Failed to load persisted queue", e); null }
    }

    private fun restoreState() {
        try {
            val ctx        = appContext.reactContext ?: return
            val prefs      = ctx.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE)
            val queue      = loadPersistedQueue()
            val trackIndex = prefs.getInt(TRACK_INDEX_KEY, 0)
            val position   = prefs.getLong(POSITION_KEY, 0)
            if (!queue.isNullOrEmpty() && playerInstance != null) {
                playerInstance?.setQueue(queue.map { it.toTrackData() }, trackIndex)
                if (position > 0) playerInstance?.seekTo(position)
                currentTrackIndex = trackIndex
                lastKnownPosition = position
                Log.i(TAG, "✅ Restored queue: ${queue.size} tracks, index $trackIndex, pos $position")
            }
        } catch (e: Exception) { Log.w(TAG, "Failed to restore state", e) }
    }

    private fun saveState(player: MavinAudioPlayer) {
        loadPersistedQueue()?.let { persistQueue(it, currentTrackIndex) }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLEANUP
    // ─────────────────────────────────────────────────────────────────────────

    private fun cleanUp() {
        runOnMain {
            stopAllTimers()
            playerInstance?.let { saveState(it); it.release() }
            playerInstance = null
            mediaSession?.release()
            mediaSession = null
            abandonAudioFocus()
            eventDebouncers.values.forEach { it.cancel() }
            eventDebouncers.clear()
            Log.i(TAG, "🧹 Module cleaned up")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
    }

    private fun requirePlayer(promise: Promise): MavinAudioPlayer? {
        val p = playerInstance
        if (p == null) promise.reject("PLAYER_NOT_READY", "Call initPlayer() first", null)
        return p
    }

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.toTrackData(): TrackData {
        val rawRgTags = get("replayGainTags")
        val rgTags: Map<String, String>? = when (rawRgTags) {
            is Map<*, *> -> rawRgTags.entries
                .filter { it.key is String }
                .associate { (k, v) -> k as String to v.toString() }
            else -> null
        }

        return TrackData(
            id           = (get("id") as? String) ?: System.currentTimeMillis().toString(),
            uri          = get("uri") as? String ?: get("url") as? String
                           ?: throw IllegalArgumentException("track must have 'uri' or 'url'"),
            title        = get("title") as? String,
            artist       = get("artist") as? String,
            album        = get("album") as? String,
            artworkUri   = get("artwork") as? String ?: get("artworkUri") as? String,
            duration     = (get("duration") as? Number)?.toLong(),
            headers      = (get("headers") as? Map<*, *>)
                               ?.entries
                               ?.filter { it.key is String }
                               ?.associate { (k, v) -> k as String to v.toString() },
            replayGainTags = rgTags,
            genre        = get("genre") as? String,
            description  = get("description") as? String,
            date         = get("date") as? String,
            rating       = (get("rating") as? Number)?.toFloat(),
            isLiveStream = get("isLiveStream") as? Boolean ?: false,
        )
    }

    private fun List<Double>.toFloatArray() = FloatArray(size) { this[it].toFloat() }

    private fun org.json.JSONObject.toMap(): Map<String, Any?> = keys().asSequence().associateWith { key ->
        when (val v = this[key]) {
            is org.json.JSONArray  -> v.toList()
            is org.json.JSONObject -> v.toMap()
            org.json.JSONObject.NULL -> null
            else -> v
        }
    }

    private fun org.json.JSONArray.toList(): List<Any?> = List(length()) { i ->
        when (val v = this[i]) {
            is org.json.JSONArray  -> v.toList()
            is org.json.JSONObject -> v.toMap()
            org.json.JSONObject.NULL -> null
            else -> v
        }
    }
}