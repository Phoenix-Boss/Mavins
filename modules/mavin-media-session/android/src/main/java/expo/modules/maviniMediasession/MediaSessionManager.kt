// modules/mavin-media-session/android/src/main/kotlin/expo/modules/maviniMediasession/MediaSessionManager.kt
//
// CORRECT APPROACH:
//  • Uses androidx.media (MediaSessionCompat / PlaybackStateCompat /
//    MediaMetadataCompat) for lock-screen + notification controls.
//    This does NOT require an ExoPlayer instance — perfect for apps where
//    expo-audio / expo-av drives actual playback and this module only
//    surfaces metadata + transport controls to the OS.
//  • androidx.media3 is only needed if you embed ExoPlayer; we don't here.
//  • Glide loads artwork asynchronously; Palette extracts the accent color.
//  • NotificationCompat.MediaStyle wires the session token so hardware
//    buttons, Android Auto, Wear OS, and the lock screen all work.
//  • Notification channel created for API 26+, IMPORTANCE_LOW (no sound).
//  • PendingIntent.FLAG_IMMUTABLE on API 23+ (required from API 31).
//  • foreground-service management left to the host app (Expo Bare / EAS).
//
// gradle dependencies needed (add to build.gradle):
//   implementation 'androidx.media:media:1.7.0'
//   implementation 'androidx.core:core-ktx:1.13.1'
//   implementation 'com.github.bumptech.glide:glide:4.16.0'
//   implementation 'androidx.palette:palette-ktx:1.0.0'

package expo.modules.maviniMediasession

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
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
    private const val DEFAULT_COLOR       = 0xFFD4AF37.toInt() // gold fallback
  }

  // ── State ──────────────────────────────────────────────────────────────────
  private val notificationManager =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private var sessionCompat: MediaSessionCompat
  private var currentState    = PlaybackStateCompat.STATE_NONE
  private var currentPosition = PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN
  private var currentSpeed    = 1.0f
  private var currentArtwork: Bitmap? = null
  private var currentTitle   = ""
  private var currentArtist  = ""
  private var currentAlbum   = ""
  private var notifColor     = DEFAULT_COLOR
  private var headlessEnabled = false

  // ── Init ───────────────────────────────────────────────────────────────────
  init {
    createNotificationChannel()

    sessionCompat = MediaSessionCompat(context, SESSION_TAG).apply {
      isActive = true

      setFlags(
        MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
        MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
      )

      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay()           = eventCallback("onPlay",           null)
        override fun onPause()          = eventCallback("onPause",          null)
        override fun onSkipToNext()     = eventCallback("onSkipToNext",     null)
        override fun onSkipToPrevious() = eventCallback("onSkipToPrevious", null)
        override fun onStop()           = eventCallback("onStop",           null)
        override fun onSeekTo(pos: Long) {
          eventCallback("onSeekTo", Bundle().apply { putLong("position", pos) })
        }
      })

      pushPlaybackState(PlaybackStateCompat.STATE_NONE)
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  fun setMetadata(
    title: String,
    artist: String,
    album: String?,
    artworkUrl: String?,
    duration: Long,
    trackId: String,
  ) {
    currentTitle  = title
    currentArtist = artist
    currentAlbum  = album ?: ""

    // Push text metadata immediately — artwork follows async.
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

    if (!artworkUrl.isNullOrEmpty()) {
      Glide.with(context.applicationContext)
        .asBitmap()
        .load(artworkUrl)
        .into(object : CustomTarget<Bitmap>() {
          override fun onResourceReady(bitmap: Bitmap, t: Transition<in Bitmap>?) {
            currentArtwork = bitmap

            // Extract accent color via Palette — priority: vibrant → dominant → lightVibrant
            Palette.from(bitmap).generate { palette ->
              notifColor = (
                palette?.vibrantSwatch?.rgb
                  ?: palette?.dominantSwatch?.rgb
                  ?: palette?.lightVibrantSwatch?.rgb
                  ?: DEFAULT_COLOR
              ) or 0xFF000000.toInt() // ensure fully opaque
            }

            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART,    bitmap)
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, bitmap)
            sessionCompat.setMetadata(builder.build())
            refreshNotification()
          }

          override fun onLoadCleared(placeholder: android.graphics.drawable.Drawable?) {
            currentArtwork = null
            notifColor     = DEFAULT_COLOR
          }
        })
    } else {
      currentArtwork = null
      notifColor     = DEFAULT_COLOR
    }
  }

  fun setPlaybackState(state: String, positionMs: Long, speed: Float) {
    currentState    = when (state) {
      "playing"   -> PlaybackStateCompat.STATE_PLAYING
      "paused"    -> PlaybackStateCompat.STATE_PAUSED
      "buffering" -> PlaybackStateCompat.STATE_BUFFERING
      "stopped"   -> PlaybackStateCompat.STATE_STOPPED
      "error"     -> PlaybackStateCompat.STATE_ERROR
      else        -> PlaybackStateCompat.STATE_NONE
    }
    currentPosition = positionMs
    currentSpeed    = speed

    pushPlaybackState(currentState, positionMs, speed)
    refreshNotification()
  }

  fun updatePosition(positionMs: Long, durationMs: Long) {
    currentPosition = positionMs
    if (currentState != PlaybackStateCompat.STATE_NONE) {
      pushPlaybackState(currentState, positionMs, currentSpeed)
    }
  }

  fun setHeadlessEnabled(enabled: Boolean) {
    headlessEnabled = enabled
  }

  fun release() {
    notificationManager.cancel(NOTIFICATION_ID)
    if (sessionCompat.isActive) {
      sessionCompat.isActive = false
    }
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
      PlaybackStateCompat.ACTION_PLAY             or
      PlaybackStateCompat.ACTION_PAUSE            or
      PlaybackStateCompat.ACTION_PLAY_PAUSE       or
      PlaybackStateCompat.ACTION_SKIP_TO_NEXT     or
      PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
      PlaybackStateCompat.ACTION_SEEK_TO          or
      PlaybackStateCompat.ACTION_STOP

    sessionCompat.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setState(state, positionMs, speed)
        .setActions(actions)
        .build()
    )
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
        description          = "Shows current track and playback controls"
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        enableLights(false)
        enableVibration(false)
        setSound(null, null)
      }.also { notificationManager.createNotificationChannel(it) }
    }
  }

  private fun pendingIntentFlags() =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    else
      PendingIntent.FLAG_UPDATE_CURRENT

  private fun buildLaunchIntent(): PendingIntent {
    val intent = (context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent()).apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP }
    return PendingIntent.getActivity(context, 0, intent, pendingIntentFlags())
  }

  private fun buildMediaAction(action: String): PendingIntent {
    val intent = Intent(action).setPackage(context.packageName)
    return PendingIntent.getBroadcast(context, action.hashCode(), intent, pendingIntentFlags())
  }

  private fun refreshNotification() {
    val isActive = currentState == PlaybackStateCompat.STATE_PLAYING ||
                   currentState == PlaybackStateCompat.STATE_BUFFERING

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(currentTitle)
      .setContentText(currentArtist)
      .setSubText(currentAlbum.takeIf { it.isNotEmpty() })
      .setContentIntent(buildLaunchIntent())
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setOngoing(isActive)
      .setColorized(true)
      .setColor(notifColor)
      // MediaStyle wires hardware buttons, lock screen, Android Auto, Wear OS.
      .setStyle(
        MediaStyle()
          .setMediaSession(sessionCompat.sessionToken)
          .setShowActionsInCompactView(0, 1, 2) // prev, play/pause, next
      )
      .addAction(
        android.R.drawable.ic_media_previous, "Previous",
        buildMediaAction("ACTION_SKIP_PREVIOUS"),
      )
      .addAction(
        if (isActive) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
        if (isActive) "Pause" else "Play",
        buildMediaAction(if (isActive) "ACTION_PAUSE" else "ACTION_PLAY"),
      )
      .addAction(
        android.R.drawable.ic_media_next, "Next",
        buildMediaAction("ACTION_SKIP_NEXT"),
      )
      .apply { currentArtwork?.let { setLargeIcon(it) } }
      .build()

    notificationManager.notify(NOTIFICATION_ID, notification)
  }
}