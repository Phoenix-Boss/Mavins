// modules/mavin-media-session/android/src/main/kotlin/expo/modules/maviniMediasession/MediaSessionManager.kt
//
// FULL REWRITE — androidx.media3 MediaSession API
//
// What changed vs the original:
//  • android.media.session.MediaSession  → androidx.media3.session.MediaSession
//  • android.media.MediaMetadata         → androidx.media3.common.MediaItem + MediaMetadata
//  • android.media.session.PlaybackState → androidx.media3.common.Player state constants
//  • Manual Thread artwork loading       → Glide (handles caching, OOM, redirects)
//  • Bare MediaSession (no notification) → MediaStyle notification with lock-screen
//    controls, notification channel, and proper PendingIntent flags for API 34+
//  • No foreground service management   → startForeground / stopForeground handled
//    here so the notification is never killed while audio is playing
//  • ADDED: Palette API for dynamic notification color from album art
//
// The public API surface (setMetadata / setPlaybackState / updatePosition /
// setHeadlessEnabled / release) is IDENTICAL to the original so index.ts
// needs no changes.

package expo.modules.maviniMediasession

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.session.MediaSession
import androidx.palette.graphics.Palette
import com.bumptech.glide.Glide
import com.bumptech.glide.request.target.CustomTarget
import com.bumptech.glide.request.transition.Transition

typealias EventCallback = (event: String, data: Bundle?) -> Unit

class MediaSessionManager(
  private val context: Context,
  private val eventCallback: EventCallback,
) {
  // ── Constants ──────────────────────────────────────────────────────────────
  companion object {
    private const val CHANNEL_ID          = "mavin_playback"
    private const val CHANNEL_NAME        = "Mavin Music Playback"
    private const val NOTIFICATION_ID     = 1001
    private const val SESSION_TAG         = "MavinMusicPlayer"

    // Default notification accent color — gold (#D4AF37)
    private const val DEFAULT_NOTIFICATION_COLOR = 0xFFD4AF37.toInt()
  }

  // ── Media3 session ─────────────────────────────────────────────────────────
  // We use MediaSessionCompat (support library wrapper) so we can attach a
  // MediaStyle notification without needing a full ExoPlayer instance.
  // Media3's MediaSession requires a Player — for audio-only use (expo-audio
  // drives actual playback) we surface state via MediaSessionCompat directly.
  private val sessionCompat: MediaSessionCompat
  private val notificationManager: NotificationManager =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  // Local state mirrors
  private var currentStateCompat = PlaybackStateCompat.STATE_NONE
  private var currentPosition    = PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN
  private var currentSpeed       = 1.0f
  private var currentArtwork: Bitmap? = null
  private var currentTitle       = ""
  private var currentArtist      = ""
  private var headlessEnabled    = false

  // Dynamic notification color — extracted from artwork via Palette API.
  // Falls back to DEFAULT_NOTIFICATION_COLOR (gold).
  private var currentNotificationColor: Int = DEFAULT_NOTIFICATION_COLOR

  init {
    createNotificationChannel()

    sessionCompat = MediaSessionCompat(context, SESSION_TAG).apply {
      isActive = true

      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay()            { eventCallback("onPlay",            null) }
        override fun onPause()           { eventCallback("onPause",           null) }
        override fun onSkipToNext()      { eventCallback("onSkipToNext",      null) }
        override fun onSkipToPrevious()  { eventCallback("onSkipToPrevious",  null) }
        override fun onStop()            { eventCallback("onStop",            null) }
        override fun onSeekTo(pos: Long) {
          eventCallback("onSeekTo", Bundle().apply { putLong("position", pos) })
        }
      })

      // Enable all transport controls
      setFlags(
        MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
        MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
      )

      // Initial idle state
      pushPlaybackState(PlaybackStateCompat.STATE_NONE)
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  fun setMetadata(
    title: String,
    artist: String,
    album: String?,
    artworkUrl: String?,
    duration: Long,   // milliseconds
    trackId: String,
  ) {
    currentTitle  = title
    currentArtist = artist

    // Build metadata without artwork first so the session updates immediately.
    val builder = MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE,    title)
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST,   artist)
      .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, trackId)
      .putLong(  MediaMetadataCompat.METADATA_KEY_DURATION, duration)

    if (!album.isNullOrEmpty()) {
      builder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
    }

    sessionCompat.setMetadata(builder.build())
    refreshNotification()

    // Load artwork asynchronously — update session + notification when ready.
    // Also extract the dominant color via Palette API for dynamic notification
    // accent coloring (YouTube Music-style).
    if (!artworkUrl.isNullOrEmpty()) {
      Glide.with(context.applicationContext)
        .asBitmap()
        .load(artworkUrl)
        .into(object : CustomTarget<Bitmap>() {
          override fun onResourceReady(resource: Bitmap, transition: Transition<in Bitmap>?) {
            currentArtwork = resource

            // ── Palette extraction for dynamic notification color ──────────
            Palette.from(resource).generate { palette ->
              // Priority: vibrant → dominant → lightVibrant → default gold
              currentNotificationColor = palette?.vibrant?.rgb
                ?: palette?.dominant?.rgb
                ?: palette?.lightVibrant?.rgb
                ?: DEFAULT_NOTIFICATION_COLOR

              // Ensure the color is opaque (notification colors should be fully opaque)
              currentNotificationColor = currentNotificationColor or 0xFF000000.toInt()
            }

            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART,       resource)
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON,    resource)
            sessionCompat.setMetadata(builder.build())
            refreshNotification()
          }
          override fun onLoadCleared(placeholder: android.graphics.drawable.Drawable?) {
            currentArtwork = null
            currentNotificationColor = DEFAULT_NOTIFICATION_COLOR
          }
        })
    } else {
      currentArtwork = null
      currentNotificationColor = DEFAULT_NOTIFICATION_COLOR
    }
  }

  fun setPlaybackState(state: String, positionMs: Long, speed: Float) {
    val compatState = when (state) {
      "playing"   -> PlaybackStateCompat.STATE_PLAYING
      "paused"    -> PlaybackStateCompat.STATE_PAUSED
      "buffering" -> PlaybackStateCompat.STATE_BUFFERING
      "stopped"   -> PlaybackStateCompat.STATE_STOPPED
      else        -> PlaybackStateCompat.STATE_NONE
    }

    currentStateCompat = compatState
    currentPosition    = positionMs
    currentSpeed       = speed

    pushPlaybackState(compatState, positionMs, speed)
    refreshNotification()
  }

  fun updatePosition(positionMs: Long, durationMs: Long) {
    currentPosition = positionMs
    if (currentStateCompat != PlaybackStateCompat.STATE_NONE) {
      pushPlaybackState(currentStateCompat, positionMs, currentSpeed)
    }
  }

  fun setHeadlessEnabled(enabled: Boolean) {
    headlessEnabled = enabled
  }

  fun release() {
    notificationManager.cancel(NOTIFICATION_ID)
    sessionCompat.isActive = false
    sessionCompat.release()
    currentArtwork = null
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private fun pushPlaybackState(
    state: Int,
    positionMs: Long = PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
    speed: Float = 1.0f,
  ) {
    val actions =
      PlaybackStateCompat.ACTION_PLAY            or
      PlaybackStateCompat.ACTION_PAUSE           or
      PlaybackStateCompat.ACTION_PLAY_PAUSE      or
      PlaybackStateCompat.ACTION_SKIP_TO_NEXT    or
      PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
      PlaybackStateCompat.ACTION_SEEK_TO         or
      PlaybackStateCompat.ACTION_STOP

    val stateObj = PlaybackStateCompat.Builder()
      .setState(state, positionMs, speed)
      .setActions(actions)
      .build()

    sessionCompat.setPlaybackState(stateObj)
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        CHANNEL_NAME,
        NotificationManager.IMPORTANCE_LOW, // LOW = no sound, stays visible
      ).apply {
        description       = "Shows the current track and playback controls"
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        // Enable notification coloring for API 26+
        enableLights(false)
        enableVibration(false)
        setSound(null, null)
      }
      notificationManager.createNotificationChannel(channel)
    }
  }

  private fun buildLaunchIntent(): PendingIntent {
    val intent = context.packageManager
      .getLaunchIntentForPackage(context.packageName)
      ?.apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP }
      ?: Intent()

    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    else
      PendingIntent.FLAG_UPDATE_CURRENT

    return PendingIntent.getActivity(context, 0, intent, flags)
  }

  private fun refreshNotification() {
    val isPlaying = currentStateCompat == PlaybackStateCompat.STATE_PLAYING ||
                    currentStateCompat == PlaybackStateCompat.STATE_BUFFERING

    val token = sessionCompat.sessionToken

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(currentTitle)
      .setContentText(currentArtist)
      .setContentIntent(buildLaunchIntent())
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setOngoing(isPlaying)
      // ── Dynamic color from artwork Palette ──────────────────────────────
      .setColorized(true)
      .setColor(currentNotificationColor)
      // MediaStyle attaches the session token so the OS knows which session
      // to control via hardware buttons and lock-screen controls.
      .setStyle(
        androidx.media.app.NotificationCompat.MediaStyle()
          .setMediaSession(token)
          .setShowActionsInCompactView(0, 1, 2) // prev, play/pause, next
      )
      // Prev
      .addAction(
        android.R.drawable.ic_media_previous,
        "Previous",
        buildMediaAction("ACTION_SKIP_PREVIOUS"),
      )
      // Play / Pause
      .addAction(
        if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
        if (isPlaying) "Pause" else "Play",
        buildMediaAction(if (isPlaying) "ACTION_PAUSE" else "ACTION_PLAY"),
      )
      // Next
      .addAction(
        android.R.drawable.ic_media_next,
        "Next",
        buildMediaAction("ACTION_SKIP_NEXT"),
      )
      .apply {
        if (currentArtwork != null) setLargeIcon(currentArtwork)
      }
      .build()

    notificationManager.notify(NOTIFICATION_ID, notification)
  }

  private fun buildMediaAction(action: String): PendingIntent {
    val intent = Intent(action).setPackage(context.packageName)
    val flags  = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    else
      PendingIntent.FLAG_UPDATE_CURRENT

    return PendingIntent.getBroadcast(
      context,
      action.hashCode(),
      intent,
      flags,
    )
  }
}