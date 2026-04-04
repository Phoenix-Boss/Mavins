package expo.modules.mavinplayer.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.annotation.DrawableRes
import androidx.core.app.NotificationCompat
import androidx.media3.common.HeartRating
import androidx.media3.common.PercentageRating
import androidx.media3.common.Rating
import androidx.media3.common.StarRating
import androidx.media3.common.ThumbRating
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.MediaStyleNotificationHelper
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.mavinplayer.MavinPlayerModule
import expo.modules.mavinplayer.audio.EqualizerProcessor

@UnstableApi
class MavinPlaybackService : MediaSessionService() {
    companion object {
        private const val TAG = "MavinPlaybackService"
        private const val NOTIFICATION_CHANNEL_ID = "mavin_playback_channel"
        private const val NOTIFICATION_ID = 1001

        /**
         * Stable, non-empty session ID.
         * Must differ from MavinPlayerModule's session ID — Media3 requires
         * all MediaSession IDs in the process to be globally unique.
         */
        private const val MEDIA_SESSION_ID = "mavin-playback-session"

        // ─────────────────────────────────────────────────────────────────────
        // RNTP Standard MediaSession Commands
        // ─────────────────────────────────────────────────────────────────────
        private const val COMMAND_LIKE          = "mavin.action.LIKE"
        private const val COMMAND_DISLIKE       = "mavin.action.DISLIKE"
        private const val COMMAND_BOOKMARK      = "mavin.action.BOOKMARK"
        private const val COMMAND_JUMP_FORWARD  = "mavin.action.JUMP_FORWARD"
        private const val COMMAND_JUMP_BACKWARD = "mavin.action.JUMP_BACKWARD"

        // ─────────────────────────────────────────────────────────────────────
        // Mavin DSP Commands
        // ─────────────────────────────────────────────────────────────────────
        private const val COMMAND_TOGGLE_EQ            = "mavin.action.TOGGLE_EQ"
        private const val COMMAND_RESET_EQ             = "mavin.action.RESET_EQ"
        private const val COMMAND_TOGGLE_MODE          = "mavin.action.TOGGLE_EQ_MODE"
        private const val COMMAND_NEXT_PRESET          = "mavin.action.NEXT_PRESET"
        private const val COMMAND_PREV_PRESET          = "mavin.action.PREV_PRESET"
        private const val COMMAND_APPLY_PRESET         = "mavin.action.APPLY_PRESET"
        private const val COMMAND_RG_TOGGLE            = "mavin.action.TOGGLE_REPLAY_GAIN"
        private const val COMMAND_TOGGLE_COMPRESSOR    = "mavin.action.TOGGLE_COMPRESSOR"
        private const val COMMAND_INCREASE_COMPRESSION = "mavin.action.INCREASE_COMPRESSION"
        private const val COMMAND_DECREASE_COMPRESSION = "mavin.action.DECREASE_COMPRESSION"
        private const val COMMAND_TOGGLE_CROSSFEED     = "mavin.action.TOGGLE_CROSSFEED"
        private const val COMMAND_SPEED_UP             = "mavin.action.SPEED_UP"
        private const val COMMAND_SLOW_DOWN            = "mavin.action.SLOW_DOWN"
        private const val COMMAND_RESET_SPEED          = "mavin.action.RESET_SPEED"
        private const val COMMAND_TOGGLE_CROSSFADE     = "mavin.action.TOGGLE_CROSSFADE"
        private const val COMMAND_INCREASE_CROSSFADE   = "mavin.action.INCREASE_CROSSFADE"
        private const val COMMAND_DECREASE_CROSSFADE   = "mavin.action.DECREASE_CROSSFADE"
        private const val COMMAND_TOGGLE_OFFLINE       = "mavin.action.TOGGLE_OFFLINE"
        private const val COMMAND_TOGGLE_64BIT         = "mavin.action.TOGGLE_64BIT"
        private const val COMMAND_TOGGLE_CONVOLUTION   = "mavin.action.TOGGLE_CONVOLUTION"
        private const val COMMAND_TOGGLE_USB_DIRECT    = "mavin.action.TOGGLE_USB_DIRECT"
        private const val COMMAND_TOGGLE_FX            = "mavin.action.TOGGLE_FX"
        private const val COMMAND_CYCLE_FX_MODE        = "mavin.action.CYCLE_FX_MODE"

        // Default capabilities (RNTP standard)
        private val DEFAULT_CAPABILITIES = setOf(
            "play", "pause", "stop", "skipToNext", "skipToPrevious", "seekTo"
        )

        // Default compact capabilities (shown in collapsed notification)
        private val DEFAULT_COMPACT_CAPABILITIES = setOf(
            "play", "pause", "skipToNext"
        )
    }

    private var mediaSession: MediaSession? = null
    private var playerListener: Player.Listener? = null
    private var presetIndex = 0

    // Current notification info
    private var currentTitle: String = "Mavin Player"
    private var currentArtist: String = "Ready to play"
    private var currentArtworkUri: String? = null
    private var isCurrentlyPlaying: Boolean = false

    // ─────────────────────────────────────────────────────────────────────
    // RNTP Parity: Dynamic Capabilities
    //
    // mediaSessionCapabilities  → what is advertised to Bluetooth/Auto/lock-screen controllers
    // activeNotificationCapabilities → what buttons appear in the notification shade
    // These are kept SEPARATE so notificationCapabilities can be a subset of capabilities.
    // ─────────────────────────────────────────────────────────────────────
    private var mediaSessionCapabilities = DEFAULT_CAPABILITIES
    private var activeNotificationCapabilities = DEFAULT_CAPABILITIES
    private var compactCapabilities = DEFAULT_COMPACT_CAPABILITIES
    private var notificationColor: Int? = null
    private var notificationIcon: Int? = null
    private var forwardJumpInterval: Int = 15   // seconds (RNTP default)
    private var backwardJumpInterval: Int = 15  // seconds (RNTP default)

    // ratingType: 0=none, 1=heart, 2=thumbs, 3=percentage, 4=star3, 5=star4, 6=star5
    private var ratingType: Int = 0

    // ─────────────────────────────────────────────────────────────────────
    // RNTP Parity: stopForegroundGracePeriod
    // ─────────────────────────────────────────────────────────────────────
    private var stopForegroundGracePeriodMs: Long = 0L
    private val mainHandler = Handler(Looper.getMainLooper())
    private var stopForegroundRunnable: Runnable? = null

    // LocalBinder for module connection
    inner class LocalBinder : android.os.Binder() {
        fun getService(): MavinPlaybackService = this@MavinPlaybackService
    }

    private val binder = LocalBinder()

    override fun onBind(intent: Intent?): IBinder? = binder

    // ─────────────────────────────────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate")

        // ── STEP 1: Create notification channel (must happen before posting) ──
        createNotificationChannel()

        // ── STEP 2: Call startForeground() IMMEDIATELY ────────────────────────
        startForeground(NOTIFICATION_ID, buildBootNotification())
        Log.i(TAG, "startForeground() called — 5-second deadline satisfied")

        // ── STEP 3: Guard against stale session from a previous instance ──────
        releaseMediaSessionIfNeeded()

        // ── STEP 4: Wire up MediaSession ──────────────────────────────────────
        val exoPlayer = MavinPlayerModule.playerInstance?.player ?: run {
            Log.w(TAG, "ExoPlayer not ready — MediaSession skipped (service is already foreground)")
            return
        }

        mediaSession = MediaSession.Builder(this, exoPlayer)
            .setId(MEDIA_SESSION_ID)
            .setCallback(MediaSessionCallback())
            .build()

        attachPlayerListener(exoPlayer)

        Log.i(TAG, "MediaSession ready (id=$MEDIA_SESSION_ID) — full DSP command surface wired")
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        val p = mediaSession?.player
        val appKilledBehavior = MavinPlayerModule.getAppKilledPlaybackBehavior()
        Log.i(TAG, "onTaskRemoved — appKilledPlaybackBehavior=$appKilledBehavior")

        when (appKilledBehavior) {
            "StopPlaybackAndRemoveNotification" -> {
                p?.stop()
                stopSelf()
            }
            "PausePlayback" -> {
                p?.pause()
                scheduleStopForegroundIfNeeded()
            }
            "ContinuePlayback" -> {
                // Keep playing (default)
            }
            "ResumeAfterReconnect" -> {
                // Keep playing, will resume on reconnect
            }
            else -> {
                if (p == null || !p.playWhenReady) {
                    Log.i(TAG, "onTaskRemoved — stopping service (not playing)")
                    stopSelf()
                }
            }
        }
    }

    override fun onDestroy() {
        Log.i(TAG, "onDestroy")
        stopForegroundRunnable?.let { mainHandler.removeCallbacks(it) }
        stopForegroundRunnable = null
        releaseMediaSessionIfNeeded()
        super.onDestroy()
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUBLIC API FOR MODULE (RNTP Parity)
    // ─────────────────────────────────────────────────────────────────────

    fun updateNowPlayingInfo(title: String, artist: String, artworkUri: String? = null) {
        currentTitle = title
        currentArtist = artist
        currentArtworkUri = artworkUri
        updateNotification()
        Log.d(TAG, "Updated now playing: $title - $artist")
    }

    fun updatePlayingState(isPlaying: Boolean) {
        isCurrentlyPlaying = isPlaying
        if (isPlaying) {
            // Cancel any pending foreground-stop when playback resumes
            stopForegroundRunnable?.let { mainHandler.removeCallbacks(it) }
            stopForegroundRunnable = null
        } else {
            scheduleStopForegroundIfNeeded()
        }
        updateNotification()
    }

    fun getMediaSession(): MediaSession? = mediaSession

    // ─────────────────────────────────────────────────────────────────────
    // RNTP Parity: Dynamic Capabilities & Notification Customization
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Update MediaSession capabilities — what Bluetooth/Auto/lock-screen controllers see.
     * Rebuilds the session so controllers pick up the new command list immediately.
     * Also syncs notificationCapabilities if they haven't been set independently.
     */
    fun updateMediaSessionCapabilities(capabilities: Set<String>) {
        mediaSessionCapabilities = capabilities
        // Only sync notification capabilities if they are still at the factory default,
        // meaning the caller hasn't set notificationCapabilities separately yet.
        if (activeNotificationCapabilities == DEFAULT_CAPABILITIES) {
            activeNotificationCapabilities = capabilities
        }
        Log.i(TAG, "MediaSession capabilities updated: $mediaSessionCapabilities")
        rebuildMediaSession()
        updateNotification()
    }

    /**
     * Update notification-bar capabilities independently from MediaSession capabilities.
     * RNTP keeps these separate: notificationCapabilities controls the notification shade,
     * capabilities controls what's advertised to media controllers.
     */
    fun updateNotificationCapabilities(capabilities: Set<String>) {
        activeNotificationCapabilities = capabilities
        Log.i(TAG, "Notification capabilities updated: $activeNotificationCapabilities")
        updateNotification()
    }

    /** Update compact capabilities (collapsed notification — max 3 buttons). */
    fun updateCompactCapabilities(capabilities: List<String>) {
        compactCapabilities = capabilities.toSet()
        Log.i(TAG, "Compact capabilities updated: $compactCapabilities")
        updateNotification()
    }

    /** Update notification accent color. */
    fun updateNotificationColor(color: Int?) {
        notificationColor = color
        Log.i(TAG, "Notification color updated: ${color?.toString(16)}")
        updateNotification()
    }

    /** Update notification small icon (drawable resource ID). */
    fun updateNotificationIcon(@DrawableRes iconResId: Int?) {
        notificationIcon = iconResId
        Log.i(TAG, "Notification icon updated: $iconResId")
        updateNotification()
    }

    /** Update jump forward/backward intervals and refresh notification labels. */
    fun updateJumpIntervals(forwardSeconds: Int, backwardSeconds: Int) {
        forwardJumpInterval = forwardSeconds
        backwardJumpInterval = backwardSeconds
        Log.i(TAG, "Jump intervals updated: forward=${forwardSeconds}s, backward=${backwardSeconds}s")
        updateNotification()
    }

    /**
     * Update rating type used in onSetRating to determine the correct Rating subclass.
     * 0=none, 1=heart, 2=thumbs, 3=percentage, 4=star3, 5=star4, 6=star5
     */
    fun updateRatingType(type: Int) {
        ratingType = type
        Log.i(TAG, "Rating type updated: $type")
    }

    /**
     * Update how long (ms) the foreground notification lingers after playback pauses
     * before the service demotes itself. 0 = never demote automatically (RNTP default).
     */
    fun updateStopForegroundGracePeriod(ms: Long) {
        stopForegroundGracePeriodMs = ms
        Log.i(TAG, "Stop foreground grace period: ${ms}ms")
    }

    // ─────────────────────────────────────────────────────────────────────
    // INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Rebuilds the MediaSession after a capabilities change.
     * Re-attaches the player listener so state callbacks stay connected.
     */
    private fun rebuildMediaSession() {
        mediaSession?.let { session ->
            val exoPlayer = session.player
            playerListener?.let { exoPlayer.removeListener(it) }
            playerListener = null
            session.release()
            mediaSession = MediaSession.Builder(this, exoPlayer)
                .setId(MEDIA_SESSION_ID)
                .setCallback(MediaSessionCallback())
                .build()
            attachPlayerListener(exoPlayer)
        }
    }

    /**
     * Attaches the state-tracking player listener to the given ExoPlayer instance.
     * Extracted so both onCreate() and rebuildMediaSession() use the same path.
     */
    private fun attachPlayerListener(player: Player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                isCurrentlyPlaying = isPlaying
                updateNotification()
                logDspState()
            }

            override fun onMediaItemTransition(
                mediaItem: androidx.media3.common.MediaItem?,
                reason: Int
            ) {
                updateNotification()
                logDspState()
            }

            override fun onPlaybackStateChanged(state: Int) {
                updateNotification()
            }
        }
        playerListener = listener
        player.addListener(listener)
    }

    /**
     * Safely tears down the MediaSession and its player listener.
     * Idempotent — safe to call from both the onCreate() guard and onDestroy().
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

    /**
     * If stopForegroundGracePeriodMs > 0, schedule demotion from foreground after the
     * configured delay when playback is paused. Cancelled if playback resumes first.
     */
    private fun scheduleStopForegroundIfNeeded() {
        if (stopForegroundGracePeriodMs <= 0L) return
        stopForegroundRunnable?.let { mainHandler.removeCallbacks(it) }
        val runnable = Runnable {
            if (!isCurrentlyPlaying) {
                Log.i(TAG, "Grace period elapsed — demoting to background")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_DETACH)
                } else {
                    @Suppress("DEPRECATION")
                    stopForeground(false)
                }
            }
            stopForegroundRunnable = null
        }
        stopForegroundRunnable = runnable
        mainHandler.postDelayed(runnable, stopForegroundGracePeriodMs)
        Log.i(TAG, "Stop foreground scheduled in ${stopForegroundGracePeriodMs}ms")
    }

    /**
     * Updates the notification with current track info and playing state.
     * Also keeps MediaSession metadata in sync so lock-screen / Auto shows
     * the correct title and artwork.
     */
    private fun updateNotification() {
        val notification = buildMediaNotification()
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)

        mediaSession?.let { session ->
            val currentIndex = session.player.currentMediaItemIndex
            if (currentIndex >= 0 && currentIndex < session.player.mediaItemCount) {
                val currentItem = session.player.getMediaItemAt(currentIndex)
                val updatedMetadata = androidx.media3.common.MediaMetadata.Builder()
                    .setTitle(currentTitle)
                    .setArtist(currentArtist)
                    .apply { currentArtworkUri?.let { setArtworkUri(android.net.Uri.parse(it)) } }
                    .build()
                session.player.replaceMediaItem(
                    currentIndex,
                    currentItem.buildUpon().setMediaMetadata(updatedMetadata).build()
                )
            }
        }
    }

    /**
     * Minimal silent notification that satisfies Android's 5-second
     * startForeground() deadline on cold start.
     */
    private fun buildBootNotification(): Notification {
        val launchIntent = packageManager
            .getLaunchIntentForPackage(packageName)
            ?.apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP }

        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(resolveNotificationIcon())
            .setContentTitle("Mavin Player")
            .setContentText("Starting…")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .apply {
                launchIntent?.let {
                    setContentIntent(PendingIntent.getActivity(this@MavinPlaybackService, 0, it, pendingFlags))
                }
                notificationColor?.let { setColor(it) }
            }
            .build()
    }

    /**
     * Builds the full media notification with play/pause controls.
     *
     * Uses activeNotificationCapabilities (not mediaSessionCapabilities) so the
     * notification shade can show a different subset from what's advertised to
     * Bluetooth/Auto controllers — matching RNTP's notificationCapabilities behaviour.
     *
     * FIX: In Media3 1.6.x, getSessionCompatToken() was removed entirely.
     * Use MediaStyleNotificationHelper.MediaStyle(session) which takes the
     * MediaSession object directly — no token conversion needed.
     */
    private fun buildMediaNotification(): Notification {
        val launchIntent = packageManager
            .getLaunchIntentForPackage(packageName)
            ?.apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP }

        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

        val contentIntent = PendingIntent.getActivity(this, 0, launchIntent, pendingFlags)
        val iconResId = resolveNotificationIcon()
        val caps = activeNotificationCapabilities

        val actions = mutableListOf<NotificationCompat.Action>()

        if (caps.contains("skipToPrevious")) {
            actions += NotificationCompat.Action.Builder(
                android.R.drawable.ic_media_previous, "Previous",
                getMediaActionPendingIntent("previous")
            ).build()
        }

        if (caps.contains("jumpBackward")) {
            actions += NotificationCompat.Action.Builder(
                android.R.drawable.ic_media_rew, "-${backwardJumpInterval}s",
                getMediaActionPendingIntent("jumpBackward")
            ).build()
        }

        if (caps.contains("play") || caps.contains("pause")) {
            actions += if (isCurrentlyPlaying) {
                NotificationCompat.Action.Builder(
                    android.R.drawable.ic_media_pause, "Pause",
                    getMediaActionPendingIntent("pause")
                ).build()
            } else {
                NotificationCompat.Action.Builder(
                    android.R.drawable.ic_media_play, "Play",
                    getMediaActionPendingIntent("play")
                ).build()
            }
        }

        if (caps.contains("jumpForward")) {
            actions += NotificationCompat.Action.Builder(
                android.R.drawable.ic_media_ff, "+${forwardJumpInterval}s",
                getMediaActionPendingIntent("jumpForward")
            ).build()
        }

        if (caps.contains("skipToNext")) {
            actions += NotificationCompat.Action.Builder(
                android.R.drawable.ic_media_next, "Next",
                getMediaActionPendingIntent("next")
            ).build()
        }

        if (caps.contains("stop")) {
            actions += NotificationCompat.Action.Builder(
                android.R.drawable.ic_menu_close_clear_cancel, "Stop",
                getMediaActionPendingIntent("stop")
            ).build()
        }

        if (caps.contains("like")) {
            actions += NotificationCompat.Action.Builder(
                android.R.drawable.btn_star_big_on, "Like",
                getMediaActionPendingIntent("like")
            ).build()
        }

        if (caps.contains("dislike")) {
            actions += NotificationCompat.Action.Builder(
                android.R.drawable.btn_star_big_off, "Dislike",
                getMediaActionPendingIntent("dislike")
            ).build()
        }

        val finalCompactIndices = resolveCompactIndices(actions).take(3).toIntArray()

        val builder = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSmallIcon(iconResId)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(isCurrentlyPlaying)
            .setOnlyAlertOnce(true)

        actions.forEach { builder.addAction(it) }

        // FIX: In Media3 1.6.x, getSessionCompatToken() was fully removed.
        // The correct API is MediaStyleNotificationHelper.MediaStyle(session) which
        // accepts the MediaSession object directly — no token conversion required.
        mediaSession?.let { session ->
            builder.setStyle(
                MediaStyleNotificationHelper.MediaStyle(session)
                    .setShowActionsInCompactView(*finalCompactIndices)
            )
        } ?: run {
            // No active session — fall back to legacy MediaStyle without a session token
            builder.setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setShowActionsInCompactView(*finalCompactIndices)
            )
        }

        notificationColor?.let { builder.setColor(it) }
        return builder.build()
    }

    /**
     * Maps compactCapabilities names to actual indices within the provided actions list.
     * Uses label matching so the index is always correct regardless of which capabilities
     * are enabled — prevents out-of-bounds crashes when some caps are disabled.
     */
    private fun resolveCompactIndices(actions: List<NotificationCompat.Action>): List<Int> {
        val labelToIndex = actions.mapIndexed { i, a -> a.title?.toString() to i }.toMap()
        val result = mutableListOf<Int>()
        for (cap in compactCapabilities) {
            val label = when (cap) {
                "skipToPrevious" -> "Previous"
                "skipToNext"     -> "Next"
                "play", "pause"  -> if (isCurrentlyPlaying) "Pause" else "Play"
                "jumpForward"    -> "+${forwardJumpInterval}s"
                "jumpBackward"   -> "-${backwardJumpInterval}s"
                "stop"           -> "Stop"
                "like"           -> "Like"
                "dislike"        -> "Dislike"
                else             -> null
            }
            label?.let { labelToIndex[it]?.let { idx -> result.add(idx) } }
            if (result.size >= 3) break
        }
        return result
    }

    private fun resolveNotificationIcon(): Int =
        notificationIcon
            ?: resources.getIdentifier("notification_icon", "drawable", packageName).takeIf { it != 0 }
            ?: android.R.drawable.ic_media_play

    private fun getMediaActionPendingIntent(action: String): PendingIntent {
        val intent = Intent(this, MavinPlaybackService::class.java).apply {
            putExtra("MEDIA_ACTION", action)
        }
        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        return PendingIntent.getService(this, action.hashCode(), intent, pendingFlags)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        intent?.getStringExtra("MEDIA_ACTION")?.let { handleMediaAction(it) }
        return START_STICKY
    }

    /**
     * Handles notification button taps.
     * FIX: Now fires the JS remote event callbacks (onRemotePlay, onRemotePause,
     * onRemoteNext, onRemotePrevious) that were missing — RN listeners
     * on "remote-play" / "onRemotePlay" etc. now receive these events.
     */
    private fun handleMediaAction(action: String) {
        val p = MavinPlayerModule.playerInstance ?: return
        when (action) {
            "play" -> {
                p.play()
                updatePlayingState(true)
                p.onRemotePlay?.invoke()          // FIX: was missing
            }
            "pause" -> {
                p.pause()
                updatePlayingState(false)
                p.onRemotePause?.invoke()         // FIX: was missing
            }
            "stop" -> {
                p.stop()
                updatePlayingState(false)
                p.onRemoteStop?.invoke()
            }
            "next" -> {
                p.skipToNext()
                p.onRemoteNext?.invoke()          // FIX: was missing
            }
            "previous" -> {
                p.skipToPrevious()
                p.onRemotePrevious?.invoke()      // FIX: was missing
            }
            "jumpForward" -> {
                val newPos = (p.getCurrentPosition() + forwardJumpInterval * 1000L)
                    .coerceIn(0L, p.getDuration())
                p.seekTo(newPos)
                p.onRemoteJumpForward?.invoke(forwardJumpInterval.toDouble())
            }
            "jumpBackward" -> {
                val newPos = (p.getCurrentPosition() - backwardJumpInterval * 1000L)
                    .coerceIn(0L, p.getDuration())
                p.seekTo(newPos)
                p.onRemoteJumpBackward?.invoke(backwardJumpInterval.toDouble())
            }
            "like" -> {
                p.onRemoteSetRating?.invoke(1.0f)
                p.onRemoteLike?.invoke()
            }
            "dislike" -> {
                p.onRemoteSetRating?.invoke(0.0f)
                p.onRemoteDislike?.invoke()
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // NOTIFICATION CHANNEL
    // ─────────────────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Mavin Player",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Background audio with EQ, Compressor, Crossfeed, Convolution, USB DAC"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // DSP STATE LOG
    // ─────────────────────────────────────────────────────────────────────

    private fun logDspState() {
        val p = MavinPlayerModule.playerInstance ?: return
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
                "64bit=${p.is64BitProcessingEnabled()}")
    }

    // ─────────────────────────────────────────────────────────────────────
    // MEDIA SESSION CALLBACK — full DSP command surface + RNTP parity
    // ─────────────────────────────────────────────────────────────────────

    private inner class MediaSessionCallback : MediaSession.Callback {

        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo
        ): MediaSession.ConnectionResult {
            val sessionCommandsBuilder = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS
                .buildUpon()

            // Gate RNTP commands on mediaSessionCapabilities
            if (mediaSessionCapabilities.contains("like"))
                sessionCommandsBuilder.add(SessionCommand(COMMAND_LIKE, Bundle.EMPTY))
            if (mediaSessionCapabilities.contains("dislike"))
                sessionCommandsBuilder.add(SessionCommand(COMMAND_DISLIKE, Bundle.EMPTY))
            if (mediaSessionCapabilities.contains("bookmark"))
                sessionCommandsBuilder.add(SessionCommand(COMMAND_BOOKMARK, Bundle.EMPTY))
            if (mediaSessionCapabilities.contains("jumpForward"))
                sessionCommandsBuilder.add(SessionCommand(COMMAND_JUMP_FORWARD, Bundle.EMPTY))
            if (mediaSessionCapabilities.contains("jumpBackward"))
                sessionCommandsBuilder.add(SessionCommand(COMMAND_JUMP_BACKWARD, Bundle.EMPTY))

            // Mavin DSP commands always available
            sessionCommandsBuilder
                .add(SessionCommand(COMMAND_TOGGLE_EQ, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_RESET_EQ, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_MODE, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_NEXT_PRESET, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_PREV_PRESET, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_APPLY_PRESET, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_RG_TOGGLE, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_COMPRESSOR, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_INCREASE_COMPRESSION, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_DECREASE_COMPRESSION, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_CROSSFEED, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_SPEED_UP, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_SLOW_DOWN, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_RESET_SPEED, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_CROSSFADE, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_INCREASE_CROSSFADE, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_DECREASE_CROSSFADE, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_OFFLINE, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_64BIT, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_CONVOLUTION, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_USB_DIRECT, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_TOGGLE_FX, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_CYCLE_FX_MODE, Bundle.EMPTY))

            val sessionCommands = sessionCommandsBuilder.build()

            // Custom command buttons for Android Auto / System UI
            val commandButtons = mutableListOf<CommandButton>()

            if (mediaSessionCapabilities.contains("like")) {
                commandButtons += CommandButton.Builder(CommandButton.ICON_HEART_UNFILLED)
                    .setDisplayName("Like")
                    .setSessionCommand(SessionCommand(COMMAND_LIKE, Bundle.EMPTY))
                    .build()
            }
            if (mediaSessionCapabilities.contains("dislike")) {
                commandButtons += CommandButton.Builder(CommandButton.ICON_THUMB_DOWN_UNFILLED)
                    .setDisplayName("Dislike")
                    .setSessionCommand(SessionCommand(COMMAND_DISLIKE, Bundle.EMPTY))
                    .build()
            }
            if (mediaSessionCapabilities.contains("bookmark")) {
                commandButtons += CommandButton.Builder(CommandButton.ICON_BOOKMARK_UNFILLED)
                    .setDisplayName("Bookmark")
                    .setSessionCommand(SessionCommand(COMMAND_BOOKMARK, Bundle.EMPTY))
                    .build()
            }

            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(sessionCommands)
                .setCustomLayout(ImmutableList.copyOf(commandButtons))
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

                // ─────────────────────────────────────────────────────────
                // RNTP Parity Commands
                // ─────────────────────────────────────────────────────────
                COMMAND_LIKE -> {
                    p?.onRemoteSetRating?.invoke(1.0f)
                    p?.onRemoteLike?.invoke()
                    Log.i(TAG, "Like command received")
                }
                COMMAND_DISLIKE -> {
                    p?.onRemoteSetRating?.invoke(0.0f)
                    p?.onRemoteDislike?.invoke()
                    Log.i(TAG, "Dislike command received")
                }
                COMMAND_BOOKMARK -> {
                    p?.onRemoteBookmark?.invoke()
                    Log.i(TAG, "Bookmark command received")
                }
                COMMAND_JUMP_FORWARD -> {
                    val cur = p?.getCurrentPosition() ?: 0L
                    val dur = p?.getDuration() ?: Long.MAX_VALUE
                    p?.seekTo((cur + forwardJumpInterval * 1000L).coerceIn(0L, dur))
                    p?.onRemoteJumpForward?.invoke(forwardJumpInterval.toDouble())
                    Log.i(TAG, "Jump forward ${forwardJumpInterval}s")
                }
                COMMAND_JUMP_BACKWARD -> {
                    val cur = p?.getCurrentPosition() ?: 0L
                    val dur = p?.getDuration() ?: Long.MAX_VALUE
                    p?.seekTo((cur - backwardJumpInterval * 1000L).coerceIn(0L, dur))
                    p?.onRemoteJumpBackward?.invoke(backwardJumpInterval.toDouble())
                    Log.i(TAG, "Jump backward ${backwardJumpInterval}s")
                }

                // ─────────────────────────────────────────────────────────
                // Mavin DSP Commands
                // ─────────────────────────────────────────────────────────
                COMMAND_TOGGLE_EQ -> {
                    val s = !(p?.equalizerProcessor?.isEnabled ?: false)
                    p?.setEQEnabled(s); Log.i(TAG, "EQ → $s")
                }
                COMMAND_RESET_EQ -> {
                    p?.resetEQ(); Log.i(TAG, "EQ reset")
                }
                COMMAND_TOGGLE_MODE -> {
                    val next = when (p?.equalizerProcessor?.getCurrentEqMode()) {
                        EqualizerProcessor.EqMode.GRAPHIC    -> "PARAMETRIC"
                        EqualizerProcessor.EqMode.PARAMETRIC -> "PARALLEL"
                        else                                  -> "GRAPHIC"
                    }
                    p?.setEQMode(next); Log.i(TAG, "EQ mode → $next")
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
                        p?.applyPresetByName(name); Log.i(TAG, "Applied preset: $name")
                    }
                }
                COMMAND_RG_TOGGLE -> {
                    val current = p?.getReplayGainInfo()?.get("mode") as? String ?: "TRACK"
                    val next = when (current) { "TRACK" -> "ALBUM"; "ALBUM" -> "OFF"; else -> "TRACK" }
                    p?.setReplayGainMode(next); Log.i(TAG, "ReplayGain → $next")
                }
                COMMAND_TOGGLE_COMPRESSOR -> {
                    val s = !(p?.isCompressorEnabled() ?: false)
                    p?.setCompressorEnabled(s); Log.i(TAG, "Compressor → $s")
                }
                COMMAND_INCREASE_COMPRESSION -> {
                    val r = ((p?.getCompressorRatio() ?: 4.0) + 1.0).coerceAtMost(20.0)
                    p?.setCompressorRatio(r); Log.i(TAG, "Ratio → $r")
                }
                COMMAND_DECREASE_COMPRESSION -> {
                    val r = ((p?.getCompressorRatio() ?: 4.0) - 1.0).coerceAtLeast(1.0)
                    p?.setCompressorRatio(r); Log.i(TAG, "Ratio → $r")
                }
                COMMAND_TOGGLE_CROSSFEED -> {
                    val s = !(p?.isCrossfeedEnabled() ?: false)
                    p?.setCrossfeedEnabled(s); Log.i(TAG, "Crossfeed → $s")
                }
                COMMAND_SPEED_UP -> {
                    val s = ((p?.getPlaybackSpeed() ?: 1f) + 0.1f).coerceAtMost(3f)
                    p?.setPlaybackSpeed(s); Log.i(TAG, "Speed → $s")
                }
                COMMAND_SLOW_DOWN -> {
                    val s = ((p?.getPlaybackSpeed() ?: 1f) - 0.1f).coerceAtLeast(0.5f)
                    p?.setPlaybackSpeed(s); Log.i(TAG, "Speed → $s")
                }
                COMMAND_RESET_SPEED -> {
                    p?.setPlaybackSpeed(1f); Log.i(TAG, "Speed reset")
                }
                COMMAND_TOGGLE_CROSSFADE -> {
                    val s = !(p?.isCrossfadeEnabled() ?: false)
                    p?.setCrossfadeEnabled(s); Log.i(TAG, "Crossfade → $s")
                }
                COMMAND_INCREASE_CROSSFADE -> {
                    val d = ((p?.getCrossfadeDurationMs() ?: 2000L) + 500L).coerceAtMost(10_000L)
                    p?.setCrossfadeDurationMs(d); Log.i(TAG, "Crossfade → $d")
                }
                COMMAND_DECREASE_CROSSFADE -> {
                    val d = ((p?.getCrossfadeDurationMs() ?: 2000L) - 500L).coerceAtLeast(500L)
                    p?.setCrossfadeDurationMs(d); Log.i(TAG, "Crossfade → $d")
                }
                COMMAND_TOGGLE_OFFLINE -> {
                    val s = !(p?.isOfflineMode() ?: false)
                    p?.setOfflineMode(s); Log.i(TAG, "Offline → $s")
                }
                COMMAND_TOGGLE_64BIT -> {
                    val s = !(p?.is64BitProcessingEnabled() ?: false)
                    p?.set64BitProcessingEnabled(s); Log.i(TAG, "64-bit → $s")
                }
                COMMAND_TOGGLE_CONVOLUTION -> {
                    val s = !(p?.isConvolutionEnabled() ?: false)
                    p?.setConvolutionEnabled(s); Log.i(TAG, "Convolution → $s")
                }
                COMMAND_TOGGLE_USB_DIRECT -> {
                    val s = !(p?.isDirectUsbRoutingEnabled() ?: false)
                    p?.enableDirectUsbRouting(s); Log.i(TAG, "USB direct → $s")
                }
                COMMAND_TOGGLE_FX -> {
                    val s = !(p?.isFxEnabled() ?: false)
                    p?.setFxEnabled(s); Log.i(TAG, "FX → $s")
                }
                COMMAND_CYCLE_FX_MODE -> {
                    val next = when (p?.getFxMode()) {
                        "REVERB"  -> "DELAY";  "DELAY"   -> "CHORUS"
                        "CHORUS"  -> "FLANGER"; "FLANGER" -> "PHASER"
                        else -> "REVERB"
                    }
                    p?.setFxMode(next); Log.i(TAG, "FX mode → $next")
                }
                else -> return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
            }

            logDspState()
            return ok()
        }

        /**
         * FIX: ThumbRating.isThumb does not exist in Media3 1.6.1.
         * The correct property per the official Media3 release API is isThumbsUp() (with 's').
         */
        override fun onSetRating(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            rating: Rating
        ): ListenableFuture<SessionResult> {
            val ratingValue: Float = when (rating) {
                is HeartRating      -> if (rating.isHeart) 1.0f else 0.0f
                is ThumbRating      -> if (rating.isThumbsUp) 1.0f else 0.0f  // FIX: isThumbsUp
                is PercentageRating -> rating.percent / 100.0f
                is StarRating       -> rating.starRating / rating.maxStars
                else                -> 0.0f
            }
            MavinPlayerModule.playerInstance?.onRemoteSetRating?.invoke(ratingValue)
            Log.i(TAG, "onSetRating: $ratingValue (${rating::class.simpleName})")
            return ok()
        }
    }

    private fun ok() = Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))

    // ─────────────────────────────────────────────────────────────────────
    // PUBLIC API (Android Auto, widgets, external use)
    // ─────────────────────────────────────────────────────────────────────

    fun getFullState(): Map<String, Any?> {
        val p = MavinPlayerModule.playerInstance ?: return emptyMap()
        val eq = p.equalizerProcessor
        return mapOf(
            "enabled"                       to eq.isEnabled,
            "mode"                          to eq.getCurrentEqMode().name,
            "gains"                         to eq.getCurrentGains().toList(),
            "preamp"                        to eq.getCurrentPreamp(),
            "q_values"                      to eq.getCurrentQValues().toList(),
            "parametric_gains"              to eq.getParametricGains().toList(),
            "parametric_freqs"              to eq.getParametricFreqs().toList(),
            "loudness_db"                   to eq.getCurrentLoudnessDb(),
            "dither_mode"                   to eq.getDitherMode().name,
            "compressor_enabled"            to p.isCompressorEnabled(),
            "compressor_threshold"          to p.getCompressorThreshold(),
            "compressor_ratio"              to p.getCompressorRatio(),
            "compressor_attack_ms"          to p.getCompressorAttackMs(),
            "compressor_release_ms"         to p.getCompressorReleaseMs(),
            "compressor_reduction_db"       to p.getCompressorReductionDb(),
            "crossfeed_enabled"             to p.isCrossfeedEnabled(),
            "crossfeed_strength"            to p.getCrossfeedStrength(),
            "crossfeed_cutoff"              to p.getCrossfeedCutoff(),
            "convolution_enabled"           to p.isConvolutionEnabled(),
            "ir_loaded"                     to p.isImpulseResponseLoaded(),
            "ir_length"                     to p.getIrLength(),
            "usb_dac_connected"             to p.isUsbDacConnected(),
            "usb_direct_routing"            to p.isDirectUsbRoutingEnabled(),
            "crossfade_enabled"             to p.isCrossfadeEnabled(),
            "crossfade_duration_ms"         to p.getCrossfadeDurationMs(),
            "offline_mode"                  to p.isOfflineMode(),
            "fx_enabled"                    to p.isFxEnabled(),
            "fx_mode"                       to p.getFxMode(),
            "fx_mix"                        to p.getFxMix(),
            "fx_bypass"                     to p.isFxBypassed(),
            "is_64bit_enabled"              to p.is64BitProcessingEnabled(),
            "playback_speed"                to p.getPlaybackSpeed(),
            "replay_gain"                   to p.getReplayGainInfo(),
            "presets"                       to p.listPresets(),
            "preset_index"                  to presetIndex,
            "mediaSessionCapabilities"      to mediaSessionCapabilities.toList(),
            "notificationCapabilities"      to activeNotificationCapabilities.toList(),
            "compactCapabilities"           to compactCapabilities.toList(),
            "notificationColor"             to notificationColor,
            "notificationIcon"              to notificationIcon,
            "forwardJumpInterval"           to forwardJumpInterval,
            "backwardJumpInterval"          to backwardJumpInterval,
            "ratingType"                    to ratingType
        )
    }

    fun toggleFX(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val s = !p.isFxEnabled(); p.setFxEnabled(s); logDspState(); return s
    }

    fun toggleEQ(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val s = !p.equalizerProcessor.isEnabled; p.setEQEnabled(s); logDspState(); return s
    }

    fun toggleCompressor(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val s = !p.isCompressorEnabled(); p.setCompressorEnabled(s); logDspState(); return s
    }

    fun toggleCrossfeed(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val s = !p.isCrossfeedEnabled(); p.setCrossfeedEnabled(s); logDspState(); return s
    }

    fun toggleConvolution(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val s = !p.isConvolutionEnabled(); p.setConvolutionEnabled(s); logDspState(); return s
    }

    fun toggleCrossfade(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val s = !p.isCrossfadeEnabled(); p.setCrossfadeEnabled(s); logDspState(); return s
    }

    fun toggleOfflineMode(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val s = !p.isOfflineMode(); p.setOfflineMode(s); logDspState(); return s
    }

    fun toggle64BitProcessing(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val s = !p.is64BitProcessingEnabled(); p.set64BitProcessingEnabled(s); logDspState(); return s
    }

    fun toggleUsbDirectRouting(): Boolean {
        val p = MavinPlayerModule.playerInstance ?: return false
        val s = !p.isDirectUsbRoutingEnabled(); p.enableDirectUsbRouting(s); logDspState(); return s
    }

    fun speedUp(): Float {
        val p = MavinPlayerModule.playerInstance ?: return 1f
        val s = (p.getPlaybackSpeed() + 0.1f).coerceAtMost(3f); p.setPlaybackSpeed(s); logDspState(); return s
    }

    fun slowDown(): Float {
        val p = MavinPlayerModule.playerInstance ?: return 1f
        val s = (p.getPlaybackSpeed() - 0.1f).coerceAtLeast(0.5f); p.setPlaybackSpeed(s); logDspState(); return s
    }

    fun resetSpeed(): Float {
        val p = MavinPlayerModule.playerInstance ?: return 1f
        p.setPlaybackSpeed(1f); logDspState(); return 1f
    }

    // ─────────────────────────────────────────────────────────────────────
    // HELPER EXTENSIONS
    // ─────────────────────────────────────────────────────────────────────

    private fun Bundle.toMap(): Map<String, Any?> = keySet().associateWith { key ->
        when (val v = get(key)) {
            is Bundle -> v.toMap()
            else -> v
        }
    }
}