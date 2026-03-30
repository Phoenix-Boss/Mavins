package expo.modules.mavinplayer.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.mavinplayer.MavinPlayerModule

@UnstableApi
class MavinPlaybackService : MediaSessionService() {

    companion object {
        private const val TAG = "MavinPlaybackService"
        private const val NOTIFICATION_CHANNEL_ID = "mavin_playback_channel"

        // EQ Commands
        private const val COMMAND_TOGGLE_EQ = "mavin.action.TOGGLE_EQ"
        private const val COMMAND_RESET_EQ = "mavin.action.RESET_EQ"
        private const val COMMAND_TOGGLE_MODE = "mavin.action.TOGGLE_EQ_MODE"
        
        // Preset Commands
        private const val COMMAND_NEXT_PRESET = "mavin.action.NEXT_PRESET"
        private const val COMMAND_PREV_PRESET = "mavin.action.PREV_PRESET"
        private const val COMMAND_APPLY_PRESET = "mavin.action.APPLY_PRESET"
        
        // ReplayGain Commands
        private const val COMMAND_RG_TOGGLE = "mavin.action.TOGGLE_REPLAY_GAIN"
        
        // Compressor Commands
        private const val COMMAND_TOGGLE_COMPRESSOR = "mavin.action.TOGGLE_COMPRESSOR"
        private const val COMMAND_INCREASE_COMPRESSION = "mavin.action.INCREASE_COMPRESSION"
        private const val COMMAND_DECREASE_COMPRESSION = "mavin.action.DECREASE_COMPRESSION"
        
        // Crossfeed Commands
        private const val COMMAND_TOGGLE_CROSSFEED = "mavin.action.TOGGLE_CROSSFEED"
        
        // Playback Speed Commands
        private const val COMMAND_SPEED_UP = "mavin.action.SPEED_UP"
        private const val COMMAND_SLOW_DOWN = "mavin.action.SLOW_DOWN"
        private const val COMMAND_RESET_SPEED = "mavin.action.RESET_SPEED"
        
        // Crossfade Commands
        private const val COMMAND_TOGGLE_CROSSFADE = "mavin.action.TOGGLE_CROSSFADE"
        private const val COMMAND_INCREASE_CROSSFADE = "mavin.action.INCREASE_CROSSFADE"
        private const val COMMAND_DECREASE_CROSSFADE = "mavin.action.DECREASE_CROSSFADE"
        
        // Offline Mode Command
        private const val COMMAND_TOGGLE_OFFLINE = "mavin.action.TOGGLE_OFFLINE"
        
        // 64-bit Processing Command
        private const val COMMAND_TOGGLE_64BIT = "mavin.action.TOGGLE_64BIT"
        
        // Convolution Commands
        private const val COMMAND_TOGGLE_CONVOLUTION = "mavin.action.TOGGLE_CONVOLUTION"
        
        // USB DAC Commands
        private const val COMMAND_TOGGLE_USB_DIRECT = "mavin.action.TOGGLE_USB_DIRECT"
    }

    private var mediaSession: MediaSession? = null
    private var playerListener: Player.Listener? = null
    private var presetIndex = 0

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate")
        createNotificationChannel()

        val exoPlayer = MavinPlayerModule.playerInstance?.player ?: run {
            Log.w(TAG, "⚠️ ExoPlayer not ready — MediaSession skipped")
            return
        }

        mediaSession = MediaSession.Builder(this, exoPlayer)
            .setCallback(MediaSessionCallback())
            .build()

        playerListener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                exoPlayer.applicationLooper.also { updateMediaSessionMetadata() }
            }
            override fun onMediaItemTransition(mediaItem: androidx.media3.common.MediaItem?, reason: Int) {
                updateMediaSessionMetadata()
            }
        }
        exoPlayer.addListener(playerListener!!)

        Log.i(TAG, "✅ MediaSession ready — EQ · Compressor · Crossfeed · Convolution · USB DAC · Crossfade · Presets · ReplayGain · Speed · Offline · 64-bit")
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        val p = mediaSession?.player
        if (p == null || !p.playWhenReady) {
            Log.i(TAG, "Stopping service")
            stopSelf()
        }
    }

    override fun onDestroy() {
        Log.i(TAG, "onDestroy")
        playerListener?.let { mediaSession?.player?.removeListener(it) }
        playerListener = null
        mediaSession?.run { release(); mediaSession = null }
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID, "Mavin Player", NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Background audio with EQ, Compressor, Crossfeed, Convolution, USB DAC"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun updateMediaSessionMetadata() {
        val p = MavinPlayerModule.playerInstance ?: return
        val eq = p.equalizerProcessor

        val extras = Bundle().apply {
            // Core EQ
            putBoolean("eq_enabled", eq.isEnabled)
            putString("eq_mode", eq.getCurrentEqMode().name)
            putFloatArray("eq_gains", eq.getCurrentGains())
            putFloat("eq_preamp", eq.getCurrentPreamp())
            putFloatArray("eq_q_values", eq.getCurrentQValues())
            
            // Parametric
            putFloatArray("eq_parametric_gains", eq.getParametricGains())
            putDoubleArray("eq_parametric_freqs", eq.getParametricFreqs())
            
            // Loudness / ReplayGain
            putFloat("eq_loudness_db", eq.getCurrentLoudnessDb())
            val rgInfo = p.getReplayGainInfo()
            putString("rg_mode", rgInfo["mode"] as? String)
            putFloat("rg_track_gain", (rgInfo["trackGain"] as? Float) ?: Float.NaN)
            putFloat("rg_album_gain", (rgInfo["albumGain"] as? Float) ?: Float.NaN)
            putFloat("rg_applied_db", (rgInfo["appliedDb"] as? Float) ?: 0f)
            
            // Dither
            putString("eq_dither_mode", eq.getDitherMode().name)
            
            // Compressor
            putBoolean("compressor_enabled", p.isCompressorEnabled())
            putDouble("compressor_threshold", p.getCompressorThreshold())
            putDouble("compressor_ratio", p.getCompressorRatio())
            putDouble("compressor_reduction_db", p.getCompressorReductionDb().toDouble())
            
            // Crossfeed
            putBoolean("crossfeed_enabled", p.isCrossfeedEnabled())
            putDouble("crossfeed_strength", p.getCrossfeedStrength().toDouble())
            putDouble("crossfeed_cutoff", p.getCrossfeedCutoff())
            
            // Convolution
            putBoolean("convolution_enabled", p.isConvolutionEnabled())
            putBoolean("ir_loaded", p.isImpulseResponseLoaded())
            putInt("ir_length", p.getIrLength())
            
            // USB DAC
            putBoolean("usb_dac_connected", p.isUsbDacConnected())
            putBoolean("usb_direct_routing", p.isDirectUsbRoutingEnabled())
            p.getCurrentDacInfo()?.let { dacInfo ->
                putString("dac_name", dacInfo.name)
                putInt("dac_max_bit_depth", dacInfo.maxBitDepth)
                putSerializable("dac_supported_rates", ArrayList(dacInfo.supportedSampleRates))
            }
            
            // Audio Capabilities
            val caps = p.getAudioCapabilities()
            putBoolean("is_hi_res_capable", caps.isHiResCapable)
            putInt("max_sample_rate", caps.maxSampleRate)
            putInt("max_bit_depth", caps.maxBitDepth)
            
            // Crossfade
            putBoolean("crossfade_enabled", p.isCrossfadeEnabled())
            putLong("crossfade_duration_ms", p.getCrossfadeDurationMs())
            
            // Offline Mode
            putBoolean("offline_mode", p.isOfflineMode())
            
            // 64-bit Processing
            putBoolean("is_64bit_enabled", p.is64BitProcessingEnabled())
            
            // Playback Speed
            putDouble("playback_speed", p.getPlaybackSpeed().toDouble())
            
            // Presets
            putStringArrayList("presets", ArrayList(p.listPresets()))
            putString("current_preset", if (presetIndex < p.listPresets().size) p.listPresets()[presetIndex] else "")
        }

        mediaSession?.setExtras(extras)
        Log.d(TAG, "MediaSession updated: mode=${eq.getCurrentEqMode()} compressor=${p.isCompressorEnabled()} convolution=${p.isConvolutionEnabled()} usb_dac=${p.isUsbDacConnected()} speed=${p.getPlaybackSpeed()}x")
    }

    private inner class MediaSessionCallback : MediaSession.Callback {

        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo
        ): MediaSession.ConnectionResult {
            val cmds = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                // EQ Commands
                .add(SessionCommand(COMMAND_TOGGLE_EQ, Bundle()))
                .add(SessionCommand(COMMAND_RESET_EQ, Bundle()))
                .add(SessionCommand(COMMAND_TOGGLE_MODE, Bundle()))
                // Preset Commands
                .add(SessionCommand(COMMAND_NEXT_PRESET, Bundle()))
                .add(SessionCommand(COMMAND_PREV_PRESET, Bundle()))
                .add(SessionCommand(COMMAND_APPLY_PRESET, Bundle()))
                // ReplayGain Commands
                .add(SessionCommand(COMMAND_RG_TOGGLE, Bundle()))
                // Compressor Commands
                .add(SessionCommand(COMMAND_TOGGLE_COMPRESSOR, Bundle()))
                .add(SessionCommand(COMMAND_INCREASE_COMPRESSION, Bundle()))
                .add(SessionCommand(COMMAND_DECREASE_COMPRESSION, Bundle()))
                // Crossfeed Commands
                .add(SessionCommand(COMMAND_TOGGLE_CROSSFEED, Bundle()))
                // Playback Speed Commands
                .add(SessionCommand(COMMAND_SPEED_UP, Bundle()))
                .add(SessionCommand(COMMAND_SLOW_DOWN, Bundle()))
                .add(SessionCommand(COMMAND_RESET_SPEED, Bundle()))
                // Crossfade Commands
                .add(SessionCommand(COMMAND_TOGGLE_CROSSFADE, Bundle()))
                .add(SessionCommand(COMMAND_INCREASE_CROSSFADE, Bundle()))
                .add(SessionCommand(COMMAND_DECREASE_CROSSFADE, Bundle()))
                // Offline Mode
                .add(SessionCommand(COMMAND_TOGGLE_OFFLINE, Bundle()))
                // 64-bit Processing
                .add(SessionCommand(COMMAND_TOGGLE_64BIT, Bundle()))
                // Convolution
                .add(SessionCommand(COMMAND_TOGGLE_CONVOLUTION, Bundle()))
                // USB DAC
                .add(SessionCommand(COMMAND_TOGGLE_USB_DIRECT, Bundle()))
                .build()
            return MediaSession.ConnectionResult.accept(
                cmds, MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS
            )
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle
        ): ListenableFuture<SessionResult> {
            val p = MavinPlayerModule.playerInstance

            when (customCommand.customAction) {
                // ── EQ Commands ──────────────────────────────────────────────
                COMMAND_TOGGLE_EQ -> {
                    val newState = !(p?.equalizerProcessor?.isEnabled ?: false)
                    p?.setEQEnabled(newState)
                    Log.i(TAG, "EQ toggled → $newState")
                }
                COMMAND_RESET_EQ -> {
                    p?.resetEQ()
                    Log.i(TAG, "EQ reset via MediaSession")
                }
                COMMAND_TOGGLE_MODE -> {
                    val next = when (p?.equalizerProcessor?.getCurrentEqMode()) {
                        expo.modules.autoeqengine.EqualizerProcessor.EqMode.GRAPHIC -> "PARAMETRIC"
                        expo.modules.autoeqengine.EqualizerProcessor.EqMode.PARAMETRIC -> "PARALLEL"
                        else -> "GRAPHIC"
                    }
                    p?.setEQMode(next)
                    Log.i(TAG, "EQ mode → $next")
                }
                
                // ── Preset Commands ──────────────────────────────────────────
                COMMAND_NEXT_PRESET -> {
                    val presets = p?.listPresets() ?: return ok()
                    presetIndex = (presetIndex + 1) % presets.size
                    p.applyPresetByName(presets[presetIndex])
                    Log.i(TAG, "Next preset → ${presets[presetIndex]}")
                }
                COMMAND_PREV_PRESET -> {
                    val presets = p?.listPresets() ?: return ok()
                    presetIndex = (presetIndex - 1 + presets.size) % presets.size
                    p.applyPresetByName(presets[presetIndex])
                    Log.i(TAG, "Prev preset → ${presets[presetIndex]}")
                }
                COMMAND_APPLY_PRESET -> {
                    val name = args.getString("preset_name")
                    if (name != null) {
                        p?.applyPresetByName(name)
                        Log.i(TAG, "Applied preset via MediaSession: $name")
                    }
                }
                
                // ── ReplayGain Commands ──────────────────────────────────────
                COMMAND_RG_TOGGLE -> {
                    val rgInfo = p?.getReplayGainInfo()
                    val current = rgInfo?.get("mode") as? String ?: "TRACK"
                    val next = when (current) {
                        "TRACK" -> "ALBUM"
                        "ALBUM" -> "OFF"
                        else -> "TRACK"
                    }
                    p?.setReplayGainMode(next)
                    Log.i(TAG, "ReplayGain mode → $next")
                }
                
                // ── Compressor Commands ──────────────────────────────────────
                COMMAND_TOGGLE_COMPRESSOR -> {
                    val newState = !(p?.isCompressorEnabled() ?: false)
                    p?.setCompressorEnabled(newState)
                    Log.i(TAG, "Compressor toggled → $newState")
                }
                COMMAND_INCREASE_COMPRESSION -> {
                    val currentRatio = p?.getCompressorRatio() ?: 4.0
                    val newRatio = (currentRatio + 1.0).coerceAtMost(20.0)
                    p?.setCompressorRatio(newRatio)
                    Log.i(TAG, "Compression ratio increased → ${newRatio}:1")
                }
                COMMAND_DECREASE_COMPRESSION -> {
                    val currentRatio = p?.getCompressorRatio() ?: 4.0
                    val newRatio = (currentRatio - 1.0).coerceAtLeast(1.0)
                    p?.setCompressorRatio(newRatio)
                    Log.i(TAG, "Compression ratio decreased → ${newRatio}:1")
                }
                
                // ── Crossfeed Commands ───────────────────────────────────────
                COMMAND_TOGGLE_CROSSFEED -> {
                    val newState = !(p?.isCrossfeedEnabled() ?: false)
                    p?.setCrossfeedEnabled(newState)
                    Log.i(TAG, "Crossfeed toggled → $newState")
                }
                
                // ── Playback Speed Commands ──────────────────────────────────
                COMMAND_SPEED_UP -> {
                    val currentSpeed = p?.getPlaybackSpeed() ?: 1.0f
                    val newSpeed = (currentSpeed + 0.1f).coerceAtMost(3.0f)
                    p?.setPlaybackSpeed(newSpeed)
                    Log.i(TAG, "Speed up → ${newSpeed}x")
                }
                COMMAND_SLOW_DOWN -> {
                    val currentSpeed = p?.getPlaybackSpeed() ?: 1.0f
                    val newSpeed = (currentSpeed - 0.1f).coerceAtLeast(0.5f)
                    p?.setPlaybackSpeed(newSpeed)
                    Log.i(TAG, "Slow down → ${newSpeed}x")
                }
                COMMAND_RESET_SPEED -> {
                    p?.setPlaybackSpeed(1.0f)
                    Log.i(TAG, "Speed reset → 1.0x")
                }
                
                // ── Crossfade Commands ───────────────────────────────────────
                COMMAND_TOGGLE_CROSSFADE -> {
                    val newState = !(p?.isCrossfadeEnabled() ?: false)
                    p?.setCrossfadeEnabled(newState)
                    Log.i(TAG, "Crossfade toggled → $newState")
                }
                COMMAND_INCREASE_CROSSFADE -> {
                    val currentDuration = p?.getCrossfadeDurationMs() ?: 2000L
                    val newDuration = (currentDuration + 500L).coerceAtMost(10000L)
                    p?.setCrossfadeDurationMs(newDuration)
                    Log.i(TAG, "Crossfade duration increased → ${newDuration}ms")
                }
                COMMAND_DECREASE_CROSSFADE -> {
                    val currentDuration = p?.getCrossfadeDurationMs() ?: 2000L
                    val newDuration = (currentDuration - 500L).coerceAtLeast(500L)
                    p?.setCrossfadeDurationMs(newDuration)
                    Log.i(TAG, "Crossfade duration decreased → ${newDuration}ms")
                }
                
                // ── Offline Mode ─────────────────────────────────────────────
                COMMAND_TOGGLE_OFFLINE -> {
                    val newState = !(p?.isOfflineMode() ?: false)
                    p?.setOfflineMode(newState)
                    Log.i(TAG, "Offline mode toggled → $newState")
                }
                
                // ── 64-bit Processing ────────────────────────────────────────
                COMMAND_TOGGLE_64BIT -> {
                    val newState = !(p?.is64BitProcessingEnabled() ?: false)
                    p?.set64BitProcessingEnabled(newState)
                    Log.i(TAG, "64-bit processing toggled → $newState")
                }
                
                // ── Convolution ──────────────────────────────────────────────
                COMMAND_TOGGLE_CONVOLUTION -> {
                    val newState = !(p?.isConvolutionEnabled() ?: false)
                    p?.setConvolutionEnabled(newState)
                    Log.i(TAG, "Convolution toggled → $newState")
                }
                
                // ── USB DAC ──────────────────────────────────────────────────
                COMMAND_TOGGLE_USB_DIRECT -> {
                    val newState = !(p?.isDirectUsbRoutingEnabled() ?: false)
                    p?.enableDirectUsbRouting(newState)
                    Log.i(TAG, "USB direct routing toggled → $newState")
                }
                
                else -> return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
            }

            updateMediaSessionMetadata()
            return ok()
        }
    }

    private fun ok() = Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))

    fun getFullState(): Map<String, Any>? {
        val p = MavinPlayerModule.playerInstance ?: return null
        val eq = p.equalizerProcessor
        
        return mapOf(
            // EQ State
            "enabled" to eq.isEnabled,
            "mode" to eq.getCurrentEqMode().name,
            "gains" to eq.getCurrentGains().toList(),
            "preamp" to eq.getCurrentPreamp(),
            "q_values" to eq.getCurrentQValues().toList(),
            "parametric_gains" to eq.getParametricGains().toList(),
            "parametric_freqs" to eq.getParametricFreqs().toList(),
            "loudness_db" to eq.getCurrentLoudnessDb(),
            "dither_mode" to eq.getDitherMode().name,
            
            // Compressor State
            "compressor_enabled" to p.isCompressorEnabled(),
            "compressor_threshold" to p.getCompressorThreshold(),
            "compressor_ratio" to p.getCompressorRatio(),
            "compressor_attack_ms" to p.getCompressorAttackMs(),
            "compressor_release_ms" to p.getCompressorReleaseMs(),
            "compressor_reduction_db" to p.getCompressorReductionDb(),
            
            // Crossfeed State
            "crossfeed_enabled" to p.isCrossfeedEnabled(),
            "crossfeed_strength" to p.getCrossfeedStrength(),
            "crossfeed_cutoff" to p.getCrossfeedCutoff(),
            
            // Convolution State
            "convolution_enabled" to p.isConvolutionEnabled(),
            "ir_loaded" to p.isImpulseResponseLoaded(),
            "ir_length" to p.getIrLength(),
            
            // USB DAC State
            "usb_dac_connected" to p.isUsbDacConnected(),
            "usb_direct_routing" to p.isDirectUsbRoutingEnabled(),
            "current_dac" to p.getCurrentDacInfo(),
            "dac_capabilities" to p.getDacCapabilities(),
            
            // Audio Capabilities
            "audio_capabilities" to p.getAudioCapabilities(),
            "optimal_format" to p.getOptimalAudioFormat(),
            "is_hi_res_capable" to p.isHiResAudioCapable(),
            "max_sample_rate" to p.getMaxSampleRate(),
            "max_bit_depth" to p.getMaxBitDepth(),
            
            // Crossfade
            "crossfade_enabled" to p.isCrossfadeEnabled(),
            "crossfade_duration_ms" to p.getCrossfadeDurationMs(),
            
            // Offline Mode
            "offline_mode" to p.isOfflineMode(),
            
            // 64-bit Processing
            "is_64bit_enabled" to p.is64BitProcessingEnabled(),
            
            // Playback Speed
            "playback_speed" to p.getPlaybackSpeed(),
            
            // ReplayGain
            "replay_gain" to p.getReplayGainInfo(),
            
            // Presets
            "presets" to p.listPresets(),
            "preset_index" to presetIndex
        )
    }

    fun toggleEQ(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val newState = !p.equalizerProcessor.isEnabled
        p.setEQEnabled(newState)
        updateMediaSessionMetadata()
        return newState
    }
    
    fun toggleCompressor(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val newState = !p.isCompressorEnabled()
        p.setCompressorEnabled(newState)
        updateMediaSessionMetadata()
        return newState
    }
    
    fun toggleCrossfeed(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val newState = !p.isCrossfeedEnabled()
        p.setCrossfeedEnabled(newState)
        updateMediaSessionMetadata()
        return newState
    }
    
    fun toggleConvolution(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val newState = !p.isConvolutionEnabled()
        p.setConvolutionEnabled(newState)
        updateMediaSessionMetadata()
        return newState
    }
    
    fun toggleCrossfade(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val newState = !p.isCrossfadeEnabled()
        p.setCrossfadeEnabled(newState)
        updateMediaSessionMetadata()
        return newState
    }
    
    fun toggleOfflineMode(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val newState = !p.isOfflineMode()
        p.setOfflineMode(newState)
        updateMediaSessionMetadata()
        return newState
    }
    
    fun toggle64BitProcessing(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val newState = !p.is64BitProcessingEnabled()
        p.set64BitProcessingEnabled(newState)
        updateMediaSessionMetadata()
        return newState
    }
    
    fun toggleUsbDirectRouting(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val newState = !p.isDirectUsbRoutingEnabled()
        p.enableDirectUsbRouting(newState)
        updateMediaSessionMetadata()
        return newState
    }
    
    fun speedUp(): Float {
        val p = MavinPlayerModule.playerInstance ?: return 1.0f
        val currentSpeed = p.getPlaybackSpeed()
        val newSpeed = (currentSpeed + 0.1f).coerceAtMost(3.0f)
        p.setPlaybackSpeed(newSpeed)
        updateMediaSessionMetadata()
        return newSpeed
    }
    
    fun slowDown(): Float {
        val p = MavinPlayerModule.playerInstance ?: return 1.0f
        val currentSpeed = p.getPlaybackSpeed()
        val newSpeed = (currentSpeed - 0.1f).coerceAtLeast(0.5f)
        p.setPlaybackSpeed(newSpeed)
        updateMediaSessionMetadata()
        return newSpeed
    }
    
    fun resetSpeed(): Float {
        val p = MavinPlayerModule.playerInstance ?: return 1.0f
        p.setPlaybackSpeed(1.0f)
        updateMediaSessionMetadata()
        return 1.0f
    }
}