package expo.modules.mavinplayer.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
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

        // Custom MediaSession commands for lockscreen / notification EQ control
        private const val COMMAND_TOGGLE_EQ    = "mavin.action.TOGGLE_EQ"
        private const val COMMAND_RESET_EQ     = "mavin.action.RESET_EQ"
        private const val COMMAND_TOGGLE_MODE  = "mavin.action.TOGGLE_EQ_MODE"
    }

    private var mediaSession: MediaSession? = null
    private var playerListener: Player.Listener? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate")
        createNotificationChannel()

        val exoPlayer = MavinPlayerModule.playerInstance?.player
        if (exoPlayer != null) {
            mediaSession = MediaSession.Builder(this, exoPlayer)
                .setCallback(MediaSessionCallback())
                .build()

            playerListener = object : Player.Listener {
                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    // Safe: update on main thread via post to avoid race on playerInstance read
                    exoPlayer.applicationLooper.let { updateMediaSessionMetadata() }
                }
            }
            exoPlayer.addListener(playerListener!!)

            Log.i(TAG, "✅ MediaSession created with full EQ integration")
        } else {
            Log.w(TAG, "⚠️ ExoPlayer not ready — MediaSession skipped. Call initPlayer() first.")
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = mediaSession?.player
        if (player == null || !player.playWhenReady) {
            Log.i(TAG, "onTaskRemoved: stopping service")
            stopSelf()
        } else {
            Log.i(TAG, "onTaskRemoved: player still active, keeping service")
        }
    }

    override fun onDestroy() {
        Log.i(TAG, "onDestroy")
        playerListener?.let { mediaSession?.player?.removeListener(it) }
        playerListener = null
        mediaSession?.run { release(); mediaSession = null }
        super.onDestroy()
    }

    // ═══════════════════════════════════════════════════════════════════════
    // NOTIFICATION CHANNEL
    // ═══════════════════════════════════════════════════════════════════════

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Mavins Player",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Background audio playback with EQ"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MEDIA SESSION METADATA (full EQ state for external controllers)
    // ═══════════════════════════════════════════════════════════════════════

    private fun updateMediaSessionMetadata() {
        val player = MavinPlayerModule.playerInstance ?: return
        val eq     = player.equalizerProcessor

        val extras = android.os.Bundle().apply {
            // Core EQ state
            putBoolean("eq_enabled",    eq.isEnabled)
            putString("eq_mode",        eq.getCurrentEqMode().name)
            putFloatArray("eq_gains",   eq.getCurrentGains())
            putFloat("eq_preamp",       eq.getCurrentPreamp())
            // Parametric state
            putFloatArray("eq_parametric_gains", eq.getParametricGains())
            // Loudness normalization
            putFloat("eq_loudness_offset", eq.getCurrentLoudnessOffset())
            // Q values
            putFloatArray("eq_q_values", eq.getCurrentQValues())
        }

        mediaSession?.setExtras(extras)
        Log.d(TAG, "MediaSession metadata updated: EQ=${eq.isEnabled} mode=${eq.getCurrentEqMode()} " +
                "loudness=${eq.getCurrentLoudnessOffset()}dB")
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CUSTOM MEDIA SESSION COMMANDS
    // ═══════════════════════════════════════════════════════════════════════

    private inner class MediaSessionCallback : MediaSession.Callback {

        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo
        ): MediaSession.ConnectionResult {
            val sessionCommands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                .add(SessionCommand(COMMAND_TOGGLE_EQ,   android.os.Bundle()))
                .add(SessionCommand(COMMAND_RESET_EQ,    android.os.Bundle()))
                .add(SessionCommand(COMMAND_TOGGLE_MODE, android.os.Bundle()))
                .build()
            return MediaSession.ConnectionResult.accept(
                sessionCommands,
                MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS
            )
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: android.os.Bundle
        ): ListenableFuture<SessionResult> {
            return when (customCommand.customAction) {
                COMMAND_TOGGLE_EQ -> {
                    val p = MavinPlayerModule.playerInstance
                    val newState = !(p?.equalizerProcessor?.isEnabled ?: false)
                    p?.setEQEnabled(newState)
                    updateMediaSessionMetadata()
                    Log.i(TAG, "EQ toggled via MediaSession: $newState")
                    Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }
                COMMAND_RESET_EQ -> {
                    MavinPlayerModule.playerInstance?.resetEQ()
                    updateMediaSessionMetadata()
                    Log.i(TAG, "EQ reset via MediaSession")
                    Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }
                COMMAND_TOGGLE_MODE -> {
                    val p = MavinPlayerModule.playerInstance
                    val current = p?.equalizerProcessor?.getCurrentEqMode()
                    val next = if (current?.name == "GRAPHIC") "PARAMETRIC" else "GRAPHIC"
                    p?.setEQMode(next)
                    updateMediaSessionMetadata()
                    Log.i(TAG, "EQ mode toggled to $next via MediaSession")
                    Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }
                else -> Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC API FOR EXTERNAL CONTROLLERS (Android Auto, widgets)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Full EQ state snapshot for system integration / Android Auto.
     */
    fun getEQState(): Map<String, Any>? {
        val player = MavinPlayerModule.playerInstance ?: return null
        val eq     = player.equalizerProcessor
        return mapOf(
            "enabled"         to eq.isEnabled,
            "mode"            to eq.getCurrentEqMode().name,
            "gains"           to eq.getCurrentGains().toList(),
            "preamp"          to eq.getCurrentPreamp(),
            "q_values"        to eq.getCurrentQValues().toList(),
            "parametric_gains" to eq.getParametricGains().toList(),
            "loudness_offset" to eq.getCurrentLoudnessOffset(),
        )
    }

    fun toggleEQ(): Boolean {
        val player   = MavinPlayerModule.playerInstance ?: return false
        val newState = !player.equalizerProcessor.isEnabled
        player.setEQEnabled(newState)
        updateMediaSessionMetadata()
        return newState
    }
}