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
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import expo.modules.autoeqengine.EqualizerProcessor
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.mavinplayer.audio.MavinAudioPlayer
import expo.modules.mavinplayer.audio.TrackData
import expo.modules.mavinplayer.service.MavinPlaybackService
import java.util.concurrent.ConcurrentHashMap

@UnstableApi
class MavinPlayerModule : Module(), AudioManager.OnAudioFocusChangeListener {

    companion object {
        private const val TAG = "MavinPlayerModule"
        private const val PROGRESS_INTERVAL_MS  = 1000L
        private const val SPECTRUM_INTERVAL_MS  = 100L
        private const val NOTIFICATION_CHANNEL_ID = "mavin_player_channel"
        private const val NOTIFICATION_ID = 1
        private const val QUEUE_PREFS     = "mavin_queue_prefs"
        private const val QUEUE_KEY       = "persisted_queue"
        private const val POSITION_KEY    = "last_position"
        private const val TRACK_INDEX_KEY = "current_track_index"

        @Volatile var playerInstance: MavinAudioPlayer? = null

        private var mediaSession: MediaSessionCompat? = null
        private var audioManager: AudioManager? = null
        private var audioFocusRequest: AudioFocusRequest? = null
        private var hasAudioFocus = false
        private var isForegroundService = false
        private val eventDebouncers = ConcurrentHashMap<String, Debouncer>()
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var progressRunnable: Runnable? = null
    private var spectrumRunnable: Runnable? = null
    private var currentTrackIndex = 0
    private var lastKnownPosition = 0L

    // ═════════════════════════════════════════════════════════════════════════
    // MODULE DEFINITION
    // ═════════════════════════════════════════════════════════════════════════

    override fun definition() = ModuleDefinition {
        Name("MavinPlayer")

        Events(
            "onPlaybackStateChanged",
            "onTrackChanged",
            "onError",
            "onProgress",
            "onSpectrum",
            "onPeakMeter",
            "onReplayGainApplied",
            "onUsbDacConnected",
            "onUsbDacDisconnected",
            "onAudioFocusLost",
            "onAudioFocusGranted",
            "onRemotePlay",
            "onRemotePause",
            "onRemoteNext",
            "onRemotePrevious",
            "onRemoteSeek"
        )

        // ─────────────────────────────────────────────────────────────────────
        // PLAYER LIFECYCLE
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

                    audioManager = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

                    val player = MavinAudioPlayer(ctx)
                    playerInstance = player

                    setupMediaSession(ctx, player)
                    setupPlayerCallbacks(player)
                    requestAudioFocus()
                    restoreState()
                    startForegroundService(ctx)

                    Log.i(TAG, "✅ initPlayer complete with MediaSession + AudioFocus + Queue persistence")
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
                playerInstance?.let { player ->
                    saveState(player)
                    player.release()
                }
                playerInstance = null
                mediaSession?.release()
                mediaSession = null
                abandonAudioFocus()
                appContext.reactContext?.let { ctx ->
                    ctx.stopService(Intent(ctx, MavinPlaybackService::class.java))
                    if (isForegroundService) {
                        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                        nm.cancel(NOTIFICATION_ID)
                        isForegroundService = false
                    }
                }
                promise.resolve(null)
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
                    updateMediaSessionQueue(tracksRaw)
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
                    loadPersistedQueue()?.let { queue ->
                        persistQueue(queue + trackMap, currentTrackIndex)
                    }
                    promise.resolve(null)
                } catch (e: Exception) { promise.reject("QUEUE_ERROR", e.message, e) }
            }
        }

        AsyncFunction("play") { promise: Promise ->
            runOnMain {
                requirePlayer(promise)?.play()
                requestAudioFocus()
                updatePlaybackState(PlaybackStateCompat.STATE_PLAYING)
                promise.resolve(null)
            }
        }

        AsyncFunction("pause") { promise: Promise ->
            runOnMain {
                requirePlayer(promise)?.pause()
                updatePlaybackState(PlaybackStateCompat.STATE_PAUSED)
                promise.resolve(null)
            }
        }

        AsyncFunction("stop") { promise: Promise ->
            runOnMain {
                requirePlayer(promise)?.stop()
                updatePlaybackState(PlaybackStateCompat.STATE_STOPPED)
                promise.resolve(null)
            }
        }

        AsyncFunction("skipToNext")     { promise: Promise -> runOnMain { requirePlayer(promise)?.skipToNext();     promise.resolve(null) } }
        AsyncFunction("skipToPrevious") { promise: Promise -> runOnMain { requirePlayer(promise)?.skipToPrevious(); promise.resolve(null) } }
        AsyncFunction("seekTo")         { ms: Double, promise: Promise -> runOnMain { requirePlayer(promise)?.seekTo(ms.toLong()); updatePlaybackState(getCurrentPlaybackState()); promise.resolve(null) } }
        AsyncFunction("skipToIndex")    { idx: Int, promise: Promise -> runOnMain { requirePlayer(promise)?.skipToIndex(idx); currentTrackIndex = idx; promise.resolve(null) } }
        AsyncFunction("setVolume")      { vol: Double, promise: Promise -> runOnMain { requirePlayer(promise)?.setVolume(vol.toFloat()); promise.resolve(null) } }
        AsyncFunction("setRepeatMode")  { mode: Int, promise: Promise -> runOnMain { requirePlayer(promise)?.setRepeatMode(mode); updatePlaybackState(getCurrentPlaybackState()); promise.resolve(null) } }
        AsyncFunction("setShuffleMode") { en: Boolean, promise: Promise -> runOnMain { requirePlayer(promise)?.setShuffleModeEnabled(en); updatePlaybackState(getCurrentPlaybackState()); promise.resolve(null) } }

        // ─────────────────────────────────────────────────────────────────────
        // PLAYBACK SPEED
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setPlaybackSpeed") { speed: Double, promise: Promise ->
            playerInstance?.setPlaybackSpeed(speed.toFloat())
            updatePlaybackState(getCurrentPlaybackState())
            promise.resolve(null)
        }
        AsyncFunction("getPlaybackSpeed") { promise: Promise ->
            promise.resolve(playerInstance?.getPlaybackSpeed()?.toDouble() ?: 1.0)
        }

        // ─────────────────────────────────────────────────────────────────────
        // CROSSFADE
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setCrossfadeEnabled")  { enabled: Boolean, promise: Promise -> playerInstance?.setCrossfadeEnabled(enabled);         promise.resolve(null) }
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
        // USB DAC CONTROL
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("isUsbDacConnected") { promise: Promise -> promise.resolve(playerInstance?.isUsbDacConnected() ?: false) }

        AsyncFunction("getCurrentDacInfo") { promise: Promise ->
            val d = playerInstance?.getCurrentDacInfo()
            if (d != null) promise.resolve(mapOf("name" to d.name, "vendorId" to d.vendorId, "productId" to d.productId, "isConnected" to d.isConnected, "hasAudioOutput" to d.hasAudioOutput, "supportedSampleRates" to d.supportedSampleRates, "maxBitDepth" to d.maxBitDepth, "maxChannels" to d.maxChannels, "isNativeDirectSupported" to d.isNativeDirectSupported))
            else promise.resolve(null)
        }

        AsyncFunction("getDacCapabilities") { promise: Promise ->
            val c = playerInstance?.getDacCapabilities()
            if (c != null) promise.resolve(mapOf("sampleRates" to c.sampleRates, "bitDepths" to c.bitDepths, "channelCounts" to c.channelCounts, "supportsFloatOutput" to c.supportsFloatOutput, "supportsHdAudio" to c.supportsHdAudio, "nativeSampleRate" to c.nativeSampleRate, "nativeBitDepth" to c.nativeBitDepth))
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
            if (c != null) promise.resolve(mapOf("maxSampleRate" to c.maxSampleRate, "maxBitDepth" to c.maxBitDepth, "supportsFloat" to c.supportsFloat, "supportsHdAudio" to c.supportsHdAudio, "supportsUltraHdAudio" to c.supportsUltraHdAudio, "supportedSampleRates" to c.supportedSampleRates, "supportedBitDepths" to c.supportedBitDepths, "isHiResCapable" to c.isHiResCapable))
            else promise.resolve(null)
        }

        AsyncFunction("getOptimalAudioFormat") { promise: Promise ->
            val f = playerInstance?.getOptimalAudioFormat()
            if (f != null) promise.resolve(mapOf("sampleRate" to f.sampleRate, "bitDepth" to f.bitDepth, "encoding" to f.encoding, "isFloat" to f.isFloat, "isHiRes" to f.isHiRes, "channelCount" to f.channelCount))
            else promise.resolve(null)
        }

        AsyncFunction("isHiResAudioCapable") { promise: Promise -> promise.resolve(playerInstance?.isHiResAudioCapable() ?: false) }
        AsyncFunction("getMaxSampleRate")    { promise: Promise -> promise.resolve(playerInstance?.getMaxSampleRate() ?: 48000) }
        AsyncFunction("getMaxBitDepth")      { promise: Promise -> promise.resolve(playerInstance?.getMaxBitDepth() ?: 16) }

        // ─────────────────────────────────────────────────────────────────────
        // CONVOLUTION PROCESSOR
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("loadImpulseResponse") { filePath: String, promise: Promise ->
            if (playerInstance?.loadImpulseResponse(filePath) == true) promise.resolve(null)
            else promise.reject("LOAD_IR_FAILED", "Failed to load impulse response from $filePath", null)
        }
        AsyncFunction("clearImpulseResponse")   { promise: Promise -> playerInstance?.clearImpulseResponse(); promise.resolve(null) }
        AsyncFunction("isImpulseResponseLoaded") { promise: Promise -> promise.resolve(playerInstance?.isImpulseResponseLoaded() ?: false) }
        AsyncFunction("getIrLength")            { promise: Promise -> promise.resolve(playerInstance?.getIrLength() ?: 0) }
        AsyncFunction("setConvolutionEnabled")  { enabled: Boolean, promise: Promise -> playerInstance?.setConvolutionEnabled(enabled); promise.resolve(null) }
        AsyncFunction("isConvolutionEnabled")   { promise: Promise -> promise.resolve(playerInstance?.isConvolutionEnabled() ?: false) }

        // ─────────────────────────────────────────────────────────────────────
        // STATE READS
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("getPosition")     { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getCurrentPosition()?.toDouble() ?: 0.0) } }
        AsyncFunction("getDuration")     { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getDuration()?.toDouble()           ?: 0.0) } }
        AsyncFunction("getCurrentTrack") { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getCurrentTrackInfo()) } }
        AsyncFunction("isPlaying")       { promise: Promise -> runOnMain { promise.resolve(playerInstance?.isPlaying() ?: false) } }
        AsyncFunction("getQueueSize")    { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getQueueSize() ?: 0) } }

        // ─────────────────────────────────────────────────────────────────────
        // EQ — GRAPHIC
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setEQEnabled")  { en: Boolean, promise: Promise          -> playerInstance?.setEQEnabled(en);                              promise.resolve(null) }
        AsyncFunction("setEQBand")     { band: Int, gainDb: Double, promise: Promise -> playerInstance?.setEQBand(band, gainDb.toFloat());         promise.resolve(null) }
        AsyncFunction("applyEQBands")  { gains: List<Double>, promise: Promise  -> playerInstance?.applyEQBands(gains.toFloatArray());            promise.resolve(null) }
        AsyncFunction("setEQPreamp")   { gainDb: Double, promise: Promise       -> playerInstance?.setEQPreamp(gainDb.toFloat());                 promise.resolve(null) }
        AsyncFunction("setEQBandQ")    { band: Int, q: Double, promise: Promise -> playerInstance?.setEQBandQ(band, q.toFloat());                 promise.resolve(null) }
        AsyncFunction("resetEQ")       { promise: Promise                       -> playerInstance?.resetEQ();                                     promise.resolve(null) }

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

        AsyncFunction("setDitherMode")  { mode: String, promise: Promise -> playerInstance?.setDitherMode(mode); promise.resolve(null) }
        AsyncFunction("getDitherMode")  { promise: Promise -> promise.resolve(playerInstance?.getDitherMode() ?: "E_WEIGHTED") }
        AsyncFunction("setSmoothingRamp") { ms: Double, promise: Promise -> playerInstance?.setSmoothingRamp(ms); promise.resolve(null) }

        // ─────────────────────────────────────────────────────────────────────
        // COMPRESSOR (DRC)
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setCompressorEnabled")    { enabled: Boolean, promise: Promise -> playerInstance?.setCompressorEnabled(enabled);       promise.resolve(null) }
        AsyncFunction("isCompressorEnabled")     { promise: Promise -> promise.resolve(playerInstance?.isCompressorEnabled() ?: false) }
        AsyncFunction("setCompressorThreshold")  { db: Double, promise: Promise -> playerInstance?.setCompressorThreshold(db);              promise.resolve(null) }
        AsyncFunction("setCompressorRatio")      { ratio: Double, promise: Promise -> playerInstance?.setCompressorRatio(ratio);            promise.resolve(null) }
        AsyncFunction("setCompressorAttack")     { ms: Double, promise: Promise -> playerInstance?.setCompressorAttackMs(ms);              promise.resolve(null) }
        AsyncFunction("setCompressorRelease")    { ms: Double, promise: Promise -> playerInstance?.setCompressorReleaseMs(ms);             promise.resolve(null) }
        AsyncFunction("setCompressorKnee")       { db: Double, promise: Promise -> playerInstance?.setCompressorKneeWidth(db);             promise.resolve(null) }
        AsyncFunction("setCompressorMakeupGain") { db: Double, promise: Promise -> playerInstance?.setCompressorMakeupGain(db);            promise.resolve(null) }
        AsyncFunction("getCompressorReduction")  { promise: Promise -> promise.resolve(playerInstance?.getCompressorReductionDb()?.toDouble() ?: 0.0) }
        AsyncFunction("getCompressorThreshold")  { promise: Promise -> promise.resolve(playerInstance?.getCompressorThreshold() ?: -24.0) }
        AsyncFunction("getCompressorRatio")      { promise: Promise -> promise.resolve(playerInstance?.getCompressorRatio() ?: 4.0) }
        AsyncFunction("getCompressorAttack")     { promise: Promise -> promise.resolve(playerInstance?.getCompressorAttackMs() ?: 5.0) }
        AsyncFunction("getCompressorRelease")    { promise: Promise -> promise.resolve(playerInstance?.getCompressorReleaseMs() ?: 100.0) }

        // ─────────────────────────────────────────────────────────────────────
        // CROSSFEED
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setCrossfeedEnabled")  { enabled: Boolean, promise: Promise -> playerInstance?.setCrossfeedEnabled(enabled);         promise.resolve(null) }
        AsyncFunction("isCrossfeedEnabled")   { promise: Promise -> promise.resolve(playerInstance?.isCrossfeedEnabled() ?: false) }
        AsyncFunction("setCrossfeedStrength") { strength: Double, promise: Promise -> playerInstance?.setCrossfeedStrength(strength.toFloat()); promise.resolve(null) }
        AsyncFunction("setCrossfeedCutoff")   { hz: Double, promise: Promise -> playerInstance?.setCrossfeedCutoff(hz);                    promise.resolve(null) }
        AsyncFunction("getCrossfeedStrength") { promise: Promise -> promise.resolve(playerInstance?.getCrossfeedStrength()?.toDouble() ?: 0.5) }
        AsyncFunction("getCrossfeedCutoff")   { promise: Promise -> promise.resolve(playerInstance?.getCrossfeedCutoff() ?: 700.0) }

        // ─────────────────────────────────────────────────────────────────────
        // PEAK METER (VU)
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("setPeakHoldMs")    { ms: Double, promise: Promise -> playerInstance?.setPeakHoldMs(ms);    promise.resolve(null) }
        AsyncFunction("setPeakReleaseMs") { ms: Double, promise: Promise -> playerInstance?.setPeakReleaseMs(ms); promise.resolve(null) }

        AsyncFunction("getCurrentPeaks") { promise: Promise ->
            val peaks = playerInstance?.getCurrentPeaks() ?: floatArrayOf(0f, 0f)
            promise.resolve(mapOf("left" to peaks.getOrElse(0) { 0f }.toDouble(), "right" to peaks.getOrElse(1) { 0f }.toDouble()))
        }
        AsyncFunction("getHeldPeaks") { promise: Promise ->
            val peaks = playerInstance?.getHeldPeaks() ?: floatArrayOf(0f, 0f)
            promise.resolve(mapOf("left" to peaks.getOrElse(0) { 0f }.toDouble(), "right" to peaks.getOrElse(1) { 0f }.toDouble()))
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
        AsyncFunction("savePreset")          { name: String, promise: Promise -> playerInstance?.saveCurrentAsPreset(name); promise.resolve(null) }
        AsyncFunction("listPresets")         { promise: Promise -> promise.resolve(playerInstance?.listPresets() ?: emptyList<String>()) }
        AsyncFunction("deletePreset")        { name: String, promise: Promise -> promise.resolve(playerInstance?.deletePreset(name) ?: false) }
        AsyncFunction("exportPreset")        { name: String, promise: Promise -> promise.resolve(playerInstance?.exportPreset(name)) }
        AsyncFunction("importPreset")        { json: String, promise: Promise -> if (playerInstance?.importPreset(json) == true) promise.resolve(null) else promise.reject("IMPORT_ERROR", "Failed to parse preset JSON", null) }
        AsyncFunction("assignTrackPreset")   { mediaId: String, presetName: String?, promise: Promise -> playerInstance?.assignTrackPreset(mediaId, presetName); promise.resolve(null) }
        AsyncFunction("getTrackPreset")      { mediaId: String, promise: Promise -> promise.resolve(playerInstance?.getTrackPreset(mediaId)) }
        AsyncFunction("setAutoSwitchPresets") { enabled: Boolean, promise: Promise -> playerInstance?.setAutoSwitchPresets(enabled); promise.resolve(null) }

        // ─────────────────────────────────────────────────────────────────────
        // EQ STATE GETTERS
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("getEQGains") { promise: Promise ->
            promise.resolve(playerInstance?.getEQGains()?.mapIndexed { i, g -> mapOf("band" to i, "gain" to g.toDouble()) } ?: emptyList<Map<String, Any>>())
        }
        AsyncFunction("getEQPreamp")        { promise: Promise -> promise.resolve(playerInstance?.getEQPreamp()?.toDouble()  ?: 0.0) }
        AsyncFunction("isEQEnabled")        { promise: Promise -> promise.resolve(playerInstance?.isEQEnabled() ?: false) }
        AsyncFunction("getEQQValues") { promise: Promise ->
            promise.resolve(playerInstance?.getEQQValues()?.mapIndexed { i, q -> mapOf("band" to i, "q" to q.toDouble()) } ?: emptyList<Map<String, Any>>())
        }
        AsyncFunction("getParametricGains") { promise: Promise ->
            promise.resolve(playerInstance?.getParametricGains()?.mapIndexed { i, g -> mapOf("band" to i, "gain" to g.toDouble()) } ?: emptyList<Map<String, Any>>())
        }
        AsyncFunction("getParametricFreqs") { promise: Promise ->
            promise.resolve(playerInstance?.getParametricFreqs()?.mapIndexed { i, f -> mapOf("band" to i, "freqHz" to f) } ?: emptyList<Map<String, Any>>())
        }
        AsyncFunction("getEQMode")     { promise: Promise -> promise.resolve(playerInstance?.getEQMode() ?: "GRAPHIC") }
        AsyncFunction("getLoudnessDb") { promise: Promise -> promise.resolve(playerInstance?.getLoudnessDb()?.toDouble() ?: 0.0) }

        // ─────────────────────────────────────────────────────────────────────
        // SPECTRUM & AUTO-EQ
        // ─────────────────────────────────────────────────────────────────────

        AsyncFunction("getSpectrumMagnitudes") { promise: Promise ->
            promise.resolve(playerInstance?.getSpectrumMagnitudes()?.mapIndexed { i, m -> mapOf("bin" to i, "magnitude" to m.toDouble()) } ?: emptyList<Map<String, Any>>())
        }
        AsyncFunction("computeAutoEQ") { promise: Promise ->
            val suggestion = playerInstance?.computeAutoEQ()
            promise.resolve(suggestion?.mapIndexed { i, g ->
                mapOf("band" to i, "gain" to g.toDouble(), "freqHz" to EqualizerProcessor.ISO_FREQ_CENTERS[i])
            } ?: emptyList<Map<String, Any>>())
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // MEDIA SESSION SETUP
    // ═════════════════════════════════════════════════════════════════════════

    private fun setupMediaSession(context: Context, player: MavinAudioPlayer) {
        mediaSession = MediaSessionCompat(context, "MavinPlayerSession").apply {
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            setMetadata(MediaMetadataCompat.Builder().build())
            setPlaybackState(
                PlaybackStateCompat.Builder()
                    .setState(PlaybackStateCompat.STATE_NONE, 0, 1f)
                    .setActions(getAvailableActions())
                    .build()
            )
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    sendEvent("onRemotePlay", emptyMap())
                    player.play()
                    requestAudioFocus()
                    updatePlaybackState(PlaybackStateCompat.STATE_PLAYING)
                }
                override fun onPause() {
                    sendEvent("onRemotePause", emptyMap())
                    player.pause()
                    updatePlaybackState(PlaybackStateCompat.STATE_PAUSED)
                }
                override fun onStop() {
                    player.stop()
                    updatePlaybackState(PlaybackStateCompat.STATE_STOPPED)
                }
                override fun onSkipToNext() {
                    sendEvent("onRemoteNext", emptyMap())
                    player.skipToNext()
                }
                override fun onSkipToPrevious() {
                    sendEvent("onRemotePrevious", emptyMap())
                    player.skipToPrevious()
                }
                override fun onSeekTo(pos: Long) {
                    sendEvent("onRemoteSeek", mapOf("position" to pos.toDouble()))
                    player.seekTo(pos)
                    updatePlaybackState(getCurrentPlaybackState())
                }
                override fun onSetRepeatMode(repeatMode: Int) {
                    player.setRepeatMode(repeatMode)
                    updatePlaybackState(getCurrentPlaybackState())
                }
                override fun onSetShuffleMode(shuffleMode: Int) {
                    player.setShuffleModeEnabled(shuffleMode == PlaybackStateCompat.SHUFFLE_MODE_ALL)
                    updatePlaybackState(getCurrentPlaybackState())
                }
            })
            isActive = true
        }
    }

    private fun getAvailableActions(): Long =
        PlaybackStateCompat.ACTION_PLAY or
        PlaybackStateCompat.ACTION_PAUSE or
        PlaybackStateCompat.ACTION_PLAY_PAUSE or
        PlaybackStateCompat.ACTION_STOP or
        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
        PlaybackStateCompat.ACTION_SEEK_TO or
        PlaybackStateCompat.ACTION_SET_REPEAT_MODE or
        PlaybackStateCompat.ACTION_SET_SHUFFLE_MODE

    private fun updatePlaybackState(state: Int) {
        val speed    = playerInstance?.getPlaybackSpeed() ?: 1f
        val position = playerInstance?.getCurrentPosition() ?: 0L
        mediaSession?.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setState(state, position, speed)
                .setActions(getAvailableActions())
                .build()
        )
    }

    private fun getCurrentPlaybackState(): Int = when {
        playerInstance?.isPlaying() == true -> PlaybackStateCompat.STATE_PLAYING
        (playerInstance?.getCurrentPosition() ?: 0) > 0 -> PlaybackStateCompat.STATE_PAUSED
        else -> PlaybackStateCompat.STATE_NONE
    }

    private fun updateMediaMetadata(track: TrackData, index: Int) {
        val builder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, track.id)
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE,  track.title  ?: "Unknown")
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, track.artist ?: "Unknown")
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM,  track.album  ?: "Unknown")
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION,      track.duration ?: 0)
            .putLong(MediaMetadataCompat.METADATA_KEY_TRACK_NUMBER,  index.toLong())
        track.artworkUri?.let { builder.putString(MediaMetadataCompat.METADATA_KEY_ART_URI, it) }
        mediaSession?.setMetadata(builder.build())
    }

    private fun updateMediaSessionQueue(tracks: List<Map<String, Any?>>) {
        val queue = tracks.mapIndexed { index, track ->
            MediaSessionCompat.QueueItem(
                MediaDescriptionCompat.Builder()
                    .setMediaId(track["id"] as? String ?: "")
                    .setTitle(track["title"] as? String ?: "Unknown")
                    .setSubtitle(track["artist"] as? String ?: "")
                    .build(),
                index.toLong()
            )
        }
        mediaSession?.setQueue(queue)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // AUDIO FOCUS MANAGEMENT (RNTP-level)
    // ═════════════════════════════════════════════════════════════════════════

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
                sendEvent("onAudioFocusGranted", emptyMap())
                true
            } else false
        } else {
            @Suppress("DEPRECATION")
            val result = audioManager?.requestAudioFocus(
                this@MavinPlayerModule,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            )
            if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                hasAudioFocus = true
                sendEvent("onAudioFocusGranted", emptyMap())
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
                sendEvent("onAudioFocusGranted", emptyMap())
                hasAudioFocus = true
            }
            AudioManager.AUDIOFOCUS_LOSS -> {
                playerInstance?.pause()
                updatePlaybackState(PlaybackStateCompat.STATE_PAUSED)
                sendEvent("onAudioFocusLost", mapOf("type" to "loss"))
                hasAudioFocus = false
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                playerInstance?.pause()
                updatePlaybackState(PlaybackStateCompat.STATE_PAUSED)
                sendEvent("onAudioFocusLost", mapOf("type" to "transient"))
                hasAudioFocus = false
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                playerInstance?.setVolume(0.3f)
                sendEvent("onAudioFocusLost", mapOf("type" to "duck"))
            }
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FOREGROUND SERVICE + NOTIFICATION (with custom icon)
    // ═════════════════════════════════════════════════════════════════════════

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

        val pendingIntent = PendingIntent.getActivity(
            context, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Resolve the custom notification icon from drawable resources.
        // Place notification-icon.png in android/app/src/main/res/drawable/
        val iconResId = context.resources.getIdentifier(
            "notification_icon", "drawable", context.packageName
        ).takeIf { it != 0 } ?: android.R.drawable.ic_media_play

        return NotificationCompat.Builder(context, NOTIFICATION_CHANNEL_ID)
            .setContentTitle(playerInstance?.getCurrentTrackInfo()?.get("title") as? String ?: "Mavin Player")
            .setContentText(playerInstance?.getCurrentTrackInfo()?.get("artist") as? String ?: "Ready to play")
            .setSmallIcon(iconResId)
            .setContentIntent(pendingIntent)
            .setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(mediaSession?.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PLAYER CALLBACKS
    // ═════════════════════════════════════════════════════════════════════════

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
                startProgressTimer(player)
                startSpectrumTimer(player)
                updatePlaybackState(PlaybackStateCompat.STATE_PLAYING)
            }
            if (state == Player.STATE_IDLE || state == Player.STATE_ENDED) {
                stopAllTimers()
                updatePlaybackState(PlaybackStateCompat.STATE_NONE)
            }
        }

        player.onTrackChanged = { index ->
            currentTrackIndex = index
            sendDebouncedEvent("onTrackChanged", mapOf("index" to index), 100)
        }

        player.onError = { message, code ->
            sendEvent("onError", mapOf("message" to message, "code" to code))
            updatePlaybackState(PlaybackStateCompat.STATE_ERROR)
        }

        player.onReplayGainApplied = { trackGain, albumGain, appliedDb ->
            sendDebouncedEvent("onReplayGainApplied", mapOf("trackGain" to trackGain, "albumGain" to albumGain, "appliedDb" to appliedDb), 200)
        }

        player.onUsbDacConnected = { dacInfo ->
            sendEvent("onUsbDacConnected", mapOf("name" to dacInfo.name, "vendorId" to dacInfo.vendorId, "productId" to dacInfo.productId, "hasAudioOutput" to dacInfo.hasAudioOutput, "supportedSampleRates" to dacInfo.supportedSampleRates, "maxBitDepth" to dacInfo.maxBitDepth, "maxChannels" to dacInfo.maxChannels, "isNativeDirectSupported" to dacInfo.isNativeDirectSupported))
        }

        player.onUsbDacDisconnected = {
            sendEvent("onUsbDacDisconnected", emptyMap())
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PROGRESS + SPECTRUM TIMERS (debounced to avoid JS bridge flooding)
    // ═════════════════════════════════════════════════════════════════════════

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
                mainHandler.postDelayed(this, PROGRESS_INTERVAL_MS)
            }
        }
        mainHandler.postDelayed(progressRunnable!!, PROGRESS_INTERVAL_MS)
    }

    private fun startSpectrumTimer(player: MavinAudioPlayer) {
        stopSpectrumTimer()
        spectrumRunnable = object : Runnable {
            override fun run() {
                if (player.isPlaying() && hasAudioFocus) {
                    val magnitudes = player.getSpectrumMagnitudes()
                    if (magnitudes.isNotEmpty()) {
                        sendDebouncedEvent("onSpectrum", mapOf("magnitudes" to magnitudes.map { it.toDouble() }), 300)
                    }
                    val peaks = player.getCurrentPeaks()
                    if (peaks.size >= 2) {
                        sendDebouncedEvent("onPeakMeter", mapOf("left" to peaks[0].toDouble(), "right" to peaks[1].toDouble()), 300)
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

    // ═════════════════════════════════════════════════════════════════════════
    // DEBOUNCED EVENT EMISSION
    // ═════════════════════════════════════════════════════════════════════════

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

    // ═════════════════════════════════════════════════════════════════════════
    // QUEUE PERSISTENCE (survives app restart / process death)
    // ═════════════════════════════════════════════════════════════════════════

    private fun persistQueue(tracks: List<Map<String, Any?>>, currentIndex: Int) {
        try {
            val ctx = appContext.reactContext ?: return
            val prefs = ctx.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE)
            val json = org.json.JSONArray(tracks.map { org.json.JSONObject(it) }).toString()
            prefs.edit()
                .putString(QUEUE_KEY, json)
                .putInt(TRACK_INDEX_KEY, currentIndex)
                .putLong(POSITION_KEY, playerInstance?.getCurrentPosition() ?: 0)
                .apply()
        } catch (e: Exception) { Log.w(TAG, "Failed to persist queue", e) }
    }

    private fun loadPersistedQueue(): List<Map<String, Any?>>? {
        return try {
            val ctx = appContext.reactContext ?: return null
            val prefs = ctx.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE)
            val json = prefs.getString(QUEUE_KEY, null) ?: return null
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
            val ctx = appContext.reactContext ?: return
            val prefs = ctx.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE)
            val queue = loadPersistedQueue()
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
        loadPersistedQueue()?.let { queue -> persistQueue(queue, currentTrackIndex) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // LIFECYCLE HOOKS
    // ═════════════════════════════════════════════════════════════════════════

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        runOnMain {
            stopAllTimers()
            playerInstance?.let { player -> saveState(player); player.release() }
            playerInstance = null
            mediaSession?.release()
            mediaSession = null
            abandonAudioFocus()
            eventDebouncers.values.forEach { it.cancel() }
            eventDebouncers.clear()
            Log.i(TAG, "🧹 Module cleaned up")
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═════════════════════════════════════════════════════════════════════════

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
    }

    private fun requirePlayer(promise: Promise): MavinAudioPlayer? {
        val p = playerInstance
        if (p == null) promise.reject("PLAYER_NOT_READY", "Call initPlayer() first", null)
        return p
    }

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.toTrackData() = TrackData(
        id          = (get("id") as? String) ?: System.currentTimeMillis().toString(),
        uri         = get("uri") as? String ?: get("url") as? String
                      ?: throw IllegalArgumentException("track must have 'uri' or 'url'"),
        title       = get("title") as? String,
        artist      = get("artist") as? String,
        album       = get("album") as? String,
        artworkUri  = get("artwork") as? String ?: get("artworkUri") as? String,
        duration    = (get("duration") as? Number)?.toLong(),
        headers     = get("headers") as? Map<String, String>,
        replayGainTags = get("replayGainTags") as? Map<String, String>,
    )

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