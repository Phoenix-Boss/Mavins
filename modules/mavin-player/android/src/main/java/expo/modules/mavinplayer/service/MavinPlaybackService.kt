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
import expo.modules.mavinplayer.audio.EqualizerProcessor
import expo.modules.mavinplayer.MavinPlayerModule

@UnstableApi
class MavinPlaybackService : MediaSessionService() {

    companion object {
        private const val TAG = "MavinPlaybackService"
        private const val NOTIFICATION_CHANNEL_ID = "mavin_playback_channel"

        /**
         * Stable, non-empty session ID.
         *
         * Media3 requires every MediaSession in the process to have a globally-unique ID.
         * Using the default (empty string "") causes an IllegalStateException when the
         * service is recreated before the previous instance fully tears down — e.g. on
         * hot reload, Fast Refresh, or system-initiated service restart.
         *
         * A hardcoded non-empty constant is safe as long as only one MavinPlaybackService
         * instance exists at a time, which onDestroy() + the guard in onCreate() guarantee.
         */
        private const val MEDIA_SESSION_ID = "mavin-playback-session"

        // EQ
        private const val COMMAND_TOGGLE_EQ    = "mavin.action.TOGGLE_EQ"
        private const val COMMAND_RESET_EQ     = "mavin.action.RESET_EQ"
        private const val COMMAND_TOGGLE_MODE  = "mavin.action.TOGGLE_EQ_MODE"
        // Presets
        private const val COMMAND_NEXT_PRESET  = "mavin.action.NEXT_PRESET"
        private const val COMMAND_PREV_PRESET  = "mavin.action.PREV_PRESET"
        private const val COMMAND_APPLY_PRESET = "mavin.action.APPLY_PRESET"
        // ReplayGain
        private const val COMMAND_RG_TOGGLE    = "mavin.action.TOGGLE_REPLAY_GAIN"
        // Compressor
        private const val COMMAND_TOGGLE_COMPRESSOR      = "mavin.action.TOGGLE_COMPRESSOR"
        private const val COMMAND_INCREASE_COMPRESSION   = "mavin.action.INCREASE_COMPRESSION"
        private const val COMMAND_DECREASE_COMPRESSION   = "mavin.action.DECREASE_COMPRESSION"
        // Crossfeed
        private const val COMMAND_TOGGLE_CROSSFEED = "mavin.action.TOGGLE_CROSSFEED"
        // Speed
        private const val COMMAND_SPEED_UP    = "mavin.action.SPEED_UP"
        private const val COMMAND_SLOW_DOWN   = "mavin.action.SLOW_DOWN"
        private const val COMMAND_RESET_SPEED = "mavin.action.RESET_SPEED"
        // Crossfade
        private const val COMMAND_TOGGLE_CROSSFADE   = "mavin.action.TOGGLE_CROSSFADE"
        private const val COMMAND_INCREASE_CROSSFADE = "mavin.action.INCREASE_CROSSFADE"
        private const val COMMAND_DECREASE_CROSSFADE = "mavin.action.DECREASE_CROSSFADE"
        // Misc
        private const val COMMAND_TOGGLE_OFFLINE      = "mavin.action.TOGGLE_OFFLINE"
        private const val COMMAND_TOGGLE_64BIT        = "mavin.action.TOGGLE_64BIT"
        private const val COMMAND_TOGGLE_CONVOLUTION  = "mavin.action.TOGGLE_CONVOLUTION"
        private const val COMMAND_TOGGLE_USB_DIRECT   = "mavin.action.TOGGLE_USB_DIRECT"
        // FX
        private const val COMMAND_TOGGLE_FX           = "mavin.action.TOGGLE_FX"
        private const val COMMAND_CYCLE_FX_MODE       = "mavin.action.CYCLE_FX_MODE"
    }

    private var mediaSession: MediaSession? = null
    private var playerListener: Player.Listener? = null
    private var presetIndex = 0

    // ─────────────────────────────────────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate")
        createNotificationChannel()

        // ── Guard: release any stale session that survived a previous instance ──
        // This happens when the service is restarted by the system (or via hot
        // reload) before the prior onDestroy() fully ran. Without this guard,
        // MediaSession.Builder.build() throws:
        //   IllegalStateException: Session ID must be unique. ID=mavin-playback-session
        releaseMediaSessionIfNeeded()

        val exoPlayer = MavinPlayerModule.playerInstance?.player ?: run {
            Log.w(TAG, "⚠️ ExoPlayer not ready — MediaSession skipped")
            return
        }

        mediaSession = MediaSession.Builder(this, exoPlayer)
            .setId(MEDIA_SESSION_ID)
            .setCallback(MediaSessionCallback())
            .build()

        playerListener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { logDspState() }
            override fun onMediaItemTransition(
                mediaItem: androidx.media3.common.MediaItem?,
                reason: Int
            ) { logDspState() }
        }
        exoPlayer.addListener(playerListener!!)

        Log.i(TAG, "✅ MediaSession ready (id=$MEDIA_SESSION_ID) — full DSP command surface wired")
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        val p = mediaSession?.player
        if (p == null || !p.playWhenReady) {
            Log.i(TAG, "onTaskRemoved — stopping service")
            stopSelf()
        }
    }

    override fun onDestroy() {
        Log.i(TAG, "onDestroy")
        releaseMediaSessionIfNeeded()
        super.onDestroy()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Safely tears down the MediaSession and its player listener.
     * Idempotent — safe to call multiple times.
     *
     * Separating this from onDestroy() lets onCreate() call it as a pre-flight
     * guard before building a new session, preventing the duplicate-ID crash
     * caused by rapid service restarts (hot reload, system restart, etc.).
     */
    private fun releaseMediaSessionIfNeeded() {
        playerListener?.let { mediaSession?.player?.removeListener(it) }
        playerListener = null
        mediaSession?.run {
            release()
            Log.i(TAG, "MediaSession released (id=$MEDIA_SESSION_ID)")
        }
        mediaSession = null
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NOTIFICATION CHANNEL
    // ─────────────────────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Mavin Player",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Background audio with EQ, Compressor, Crossfeed, Convolution, USB DAC"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DSP STATE LOG
    // ─────────────────────────────────────────────────────────────────────────

    private fun logDspState() {
        val p  = MavinPlayerModule.playerInstance ?: return
        val eq = p.equalizerProcessor
        Log.d(TAG, "DSP state: mode=${eq.getCurrentEqMode()} " +
                "compressor=${p.isCompressorEnabled()} " +
                "convolution=${p.isConvolutionEnabled()} " +
                "usb_dac=${p.isUsbDacConnected()} " +
                "speed=${p.getPlaybackSpeed()}x " +
                "crossfeed=${p.isCrossfeedEnabled()} " +
                "fx=${p.isFxEnabled()} fxMode=${p.getFxMode()} " +
                "crossfade=${p.isCrossfadeEnabled()} " +
                "offline=${p.isOfflineMode()} " +
                "64bit=${p.is64BitProcessingEnabled()}"
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MEDIA SESSION CALLBACK — full DSP command surface
    // ─────────────────────────────────────────────────────────────────────────

    private inner class MediaSessionCallback : MediaSession.Callback {

        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo
        ): MediaSession.ConnectionResult {
            val sessionCommands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS
                .buildUpon()
                .add(SessionCommand(COMMAND_TOGGLE_EQ,           Bundle.EMPTY))
                .add(SessionCommand(COMMAND_RESET_EQ,            Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_MODE,         Bundle.EMPTY))
                .add(SessionCommand(COMMAND_NEXT_PRESET,         Bundle.EMPTY))
                .add(SessionCommand(COMMAND_PREV_PRESET,         Bundle.EMPTY))
                .add(SessionCommand(COMMAND_APPLY_PRESET,        Bundle.EMPTY))
                .add(SessionCommand(COMMAND_RG_TOGGLE,           Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_COMPRESSOR,   Bundle.EMPTY))
                .add(SessionCommand(COMMAND_INCREASE_COMPRESSION,Bundle.EMPTY))
                .add(SessionCommand(COMMAND_DECREASE_COMPRESSION,Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_CROSSFEED,    Bundle.EMPTY))
                .add(SessionCommand(COMMAND_SPEED_UP,            Bundle.EMPTY))
                .add(SessionCommand(COMMAND_SLOW_DOWN,           Bundle.EMPTY))
                .add(SessionCommand(COMMAND_RESET_SPEED,         Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_CROSSFADE,    Bundle.EMPTY))
                .add(SessionCommand(COMMAND_INCREASE_CROSSFADE,  Bundle.EMPTY))
                .add(SessionCommand(COMMAND_DECREASE_CROSSFADE,  Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_OFFLINE,      Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_64BIT,        Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_CONVOLUTION,  Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_USB_DIRECT,   Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_FX,           Bundle.EMPTY))
                .add(SessionCommand(COMMAND_CYCLE_FX_MODE,       Bundle.EMPTY))
                .build()

            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(sessionCommands)
                .build()
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle
        ): ListenableFuture<SessionResult> {
            val p = MavinPlayerModule.playerInstance

            when (customCommand.customAction) {
                COMMAND_TOGGLE_EQ    -> { val s = !(p?.equalizerProcessor?.isEnabled ?: false); p?.setEQEnabled(s); Log.i(TAG, "EQ → $s") }
                COMMAND_RESET_EQ     -> { p?.resetEQ(); Log.i(TAG, "EQ reset") }
                COMMAND_TOGGLE_MODE  -> {
                    val next = when (p?.equalizerProcessor?.getCurrentEqMode()) {
                        EqualizerProcessor.EqMode.GRAPHIC    -> "PARAMETRIC"
                        EqualizerProcessor.EqMode.PARAMETRIC -> "PARALLEL"
                        else -> "GRAPHIC"
                    }
                    p?.setEQMode(next)
                    Log.i(TAG, "EQ mode → $next")
                }
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
                    args.getString("preset_name")?.let { name ->
                        p?.applyPresetByName(name)
                        Log.i(TAG, "Applied preset: $name")
                    }
                }
                COMMAND_RG_TOGGLE -> {
                    val current = p?.getReplayGainInfo()?.get("mode") as? String ?: "TRACK"
                    val next = when (current) { "TRACK" -> "ALBUM"; "ALBUM" -> "OFF"; else -> "TRACK" }
                    p?.setReplayGainMode(next)
                    Log.i(TAG, "ReplayGain → $next")
                }
                COMMAND_TOGGLE_COMPRESSOR    -> { val s = !(p?.isCompressorEnabled() ?: false); p?.setCompressorEnabled(s); Log.i(TAG, "Compressor → $s") }
                COMMAND_INCREASE_COMPRESSION -> { val r = ((p?.getCompressorRatio() ?: 4.0) + 1.0).coerceAtMost(20.0); p?.setCompressorRatio(r); Log.i(TAG, "Ratio → $r") }
                COMMAND_DECREASE_COMPRESSION -> { val r = ((p?.getCompressorRatio() ?: 4.0) - 1.0).coerceAtLeast(1.0); p?.setCompressorRatio(r); Log.i(TAG, "Ratio → $r") }
                COMMAND_TOGGLE_CROSSFEED     -> { val s = !(p?.isCrossfeedEnabled() ?: false); p?.setCrossfeedEnabled(s); Log.i(TAG, "Crossfeed → $s") }
                COMMAND_SPEED_UP             -> { val s = ((p?.getPlaybackSpeed() ?: 1f) + 0.1f).coerceAtMost(3f); p?.setPlaybackSpeed(s); Log.i(TAG, "Speed → $s") }
                COMMAND_SLOW_DOWN            -> { val s = ((p?.getPlaybackSpeed() ?: 1f) - 0.1f).coerceAtLeast(0.5f); p?.setPlaybackSpeed(s); Log.i(TAG, "Speed → $s") }
                COMMAND_RESET_SPEED          -> { p?.setPlaybackSpeed(1f); Log.i(TAG, "Speed reset") }
                COMMAND_TOGGLE_CROSSFADE     -> { val s = !(p?.isCrossfadeEnabled() ?: false); p?.setCrossfadeEnabled(s); Log.i(TAG, "Crossfade → $s") }
                COMMAND_INCREASE_CROSSFADE   -> { val d = ((p?.getCrossfadeDurationMs() ?: 2000L) + 500L).coerceAtMost(10_000L); p?.setCrossfadeDurationMs(d); Log.i(TAG, "Crossfade duration → $d") }
                COMMAND_DECREASE_CROSSFADE   -> { val d = ((p?.getCrossfadeDurationMs() ?: 2000L) - 500L).coerceAtLeast(500L); p?.setCrossfadeDurationMs(d); Log.i(TAG, "Crossfade duration → $d") }
                COMMAND_TOGGLE_OFFLINE       -> { val s = !(p?.isOfflineMode() ?: false); p?.setOfflineMode(s); Log.i(TAG, "Offline → $s") }
                COMMAND_TOGGLE_64BIT         -> { val s = !(p?.is64BitProcessingEnabled() ?: false); p?.set64BitProcessingEnabled(s); Log.i(TAG, "64-bit → $s") }
                COMMAND_TOGGLE_CONVOLUTION   -> { val s = !(p?.isConvolutionEnabled() ?: false); p?.setConvolutionEnabled(s); Log.i(TAG, "Convolution → $s") }
                COMMAND_TOGGLE_USB_DIRECT    -> { val s = !(p?.isDirectUsbRoutingEnabled() ?: false); p?.enableDirectUsbRouting(s); Log.i(TAG, "USB direct → $s") }
                COMMAND_TOGGLE_FX            -> { val s = !(p?.isFxEnabled() ?: false); p?.setFxEnabled(s); Log.i(TAG, "FX → $s") }
                COMMAND_CYCLE_FX_MODE -> {
                    val next = when (p?.getFxMode()) {
                        "REVERB"  -> "DELAY"
                        "DELAY"   -> "CHORUS"
                        "CHORUS"  -> "FLANGER"
                        "FLANGER" -> "PHASER"
                        else      -> "REVERB"
                    }
                    p?.setFxMode(next); Log.i(TAG, "FX mode → $next")
                }
                else -> return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
            }

            logDspState()
            return ok()
        }
    }

    private fun ok() = Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API (Android Auto, widgets)
    // ─────────────────────────────────────────────────────────────────────────

    fun getFullState(): Map<String, Any?> {
        val p  = MavinPlayerModule.playerInstance ?: return emptyMap()
        val eq = p.equalizerProcessor
        return mapOf(
            "enabled"              to eq.isEnabled,
            "mode"                 to eq.getCurrentEqMode().name,
            "gains"                to eq.getCurrentGains().toList(),
            "preamp"               to eq.getCurrentPreamp(),
            "q_values"             to eq.getCurrentQValues().toList(),
            "parametric_gains"     to eq.getParametricGains().toList(),
            "parametric_freqs"     to eq.getParametricFreqs().toList(),
            "loudness_db"          to eq.getCurrentLoudnessDb(),
            "dither_mode"          to eq.getDitherMode().name,
            "compressor_enabled"   to p.isCompressorEnabled(),
            "compressor_threshold" to p.getCompressorThreshold(),
            "compressor_ratio"     to p.getCompressorRatio(),
            "compressor_attack_ms" to p.getCompressorAttackMs(),
            "compressor_release_ms" to p.getCompressorReleaseMs(),
            "compressor_reduction_db" to p.getCompressorReductionDb(),
            "crossfeed_enabled"    to p.isCrossfeedEnabled(),
            "crossfeed_strength"   to p.getCrossfeedStrength(),
            "crossfeed_cutoff"     to p.getCrossfeedCutoff(),
            "convolution_enabled"  to p.isConvolutionEnabled(),
            "ir_loaded"            to p.isImpulseResponseLoaded(),
            "ir_length"            to p.getIrLength(),
            "usb_dac_connected"    to p.isUsbDacConnected(),
            "usb_direct_routing"   to p.isDirectUsbRoutingEnabled(),
            "crossfade_enabled"    to p.isCrossfadeEnabled(),
            "crossfade_duration_ms" to p.getCrossfadeDurationMs(),
            "offline_mode"         to p.isOfflineMode(),
            "fx_enabled"           to p.isFxEnabled(),
            "fx_mode"              to p.getFxMode(),
            "fx_mix"               to p.getFxMix(),
            "is_64bit_enabled"     to p.is64BitProcessingEnabled(),
            "playback_speed"       to p.getPlaybackSpeed(),
            "replay_gain"          to p.getReplayGainInfo(),
            "presets"              to p.listPresets(),
            "preset_index"         to presetIndex
        )
    }

    fun toggleFX(): Boolean              { val p = MavinPlayerModule.playerInstance ?: return false; val s = !p.isFxEnabled(); p.setFxEnabled(s); logDspState(); return s }
    fun toggleEQ(): Boolean              { val p = MavinPlayerModule.playerInstance ?: return false; val s = !p.equalizerProcessor.isEnabled; p.setEQEnabled(s); logDspState(); return s }
    fun toggleCompressor(): Boolean      { val p = MavinPlayerModule.playerInstance ?: return false; val s = !p.isCompressorEnabled(); p.setCompressorEnabled(s); logDspState(); return s }
    fun toggleCrossfeed(): Boolean       { val p = MavinPlayerModule.playerInstance ?: return false; val s = !p.isCrossfeedEnabled(); p.setCrossfeedEnabled(s); logDspState(); return s }
    fun toggleConvolution(): Boolean     { val p = MavinPlayerModule.playerInstance ?: return false; val s = !p.isConvolutionEnabled(); p.setConvolutionEnabled(s); logDspState(); return s }
    fun toggleCrossfade(): Boolean       { val p = MavinPlayerModule.playerInstance ?: return false; val s = !p.isCrossfadeEnabled(); p.setCrossfadeEnabled(s); logDspState(); return s }
    fun toggleOfflineMode(): Boolean     { val p = MavinPlayerModule.playerInstance ?: return false; val s = !p.isOfflineMode(); p.setOfflineMode(s); logDspState(); return s }
    fun toggle64BitProcessing(): Boolean { val p = MavinPlayerModule.playerInstance ?: return false; val s = !p.is64BitProcessingEnabled(); p.set64BitProcessingEnabled(s); logDspState(); return s }
    fun toggleUsbDirectRouting(): Boolean{ val p = MavinPlayerModule.playerInstance ?: return false; val s = !p.isDirectUsbRoutingEnabled(); p.enableDirectUsbRouting(s); logDspState(); return s }
    fun speedUp(): Float                 { val p = MavinPlayerModule.playerInstance ?: return 1f; val s = (p.getPlaybackSpeed() + 0.1f).coerceAtMost(3f); p.setPlaybackSpeed(s); logDspState(); return s }
    fun slowDown(): Float                { val p = MavinPlayerModule.playerInstance ?: return 1f; val s = (p.getPlaybackSpeed() - 0.1f).coerceAtLeast(0.5f); p.setPlaybackSpeed(s); logDspState(); return s }
    fun resetSpeed(): Float              { val p = MavinPlayerModule.playerInstance ?: return 1f; p.setPlaybackSpeed(1f); logDspState(); return 1f }
}