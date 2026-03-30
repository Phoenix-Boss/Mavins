package expo.modules.mavinplayer

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

@UnstableApi
class MavinPlayerModule : Module() {

    companion object {
        private const val TAG = "MavinPlayerModule"
        private const val PROGRESS_INTERVAL_MS = 1000L
        @Volatile var playerInstance: MavinAudioPlayer? = null
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var progressRunnable: Runnable? = null

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
            "onUsbDacDisconnected"
        )

        // ═════════════════════════════════════════════════════════════════════
        // PLAYER LIFECYCLE
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("initPlayer") { promise: Promise ->
            runOnMain {
                try {
                    if (playerInstance != null) { promise.resolve(null); return@runOnMain }
                    val ctx = appContext.reactContext
                        ?: return@runOnMain promise.reject("NO_CONTEXT", "ReactContext not available", null)

                    val player = MavinAudioPlayer(ctx)

                    player.onPlaybackStateChanged = { state ->
                        val name = when (state) {
                            Player.STATE_IDLE -> "idle"
                            Player.STATE_BUFFERING -> "buffering"
                            Player.STATE_READY -> "ready"
                            Player.STATE_ENDED -> "ended"
                            else -> "unknown"
                        }
                        sendEvent("onPlaybackStateChanged", mapOf("state" to name))
                        if (state == Player.STATE_READY) startProgressTimer(player)
                        if (state == Player.STATE_IDLE || state == Player.STATE_ENDED) stopProgressTimer()
                    }
                    player.onTrackChanged = { index ->
                        sendEvent("onTrackChanged", mapOf("index" to index))
                    }
                    player.onError = { message, code ->
                        sendEvent("onError", mapOf("message" to message, "code" to code))
                    }
                    player.onReplayGainApplied = { trackGain, albumGain, appliedDb ->
                        sendEvent("onReplayGainApplied", mapOf(
                            "trackGain" to trackGain,
                            "albumGain" to albumGain,
                            "appliedDb" to appliedDb
                        ))
                    }
                    player.onPeakMeter = { leftPeak, rightPeak ->
                        sendEvent("onPeakMeter", mapOf(
                            "left" to leftPeak.toDouble(),
                            "right" to rightPeak.toDouble()
                        ))
                    }
                    player.onUsbDacConnected = { dacInfo ->
                        sendEvent("onUsbDacConnected", mapOf(
                            "name" to dacInfo.name,
                            "vendorId" to dacInfo.vendorId,
                            "productId" to dacInfo.productId,
                            "hasAudioOutput" to dacInfo.hasAudioOutput,
                            "supportedSampleRates" to dacInfo.supportedSampleRates,
                            "maxBitDepth" to dacInfo.maxBitDepth,
                            "maxChannels" to dacInfo.maxChannels,
                            "isNativeDirectSupported" to dacInfo.isNativeDirectSupported
                        ))
                    }
                    player.onUsbDacDisconnected = {
                        sendEvent("onUsbDacDisconnected", emptyMap())
                    }

                    playerInstance = player

                    val serviceIntent = Intent().apply {
                        setClassName(ctx, "expo.modules.mavinplayer.service.MavinPlaybackService")
                    }
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O)
                        ctx.startForegroundService(serviceIntent)
                    else ctx.startService(serviceIntent)

                    Log.i(TAG, "✅ initPlayer complete")
                    promise.resolve(null)
                } catch (e: Exception) {
                    Log.e(TAG, "initPlayer failed", e)
                    promise.reject("INIT_ERROR", e.message ?: "initPlayer failed", e)
                }
            }
        }

        // ═════════════════════════════════════════════════════════════════════
        // PLAYBACK CONTROL
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("load") { trackMap: Map<String, Any?>, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                try { p.load(trackMap.toTrackData()); promise.resolve(null) }
                catch (e: Exception) { promise.reject("LOAD_ERROR", e.message, e) }
            }
        }
        AsyncFunction("setQueue") { tracksRaw: List<Map<String, Any?>>, startIndex: Int?, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                try { p.setQueue(tracksRaw.map { it.toTrackData() }, startIndex ?: 0); promise.resolve(null) }
                catch (e: Exception) { promise.reject("QUEUE_ERROR", e.message, e) }
            }
        }
        AsyncFunction("addToQueue") { trackMap: Map<String, Any?>, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                try { p.addToQueue(trackMap.toTrackData()); promise.resolve(null) }
                catch (e: Exception) { promise.reject("QUEUE_ERROR", e.message, e) }
            }
        }

        AsyncFunction("play") { promise: Promise -> runOnMain { requirePlayer(promise)?.play(); promise.resolve(null) } }
        AsyncFunction("pause") { promise: Promise -> runOnMain { requirePlayer(promise)?.pause(); promise.resolve(null) } }
        AsyncFunction("stop") { promise: Promise -> runOnMain { requirePlayer(promise)?.stop(); promise.resolve(null) } }
        AsyncFunction("skipToNext") { promise: Promise -> runOnMain { requirePlayer(promise)?.skipToNext(); promise.resolve(null) } }
        AsyncFunction("skipToPrevious") { promise: Promise -> runOnMain { requirePlayer(promise)?.skipToPrevious(); promise.resolve(null) } }
        AsyncFunction("seekTo") { ms: Double, promise: Promise -> runOnMain { requirePlayer(promise)?.seekTo(ms.toLong()); promise.resolve(null) } }
        AsyncFunction("skipToIndex") { idx: Int, promise: Promise -> runOnMain { requirePlayer(promise)?.skipToIndex(idx); promise.resolve(null) } }
        AsyncFunction("setVolume") { vol: Double, promise: Promise -> runOnMain { requirePlayer(promise)?.setVolume(vol.toFloat()); promise.resolve(null) } }
        AsyncFunction("setRepeatMode") { mode: Int, promise: Promise -> runOnMain { requirePlayer(promise)?.setRepeatMode(mode); promise.resolve(null) } }
        AsyncFunction("setShuffleMode") { en: Boolean, promise: Promise -> runOnMain { requirePlayer(promise)?.setShuffleModeEnabled(en); promise.resolve(null) } }

        // ═════════════════════════════════════════════════════════════════════
        // PLAYBACK SPEED
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("setPlaybackSpeed") { speed: Double, promise: Promise ->
            playerInstance?.setPlaybackSpeed(speed.toFloat()); promise.resolve(null)
        }
        AsyncFunction("getPlaybackSpeed") { promise: Promise ->
            promise.resolve(playerInstance?.getPlaybackSpeed()?.toDouble() ?: 1.0)
        }

        // ═════════════════════════════════════════════════════════════════════
        // CROSSFADE
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("setCrossfadeEnabled") { enabled: Boolean, promise: Promise ->
            playerInstance?.setCrossfadeEnabled(enabled); promise.resolve(null)
        }
        AsyncFunction("isCrossfadeEnabled") { promise: Promise ->
            promise.resolve(playerInstance?.isCrossfadeEnabled() ?: false)
        }
        AsyncFunction("setCrossfadeDuration") { durationMs: Double, promise: Promise ->
            playerInstance?.setCrossfadeDurationMs(durationMs.toLong()); promise.resolve(null)
        }
        AsyncFunction("getCrossfadeDuration") { promise: Promise ->
            promise.resolve(playerInstance?.getCrossfadeDurationMs()?.toDouble() ?: 2000.0)
        }

        // ═════════════════════════════════════════════════════════════════════
        // OFFLINE MODE (ZERO TELEMETRY)
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("setOfflineMode") { enabled: Boolean, promise: Promise ->
            playerInstance?.setOfflineMode(enabled); promise.resolve(null)
        }
        AsyncFunction("isOfflineMode") { promise: Promise ->
            promise.resolve(playerInstance?.isOfflineMode() ?: false)
        }

        // ═════════════════════════════════════════════════════════════════════
        // 64-BIT PROCESSING
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("set64BitProcessingEnabled") { enabled: Boolean, promise: Promise ->
            playerInstance?.set64BitProcessingEnabled(enabled); promise.resolve(null)
        }
        AsyncFunction("is64BitProcessingEnabled") { promise: Promise ->
            promise.resolve(playerInstance?.is64BitProcessingEnabled() ?: false)
        }

        // ═════════════════════════════════════════════════════════════════════
        // USB DAC CONTROL
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("isUsbDacConnected") { promise: Promise ->
            promise.resolve(playerInstance?.isUsbDacConnected() ?: false)
        }
        AsyncFunction("getCurrentDacInfo") { promise: Promise ->
            val dacInfo = playerInstance?.getCurrentDacInfo()
            if (dacInfo != null) {
                promise.resolve(mapOf(
                    "name" to dacInfo.name,
                    "vendorId" to dacInfo.vendorId,
                    "productId" to dacInfo.productId,
                    "isConnected" to dacInfo.isConnected,
                    "hasAudioOutput" to dacInfo.hasAudioOutput,
                    "supportedSampleRates" to dacInfo.supportedSampleRates,
                    "maxBitDepth" to dacInfo.maxBitDepth,
                    "maxChannels" to dacInfo.maxChannels,
                    "isNativeDirectSupported" to dacInfo.isNativeDirectSupported
                ))
            } else {
                promise.resolve(null)
            }
        }
        AsyncFunction("getDacCapabilities") { promise: Promise ->
            val caps = playerInstance?.getDacCapabilities()
            if (caps != null) {
                promise.resolve(mapOf(
                    "sampleRates" to caps.sampleRates,
                    "bitDepths" to caps.bitDepths,
                    "channelCounts" to caps.channelCounts,
                    "supportsFloatOutput" to caps.supportsFloatOutput,
                    "supportsHdAudio" to caps.supportsHdAudio,
                    "nativeSampleRate" to caps.nativeSampleRate,
                    "nativeBitDepth" to caps.nativeBitDepth
                ))
            } else {
                promise.resolve(null)
            }
        }
        AsyncFunction("enableDirectUsbRouting") { enabled: Boolean, promise: Promise ->
            val result = playerInstance?.enableDirectUsbRouting(enabled) ?: false
            promise.resolve(result)
        }
        AsyncFunction("isDirectUsbRoutingEnabled") { promise: Promise ->
            promise.resolve(playerInstance?.isDirectUsbRoutingEnabled() ?: false)
        }
        AsyncFunction("setPreferredDacSampleRate") { rate: Int, promise: Promise ->
            val result = playerInstance?.setPreferredDacSampleRate(rate) ?: false
            promise.resolve(result)
        }
        AsyncFunction("setPreferredDacBitDepth") { depth: Int, promise: Promise ->
            val result = playerInstance?.setPreferredDacBitDepth(depth) ?: false
            promise.resolve(result)
        }
        AsyncFunction("rescanUsbDevices") { promise: Promise ->
            playerInstance?.rescanUsbDevices(); promise.resolve(null)
        }

        // ═════════════════════════════════════════════════════════════════════
        // AUDIO FORMAT DETECTION
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("getAudioCapabilities") { promise: Promise ->
            val caps = playerInstance?.getAudioCapabilities()
            if (caps != null) {
                promise.resolve(mapOf(
                    "maxSampleRate" to caps.maxSampleRate,
                    "maxBitDepth" to caps.maxBitDepth,
                    "supportsFloat" to caps.supportsFloat,
                    "supportsHdAudio" to caps.supportsHdAudio,
                    "supportsUltraHdAudio" to caps.supportsUltraHdAudio,
                    "supportedSampleRates" to caps.supportedSampleRates,
                    "supportedBitDepths" to caps.supportedBitDepths,
                    "isHiResCapable" to caps.isHiResCapable
                ))
            } else {
                promise.resolve(null)
            }
        }
        AsyncFunction("getOptimalAudioFormat") { promise: Promise ->
            val format = playerInstance?.getOptimalAudioFormat()
            if (format != null) {
                promise.resolve(mapOf(
                    "sampleRate" to format.sampleRate,
                    "bitDepth" to format.bitDepth,
                    "encoding" to format.encoding,
                    "isFloat" to format.isFloat,
                    "isHiRes" to format.isHiRes,
                    "channelCount" to format.channelCount
                ))
            } else {
                promise.resolve(null)
            }
        }
        AsyncFunction("isHiResAudioCapable") { promise: Promise ->
            promise.resolve(playerInstance?.isHiResAudioCapable() ?: false)
        }
        AsyncFunction("getMaxSampleRate") { promise: Promise ->
            promise.resolve(playerInstance?.getMaxSampleRate() ?: 48000)
        }
        AsyncFunction("getMaxBitDepth") { promise: Promise ->
            promise.resolve(playerInstance?.getMaxBitDepth() ?: 16)
        }

        // ═════════════════════════════════════════════════════════════════════
        // CONVOLUTION PROCESSOR (IMPULSE RESPONSES)
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("loadImpulseResponse") { filePath: String, promise: Promise ->
            val result = playerInstance?.loadImpulseResponse(filePath) ?: false
            if (result) promise.resolve(null)
            else promise.reject("LOAD_IR_FAILED", "Failed to load impulse response from $filePath", null)
        }
        AsyncFunction("clearImpulseResponse") { promise: Promise ->
            playerInstance?.clearImpulseResponse(); promise.resolve(null)
        }
        AsyncFunction("isImpulseResponseLoaded") { promise: Promise ->
            promise.resolve(playerInstance?.isImpulseResponseLoaded() ?: false)
        }
        AsyncFunction("getIrLength") { promise: Promise ->
            promise.resolve(playerInstance?.getIrLength() ?: 0)
        }
        AsyncFunction("setConvolutionEnabled") { enabled: Boolean, promise: Promise ->
            playerInstance?.setConvolutionEnabled(enabled); promise.resolve(null)
        }
        AsyncFunction("isConvolutionEnabled") { promise: Promise ->
            promise.resolve(playerInstance?.isConvolutionEnabled() ?: false)
        }

        // ═════════════════════════════════════════════════════════════════════
        // STATE READS
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("getPosition") { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getCurrentPosition()?.toDouble() ?: 0.0) } }
        AsyncFunction("getDuration") { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getDuration()?.toDouble() ?: 0.0) } }
        AsyncFunction("getCurrentTrack") { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getCurrentTrackInfo()) } }
        AsyncFunction("isPlaying") { promise: Promise -> runOnMain { promise.resolve(playerInstance?.isPlaying() ?: false) } }
        AsyncFunction("getQueueSize") { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getQueueSize() ?: 0) } }

        // ═════════════════════════════════════════════════════════════════════
        // EQ — GRAPHIC
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("setEQEnabled") { en: Boolean, promise: Promise -> playerInstance?.setEQEnabled(en); promise.resolve(null) }
        AsyncFunction("setEQBand") { band: Int, gainDb: Double, promise: Promise -> playerInstance?.setEQBand(band, gainDb.toFloat()); promise.resolve(null) }
        AsyncFunction("applyEQBands") { gains: List<Double>, promise: Promise -> playerInstance?.applyEQBands(gains.toFloatArray()); promise.resolve(null) }
        AsyncFunction("setEQPreamp") { gainDb: Double, promise: Promise -> playerInstance?.setEQPreamp(gainDb.toFloat()); promise.resolve(null) }
        AsyncFunction("setEQBandQ") { band: Int, q: Double, promise: Promise -> playerInstance?.setEQBandQ(band, q.toFloat()); promise.resolve(null) }
        AsyncFunction("resetEQ") { promise: Promise -> playerInstance?.resetEQ(); promise.resolve(null) }

        // ═════════════════════════════════════════════════════════════════════
        // EQ — PARAMETRIC
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("setParametricBandGain") { band: Int, gainDb: Double, promise: Promise ->
            playerInstance?.setParametricBandGain(band, gainDb.toFloat()); promise.resolve(null)
        }
        AsyncFunction("applyParametricBands") { gains: List<Double>, promise: Promise ->
            playerInstance?.applyParametricBands(gains.toFloatArray()); promise.resolve(null)
        }
        AsyncFunction("setParametricBandFreq") { band: Int, freqHz: Double, promise: Promise ->
            playerInstance?.setParametricBandFreq(band, freqHz); promise.resolve(null)
        }
        AsyncFunction("resetParametric") { promise: Promise -> playerInstance?.resetParametric(); promise.resolve(null) }

        AsyncFunction("setEQMode") { mode: String, promise: Promise ->
            playerInstance?.setEQMode(mode); promise.resolve(null)
        }

        // ═════════════════════════════════════════════════════════════════════
        // EQ — DITHER / NOISE SHAPING
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("setDitherMode") { mode: String, promise: Promise ->
            playerInstance?.setDitherMode(mode); promise.resolve(null)
        }
        AsyncFunction("getDitherMode") { promise: Promise ->
            promise.resolve(playerInstance?.getDitherMode() ?: "E_WEIGHTED")
        }

        // ═════════════════════════════════════════════════════════════════════
        // EQ — SMOOTHING
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("setSmoothingRamp") { ms: Double, promise: Promise ->
            playerInstance?.setSmoothingRamp(ms); promise.resolve(null)
        }

        // ═════════════════════════════════════════════════════════════════════
        // COMPRESSOR (DRC)
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("setCompressorEnabled") { enabled: Boolean, promise: Promise ->
            playerInstance?.setCompressorEnabled(enabled); promise.resolve(null)
        }
        AsyncFunction("isCompressorEnabled") { promise: Promise ->
            promise.resolve(playerInstance?.isCompressorEnabled() ?: false)
        }
        AsyncFunction("setCompressorThreshold") { db: Double, promise: Promise ->
            playerInstance?.setCompressorThreshold(db); promise.resolve(null)
        }
        AsyncFunction("setCompressorRatio") { ratio: Double, promise: Promise ->
            playerInstance?.setCompressorRatio(ratio); promise.resolve(null)
        }
        AsyncFunction("setCompressorAttack") { ms: Double, promise: Promise ->
            playerInstance?.setCompressorAttackMs(ms); promise.resolve(null)
        }
        AsyncFunction("setCompressorRelease") { ms: Double, promise: Promise ->
            playerInstance?.setCompressorReleaseMs(ms); promise.resolve(null)
        }
        AsyncFunction("setCompressorKnee") { db: Double, promise: Promise ->
            playerInstance?.setCompressorKneeWidth(db); promise.resolve(null)
        }
        AsyncFunction("setCompressorMakeupGain") { db: Double, promise: Promise ->
            playerInstance?.setCompressorMakeupGain(db); promise.resolve(null)
        }
        AsyncFunction("getCompressorReduction") { promise: Promise ->
            promise.resolve(playerInstance?.getCompressorReductionDb()?.toDouble() ?: 0.0)
        }
        AsyncFunction("getCompressorThreshold") { promise: Promise ->
            promise.resolve(playerInstance?.getCompressorThreshold() ?: -24.0)
        }
        AsyncFunction("getCompressorRatio") { promise: Promise ->
            promise.resolve(playerInstance?.getCompressorRatio() ?: 4.0)
        }
        AsyncFunction("getCompressorAttack") { promise: Promise ->
            promise.resolve(playerInstance?.getCompressorAttackMs() ?: 5.0)
        }
        AsyncFunction("getCompressorRelease") { promise: Promise ->
            promise.resolve(playerInstance?.getCompressorReleaseMs() ?: 100.0)
        }

        // ═════════════════════════════════════════════════════════════════════
        // CROSSFEED
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("setCrossfeedEnabled") { enabled: Boolean, promise: Promise ->
            playerInstance?.setCrossfeedEnabled(enabled); promise.resolve(null)
        }
        AsyncFunction("isCrossfeedEnabled") { promise: Promise ->
            promise.resolve(playerInstance?.isCrossfeedEnabled() ?: false)
        }
        AsyncFunction("setCrossfeedStrength") { strength: Double, promise: Promise ->
            playerInstance?.setCrossfeedStrength(strength.toFloat()); promise.resolve(null)
        }
        AsyncFunction("setCrossfeedCutoff") { hz: Double, promise: Promise ->
            playerInstance?.setCrossfeedCutoff(hz); promise.resolve(null)
        }
        AsyncFunction("getCrossfeedStrength") { promise: Promise ->
            promise.resolve(playerInstance?.getCrossfeedStrength()?.toDouble() ?: 0.5)
        }
        AsyncFunction("getCrossfeedCutoff") { promise: Promise ->
            promise.resolve(playerInstance?.getCrossfeedCutoff() ?: 700.0)
        }

        // ═════════════════════════════════════════════════════════════════════
        // PEAK METER (VU)
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("setPeakHoldMs") { ms: Double, promise: Promise ->
            playerInstance?.setPeakHoldMs(ms); promise.resolve(null)
        }
        AsyncFunction("setPeakReleaseMs") { ms: Double, promise: Promise ->
            playerInstance?.setPeakReleaseMs(ms); promise.resolve(null)
        }
        AsyncFunction("getCurrentPeaks") { promise: Promise ->
            val peaks = playerInstance?.getCurrentPeaks() ?: floatArrayOf(0f, 0f)
            promise.resolve(mapOf(
                "left" to peaks.getOrElse(0) { 0f }.toDouble(),
                "right" to peaks.getOrElse(1) { 0f }.toDouble()
            ))
        }
        AsyncFunction("getHeldPeaks") { promise: Promise ->
            val peaks = playerInstance?.getHeldPeaks() ?: floatArrayOf(0f, 0f)
            promise.resolve(mapOf(
                "left" to peaks.getOrElse(0) { 0f }.toDouble(),
                "right" to peaks.getOrElse(1) { 0f }.toDouble()
            ))
        }
        AsyncFunction("resetPeaks") { promise: Promise ->
            playerInstance?.resetPeaks(); promise.resolve(null)
        }

        // ═════════════════════════════════════════════════════════════════════
        // REPLAY GAIN
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("setReplayGainMode") { mode: String, promise: Promise ->
            playerInstance?.setReplayGainMode(mode); promise.resolve(null)
        }
        AsyncFunction("setReplayGainPreamp") { gainDb: Double, promise: Promise ->
            playerInstance?.setReplayGainPreamp(gainDb.toFloat()); promise.resolve(null)
        }
        AsyncFunction("setReplayGainFromMap") { tags: Map<String, String>, promise: Promise ->
            playerInstance?.setReplayGainFromMap(tags); promise.resolve(null)
        }
        AsyncFunction("getReplayGainInfo") { promise: Promise ->
            promise.resolve(playerInstance?.getReplayGainInfo())
        }

        // ═════════════════════════════════════════════════════════════════════
        // PRESETS
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("applyPreset") { name: String, promise: Promise ->
            val applied = playerInstance?.applyPresetByName(name) ?: false
            if (applied) promise.resolve(null)
            else promise.reject("PRESET_NOT_FOUND", "Preset '$name' not found", null)
        }
        AsyncFunction("savePreset") { name: String, promise: Promise ->
            playerInstance?.saveCurrentAsPreset(name); promise.resolve(null)
        }
        AsyncFunction("listPresets") { promise: Promise ->
            promise.resolve(playerInstance?.listPresets() ?: emptyList<String>())
        }
        AsyncFunction("deletePreset") { name: String, promise: Promise ->
            val deleted = playerInstance?.deletePreset(name) ?: false
            promise.resolve(deleted)
        }
        AsyncFunction("exportPreset") { name: String, promise: Promise ->
            promise.resolve(playerInstance?.exportPreset(name))
        }
        AsyncFunction("importPreset") { json: String, promise: Promise ->
            val ok = playerInstance?.importPreset(json) ?: false
            if (ok) promise.resolve(null)
            else promise.reject("IMPORT_ERROR", "Failed to parse preset JSON", null)
        }
        AsyncFunction("assignTrackPreset") { mediaId: String, presetName: String?, promise: Promise ->
            playerInstance?.assignTrackPreset(mediaId, presetName); promise.resolve(null)
        }
        AsyncFunction("getTrackPreset") { mediaId: String, promise: Promise ->
            promise.resolve(playerInstance?.getTrackPreset(mediaId))
        }
        AsyncFunction("setAutoSwitchPresets") { enabled: Boolean, promise: Promise ->
            playerInstance?.setAutoSwitchPresets(enabled); promise.resolve(null)
        }

        // ═════════════════════════════════════════════════════════════════════
        // EQ STATE GETTERS
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("getEQGains") { promise: Promise ->
            promise.resolve(playerInstance?.getEQGains()?.mapIndexed { i, g ->
                mapOf("band" to i, "gain" to g.toDouble())
            } ?: emptyList<Map<String, Any>>())
        }
        AsyncFunction("getEQPreamp") { promise: Promise -> promise.resolve(playerInstance?.getEQPreamp()?.toDouble() ?: 0.0) }
        AsyncFunction("isEQEnabled") { promise: Promise -> promise.resolve(playerInstance?.isEQEnabled() ?: false) }
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
        AsyncFunction("getEQMode") { promise: Promise -> promise.resolve(playerInstance?.getEQMode() ?: "GRAPHIC") }
        AsyncFunction("getLoudnessDb") { promise: Promise -> promise.resolve(playerInstance?.getLoudnessDb()?.toDouble() ?: 0.0) }

        // ═════════════════════════════════════════════════════════════════════
        // SPECTRUM & AUTO-EQ
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("getSpectrumMagnitudes") { promise: Promise ->
            promise.resolve(playerInstance?.getSpectrumMagnitudes()?.mapIndexed { i, m ->
                mapOf("bin" to i, "magnitude" to m.toDouble())
            } ?: emptyList<Map<String, Any>>())
        }
        AsyncFunction("computeAutoEQ") { promise: Promise ->
            val suggestion = playerInstance?.computeAutoEQ()
            promise.resolve(suggestion?.mapIndexed { i, g ->
                mapOf(
                    "band" to i,
                    "gain" to g.toDouble(),
                    "freqHz" to expo.modules.autoeqengine.EqualizerProcessor.ISO_FREQ_CENTERS[i]
                )
            } ?: emptyList<Map<String, Any>>())
        }

        // ═════════════════════════════════════════════════════════════════════
        // CLEANUP
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("release") { promise: Promise ->
            runOnMain {
                stopProgressTimer()
                playerInstance?.release()
                playerInstance = null
                val ctx = appContext.reactContext
                ctx?.stopService(Intent().apply {
                    setClassName(ctx, "expo.modules.mavinplayer.service.MavinPlaybackService")
                })
                promise.resolve(null)
            }
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PROGRESS TIMER
    // ═════════════════════════════════════════════════════════════════════════

    private fun startProgressTimer(player: MavinAudioPlayer) {
        stopProgressTimer()
        progressRunnable = object : Runnable {
            override fun run() {
                if (player.isPlaying()) {
                    sendEvent("onProgress", mapOf(
                        "position" to player.getCurrentPosition().toDouble(),
                        "duration" to player.getDuration().toDouble(),
                        "buffered" to player.getBufferedPosition().toDouble(),
                    ))
                    
                    val magnitudes = player.getSpectrumMagnitudes()
                    if (magnitudes.isNotEmpty()) {
                        sendEvent("onSpectrum", mapOf(
                            "magnitudes" to magnitudes.map { it.toDouble() }
                        ))
                    }
                    
                    val peaks = player.getCurrentPeaks()
                    if (peaks.size >= 2) {
                        sendEvent("onPeakMeter", mapOf(
                            "left" to peaks[0].toDouble(),
                            "right" to peaks[1].toDouble()
                        ))
                    }
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
        id = (get("id") as? String) ?: System.currentTimeMillis().toString(),
        uri = get("uri") as? String ?: get("url") as? String
            ?: throw IllegalArgumentException("track must have 'uri' or 'url'"),
        title = get("title") as? String,
        artist = get("artist") as? String,
        album = get("album") as? String,
        artworkUri = get("artwork") as? String ?: get("artworkUri") as? String,
        duration = (get("duration") as? Number)?.toLong(),
        headers = get("headers") as? Map<String, String>,
        replayGainTags = get("replayGainTags") as? Map<String, String>,
    )

    private fun List<Double>.toFloatArray() = FloatArray(size) { this[it].toFloat() }
}