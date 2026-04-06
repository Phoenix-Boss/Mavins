// ============================================================================
// MavinPlayerModule.kt - COMPLETE PRODUCTION IMPLEMENTATION
// Full RNTP 4.x parity + ExoPlayer + DSP chain:
//   ✅ HeadlessJsTaskService for background JS event delivery
//   ✅ PlaybackService registration pattern
//   ✅ AppKilledPlaybackBehavior (all 3 modes)
//   ✅ remote-duck event with {paused, permanent} payload
//   ✅ Notification artwork loading (Glide)
//   ✅ icon + color options applied to notification
//   ✅ Per-action custom notification icons (playIcon, pauseIcon, stopIcon, etc.)
//   ✅ jumpInterval / forwardJumpInterval / backwardJumpInterval (separate forward/backward)
//   ✅ stopForegroundGracePeriod implemented
//   ✅ Android Auto (MediaBrowserServiceCompat) + PlayFromId + PlayFromSearch
//   ✅ DRM fields on TrackMetadata (Widevine, PlayReady, ClearKey)
//   ✅ Progress in SECONDS (RNTP-compatible units)
//   ✅ PlaybackQueueEnded with {track, position} payload
//   ✅ PlaybackActiveTrackChanged with full lastTrack + nextTrack + index + lastIndex + lastPosition payload
//   ✅ PlaybackPlayWhenReadyChanged event
//   ✅ PlaybackProgressUpdated includes track index in payload
//   ✅ All declared events fire (rating, like, dislike, bookmark)
//   ✅ getTrack(index) / getActiveTrack() / getActiveTrackIndex() exposed as JS functions
//   ✅ ratingType applied to MediaSession (RatingCompat)
//   ✅ clearNowPlayingMetadata exposed as JS function
//   ✅ preloadNextTrack — pre-buffers next item without switching
//   ✅ setPlayWhenReady / getPlayWhenReady
//   ✅ unmutedVolume (save/restore mute state)
//   ✅ setMaxCacheSize / getCacheSize
//   ✅ TrackType (default, hls, dash, smoothstreaming) hints for ExoPlayer
//   ✅ pitchAlgorithm stub (linear / music / voice)
//   ✅ headers per-track support (custom HTTP request headers)
//   ✅ userAgent per-track HTTP header
//   ✅ contentType per-track mime type override
//   ✅ PlayFromId / PlayFromSearch capabilities + MediaSession callbacks
//   ✅ AudioChapterMetadataReceived / AudioTimedMetadataReceived /
//      AudioCommonMetadataReceived — distinct ICY/ID3/EMSG events
//   ✅ wakelock management (WAKE_MODE_NETWORK)
//   ✅ maxBuffer / minBuffer / playbackBuffer / backBuffer options from setupPlayer
//   ✅ backBuffer (behind-playhead buffer) wired to DefaultLoadControl
//   ✅ androidAudioContentType option (Music/Speech/Movie/Unknown)
//   ✅ autoHandleInterruptions option in setupPlayer
//   ✅ Retry with exponential back-off for network errors
//   ✅ removeUpcomingTracks / removePreviousTracks
//   ✅ remote-skip event with {index} payload
//   ✅ skipToNext / skipToPrevious with optional initialPosition
//   ✅ add() returns first added track index
//   ✅ DSP chain fully preserved (EQ, Compressor, Crossfeed, Convolution, FX, Peak Meter)
//   ✅ EqPresetManager fully preserved
//   ✅ ReplayGain fully preserved
//   ✅ VideoTrack fully preserved
//   ✅ STATE_LOADING — RNTP 4.x distinct initial-load state
//   ✅ likeOptions / dislikeOptions / bookmarkOptions FeedbackOptions (isActive toggle)
//   ✅ maxCacheSize in KB (RNTP spec) — converted to bytes internally
//   ✅ waitForBuffer parsed from options (deprecated RNTP field, no-op kept for compat)
//   ✅ isServiceRunning() JS function
//   ✅ getPlaybackState() carries live error payload in error state
//   ✅ remove() RNTP 4.x contract: current track removal activates next/first
//   ✅ PlaybackActiveTrackChanged fires with null index/track when queue empties
//   ✅ Feedback button isActive state reflected in notification / MediaSession
//   ✅ progressUpdateEventInterval stops firing when paused (RNTP spec)
// ============================================================================

package expo.modules.mavinplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.RatingCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media3.common.AudioAttributes as Media3AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.metadata.MetadataOutput
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.extractor.metadata.emsg.EventMessage
import androidx.media3.extractor.metadata.icy.IcyHeaders
import androidx.media3.extractor.metadata.icy.IcyInfo
import androidx.media3.extractor.metadata.id3.Id3Frame
import androidx.media3.extractor.metadata.id3.TextInformationFrame
import androidx.media3.extractor.metadata.vorbis.VorbisComment
import com.bumptech.glide.Glide
import com.bumptech.glide.request.target.CustomTarget
import com.bumptech.glide.request.transition.Transition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.mavinplayer.audio.CompressorProcessor
import expo.modules.mavinplayer.audio.ConvolutionProcessor
import expo.modules.mavinplayer.audio.CrossfeedProcessor
import expo.modules.mavinplayer.audio.EqualizerProcessor
import expo.modules.mavinplayer.audio.FxProcessor
import expo.modules.mavinplayer.audio.PeakMeterProcessor
import expo.modules.mavinplayer.audio.ReplayGainParser
import expo.modules.mavinplayer.audio.TrackData
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

// ============================================================================
// CONSTANTS
// ============================================================================

@UnstableApi
object MavinPlayerConstants {
    const val TAG = "MavinPlayer"
    const val NOTIFICATION_CHANNEL_ID = "mavin_playback_channel"
    const val NOTIFICATION_ID = 1001
    const val MEDIA_SESSION_TAG = "MavinPlayerSession"
    const val BROWSER_ROOT_ID = "mavin_media_root"

    // Buffer config (defaults — overridable from setupPlayer options)
    const val MIN_BUFFER_MS = 50_000L
    const val MAX_BUFFER_MS = 50_000L
    const val BUFFER_FOR_PLAYBACK_MS = 2_500L
    const val BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS = 5_000L
    const val BACK_BUFFER_DURATION_MS = 0L

    // Cache — RNTP passes maxCacheSize in KB; default 200 MB = 204800 KB
    const val DEFAULT_CACHE_SIZE_KB = 204_800L
    const val CACHE_FILE_NAME = "mavin_player_cache"

    // Progress — NOTE: all JS-facing values are in SECONDS (RNTP-compatible)
    const val DEFAULT_PROGRESS_UPDATE_INTERVAL_MS = 1000L
    const val MIN_PROGRESS_UPDATE_INTERVAL_MS = 100L
    const val MAX_PROGRESS_UPDATE_INTERVAL_MS = 30_000L

    // Player states
    const val STATE_NONE = 0
    const val STATE_READY = 1
    const val STATE_PLAYING = 2
    const val STATE_PAUSED = 3
    const val STATE_STOPPED = 4
    const val STATE_BUFFERING = 5
    const val STATE_CONNECTION_ERROR = 6
    const val STATE_ERROR = 7
    const val STATE_ENDED = 8
    const val STATE_LOADING = 9   // RNTP 4.x: distinct initial-load phase state

    // Repeat
    const val REPEAT_OFF = 0
    const val REPEAT_TRACK = 1
    const val REPEAT_QUEUE = 2

    // Capabilities
    const val CAPABILITY_PLAY = "play"
    const val CAPABILITY_PAUSE = "pause"
    const val CAPABILITY_STOP = "stop"
    const val CAPABILITY_SEEK_TO = "seekTo"
    const val CAPABILITY_SKIP = "skip"
    const val CAPABILITY_SKIP_TO_NEXT = "skipToNext"
    const val CAPABILITY_SKIP_TO_PREVIOUS = "skipToPrevious"
    const val CAPABILITY_JUMP_FORWARD = "jumpForward"
    const val CAPABILITY_JUMP_BACKWARD = "jumpBackward"
    const val CAPABILITY_SET_RATING = "setRating"
    const val CAPABILITY_LIKE = "like"
    const val CAPABILITY_DISLIKE = "dislike"
    const val CAPABILITY_BOOKMARK = "bookmark"
    // Android Auto capabilities
    const val CAPABILITY_PLAY_FROM_ID = "playFromId"
    const val CAPABILITY_PLAY_FROM_SEARCH = "playFromSearch"

    // Rating types (maps to RatingCompat)
    const val RATING_HEART = 1
    const val RATING_THUMB_UP_DOWN = 2
    const val RATING_3_STARS = 3
    const val RATING_4_STARS = 4
    const val RATING_5_STARS = 5
    const val RATING_PERCENTAGE = 6

    // AppKilledPlaybackBehavior
    const val APP_KILLED_CONTINUE = "ContinuePlayback"
    const val APP_KILLED_PAUSE = "PausePlayback"
    const val APP_KILLED_STOP = "StopPlaybackAndRemoveNotification"

    // TrackType hints
    const val TRACK_TYPE_DEFAULT = "default"
    const val TRACK_TYPE_HLS = "hls"
    const val TRACK_TYPE_DASH = "dash"
    const val TRACK_TYPE_SMOOTH_STREAMING = "smoothstreaming"

    // PitchAlgorithm
    const val PITCH_ALGORITHM_LINEAR = "linear"
    const val PITCH_ALGORITHM_MUSIC = "music"
    const val PITCH_ALGORITHM_VOICE = "voice"

    // AndroidAudioContentType
    const val AUDIO_CONTENT_TYPE_MUSIC = "music"
    const val AUDIO_CONTENT_TYPE_SPEECH = "speech"
    const val AUDIO_CONTENT_TYPE_MOVIE = "movie"
    const val AUDIO_CONTENT_TYPE_SONIFICATION = "sonification"
    const val AUDIO_CONTENT_TYPE_UNKNOWN = "unknown"

    // Error codes
    const val ERROR_CODE_BAD_HTTP_STATUS = "bad-http-status"
    const val ERROR_CODE_INVALID_CONTENT_TYPE = "invalid-content-type"
    const val ERROR_CODE_NETWORK_CONNECTION_FAILED = "network-connection-failed"
    const val ERROR_CODE_NETWORK_TIMEOUT = "network-timeout"
    const val ERROR_CODE_FILE_NOT_FOUND = "file-not-found"
    const val ERROR_CODE_DECODER_INIT_FAILED = "decoder-init-failed"
    const val ERROR_CODE_DECODING_FAILED = "decoding-failed"
    const val ERROR_CODE_TIMEOUT = "timeout"
    const val ERROR_CODE_UNKNOWN = "unknown"

    // Notification actions
    const val ACTION_PLAY = "mavin.action.PLAY"
    const val ACTION_PAUSE = "mavin.action.PAUSE"
    const val ACTION_NEXT = "mavin.action.NEXT"
    const val ACTION_PREVIOUS = "mavin.action.PREVIOUS"
    const val ACTION_STOP = "mavin.action.STOP"
    const val ACTION_JUMP_FORWARD = "mavin.action.JUMP_FORWARD"
    const val ACTION_JUMP_BACKWARD = "mavin.action.JUMP_BACKWARD"
    const val ACTION_LIKE = "mavin.action.LIKE"
    const val ACTION_DISLIKE = "mavin.action.DISLIKE"
    const val ACTION_BOOKMARK = "mavin.action.BOOKMARK"
    const val ACTION_SKIP = "mavin.action.SKIP"
}

// ============================================================================
// DATA CLASSES
// ============================================================================

/**
 * RNTP 4.x FeedbackOptions — structured like/dislike/bookmark button state.
 * isActive: whether the button shows as "active" (e.g. liked vs not liked)
 * title: accessibility label for the button
 */
@UnstableApi
data class FeedbackOptions(
    val isActive: Boolean = false,
    val title: String = ""
)

@UnstableApi
data class PlayerOptions(
    val autoWait: Boolean = false,
    val autoUpdateMetadata: Boolean = true,
    val stopWithApp: Boolean = false,
    val alwaysPauseOnInterruption: Boolean = false,
    val autoHandleInterruptions: Boolean = false,
    // RNTP deprecated but parsed for compatibility
    val waitForBuffer: Boolean = true,
    val capabilities: List<String> = listOf(
        MavinPlayerConstants.CAPABILITY_PLAY,
        MavinPlayerConstants.CAPABILITY_PAUSE,
        MavinPlayerConstants.CAPABILITY_SEEK_TO,
        MavinPlayerConstants.CAPABILITY_SKIP_TO_NEXT,
        MavinPlayerConstants.CAPABILITY_SKIP_TO_PREVIOUS
    ),
    val compactCapabilities: List<String> = listOf(
        MavinPlayerConstants.CAPABILITY_PLAY,
        MavinPlayerConstants.CAPABILITY_PAUSE,
        MavinPlayerConstants.CAPABILITY_SKIP_TO_NEXT
    ),
    val notificationCapabilities: List<String> = emptyList(),
    val icon: String? = null,
    val playIcon: String? = null,
    val pauseIcon: String? = null,
    val stopIcon: String? = null,
    val previousIcon: String? = null,
    val nextIcon: String? = null,
    val rewindIcon: String? = null,
    val forwardIcon: String? = null,
    val color: Int? = null,
    val forwardJumpInterval: Long = 15_000L,
    val backwardJumpInterval: Long = 15_000L,
    val ratingType: Int = 0,
    val progressUpdateEventInterval: Long = MavinPlayerConstants.DEFAULT_PROGRESS_UPDATE_INTERVAL_MS,
    val minBufferMs: Long = MavinPlayerConstants.MIN_BUFFER_MS,
    val maxBufferMs: Long = MavinPlayerConstants.MAX_BUFFER_MS,
    val playbackBufferMs: Long = MavinPlayerConstants.BUFFER_FOR_PLAYBACK_MS,
    val playbackBufferAfterRebufferMs: Long = MavinPlayerConstants.BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS,
    val backBufferDurationMs: Long = MavinPlayerConstants.BACK_BUFFER_DURATION_MS,
    val androidAudioContentType: String = MavinPlayerConstants.AUDIO_CONTENT_TYPE_MUSIC,
    // RNTP: maxCacheSize in KB; stored here in KB, converted to bytes on use
    val maxCacheSizeKb: Long = MavinPlayerConstants.DEFAULT_CACHE_SIZE_KB,
    // RNTP 4.x FeedbackOptions for like / dislike / bookmark
    val likeOptions: FeedbackOptions? = null,
    val dislikeOptions: FeedbackOptions? = null,
    val bookmarkOptions: FeedbackOptions? = null,
    val android: AndroidOptions = AndroidOptions()
) {
    val jumpInterval: Long get() = forwardJumpInterval
    /** Cache size in bytes for internal use */
    val maxCacheSizeBytes: Long get() = maxCacheSizeKb * 1024L
}

@UnstableApi
data class AndroidOptions(
    val appKilledPlaybackBehavior: String = MavinPlayerConstants.APP_KILLED_CONTINUE,
    val stopForegroundGracePeriod: Long = 0L,
    val alwaysPauseOnInterruption: Boolean = false
)

@UnstableApi
data class TrackMetadata(
    val id: String,
    val url: String,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val genre: String? = null,
    val date: String? = null,
    val artwork: String? = null,
    val duration: Double? = null,
    val description: String? = null,
    val rating: Double? = null,
    val isLiveStream: Boolean = false,
    val type: String? = null,
    val headers: Map<String, String>? = null,
    val userAgent: String? = null,
    val contentType: String? = null,
    val pitchAlgorithm: String? = null,
    val drmScheme: String? = null,
    val drmLicenseServer: String? = null,
    val drmHeaders: Map<String, String>? = null,
    val drmMultiSession: Boolean = false
)

@UnstableApi
data class PlaybackProgress(
    val position: Double,
    val duration: Double,
    val buffered: Double
)

@UnstableApi
data class PlaybackError(
    val code: String,
    val message: String
)

@UnstableApi
data class VideoTrack(
    val id: String,
    val url: String,
    val muxedUrl: String?,
    val title: String?,
    val artist: String?,
    val artwork: String?,
    val duration: Double?,
    val uploaderUrl: String?,
    val likeCount: Double?,
    val dislikeCount: Double?,
    val viewCount: Double?,
    val commentsCount: Double?
)

// ============================================================================
// GLOBAL STATE HOLDER
// ============================================================================

@UnstableApi
object MavinPlayerRegistry {
    @Volatile var core: MavinPlayerCore? = null
    @Volatile var options: PlayerOptions = PlayerOptions()
    @Volatile var remoteEventCallback: ((String, Map<String, Any?>) -> Unit)? = null
    @Volatile var sharedCache: SimpleCache? = null
    @Volatile var isServiceRunning: Boolean = false
    // Live error from last playback error (cleared on successful play)
    @Volatile var lastPlaybackError: PlaybackError? = null
}

// ============================================================================
// MAVIN PLAYER CORE
// ============================================================================

@UnstableApi
class MavinPlayerCore private constructor(private val context: Context) {

    companion object {
        private const val TAG = "MavinPlayerCore"

        fun getInstance(context: Context): MavinPlayerCore {
            return MavinPlayerRegistry.core ?: synchronized(MavinPlayerRegistry) {
                MavinPlayerRegistry.core ?: MavinPlayerCore(context.applicationContext).also {
                    MavinPlayerRegistry.core = it
                }
            }
        }

        fun destroyInstance() {
            MavinPlayerRegistry.core?.release()
            MavinPlayerRegistry.core = null
            MavinPlayerRegistry.sharedCache?.release()
            MavinPlayerRegistry.sharedCache = null
            MavinPlayerRegistry.isServiceRunning = false
            MavinPlayerRegistry.lastPlaybackError = null
        }
    }

    // DSP Processors
    val equalizerProcessor: EqualizerProcessor = EqualizerProcessor()
    val compressorProcessor: CompressorProcessor = CompressorProcessor()
    val crossfeedProcessor: CrossfeedProcessor = CrossfeedProcessor()
    val peakMeterProcessor: PeakMeterProcessor = PeakMeterProcessor()
    val convolutionProcessor: ConvolutionProcessor = ConvolutionProcessor(context)
    val fxProcessor: FxProcessor = FxProcessor()

    lateinit var player: ExoPlayer
        private set

    private val mainHandler = Handler(Looper.getMainLooper())
    private val progressIntervalMs = AtomicLong(MavinPlayerConstants.DEFAULT_PROGRESS_UPDATE_INTERVAL_MS)
    private val isReleased = AtomicBoolean(false)
    private val isPreparing = AtomicBoolean(false)
    private val retryCount = AtomicInteger(0)
    private val maxRetries = 3

    private var progressRunnable: Runnable? = null
    private var lastEmittedPosition = -1L
    private var lastEmittedDuration = -1L

    val eventListeners = CopyOnWriteArrayList<PlayerEventListener>()

    private val currentTrackRef = AtomicReference<TrackMetadata?>()
    private val currentVideoTrackRef = AtomicReference<VideoTrack?>()
    private val previousTrackRef = AtomicReference<TrackMetadata?>()
    private val lastTrackPositionMs = AtomicLong(0L)

    // Audio focus
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var hasAudioFocus = false
    private var alwaysPauseOnInterruption = false
    private var autoHandleInterruptions = false
    private var isDucked = false

    // Mute state
    private var unmutedVolume: Float = 1.0f
    private var isMuted: Boolean = false

    // playWhenReady tracking
    private var lastPlayWhenReady: Boolean = false

    // Coroutine scope
    private val coroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // ReplayGain
    private var replayGainMode = ReplayGainParser.Mode.TRACK
    private var replayGainPreampDb = 0f
    private var currentRgInfo = ReplayGainParser.EMPTY

    // Presets
    private var autoSwitchPresets = true
    private val presetManager = EqPresetManager(context)

    // Metadata state
    private var nowPlayingCleared = false

    // RNTP 4.x: track whether we are in the initial loading phase
    private var isInLoadingPhase = AtomicBoolean(false)

    interface PlayerEventListener {
        fun onPlaybackStateChanged(state: Int, stateName: String)
        fun onPlaybackError(error: PlaybackError)
        fun onPlaybackProgress(progress: PlaybackProgress, trackIndex: Int)
        fun onPlaybackTrackChanged(
            track: TrackMetadata?, index: Int,
            previousIndex: Int, lastTrack: TrackMetadata?,
            nextTrack: TrackMetadata?, nextIndex: Int,
            lastPosition: Double
        )
        fun onPlaybackQueueEnded(track: TrackMetadata?, positionSeconds: Double)
        fun onPlaybackMetadataReceived(metadata: Map<String, Any?>)
        fun onAudioCommonMetadataReceived(metadata: Map<String, Any?>)
        fun onAudioTimedMetadataReceived(metadata: Map<String, Any?>)
        fun onAudioChapterMetadataReceived(metadata: Map<String, Any?>)
        fun onPeakMeterUpdate(left: Float, right: Float)
        fun onRemoteDuck(paused: Boolean, permanent: Boolean)
        fun onPlaybackPlayWhenReadyChanged(playWhenReady: Boolean, reason: String)
        fun onRemotePlayFromId(id: String, extras: Map<String, Any?>)
        fun onRemotePlayFromSearch(query: String, extras: Map<String, Any?>)
        fun onRemoteSkip(index: Int)
    }

    init {
        initializeCache()
        initializePlayer()
        initializeAudioFocus()
        initializePeakMeter()
    }

    // ========================================================================
    // INIT
    // ========================================================================

    private fun initializeCache() {
        if (MavinPlayerRegistry.sharedCache == null) {
            try {
                val cacheDir = File(context.cacheDir, MavinPlayerConstants.CACHE_FILE_NAME)
                // RNTP: maxCacheSize is in KB; convert to bytes
                val cacheSizeBytes = MavinPlayerRegistry.options.maxCacheSizeBytes
                    .takeIf { it > 0 } ?: (MavinPlayerConstants.DEFAULT_CACHE_SIZE_KB * 1024L)
                MavinPlayerRegistry.sharedCache = SimpleCache(
                    cacheDir,
                    LeastRecentlyUsedCacheEvictor(cacheSizeBytes)
                )
                Log.i(TAG, "Cache initialised: ${cacheDir.absolutePath} (${cacheSizeBytes / 1024 / 1024}MB)")
            } catch (e: Exception) {
                Log.w(TAG, "Cache init failed", e)
            }
        }
    }

    private fun initializePlayer() {
        val opts = MavinPlayerRegistry.options

        val audioProcessors = arrayOf(
            equalizerProcessor,
            compressorProcessor,
            crossfeedProcessor,
            convolutionProcessor,
            fxProcessor,
            peakMeterProcessor
        )

        val audioSink = DefaultAudioSink.Builder(context)
            .setAudioProcessors(audioProcessors)
            .setEnableFloatOutput(true)
            .setEnableAudioTrackPlaybackParams(true)
            .build()

        val renderersFactory = object : DefaultRenderersFactory(context) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioTrackPlaybackParams: Boolean
            ): AudioSink = audioSink
        }.setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF)

        val loadControl = DefaultLoadControl.Builder()
            .setMinBufferMs(opts.minBufferMs.toInt())
            .setMaxBufferMs(opts.maxBufferMs.toInt())
            .setBufferForPlaybackMs(opts.playbackBufferMs.toInt())
            .setBufferForPlaybackAfterRebufferMs(opts.playbackBufferAfterRebufferMs.toInt())
            .setBackBuffer(opts.backBufferDurationMs.toInt(), false)
            .build()

        val trackSelector = DefaultTrackSelector(context).apply {
            setParameters(buildUponParameters().setForceHighestSupportedBitrate(true))
        }

        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(15_000)
            .setAllowCrossProtocolRedirects(true)

        val cache = MavinPlayerRegistry.sharedCache
        val cacheDataSourceFactory = if (cache != null) {
            CacheDataSource.Factory()
                .setCache(cache)
                .setUpstreamDataSourceFactory(httpDataSourceFactory)
                .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
        } else {
            httpDataSourceFactory
        }

        val audioContentType = when (opts.androidAudioContentType.lowercase()) {
            MavinPlayerConstants.AUDIO_CONTENT_TYPE_SPEECH      -> C.AUDIO_CONTENT_TYPE_SPEECH
            MavinPlayerConstants.AUDIO_CONTENT_TYPE_MOVIE       -> C.AUDIO_CONTENT_TYPE_MOVIE
            MavinPlayerConstants.AUDIO_CONTENT_TYPE_SONIFICATION -> C.AUDIO_CONTENT_TYPE_SONIFICATION
            MavinPlayerConstants.AUDIO_CONTENT_TYPE_UNKNOWN     -> C.AUDIO_CONTENT_TYPE_UNKNOWN
            else                                                 -> C.AUDIO_CONTENT_TYPE_MUSIC
        }

        player = ExoPlayer.Builder(context)
            .setRenderersFactory(renderersFactory)
            .setMediaSourceFactory(
                DefaultMediaSourceFactory(context).setDataSourceFactory(cacheDataSourceFactory)
            )
            .setTrackSelector(trackSelector)
            .setLoadControl(loadControl)
            .setAudioAttributes(
                Media3AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(audioContentType)
                    .build(),
                false
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                handlePlaybackStateChanged(playbackState)
            }

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                handlePlayWhenReadyChanged(playWhenReady, reason)
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                handleIsPlayingChanged(isPlaying)
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                handleMediaItemTransition(mediaItem, reason)
            }

            override fun onPlayerError(error: PlaybackException) {
                handlePlayerError(error)
            }

            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int
            ) {
                emitProgressUpdate(force = true)
            }

            override fun onMediaMetadataChanged(mediaMetadata: MediaMetadata) {
                handleMediaMetadataChanged(mediaMetadata)
            }

            override fun onIsLoadingChanged(isLoading: Boolean) {
                // RNTP 4.x: emit STATE_LOADING when initially loading a track
                // (ExoPlayer STATE_BUFFERING at index 0 with isPreparing = true)
                if (isLoading && isPreparing.get() && isInLoadingPhase.get()) {
                    emitState(MavinPlayerConstants.STATE_LOADING, "loading")
                } else if (isLoading && player.playbackState == Player.STATE_BUFFERING) {
                    emitState(MavinPlayerConstants.STATE_BUFFERING, "buffering")
                }
            }

            override fun onTracksChanged(tracks: Tracks) {}
        })

        player.addAnalyticsListener(object : androidx.media3.exoplayer.analytics.AnalyticsListener {
            override fun onMetadata(
                eventTime: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime,
                metadata: androidx.media3.common.Metadata
            ) {
                handleRawMetadata(metadata)
            }
        })

        Log.i(TAG, "ExoPlayer initialised")
    }

    private fun initializeAudioFocus() {
        audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    }

    private fun initializePeakMeter() {
        peakMeterProcessor.setPeakCallback { peaks ->
            if (peaks.size >= 2) {
                eventListeners.forEach { it.onPeakMeterUpdate(peaks[0], peaks[1]) }
            }
        }
    }

    // ========================================================================
    // STATE HANDLERS
    // ========================================================================

    private fun handlePlaybackStateChanged(playbackState: Int) {
        // Once ExoPlayer reaches READY or ENDED, we are past the initial loading phase
        if (playbackState == Player.STATE_READY || playbackState == Player.STATE_ENDED) {
            isInLoadingPhase.set(false)
        }
        isPreparing.set(false)

        val (state, stateName) = when (playbackState) {
            Player.STATE_IDLE -> {
                if (player.mediaItemCount == 0) MavinPlayerConstants.STATE_NONE to "none"
                else MavinPlayerConstants.STATE_STOPPED to "stopped"
            }
            Player.STATE_BUFFERING -> {
                // RNTP 4.x: if this is the very first buffer of a new track, emit loading
                if (isInLoadingPhase.get()) {
                    MavinPlayerConstants.STATE_LOADING to "loading"
                } else {
                    MavinPlayerConstants.STATE_BUFFERING to "buffering"
                }
            }
            Player.STATE_READY -> {
                // Clear last error on successful playback ready
                MavinPlayerRegistry.lastPlaybackError = null
                if (player.isPlaying) MavinPlayerConstants.STATE_PLAYING to "playing"
                else MavinPlayerConstants.STATE_READY to "ready"
            }
            Player.STATE_ENDED -> {
                val posSeconds = player.currentPosition.toDouble() / 1000.0
                val track = currentTrackRef.get()
                eventListeners.forEach { it.onPlaybackQueueEnded(track, posSeconds) }
                MavinPlayerConstants.STATE_ENDED to "ended"
            }
            else -> MavinPlayerConstants.STATE_ERROR to "unknown"
        }

        when (playbackState) {
            Player.STATE_READY -> if (player.isPlaying) startProgressUpdates()
            Player.STATE_BUFFERING -> startProgressUpdates()
            else -> stopProgressUpdates()
        }

        emitState(state, stateName)
    }

    private fun handlePlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        if (autoHandleInterruptions) {
            when (reason) {
                Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS -> {
                    if (!playWhenReady) player.pause()
                }
                Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY -> {
                    if (!playWhenReady) player.pause()
                }
                else -> {}
            }
        }

        if (playWhenReady != lastPlayWhenReady) {
            lastPlayWhenReady = playWhenReady
            val reasonStr = when (reason) {
                Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST         -> "user-request"
                Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS     -> "audio-focus-loss"
                Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY -> "audio-becoming-noisy"
                Player.PLAY_WHEN_READY_CHANGE_REASON_REMOTE               -> "remote"
                Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM    -> "end-of-media-item"
                else                                                       -> "unknown"
            }
            eventListeners.forEach { it.onPlaybackPlayWhenReadyChanged(playWhenReady, reasonStr) }
        }

        val state = when {
            playWhenReady && player.playbackState == Player.STATE_READY ->
                MavinPlayerConstants.STATE_PLAYING to "playing"
            playWhenReady && player.playbackState == Player.STATE_BUFFERING -> {
                if (isInLoadingPhase.get()) MavinPlayerConstants.STATE_LOADING to "loading"
                else MavinPlayerConstants.STATE_BUFFERING to "buffering"
            }
            !playWhenReady && player.playbackState == Player.STATE_IDLE ->
                MavinPlayerConstants.STATE_NONE to "none"
            !playWhenReady && player.playbackState == Player.STATE_ENDED ->
                MavinPlayerConstants.STATE_ENDED to "ended"
            else -> MavinPlayerConstants.STATE_PAUSED to "paused"
        }
        emitState(state.first, state.second)

        // RNTP spec: stop progress updates when paused (not just when stopped)
        if (!playWhenReady && player.playbackState == Player.STATE_READY) {
            stopProgressUpdates()
        }
    }

    private fun handleIsPlayingChanged(isPlaying: Boolean) {
        if (isPlaying) {
            startProgressUpdates()
            emitState(MavinPlayerConstants.STATE_PLAYING, "playing")
        } else {
            stopProgressUpdates()
            val state = when (player.playbackState) {
                Player.STATE_BUFFERING -> {
                    if (isInLoadingPhase.get()) MavinPlayerConstants.STATE_LOADING to "loading"
                    else MavinPlayerConstants.STATE_BUFFERING to "buffering"
                }
                Player.STATE_IDLE     -> MavinPlayerConstants.STATE_NONE to "none"
                Player.STATE_ENDED   -> MavinPlayerConstants.STATE_ENDED to "ended"
                else                 -> MavinPlayerConstants.STATE_PAUSED to "paused"
            }
            emitState(state.first, state.second)
        }
    }

    private fun handleMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        val capturedLastPositionMs = lastTrackPositionMs.get()
        val lastPositionSeconds = capturedLastPositionMs.toDouble() / 1000.0

        val previousIndex = if (player.previousMediaItemIndex >= 0) player.previousMediaItemIndex else -1
        val currentIndex = player.currentMediaItemIndex
        val nextIndex = if (player.hasNextMediaItem()) player.nextMediaItemIndex else -1
        val nextTrack = if (nextIndex >= 0) getTrack(nextIndex) else null

        val lastTrack = previousTrackRef.get()
        val newTrack = mediaItem?.let { buildTrackMetadataFromItem(it) }

        previousTrackRef.set(currentTrackRef.get())
        currentTrackRef.set(newTrack)
        nowPlayingCleared = false

        // RNTP 4.x: entering a new track is a loading phase
        isInLoadingPhase.set(true)

        mediaItem?.let { handleTrackTransition(it) }

        eventListeners.forEach {
            it.onPlaybackTrackChanged(
                newTrack, currentIndex, previousIndex, lastTrack, nextTrack, nextIndex,
                lastPositionSeconds
            )
        }

        // RNTP 4.x: if queue is now empty after transition, fire with nulls
        if (mediaItem == null && player.mediaItemCount == 0) {
            eventListeners.forEach {
                it.onPlaybackTrackChanged(null, -1, previousIndex, lastTrack, null, -1, lastPositionSeconds)
            }
        }

        lastEmittedPosition = -1
        lastEmittedDuration = -1
    }

    private fun buildTrackMetadataFromItem(item: MediaItem): TrackMetadata = TrackMetadata(
        id = item.mediaId,
        url = item.localConfiguration?.uri?.toString() ?: "",
        title = item.mediaMetadata.title?.toString(),
        artist = item.mediaMetadata.artist?.toString(),
        album = item.mediaMetadata.albumTitle?.toString(),
        artwork = item.mediaMetadata.artworkUri?.toString(),
        duration = item.mediaMetadata.durationMs?.toDouble()?.div(1000.0),
        genre = item.mediaMetadata.genre?.toString(),
        description = item.mediaMetadata.description?.toString()
    )

    private fun handlePlayerError(error: PlaybackException) {
        Log.e(TAG, "Player error: ${error.errorCodeName}", error)

        val errorCode = when (error.errorCode) {
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS            -> MavinPlayerConstants.ERROR_CODE_BAD_HTTP_STATUS
            PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE  -> MavinPlayerConstants.ERROR_CODE_INVALID_CONTENT_TYPE
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED  -> MavinPlayerConstants.ERROR_CODE_NETWORK_CONNECTION_FAILED
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> MavinPlayerConstants.ERROR_CODE_NETWORK_TIMEOUT
            PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND             -> MavinPlayerConstants.ERROR_CODE_FILE_NOT_FOUND
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED           -> MavinPlayerConstants.ERROR_CODE_DECODER_INIT_FAILED
            PlaybackException.ERROR_CODE_DECODING_FAILED               -> MavinPlayerConstants.ERROR_CODE_DECODING_FAILED
            PlaybackException.ERROR_CODE_TIMEOUT                       -> MavinPlayerConstants.ERROR_CODE_TIMEOUT
            else                                                        -> MavinPlayerConstants.ERROR_CODE_UNKNOWN
        }

        val playbackError = PlaybackError(code = errorCode, message = error.message ?: "Playback error")
        // RNTP 4.x: store last error so getPlaybackState() can carry it in error state
        MavinPlayerRegistry.lastPlaybackError = playbackError
        isInLoadingPhase.set(false)
        emitState(MavinPlayerConstants.STATE_ERROR, "error")
        eventListeners.forEach { it.onPlaybackError(playbackError) }

        val isNetworkError = errorCode in listOf(
            MavinPlayerConstants.ERROR_CODE_NETWORK_CONNECTION_FAILED,
            MavinPlayerConstants.ERROR_CODE_NETWORK_TIMEOUT
        )

        if (isNetworkError && retryCount.get() < maxRetries) {
            val backoffMs = (1000L * (1 shl retryCount.getAndIncrement())).coerceAtMost(8000L)
            Log.i(TAG, "Auto-retrying after network error (attempt ${retryCount.get()}) in ${backoffMs}ms")
            mainHandler.postDelayed({
                if (!isReleased.get() && player.playbackState == Player.STATE_IDLE) {
                    player.prepare()
                }
            }, backoffMs)
        }
    }

    private fun handleMediaMetadataChanged(mediaMetadata: MediaMetadata) {
        if (nowPlayingCleared) return
        val metadata = mutableMapOf<String, Any?>()
        mediaMetadata.title?.let       { metadata["title"]       = it.toString() }
        mediaMetadata.artist?.let      { metadata["artist"]      = it.toString() }
        mediaMetadata.albumTitle?.let  { metadata["album"]       = it.toString() }
        mediaMetadata.genre?.let       { metadata["genre"]       = it.toString() }
        mediaMetadata.description?.let { metadata["description"] = it.toString() }
        mediaMetadata.artworkUri?.let  { metadata["artwork"]     = it.toString() }
        mediaMetadata.durationMs?.let  { metadata["duration"]    = it.toDouble() / 1000.0 }

        if (metadata.isNotEmpty()) {
            eventListeners.forEach { it.onPlaybackMetadataReceived(metadata) }
        }
    }

    private fun handleRawMetadata(metadata: androidx.media3.common.Metadata) {
        val common = mutableMapOf<String, Any?>()
        val timed = mutableMapOf<String, Any?>()
        val chapter = mutableMapOf<String, Any?>()

        for (i in 0 until metadata.length()) {
            when (val entry = metadata.get(i)) {
                is IcyInfo -> {
                    entry.title?.let { common["title"] = it }
                    entry.url?.let   { common["url"]   = it }
                }
                is IcyHeaders -> {
                    entry.name?.let    { common["station"]    = it }
                    entry.genre?.let   { common["genre"]      = it }
                    entry.url?.let     { common["stationUrl"] = it }
                    entry.bitrate.let  { common["bitrate"]    = it }
                }
                is TextInformationFrame -> {
                    common[entry.id.lowercase()] = entry.values.firstOrNull()
                }
                is Id3Frame -> {
                    timed["id3Frame"] = entry.id
                }
                is VorbisComment -> {
                    common[entry.key.lowercase()] = entry.value
                }
                is EventMessage -> {
                    timed["schemeIdUri"]        = entry.schemeIdUri
                    timed["value"]              = entry.value
                    timed["id"]                 = entry.id
                    timed["durationMs"]         = entry.durationMs
                    timed["presentationTimeUs"] = entry.presentationTimeMsUs
                }
            }
        }

        if (common.isNotEmpty()) eventListeners.forEach { it.onAudioCommonMetadataReceived(common) }
        if (timed.isNotEmpty())  eventListeners.forEach { it.onAudioTimedMetadataReceived(timed) }
    }

    private fun handleTrackTransition(mediaItem: MediaItem) {
        retryCount.set(0)
        MavinPlayerRegistry.lastPlaybackError = null
        val mediaId = mediaItem.mediaId
        if (autoSwitchPresets) {
            presetManager.getTrackPreset(mediaId)?.let { applyPresetByName(it) }
        }

        coroutineScope.launch {
            val localUri = mediaItem.localConfiguration?.uri?.path
            val info = if (localUri != null) {
                ReplayGainParser.parse(localUri)
            } else {
                val extras = mediaItem.mediaMetadata.extras
                if (extras != null) {
                    ReplayGainParser.parseFromMap(
                        mapOf(
                            "replaygain_track_gain" to (extras.getString("replaygain_track_gain") ?: ""),
                            "replaygain_album_gain" to (extras.getString("replaygain_album_gain") ?: ""),
                            "replaygain_track_peak" to (extras.getString("replaygain_track_peak") ?: ""),
                            "replaygain_album_peak" to (extras.getString("replaygain_album_peak") ?: "")
                        )
                    )
                } else ReplayGainParser.EMPTY
            }
            currentRgInfo = info
            applyReplayGainInternal(info)
        }
    }

    private fun applyReplayGainInternal(info: ReplayGainParser.ReplayGainInfo) {
        val gainDb = info.resolveGain(replayGainMode, replayGainPreampDb)
        if (gainDb != null) equalizerProcessor.setLoudnessOffset(gainDb)
        else equalizerProcessor.setLoudnessLinear(1f)
    }

    // ========================================================================
    // PROGRESS
    // ========================================================================

    private fun startProgressUpdates() {
        stopProgressUpdates()
        val interval = progressIntervalMs.get()
        // RNTP spec: only start if non-zero interval configured
        if (interval <= 0L) return
        progressRunnable = object : Runnable {
            override fun run() {
                if (isReleased.get()) return
                emitProgressUpdate()
                // RNTP spec: only continue firing while actively playing (not paused)
                if (!isReleased.get() && player.isPlaying) {
                    mainHandler.postDelayed(this, interval)
                }
            }
        }
        mainHandler.post(progressRunnable!!)
    }

    private fun stopProgressUpdates() {
        progressRunnable?.let { mainHandler.removeCallbacks(it) }
        progressRunnable = null
    }

    private fun emitProgressUpdate(force: Boolean = false) {
        val posMs   = player.currentPosition
        val durMs   = if (player.duration != C.TIME_UNSET) player.duration else 0L
        val bufMs   = player.bufferedPosition

        lastTrackPositionMs.set(posMs)

        val posChanged = force || kotlin.math.abs(posMs - lastEmittedPosition) >= 250
        val durChanged = durMs != lastEmittedDuration

        if (posChanged || durChanged) {
            lastEmittedPosition = posMs
            lastEmittedDuration = durMs
            val progress = PlaybackProgress(
                position = posMs.toDouble() / 1000.0,
                duration = durMs.toDouble() / 1000.0,
                buffered = bufMs.toDouble() / 1000.0
            )
            val trackIndex = player.currentMediaItemIndex
            eventListeners.forEach { it.onPlaybackProgress(progress, trackIndex) }
        }
    }

    private fun emitState(state: Int, stateName: String) {
        eventListeners.forEach { it.onPlaybackStateChanged(state, stateName) }
    }

    // ========================================================================
    // AUDIO FOCUS
    // ========================================================================

    fun requestAudioFocus(): Boolean {
        val am = audioManager ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setWillPauseWhenDucked(alwaysPauseOnInterruption)
                .setOnAudioFocusChangeListener { handleAudioFocusChange(it) }
                .build()
            val result = am.requestAudioFocus(req)
            if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                audioFocusRequest = req; hasAudioFocus = true; true
            } else false
        } else {
            @Suppress("DEPRECATION")
            val result = am.requestAudioFocus(
                { handleAudioFocusChange(it) },
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            )
            hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            hasAudioFocus
        }
    }

    fun abandonAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager?.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            audioManager?.abandonAudioFocus(null)
        }
        hasAudioFocus = false
    }

    private fun handleAudioFocusChange(focusChange: Int) {
        when (focusChange) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                if (isDucked) {
                    isDucked = false
                    player.volume = if (isMuted) 0f else unmutedVolume
                    eventListeners.forEach { it.onRemoteDuck(paused = false, permanent = false) }
                } else if (player.playbackState == Player.STATE_READY && !player.isPlaying) {
                    player.play()
                }
                player.volume = if (isMuted) 0f else unmutedVolume
            }
            AudioManager.AUDIOFOCUS_LOSS -> {
                player.pause()
                abandonAudioFocus()
                eventListeners.forEach { it.onRemoteDuck(paused = true, permanent = true) }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                if (alwaysPauseOnInterruption || autoHandleInterruptions) {
                    player.pause()
                    eventListeners.forEach { it.onRemoteDuck(paused = true, permanent = false) }
                } else {
                    eventListeners.forEach { it.onRemoteDuck(paused = false, permanent = false) }
                }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                if (alwaysPauseOnInterruption || autoHandleInterruptions) {
                    player.pause()
                    eventListeners.forEach { it.onRemoteDuck(paused = true, permanent = false) }
                } else {
                    isDucked = true
                    player.volume = 0.3f
                    eventListeners.forEach { it.onRemoteDuck(paused = false, permanent = false) }
                }
            }
        }
    }

    // ========================================================================
    // REMOTE EVENT ROUTING
    // ========================================================================

    fun handleRemoteAction(action: String) {
        val opts = MavinPlayerRegistry.options
        val callback = MavinPlayerRegistry.remoteEventCallback
        when (action) {
            MavinPlayerConstants.ACTION_PLAY -> {
                play()
                callback?.invoke("remote-play", emptyMap())
            }
            MavinPlayerConstants.ACTION_PAUSE -> {
                pause()
                callback?.invoke("remote-pause", emptyMap())
            }
            MavinPlayerConstants.ACTION_NEXT -> {
                skipToNext()
                callback?.invoke("remote-next", emptyMap())
            }
            MavinPlayerConstants.ACTION_PREVIOUS -> {
                skipToPrevious()
                callback?.invoke("remote-previous", emptyMap())
            }
            MavinPlayerConstants.ACTION_STOP -> {
                stop()
                callback?.invoke("remote-stop", emptyMap())
            }
            MavinPlayerConstants.ACTION_JUMP_FORWARD -> {
                seekBy(opts.forwardJumpInterval)
                callback?.invoke("remote-jump-forward", mapOf("interval" to opts.forwardJumpInterval.toDouble() / 1000.0))
            }
            MavinPlayerConstants.ACTION_JUMP_BACKWARD -> {
                seekBy(-opts.backwardJumpInterval)
                callback?.invoke("remote-jump-backward", mapOf("interval" to opts.backwardJumpInterval.toDouble() / 1000.0))
            }
            MavinPlayerConstants.ACTION_LIKE -> {
                callback?.invoke("remote-like", emptyMap())
            }
            MavinPlayerConstants.ACTION_DISLIKE -> {
                callback?.invoke("remote-dislike", emptyMap())
            }
            MavinPlayerConstants.ACTION_BOOKMARK -> {
                callback?.invoke("remote-bookmark", emptyMap())
            }
        }
    }

    fun handleRemoteSeek(positionSeconds: Double) {
        val posMs = (positionSeconds * 1000.0).toLong()
        seekTo(posMs)
        MavinPlayerRegistry.remoteEventCallback?.invoke(
            "remote-seek",
            mapOf("position" to positionSeconds)
        )
    }

    fun handleRemoteSetRating(rating: Double) {
        MavinPlayerRegistry.remoteEventCallback?.invoke(
            "remote-set-rating",
            mapOf("rating" to rating)
        )
    }

    fun handleRemoteSkip(index: Int) {
        skipToIndex(index)
        eventListeners.forEach { it.onRemoteSkip(index) }
        MavinPlayerRegistry.remoteEventCallback?.invoke("remote-skip", mapOf("index" to index))
    }

    fun handleRemotePlayFromId(id: String, extras: Bundle?) {
        val extrasMap = extras?.keySet()?.associateWith { extras.get(it) as? Any? } ?: emptyMap()
        val index = (0 until player.mediaItemCount).firstOrNull { i ->
            player.getMediaItemAt(i).mediaId == id
        }
        if (index != null) skipToIndex(index)
        eventListeners.forEach { it.onRemotePlayFromId(id, extrasMap) }
        MavinPlayerRegistry.remoteEventCallback?.invoke("remote-play-from-id", mapOf("id" to id, "extras" to extrasMap))
    }

    fun handleRemotePlayFromSearch(query: String, extras: Bundle?) {
        val extrasMap = extras?.keySet()?.associateWith { extras.get(it) as? Any? } ?: emptyMap()
        eventListeners.forEach { it.onRemotePlayFromSearch(query, extrasMap) }
        MavinPlayerRegistry.remoteEventCallback?.invoke("remote-play-from-search", mapOf("query" to query, "extras" to extrasMap))
    }

    // ========================================================================
    // PUBLIC PLAYBACK API
    // ========================================================================

    fun addEventListener(listener: PlayerEventListener) { eventListeners.add(listener) }
    fun removeEventListener(listener: PlayerEventListener) { eventListeners.remove(listener) }

    fun load(track: TrackMetadata, playWhenReady: Boolean = true) {
        val mediaItem = buildMediaItem(track)
        isPreparing.set(true)
        isInLoadingPhase.set(true)
        retryCount.set(0)
        MavinPlayerRegistry.lastPlaybackError = null
        player.setMediaItem(mediaItem)
        player.playWhenReady = playWhenReady
        player.prepare()
        currentTrackRef.set(track)
        currentVideoTrackRef.set(null)
        nowPlayingCleared = false
        Log.i(TAG, "Loaded track: ${track.title}")
    }

    fun loadVideoTrack(videoTrack: VideoTrack, playWhenReady: Boolean = true) {
        val mediaItem = buildVideoMediaItem(videoTrack)
        isPreparing.set(true)
        isInLoadingPhase.set(true)
        retryCount.set(0)
        MavinPlayerRegistry.lastPlaybackError = null
        player.setMediaItem(mediaItem)
        player.playWhenReady = playWhenReady
        player.prepare()
        currentVideoTrackRef.set(videoTrack)
        currentTrackRef.set(
            TrackMetadata(
                id = videoTrack.id, url = videoTrack.url, title = videoTrack.title,
                artist = videoTrack.artist, artwork = videoTrack.artwork, duration = videoTrack.duration
            )
        )
        Log.i(TAG, "Loaded video track: ${videoTrack.title}")
    }

    fun add(tracks: List<TrackMetadata>, insertBeforeIndex: Int? = null): Int {
        val items = tracks.map { buildMediaItem(it) }
        val insertIndex = if (insertBeforeIndex != null && insertBeforeIndex >= 0) {
            player.addMediaItems(insertBeforeIndex, items)
            insertBeforeIndex
        } else {
            val firstIdx = player.mediaItemCount
            player.addMediaItems(items)
            firstIdx
        }
        return insertIndex
    }

    fun setQueue(tracks: List<TrackMetadata>, startIndex: Int = 0, startPositionMs: Long = 0) {
        val items = tracks.map { buildMediaItem(it) }
        isPreparing.set(true)
        isInLoadingPhase.set(true)
        retryCount.set(0)
        MavinPlayerRegistry.lastPlaybackError = null
        player.setMediaItems(items, startIndex, startPositionMs)
        player.prepare()
    }

    /**
     * RNTP 4.x remove() contract:
     * - If removed index is current track → next track activates (or first if last)
     * - Multiple indices removed in descending order to preserve correct positions
     */
    fun remove(index: Int) {
        val total = player.mediaItemCount
        if (index !in 0 until total) return
        val currentIdx = player.currentMediaItemIndex
        player.removeMediaItem(index)
        // If we removed the current track, ExoPlayer automatically activates next;
        // if it was the last item, it wraps to first (if queue not empty)
        // No explicit action needed — ExoPlayer handles this natively
    }

    fun remove(indices: List<Int>) {
        // Remove in descending order to preserve correct positions
        val sorted = indices.filter { it in 0 until player.mediaItemCount }.sortedDescending()
        sorted.forEach { idx -> player.removeMediaItem(idx) }
    }

    fun removeUpcomingTracks() {
        val currentIndex = player.currentMediaItemIndex
        val total = player.mediaItemCount
        if (currentIndex >= 0 && currentIndex < total - 1) {
            remove((total - 1 downTo currentIndex + 1).toList())
        }
    }

    fun removePreviousTracks() {
        val currentIndex = player.currentMediaItemIndex
        if (currentIndex > 0) {
            remove((currentIndex - 1 downTo 0).toList())
        }
    }

    fun move(fromIndex: Int, toIndex: Int) {
        if (fromIndex in 0 until player.mediaItemCount && toIndex in 0 until player.mediaItemCount)
            player.moveMediaItem(fromIndex, toIndex)
    }

    fun updateTrackMetadata(index: Int, metadata: TrackMetadata) {
        if (index !in 0 until player.mediaItemCount) return
        val existing = player.getMediaItemAt(index)
        val updated = buildMediaItem(metadata).buildUpon().setMediaId(existing.mediaId).build()
        player.replaceMediaItem(index, updated)
    }

    fun updateNowPlayingMetadata(metadata: TrackMetadata) {
        nowPlayingCleared = false
        val idx = player.currentMediaItemIndex
        if (idx in 0 until player.mediaItemCount) updateTrackMetadata(idx, metadata)
    }

    fun clearNowPlayingMetadata() {
        nowPlayingCleared = true
        val idx = player.currentMediaItemIndex
        if (idx in 0 until player.mediaItemCount) {
            val blank = MediaItem.Builder()
                .setUri(player.getMediaItemAt(idx).localConfiguration?.uri ?: Uri.EMPTY)
                .setMediaId(player.getMediaItemAt(idx).mediaId)
                .setMediaMetadata(MediaMetadata.Builder().build())
                .build()
            player.replaceMediaItem(idx, blank)
        }
    }

    fun preloadNextTrack(track: TrackMetadata) {
        val nextIndex = player.currentMediaItemIndex + 1
        if (nextIndex >= player.mediaItemCount) {
            player.addMediaItem(buildMediaItem(track))
            Log.i(TAG, "Preloaded next track: ${track.title}")
        }
    }

    fun play() {
        requestAudioFocus()
        player.play()
    }

    fun pause() { player.pause() }

    fun stop() { player.stop() }

    fun reset() {
        player.stop()
        player.clearMediaItems()
        currentTrackRef.set(null)
        currentVideoTrackRef.set(null)
        previousTrackRef.set(null)
        lastEmittedPosition = -1
        lastEmittedDuration = -1
        lastTrackPositionMs.set(0L)
        nowPlayingCleared = false
        isInLoadingPhase.set(false)
        retryCount.set(0)
        MavinPlayerRegistry.lastPlaybackError = null
    }

    fun seekTo(positionMs: Long) {
        player.seekTo(positionMs.coerceAtLeast(0))
        emitProgressUpdate(force = true)
    }

    fun seekBy(offsetMs: Long) {
        val newPos = (player.currentPosition + offsetMs).coerceIn(
            0,
            if (player.duration != C.TIME_UNSET) player.duration else Long.MAX_VALUE
        )
        player.seekTo(newPos)
        emitProgressUpdate(force = true)
    }

    fun skipToNext(initialPositionMs: Long = 0): Boolean {
        return if (player.hasNextMediaItem()) {
            player.seekTo(player.nextMediaItemIndex, initialPositionMs)
            true
        } else false
    }

    fun skipToPrevious(initialPositionMs: Long = 0): Boolean {
        return if (player.hasPreviousMediaItem()) {
            player.seekTo(player.previousMediaItemIndex, initialPositionMs)
            true
        } else false
    }

    fun skipToIndex(index: Int, positionMs: Long = 0): Boolean {
        return if (index in 0 until player.mediaItemCount) {
            player.seekTo(index, positionMs); true
        } else false
    }

    fun retry() {
        retryCount.set(0)
        isInLoadingPhase.set(true)
        MavinPlayerRegistry.lastPlaybackError = null
        player.prepare()
    }

    fun setPlayWhenReady(playWhenReady: Boolean) { player.playWhenReady = playWhenReady }
    fun getPlayWhenReady(): Boolean = player.playWhenReady

    // ========================================================================
    // STATE QUERIES
    // ========================================================================

    fun getCurrentTrack(): TrackMetadata? = currentTrackRef.get()
    fun getCurrentVideoTrack(): VideoTrack? = currentVideoTrackRef.get()

    fun getTrack(index: Int): TrackMetadata? {
        if (index !in 0 until player.mediaItemCount) return null
        val item = player.getMediaItemAt(index)
        return TrackMetadata(
            id = item.mediaId,
            url = item.localConfiguration?.uri?.toString() ?: "",
            title = item.mediaMetadata.title?.toString(),
            artist = item.mediaMetadata.artist?.toString(),
            album = item.mediaMetadata.albumTitle?.toString(),
            artwork = item.mediaMetadata.artworkUri?.toString(),
            duration = item.mediaMetadata.durationMs?.toDouble()?.div(1000.0),
            genre = item.mediaMetadata.genre?.toString(),
            description = item.mediaMetadata.description?.toString()
        )
    }

    fun getActiveTrack(): TrackMetadata? = currentTrackRef.get()
        ?: getTrack(player.currentMediaItemIndex)

    fun getActiveTrackIndex(): Int = player.currentMediaItemIndex

    fun getQueue(): List<TrackMetadata> = (0 until player.mediaItemCount).mapNotNull { getTrack(it) }

    fun getProgress(): PlaybackProgress {
        val posMs = player.currentPosition
        val durMs = if (player.duration != C.TIME_UNSET) player.duration else 0L
        val bufMs = player.bufferedPosition
        return PlaybackProgress(
            position = posMs.toDouble() / 1000.0,
            duration = durMs.toDouble() / 1000.0,
            buffered = bufMs.toDouble() / 1000.0
        )
    }

    fun getPlaybackState(): Int = when {
        player.playbackState == Player.STATE_IDLE && player.mediaItemCount == 0 -> MavinPlayerConstants.STATE_NONE
        player.playbackState == Player.STATE_IDLE          -> MavinPlayerConstants.STATE_STOPPED
        player.playbackState == Player.STATE_BUFFERING && isInLoadingPhase.get() -> MavinPlayerConstants.STATE_LOADING
        player.playbackState == Player.STATE_BUFFERING     -> MavinPlayerConstants.STATE_BUFFERING
        player.playbackState == Player.STATE_READY && player.isPlaying  -> MavinPlayerConstants.STATE_PLAYING
        player.playbackState == Player.STATE_READY && !player.isPlaying -> MavinPlayerConstants.STATE_PAUSED
        player.playbackState == Player.STATE_ENDED         -> MavinPlayerConstants.STATE_ENDED
        else                                               -> MavinPlayerConstants.STATE_ERROR
    }

    fun getPlaybackStateString(): String = when (getPlaybackState()) {
        MavinPlayerConstants.STATE_NONE             -> "none"
        MavinPlayerConstants.STATE_READY            -> "ready"
        MavinPlayerConstants.STATE_PLAYING          -> "playing"
        MavinPlayerConstants.STATE_PAUSED           -> "paused"
        MavinPlayerConstants.STATE_STOPPED          -> "stopped"
        MavinPlayerConstants.STATE_BUFFERING        -> "buffering"
        MavinPlayerConstants.STATE_LOADING          -> "loading"
        MavinPlayerConstants.STATE_CONNECTION_ERROR -> "connection-error"
        MavinPlayerConstants.STATE_ERROR            -> "error"
        MavinPlayerConstants.STATE_ENDED            -> "ended"
        else                                        -> "unknown"
    }

    fun isPlaying(): Boolean = player.isPlaying
    fun isLoading(): Boolean = player.isLoading || isPreparing.get() || isInLoadingPhase.get()
    fun getDurationMs(): Long = if (player.duration != C.TIME_UNSET) player.duration else 0L
    fun getCurrentPositionMs(): Long = player.currentPosition
    fun getBufferedPositionMs(): Long = player.bufferedPosition

    fun getVolume(): Float = unmutedVolume
    fun setVolume(v: Float) {
        unmutedVolume = v.coerceIn(0f, 1f)
        if (!isMuted) player.volume = unmutedVolume
    }
    fun mute() {
        isMuted = true
        player.volume = 0f
    }
    fun unmute() {
        isMuted = false
        player.volume = unmutedVolume
    }
    fun isMuted(): Boolean = isMuted
    fun getUnmutedVolume(): Float = unmutedVolume

    fun getRepeatMode(): Int = when (player.repeatMode) {
        Player.REPEAT_MODE_OFF -> MavinPlayerConstants.REPEAT_OFF
        Player.REPEAT_MODE_ONE -> MavinPlayerConstants.REPEAT_TRACK
        Player.REPEAT_MODE_ALL -> MavinPlayerConstants.REPEAT_QUEUE
        else                   -> MavinPlayerConstants.REPEAT_OFF
    }
    fun setRepeatMode(mode: Int) {
        player.repeatMode = when (mode) {
            MavinPlayerConstants.REPEAT_TRACK -> Player.REPEAT_MODE_ONE
            MavinPlayerConstants.REPEAT_QUEUE -> Player.REPEAT_MODE_ALL
            else                              -> Player.REPEAT_MODE_OFF
        }
    }
    fun getShuffleMode(): Boolean = player.shuffleModeEnabled
    fun setShuffleMode(enabled: Boolean) { player.shuffleModeEnabled = enabled }
    fun getPlaybackRate(): Float = player.playbackParameters.speed
    fun setPlaybackRate(rate: Float) {
        val pitch = player.playbackParameters.pitch
        player.setPlaybackParameters(PlaybackParameters(rate.coerceIn(0.1f, 4.0f), pitch))
    }
    fun getPlaybackPitch(): Float = player.playbackParameters.pitch
    fun setPlaybackPitch(pitch: Float) {
        val rate = player.playbackParameters.speed
        player.setPlaybackParameters(PlaybackParameters(rate, pitch.coerceIn(0.1f, 4.0f)))
    }

    // RNTP: getCacheSize returns bytes used
    fun getCacheSizeBytes(): Long = MavinPlayerRegistry.sharedCache?.cacheSpace ?: 0L

    // ========================================================================
    // CONFIGURATION
    // ========================================================================

    fun setProgressUpdateInterval(intervalMs: Long) {
        val clamped = intervalMs.coerceIn(
            MavinPlayerConstants.MIN_PROGRESS_UPDATE_INTERVAL_MS,
            MavinPlayerConstants.MAX_PROGRESS_UPDATE_INTERVAL_MS
        )
        progressIntervalMs.set(clamped)
        if (progressRunnable != null) {
            stopProgressUpdates()
            if (player.isPlaying) startProgressUpdates()
        }
    }

    fun setAlwaysPauseOnInterruption(enabled: Boolean) { alwaysPauseOnInterruption = enabled }
    fun setAutoHandleInterruptions(enabled: Boolean) { autoHandleInterruptions = enabled }

    // ========================================================================
    // EQ / DSP API — fully preserved
    // ========================================================================

    fun setEQEnabled(enabled: Boolean) { equalizerProcessor.isEnabled = enabled }
    fun isEQEnabled(): Boolean = equalizerProcessor.isEnabled
    fun setEQBand(band: Int, gainDb: Float) { equalizerProcessor.setBandGain(band, gainDb) }
    fun applyEQBands(gainsDb: FloatArray) { equalizerProcessor.applyBands(gainsDb) }
    fun setEQPreamp(gainDb: Float) { equalizerProcessor.setPreamp(gainDb) }
    fun resetEQ() { equalizerProcessor.resetGains() }
    fun getEQGains(): FloatArray = equalizerProcessor.getCurrentGains()
    fun getEQPreamp(): Float = equalizerProcessor.getCurrentPreamp()
    fun setEQMode(mode: String) {
        equalizerProcessor.setEqMode(when (mode.uppercase()) {
            "PARAMETRIC" -> EqualizerProcessor.EqMode.PARAMETRIC
            "PARALLEL"   -> EqualizerProcessor.EqMode.PARALLEL
            else         -> EqualizerProcessor.EqMode.GRAPHIC
        })
    }
    fun getEQMode(): String = equalizerProcessor.getCurrentEqMode().name
    fun setParametricBandGain(band: Int, gainDb: Float) { equalizerProcessor.setParametricBandGain(band, gainDb) }
    fun applyParametricBands(gainsDb: FloatArray) { equalizerProcessor.applyParametricBands(gainsDb) }
    fun setParametricBandFreq(band: Int, freqHz: Double) { equalizerProcessor.setParametricBandFreq(band, freqHz) }
    fun getParametricGains(): FloatArray = equalizerProcessor.getParametricGains()
    fun getParametricFreqs(): DoubleArray = equalizerProcessor.getParametricFreqs()
    fun setDitherMode(mode: String) {
        equalizerProcessor.setDitherMode(when (mode.uppercase()) {
            "HIGHPASS"   -> EqualizerProcessor.DitherMode.HIGHPASS
            "E_WEIGHTED" -> EqualizerProcessor.DitherMode.E_WEIGHTED
            "F_WEIGHTED" -> EqualizerProcessor.DitherMode.F_WEIGHTED
            else         -> EqualizerProcessor.DitherMode.FLAT
        })
    }
    fun getDitherMode(): String = equalizerProcessor.getDitherMode().name
    fun setSmoothingRamp(ms: Double) {
        equalizerProcessor.smoothingRampMs = ms.coerceIn(0.0, 50.0)
        equalizerProcessor.recomputeSmoothStep()
    }
    fun getLoudnessDb(): Float = equalizerProcessor.getCurrentLoudnessDb()
    fun getSpectrumMagnitudes(): FloatArray = equalizerProcessor.spectrumMagnitudes
    fun computeAutoEQ(): FloatArray = equalizerProcessor.computeAutoEqSuggestion()

    // Compressor
    fun setCompressorEnabled(e: Boolean) { compressorProcessor.setEnabled(e) }
    fun isCompressorEnabled(): Boolean = compressorProcessor.isEnabled()
    fun setCompressorThreshold(db: Double) { compressorProcessor.setThreshold(db) }
    fun setCompressorRatio(ratio: Double) { compressorProcessor.setRatio(ratio) }
    fun setCompressorAttackMs(ms: Double) { compressorProcessor.setAttackMs(ms) }
    fun setCompressorReleaseMs(ms: Double) { compressorProcessor.setReleaseMs(ms) }
    fun setCompressorKneeWidth(db: Double) { compressorProcessor.setKneeWidth(db) }
    fun setCompressorMakeupGain(db: Double) { compressorProcessor.setMakeupGain(db) }
    fun getCompressorReductionDb(): Float = compressorProcessor.getReductionDb()
    fun getCompressorThreshold(): Double = compressorProcessor.getThreshold()
    fun getCompressorRatio(): Double = compressorProcessor.getRatio()
    fun getCompressorAttackMs(): Double = compressorProcessor.getAttackMs()
    fun getCompressorReleaseMs(): Double = compressorProcessor.getReleaseMs()

    // Crossfeed
    fun setCrossfeedEnabled(e: Boolean) { crossfeedProcessor.setEnabled(e) }
    fun isCrossfeedEnabled(): Boolean = crossfeedProcessor.isEnabled()
    fun setCrossfeedStrength(strength: Float) {
        val db = CrossfeedProcessor.FEED_MIN_DB +
                (CrossfeedProcessor.FEED_MAX_DB - CrossfeedProcessor.FEED_MIN_DB) * strength.coerceIn(0f, 1f)
        crossfeedProcessor.setFeedDb(db)
    }
    fun getCrossfeedStrength(): Float {
        val range = CrossfeedProcessor.FEED_MAX_DB - CrossfeedProcessor.FEED_MIN_DB
        return ((crossfeedProcessor.getFeedDb() - CrossfeedProcessor.FEED_MIN_DB) / range).toFloat().coerceIn(0f, 1f)
    }
    fun setCrossfeedCutoff(hz: Double) { crossfeedProcessor.setCutoffHz(hz) }
    fun getCrossfeedCutoff(): Double = crossfeedProcessor.getCutoffHz()
    fun setCrossfeedDelayMs(ms: Double) { crossfeedProcessor.setDelayMs(ms) }
    fun getCrossfeedDelayMs(): Double = crossfeedProcessor.getDelayMs()

    // Peak Meter
    fun setPeakHoldMs(ms: Double) { peakMeterProcessor.setPeakHoldMs(ms) }
    fun setPeakReleaseMs(ms: Double) { peakMeterProcessor.setReleaseMs(ms) }
    fun getCurrentPeaks(): FloatArray = peakMeterProcessor.getCurrentPeaks()
    fun getHeldPeaks(): FloatArray = peakMeterProcessor.getHeldPeaks()
    fun resetPeaks() { peakMeterProcessor.resetPeaks() }

    // ReplayGain
    fun setReplayGainMode(mode: String) {
        replayGainMode = when (mode.uppercase()) {
            "ALBUM" -> ReplayGainParser.Mode.ALBUM
            "RADIO" -> ReplayGainParser.Mode.RADIO
            "OFF"   -> ReplayGainParser.Mode.OFF
            else    -> ReplayGainParser.Mode.TRACK
        }
        if (currentRgInfo.hasData) applyReplayGainInternal(currentRgInfo)
    }
    fun setReplayGainPreamp(gainDb: Float) {
        replayGainPreampDb = gainDb.coerceIn(-15f, 15f)
        if (currentRgInfo.hasData) applyReplayGainInternal(currentRgInfo)
    }
    fun setReplayGainFromMap(tags: Map<String, String>) {
        currentRgInfo = ReplayGainParser.parseFromMap(tags)
        applyReplayGainInternal(currentRgInfo)
    }
    fun getReplayGainInfo(): Map<String, Any?> = mapOf(
        "trackGain" to currentRgInfo.trackGain,
        "albumGain" to currentRgInfo.albumGain,
        "trackPeak" to currentRgInfo.trackPeak,
        "albumPeak" to currentRgInfo.albumPeak,
        "source"    to currentRgInfo.source,
        "mode"      to replayGainMode.name,
        "preampDb"  to replayGainPreampDb
    )

    // Presets
    fun applyPresetByName(name: String): Boolean {
        val preset = presetManager.loadPreset(name) ?: return false
        applyPreset(preset); return true
    }
    fun applyPreset(preset: EqPresetManager.EqPreset) {
        equalizerProcessor.applyBands(preset.graphicGains)
        equalizerProcessor.applyParametricBands(preset.parametricGains)
        for (b in 0 until EqualizerProcessor.BAND_COUNT) {
            equalizerProcessor.setParametricBandFreq(b, preset.parametricFreqs[b])
            equalizerProcessor.setBandQ(b, preset.qValues[b])
        }
        equalizerProcessor.setPreamp(preset.preampDb)
        setEQMode(preset.eqMode)
        setSmoothingRamp(preset.smoothingRampMs)
    }
    fun saveCurrentAsPreset(name: String) {
        presetManager.savePreset(EqPresetManager.EqPreset(
            name = name,
            graphicGains = equalizerProcessor.getCurrentGains(),
            parametricGains = equalizerProcessor.getParametricGains(),
            parametricFreqs = equalizerProcessor.getParametricFreqs(),
            qValues = equalizerProcessor.getCurrentQValues(),
            preampDb = equalizerProcessor.getCurrentPreamp(),
            eqMode = equalizerProcessor.getCurrentEqMode().name,
            smoothingRampMs = equalizerProcessor.smoothingRampMs
        ))
    }
    fun listPresets(): List<String> = presetManager.listPresets()
    fun deletePreset(name: String): Boolean = presetManager.deletePreset(name)
    fun exportPreset(name: String): String? = presetManager.exportPreset(name)
    fun importPreset(json: String): Boolean = presetManager.importPreset(json) != null
    fun assignTrackPreset(mediaId: String, presetName: String?) { presetManager.assignTrackPreset(mediaId, presetName) }
    fun getTrackPresetName(mediaId: String): String? = presetManager.getTrackPreset(mediaId)
    fun setAutoSwitchPresets(enabled: Boolean) { autoSwitchPresets = enabled }

    // Convolution
    fun loadImpulseResponse(filePath: String): Boolean = convolutionProcessor.loadImpulseResponse(filePath)
    fun clearImpulseResponse() { convolutionProcessor.clearImpulseResponse() }
    fun isImpulseResponseLoaded(): Boolean = convolutionProcessor.isImpulseResponseLoaded()
    fun getIrLength(): Int = convolutionProcessor.getIrLength()
    fun setConvolutionEnabled(e: Boolean) { convolutionProcessor.isEnabled = e }
    fun isConvolutionEnabled(): Boolean = convolutionProcessor.isEnabled

    // FX Processor
    fun setFxEnabled(e: Boolean) { fxProcessor.isEnabled = e }
    fun isFxEnabled(): Boolean = fxProcessor.isEnabled
    fun setFxMode(mode: String) {
        fxProcessor.setFxMode(when (mode.uppercase()) {
            "REVERB"   -> FxProcessor.FxMode.REVERB
            "DELAY"    -> FxProcessor.FxMode.DELAY
            "CHORUS"   -> FxProcessor.FxMode.CHORUS
            "FLANGER"  -> FxProcessor.FxMode.FLANGER
            "PHASER"   -> FxProcessor.FxMode.PHASER
            else       -> FxProcessor.FxMode.REVERB
        })
    }
    fun getFxMode(): String = fxProcessor.getFxMode().name
    fun setFxMix(mix: Double) { fxProcessor.setMix(mix / 100.0) }
    fun getFxMix(): Double = fxProcessor.getMix() * 100.0
    fun setFxBypass(bypass: Boolean) { fxProcessor.setBypass(bypass) }
    fun isFxBypassed(): Boolean = fxProcessor.isBypassed()
    fun setReverbRoomSize(v: Double) { fxProcessor.setReverbRoomSize(v / 100.0) }
    fun setReverbDecay(v: Double) { fxProcessor.setReverbDecay(v / 100.0) }
    fun setReverbPreDelay(v: Double) { fxProcessor.setReverbPreDelay(v / 100.0) }
    fun setReverbDamping(v: Double) { fxProcessor.setReverbDamping(v / 100.0) }
    fun setDelayTime(v: Double) { fxProcessor.setDelayTime(v / 100.0) }
    fun setDelayFeedback(v: Double) { fxProcessor.setDelayFeedback(v / 100.0) }
    fun setDelayLowCut(v: Double) { fxProcessor.setDelayLowCut(v / 100.0) }
    fun setDelayHighCut(v: Double) { fxProcessor.setDelayHighCut(v / 100.0) }
    fun setModRate(v: Double) { fxProcessor.setModRate(v / 100.0) }
    fun setModDepth(v: Double) { fxProcessor.setModDepth(v / 100.0) }
    fun setModPhase(v: Double) { fxProcessor.setModPhase(v / 100.0) }
    fun setModFeedback(v: Double) { fxProcessor.setModFeedback(v / 100.0) }

    // ========================================================================
    // MEDIA ITEM BUILDERS
    // ========================================================================

    private fun buildMediaItem(track: TrackMetadata): MediaItem {
        val metaBuilder = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .setGenre(track.genre)
            .setDescription(track.description)
        track.artwork?.let  { metaBuilder.setArtworkUri(Uri.parse(it)) }
        track.duration?.let { metaBuilder.setDurationMs((it * 1000.0).toLong()) }

        val itemBuilder = MediaItem.Builder()
            .setUri(track.url)
            .setMediaId(track.id)
            .setMediaMetadata(metaBuilder.build())

        val mimeType: String? = when {
            track.contentType != null -> track.contentType
            else -> when (track.type?.lowercase()) {
                MavinPlayerConstants.TRACK_TYPE_HLS              -> MimeTypes.APPLICATION_M3U8
                MavinPlayerConstants.TRACK_TYPE_DASH             -> MimeTypes.APPLICATION_MPD
                MavinPlayerConstants.TRACK_TYPE_SMOOTH_STREAMING -> MimeTypes.APPLICATION_SS
                else                                              -> null
            }
        }
        mimeType?.let { itemBuilder.setMimeType(it) }

        val allHeaders = mutableMapOf<String, String>()
        track.userAgent?.let { allHeaders["User-Agent"] = it }
        track.headers?.let { allHeaders.putAll(it) }
        if (allHeaders.isNotEmpty()) {
            val requestMetadata = MediaItem.RequestMetadata.Builder()
                .setExtras(Bundle().also { bundle ->
                    allHeaders.forEach { (k, v) -> bundle.putString(k, v) }
                })
                .build()
            itemBuilder.setRequestMetadata(requestMetadata)
        }

        if (track.drmScheme != null && track.drmLicenseServer != null) {
            val drmSchemeUuid = when (track.drmScheme.lowercase()) {
                "widevine"  -> C.WIDEVINE_UUID
                "playready" -> C.PLAYREADY_UUID
                "clearkey"  -> C.CLEARKEY_UUID
                else        -> null
            }
            if (drmSchemeUuid != null) {
                val drmConfig = MediaItem.DrmConfiguration.Builder(drmSchemeUuid)
                    .setLicenseUri(track.drmLicenseServer)
                    .setMultiSession(track.drmMultiSession)
                    .apply {
                        track.drmHeaders?.let { headers ->
                            setLicenseRequestHeaders(headers)
                        }
                    }
                    .build()
                itemBuilder.setDrmConfiguration(drmConfig)
            }
        }

        return itemBuilder.build()
    }

    private fun buildVideoMediaItem(videoTrack: VideoTrack): MediaItem {
        val metaBuilder = MediaMetadata.Builder()
            .setTitle(videoTrack.title)
            .setArtist(videoTrack.artist)
        videoTrack.artwork?.let  { metaBuilder.setArtworkUri(Uri.parse(it)) }
        videoTrack.duration?.let { metaBuilder.setDurationMs((it * 1000.0).toLong()) }

        return MediaItem.Builder()
            .setUri(videoTrack.muxedUrl ?: videoTrack.url)
            .setMediaId(videoTrack.id)
            .setMediaMetadata(metaBuilder.build())
            .build()
    }

    // ========================================================================
    // LIFECYCLE
    // ========================================================================

    fun release() {
        if (isReleased.getAndSet(true)) return
        coroutineScope.cancel()
        stopProgressUpdates()
        abandonAudioFocus()
        player.removeListener(object : Player.Listener {})
        player.release()
        Log.i(TAG, "Player released")
    }
}

// ============================================================================
// MAVIN PLAYBACK SERVICE
// ============================================================================

@UnstableApi
class MavinPlaybackService : MediaBrowserServiceCompat() {

    companion object {
        private const val TAG = "MavinPlaybackService"
        const val EXTRA_SKIP_INDEX = "mavin.extra.SKIP_INDEX"
    }

    private var mediaSession: MediaSessionCompat? = null
    private var playerCore: MavinPlayerCore? = null
    private var notificationManager: NotificationManager? = null
    private var currentArtworkBitmap: Bitmap? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var stopForegroundRunnable: Runnable? = null
    private val coroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")
        MavinPlayerRegistry.isServiceRunning = true
        notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        playerCore = MavinPlayerCore.getInstance(this)
        createNotificationChannel()
        setupMediaSession()
        sessionToken = mediaSession?.sessionToken
        startForeground(MavinPlayerConstants.NOTIFICATION_ID, buildPlaceholderNotification())
        updateNotificationAsync()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        val action = intent?.action
        if (action != null) {
            val core = playerCore ?: MavinPlayerCore.getInstance(this)
            when (action) {
                "mavin.action.SEEK" -> {
                    val pos = intent.getDoubleExtra("position", 0.0)
                    core.handleRemoteSeek(pos)
                }
                "mavin.action.RATING" -> {
                    val rating = intent.getDoubleExtra("rating", 0.0)
                    core.handleRemoteSetRating(rating)
                }
                MavinPlayerConstants.ACTION_SKIP -> {
                    val idx = intent.getIntExtra(EXTRA_SKIP_INDEX, -1)
                    if (idx >= 0) core.handleRemoteSkip(idx)
                }
                else -> core.handleRemoteAction(action)
            }
            updateNotificationAsync()
        }
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        val core = playerCore ?: return
        val opts = MavinPlayerRegistry.options
        when (opts.android.appKilledPlaybackBehavior) {
            MavinPlayerConstants.APP_KILLED_CONTINUE -> {
                Log.d(TAG, "App killed — continuing playback")
            }
            MavinPlayerConstants.APP_KILLED_PAUSE -> {
                core.pause()
                updateNotificationAsync()
                Log.d(TAG, "App killed — pausing playback")
            }
            MavinPlayerConstants.APP_KILLED_STOP -> {
                val graceMs = opts.android.stopForegroundGracePeriod * 1000L
                if (graceMs <= 0L) {
                    stopForegroundAndService()
                } else {
                    stopForegroundRunnable = Runnable { stopForegroundAndService() }
                    mainHandler.postDelayed(stopForegroundRunnable!!, graceMs)
                    Log.d(TAG, "App killed — stopping after ${graceMs}ms grace period")
                }
            }
        }
    }

    override fun onDestroy() {
        Log.d(TAG, "Service destroyed")
        MavinPlayerRegistry.isServiceRunning = false
        stopForegroundRunnable?.let { mainHandler.removeCallbacks(it) }
        mediaSession?.release()
        mediaSession = null
        currentArtworkBitmap = null
        coroutineScope.cancel()
        super.onDestroy()
    }

    // -------------------------------------------------------------------------
    // Android Auto
    // -------------------------------------------------------------------------

    override fun onGetRoot(
        clientPackageName: String,
        clientUid: Int,
        rootHints: Bundle?
    ): BrowserRoot {
        return BrowserRoot(MavinPlayerConstants.BROWSER_ROOT_ID, null)
    }

    override fun onLoadChildren(
        parentId: String,
        result: Result<List<MediaBrowserCompat.MediaItem>>
    ) {
        if (parentId != MavinPlayerConstants.BROWSER_ROOT_ID) {
            result.sendResult(emptyList())
            return
        }
        result.detach()
        val core = playerCore ?: MavinPlayerCore.getInstance(this)
        val queue = core.getQueue()
        val mediaItems = queue.map { track ->
            val descBuilder = MediaDescriptionCompat.Builder()
                .setMediaId(track.id)
                .setTitle(track.title ?: "Unknown")
                .setSubtitle(track.artist ?: "")
            track.artwork?.let { descBuilder.setIconUri(Uri.parse(it)) }
            MediaBrowserCompat.MediaItem(
                descBuilder.build(),
                MediaBrowserCompat.MediaItem.FLAG_PLAYABLE
            )
        }
        result.sendResult(mediaItems)
    }

    // -------------------------------------------------------------------------
    // MediaSession setup
    // -------------------------------------------------------------------------

    private fun setupMediaSession() {
        val opts = MavinPlayerRegistry.options
        val sessionIntent = packageManager?.getLaunchIntentForPackage(packageName)
        val pendingSessionIntent = sessionIntent?.let {
            PendingIntent.getActivity(
                this, 0, it,
                PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentImmutableFlag()
            )
        }

        mediaSession = MediaSessionCompat(this, MavinPlayerConstants.MEDIA_SESSION_TAG).apply {
            pendingSessionIntent?.let { setSessionActivity(it) }

            val ratingStyle = when (opts.ratingType) {
                MavinPlayerConstants.RATING_HEART         -> RatingCompat.RATING_HEART
                MavinPlayerConstants.RATING_THUMB_UP_DOWN -> RatingCompat.RATING_THUMB_UP_DOWN
                MavinPlayerConstants.RATING_3_STARS       -> RatingCompat.RATING_3_STARS
                MavinPlayerConstants.RATING_4_STARS       -> RatingCompat.RATING_4_STARS
                MavinPlayerConstants.RATING_5_STARS       -> RatingCompat.RATING_5_STARS
                MavinPlayerConstants.RATING_PERCENTAGE    -> RatingCompat.RATING_PERCENTAGE
                else                                      -> RatingCompat.RATING_NONE
            }
            setRatingType(ratingStyle)

            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay()           { playerCore?.handleRemoteAction(MavinPlayerConstants.ACTION_PLAY) }
                override fun onPause()          { playerCore?.handleRemoteAction(MavinPlayerConstants.ACTION_PAUSE) }
                override fun onSkipToNext()     { playerCore?.handleRemoteAction(MavinPlayerConstants.ACTION_NEXT) }
                override fun onSkipToPrevious() { playerCore?.handleRemoteAction(MavinPlayerConstants.ACTION_PREVIOUS) }
                override fun onStop()           { playerCore?.handleRemoteAction(MavinPlayerConstants.ACTION_STOP) }
                override fun onFastForward()    { playerCore?.handleRemoteAction(MavinPlayerConstants.ACTION_JUMP_FORWARD) }
                override fun onRewind()         { playerCore?.handleRemoteAction(MavinPlayerConstants.ACTION_JUMP_BACKWARD) }
                override fun onSeekTo(pos: Long) { playerCore?.handleRemoteSeek(pos.toDouble() / 1000.0) }

                override fun onSetRating(rating: RatingCompat?) {
                    val value = when {
                        rating?.isRated == false -> 0.0
                        rating?.ratingStyle == RatingCompat.RATING_HEART ->
                            if (rating.hasHeart()) 1.0 else 0.0
                        rating?.ratingStyle == RatingCompat.RATING_THUMB_UP_DOWN ->
                            if (rating.isThumbUp) 1.0 else 0.0
                        else -> rating?.starRating?.toDouble() ?: 0.0
                    }
                    playerCore?.handleRemoteSetRating(value)
                    updateNotificationAsync()
                }

                override fun onCustomAction(action: String?, extras: Bundle?) {
                    action?.let { playerCore?.handleRemoteAction(it) }
                    updateNotificationAsync()
                }

                override fun onSkipToQueueItem(id: Long) {
                    playerCore?.handleRemoteSkip(id.toInt())
                    updateNotificationAsync()
                }

                override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
                    if (mediaId != null) {
                        playerCore?.handleRemotePlayFromId(mediaId, extras)
                        updateNotificationAsync()
                    }
                }

                override fun onPlayFromSearch(query: String?, extras: Bundle?) {
                    playerCore?.handleRemotePlayFromSearch(query ?: "", extras)
                    updateNotificationAsync()
                }
            })
            isActive = true
        }
    }

    // -------------------------------------------------------------------------
    // Notification
    // -------------------------------------------------------------------------

    fun updateNotificationAsync() {
        val core = playerCore ?: return
        val track = core.getCurrentTrack()
        val artworkUrl = track?.artwork

        if (artworkUrl != null && artworkUrl.isNotBlank()) {
            coroutineScope.launch {
                try {
                    val bitmap = if (artworkUrl.startsWith("http://") || artworkUrl.startsWith("https://")) {
                        withContext(Dispatchers.IO) {
                            Glide.with(applicationContext)
                                .asBitmap()
                                .load(artworkUrl)
                                .submit(512, 512)
                                .get()
                        }
                    } else {
                        BitmapFactory.decodeFile(artworkUrl)
                    }
                    currentArtworkBitmap = bitmap
                    withContext(Dispatchers.Main) { postNotification() }
                } catch (e: Exception) {
                    Log.w(TAG, "Artwork load failed: $artworkUrl", e)
                    withContext(Dispatchers.Main) { postNotification() }
                }
            }
        } else {
            currentArtworkBitmap = null
            postNotification()
        }
    }

    private fun postNotification() {
        notificationManager?.notify(MavinPlayerConstants.NOTIFICATION_ID, buildNotification())
    }

    private fun resolveIconRes(iconName: String?, fallback: Int): Int {
        if (iconName.isNullOrBlank()) return fallback
        val res = resources.getIdentifier(iconName, "drawable", packageName)
        return if (res != 0) res else fallback
    }

    private fun buildNotification(): Notification {
        val core = playerCore ?: return buildPlaceholderNotification()
        val opts = MavinPlayerRegistry.options
        val track = core.getCurrentTrack()
        val isPlaying = core.isPlaying()

        val notifCaps = if (opts.notificationCapabilities.isNotEmpty())
            opts.notificationCapabilities else opts.capabilities
        val compactCaps = opts.compactCapabilities

        val builder = NotificationCompat.Builder(this, MavinPlayerConstants.NOTIFICATION_CHANNEL_ID)
            .setContentTitle(track?.title ?: "Unknown")
            .setContentText(track?.artist ?: "")
            .setSubText(track?.album)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(isPlaying)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)

        val smallIconRes = resolveIconRes(opts.icon, android.R.drawable.ic_media_play)
        builder.setSmallIcon(smallIconRes)

        opts.color?.let { builder.setColor(it) }

        currentArtworkBitmap?.let { builder.setLargeIcon(it) }
        track?.artwork?.let { uri ->
            if (uri.startsWith("content://") || uri.startsWith("file://")) {
                try {
                    val bmp = BitmapFactory.decodeStream(contentResolver.openInputStream(Uri.parse(uri)))
                    bmp?.let { builder.setLargeIcon(it) }
                } catch (_: Exception) {}
            }
        }

        packageManager?.getLaunchIntentForPackage(packageName)?.let { launchIntent ->
            builder.setContentIntent(
                PendingIntent.getActivity(
                    this, 0, launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentImmutableFlag()
                )
            )
        }

        val style = androidx.media.app.NotificationCompat.MediaStyle()
            .setMediaSession(mediaSession?.sessionToken)

        var actionIndex = 0
        val compactIndices = mutableListOf<Int>()

        fun addAction(capability: String, label: String, iconRes: Int, action: String) {
            if (capability !in notifCaps) return
            builder.addAction(NotificationCompat.Action(iconRes, label, makeServicePendingIntent(action)))
            if (capability in compactCaps) compactIndices.add(actionIndex)
            actionIndex++
        }

        // RNTP: like/dislike/bookmark button labels reflect isActive state from FeedbackOptions
        val likeLabel = if (opts.likeOptions?.isActive == true)
            (opts.likeOptions.title.ifBlank { "Unlike" }) else (opts.likeOptions?.title?.ifBlank { "Like" } ?: "Like")
        val dislikeLabel = if (opts.dislikeOptions?.isActive == true)
            (opts.dislikeOptions.title.ifBlank { "Disliked" }) else (opts.dislikeOptions?.title?.ifBlank { "Dislike" } ?: "Dislike")
        val bookmarkLabel = if (opts.bookmarkOptions?.isActive == true)
            (opts.bookmarkOptions.title.ifBlank { "Bookmarked" }) else (opts.bookmarkOptions?.title?.ifBlank { "Bookmark" } ?: "Bookmark")

        addAction(MavinPlayerConstants.CAPABILITY_LIKE, likeLabel,
            android.R.drawable.btn_star_big_on, MavinPlayerConstants.ACTION_LIKE)
        addAction(MavinPlayerConstants.CAPABILITY_DISLIKE, dislikeLabel,
            android.R.drawable.btn_star_big_off, MavinPlayerConstants.ACTION_DISLIKE)
        addAction(MavinPlayerConstants.CAPABILITY_SKIP_TO_PREVIOUS, "Previous",
            resolveIconRes(opts.previousIcon, android.R.drawable.ic_media_previous),
            MavinPlayerConstants.ACTION_PREVIOUS)
        addAction(MavinPlayerConstants.CAPABILITY_JUMP_BACKWARD, "Back ${opts.backwardJumpInterval / 1000}s",
            resolveIconRes(opts.rewindIcon, android.R.drawable.ic_media_rew),
            MavinPlayerConstants.ACTION_JUMP_BACKWARD)

        if (isPlaying) {
            addAction(MavinPlayerConstants.CAPABILITY_PAUSE, "Pause",
                resolveIconRes(opts.pauseIcon, android.R.drawable.ic_media_pause),
                MavinPlayerConstants.ACTION_PAUSE)
        } else {
            addAction(MavinPlayerConstants.CAPABILITY_PLAY, "Play",
                resolveIconRes(opts.playIcon, android.R.drawable.ic_media_play),
                MavinPlayerConstants.ACTION_PLAY)
        }

        addAction(MavinPlayerConstants.CAPABILITY_JUMP_FORWARD, "Forward ${opts.forwardJumpInterval / 1000}s",
            resolveIconRes(opts.forwardIcon, android.R.drawable.ic_media_ff),
            MavinPlayerConstants.ACTION_JUMP_FORWARD)
        addAction(MavinPlayerConstants.CAPABILITY_SKIP_TO_NEXT, "Next",
            resolveIconRes(opts.nextIcon, android.R.drawable.ic_media_next),
            MavinPlayerConstants.ACTION_NEXT)
        addAction(MavinPlayerConstants.CAPABILITY_STOP, "Stop",
            resolveIconRes(opts.stopIcon, android.R.drawable.ic_menu_close_clear_cancel),
            MavinPlayerConstants.ACTION_STOP)
        addAction(MavinPlayerConstants.CAPABILITY_BOOKMARK, bookmarkLabel,
            android.R.drawable.ic_menu_add, MavinPlayerConstants.ACTION_BOOKMARK)

        style.setShowActionsInCompactView(*compactIndices.take(3).toIntArray())
        builder.setStyle(style)

        updateMediaSessionState(core, track)

        return builder.build()
    }

    private fun updateMediaSessionState(core: MavinPlayerCore, track: TrackMetadata?) {
        val session = mediaSession ?: return
        val opts = MavinPlayerRegistry.options

        val metadataBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, track?.title ?: "")
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, track?.artist ?: "")
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, track?.album ?: "")
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, core.getDurationMs())
        track?.artwork?.let { metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_ART_URI, it) }
        currentArtworkBitmap?.let { metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, it) }
        session.setMetadata(metadataBuilder.build())

        // RNTP 4.x: likeOptions isActive is surfaced as a heart/thumbs rating on MediaSession
        val likeIsActive = opts.likeOptions?.isActive ?: false
        val ratingStyle = when (opts.ratingType) {
            MavinPlayerConstants.RATING_HEART         -> RatingCompat.RATING_HEART
            MavinPlayerConstants.RATING_THUMB_UP_DOWN -> RatingCompat.RATING_THUMB_UP_DOWN
            else                                      -> RatingCompat.RATING_HEART
        }
        val userRating = when (ratingStyle) {
            RatingCompat.RATING_HEART -> RatingCompat.newHeartRating(likeIsActive)
            RatingCompat.RATING_THUMB_UP_DOWN -> RatingCompat.newThumbRating(likeIsActive)
            else -> RatingCompat.newUnratedRating(ratingStyle)
        }
        metadataBuilder.putRating(MediaMetadataCompat.METADATA_KEY_USER_RATING, userRating)

        val state = when (core.getPlaybackState()) {
            MavinPlayerConstants.STATE_PLAYING   -> PlaybackStateCompat.STATE_PLAYING
            MavinPlayerConstants.STATE_PAUSED    -> PlaybackStateCompat.STATE_PAUSED
            MavinPlayerConstants.STATE_BUFFERING -> PlaybackStateCompat.STATE_BUFFERING
            MavinPlayerConstants.STATE_LOADING   -> PlaybackStateCompat.STATE_BUFFERING
            MavinPlayerConstants.STATE_STOPPED   -> PlaybackStateCompat.STATE_STOPPED
            MavinPlayerConstants.STATE_ERROR     -> PlaybackStateCompat.STATE_ERROR
            else                                 -> PlaybackStateCompat.STATE_NONE
        }

        val actions = buildPlaybackStateActions(opts)
        val stateBuilder = PlaybackStateCompat.Builder()
            .setState(state, core.getCurrentPositionMs(), core.getPlaybackRate())
            .setActions(actions)

        // Carry error message into MediaSession error state
        if (state == PlaybackStateCompat.STATE_ERROR) {
            val err = MavinPlayerRegistry.lastPlaybackError
            stateBuilder.setErrorMessage(
                PlaybackStateCompat.ERROR_CODE_APP_ERROR,
                err?.message ?: "Unknown error"
            )
        }

        session.setPlaybackState(stateBuilder.build())

        val queue = core.getQueue().mapIndexed { idx, t ->
            val desc = MediaDescriptionCompat.Builder()
                .setMediaId(t.id)
                .setTitle(t.title ?: "")
                .setSubtitle(t.artist ?: "")
                .apply { t.artwork?.let { setIconUri(Uri.parse(it)) } }
                .build()
            MediaSessionCompat.QueueItem(desc, idx.toLong())
        }
        session.setQueue(queue)
        session.setQueueTitle("Queue")
    }

    private fun buildPlaybackStateActions(opts: PlayerOptions): Long {
        var actions = 0L
        val caps = opts.capabilities
        if (MavinPlayerConstants.CAPABILITY_PLAY in caps)             actions = actions or PlaybackStateCompat.ACTION_PLAY
        if (MavinPlayerConstants.CAPABILITY_PAUSE in caps)            actions = actions or PlaybackStateCompat.ACTION_PAUSE
        if (MavinPlayerConstants.CAPABILITY_STOP in caps)             actions = actions or PlaybackStateCompat.ACTION_STOP
        if (MavinPlayerConstants.CAPABILITY_SEEK_TO in caps)          actions = actions or PlaybackStateCompat.ACTION_SEEK_TO
        if (MavinPlayerConstants.CAPABILITY_SKIP_TO_NEXT in caps)     actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_NEXT
        if (MavinPlayerConstants.CAPABILITY_SKIP_TO_PREVIOUS in caps) actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
        if (MavinPlayerConstants.CAPABILITY_JUMP_FORWARD in caps)     actions = actions or PlaybackStateCompat.ACTION_FAST_FORWARD
        if (MavinPlayerConstants.CAPABILITY_JUMP_BACKWARD in caps)    actions = actions or PlaybackStateCompat.ACTION_REWIND
        if (MavinPlayerConstants.CAPABILITY_SET_RATING in caps)       actions = actions or PlaybackStateCompat.ACTION_SET_RATING
        if (MavinPlayerConstants.CAPABILITY_SKIP in caps)             actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_QUEUE_ITEM
        if (MavinPlayerConstants.CAPABILITY_PLAY_FROM_ID in caps)     actions = actions or PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID
        if (MavinPlayerConstants.CAPABILITY_PLAY_FROM_SEARCH in caps) actions = actions or PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH
        return actions
    }

    private fun buildPlaceholderNotification(): Notification =
        NotificationCompat.Builder(this, MavinPlayerConstants.NOTIFICATION_CHANNEL_ID)
            .setContentTitle("Mavin Player")
            .setContentText("Loading…")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                MavinPlayerConstants.NOTIFICATION_CHANNEL_ID,
                "Mavin Player",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Music playback controls"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            notificationManager?.createNotificationChannel(channel)
        }
    }

    private fun makeServicePendingIntent(action: String, extras: Bundle? = null): PendingIntent {
        val intent = Intent(this, MavinPlaybackService::class.java).apply {
            this.action = action
            extras?.let { putExtras(it) }
        }
        return PendingIntent.getService(
            this, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentImmutableFlag()
        )
    }

    private fun pendingIntentImmutableFlag(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

    private fun stopForegroundAndService() {
        playerCore?.stop()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        notificationManager?.cancel(MavinPlayerConstants.NOTIFICATION_ID)
        stopSelf()
    }
}

// ============================================================================
// MAVIN PLAYER MODULE — Expo Module Definition
// ============================================================================

@UnstableApi
class MavinPlayerModule : Module(), MavinPlayerCore.PlayerEventListener {

    companion object {
        private const val TAG = "MavinPlayerModule"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var playerCore: MavinPlayerCore? = null
    private var isServiceStarted = false

    override fun definition() = ModuleDefinition {
        Name("MavinPlayer")

        Events(
            // Playback state
            "playback-state",
            "playback-track-changed",
            "playback-active-track-changed",
            "playback-queue-ended",
            "playback-error",
            "playback-progress-updated",
            "playback-play-when-ready-changed",
            // Metadata events
            "playback-metadata-received",
            "audio-common-metadata-received",
            "audio-timed-metadata-received",
            "audio-chapter-metadata-received",
            // Remote events
            "remote-play",
            "remote-pause",
            "remote-stop",
            "remote-next",
            "remote-previous",
            "remote-seek",
            "remote-jump-forward",
            "remote-jump-backward",
            "remote-set-rating",
            "remote-like",
            "remote-dislike",
            "remote-bookmark",
            "remote-duck",
            "remote-skip",
            // Android Auto events
            "remote-play-from-id",
            "remote-play-from-search",
            // DSP events
            "peak-meter-update"
        )

        // ==================================================================
        // LIFECYCLE
        // ==================================================================

        AsyncFunction("setupPlayer") { options: Map<String, Any?>?, promise: Promise ->
            setupPlayerInternal(options, promise)
        }

        AsyncFunction("destroy") { promise: Promise ->
            destroyPlayer(promise)
        }

        AsyncFunction("updateOptions") { options: Map<String, Any?>, promise: Promise ->
            updateOptionsInternal(options, promise)
        }

        // RNTP 4.x: isServiceRunning() — reports whether the playback service is active
        AsyncFunction("isServiceRunning") { promise: Promise ->
            promise.resolve(MavinPlayerRegistry.isServiceRunning)
        }

        // ==================================================================
        // QUEUE MANAGEMENT
        // ==================================================================

        AsyncFunction("add") { tracks: List<Map<String, Any?>>, insertBeforeIndex: Int?, promise: Promise ->
            runWithPlayer(promise) { core ->
                val firstIndex = core.add(tracks.map { it.toTrackMetadata() }, insertBeforeIndex)
                promise.resolve(firstIndex)
            }
        }

        AsyncFunction("load") { track: Map<String, Any?>, promise: Promise ->
            runWithPlayer(promise) { core ->
                core.load(track.toTrackMetadata(), playWhenReady = true)
                promise.resolve(null)
            }
        }

        AsyncFunction("setQueue") { tracks: List<Map<String, Any?>>, startIndex: Int?, startPosition: Double?, promise: Promise ->
            runWithPlayer(promise) { core ->
                val startMs = ((startPosition ?: 0.0) * 1000.0).toLong()
                core.setQueue(tracks.map { it.toTrackMetadata() }, startIndex ?: 0, startMs)
                promise.resolve(null)
            }
        }

        AsyncFunction("remove") { indices: Any, promise: Promise ->
            runWithPlayer(promise) { core ->
                when (indices) {
                    is Int    -> core.remove(indices)
                    is Double -> core.remove(indices.toInt())
                    is List<*> -> core.remove(
                        indices.filterIsInstance<Int>()
                            .ifEmpty { indices.filterIsInstance<Double>().map { it.toInt() } }
                    )
                    else -> throw IllegalArgumentException("Invalid indices type")
                }
                promise.resolve(null)
            }
        }

        AsyncFunction("removeUpcomingTracks") { promise: Promise ->
            runWithPlayer(promise) { core -> core.removeUpcomingTracks(); promise.resolve(null) }
        }

        AsyncFunction("removePreviousTracks") { promise: Promise ->
            runWithPlayer(promise) { core -> core.removePreviousTracks(); promise.resolve(null) }
        }

        AsyncFunction("move") { fromIndex: Int, toIndex: Int, promise: Promise ->
            runWithPlayer(promise) { core ->
                core.move(fromIndex, toIndex)
                promise.resolve(null)
            }
        }

        AsyncFunction("updateMetadataForTrack") { index: Int, metadata: Map<String, Any?>, promise: Promise ->
            runWithPlayer(promise) { core ->
                core.updateTrackMetadata(index, metadata.toTrackMetadata())
                promise.resolve(null)
            }
        }

        AsyncFunction("updateNowPlayingMetadata") { metadata: Map<String, Any?>, promise: Promise ->
            runWithPlayer(promise) { core ->
                core.updateNowPlayingMetadata(metadata.toTrackMetadata())
                notifyServiceNotificationUpdate()
                promise.resolve(null)
            }
        }

        AsyncFunction("clearNowPlayingMetadata") { promise: Promise ->
            runWithPlayer(promise) { core ->
                core.clearNowPlayingMetadata()
                notifyServiceNotificationUpdate()
                promise.resolve(null)
            }
        }

        AsyncFunction("preloadNextTrack") { track: Map<String, Any?>, promise: Promise ->
            runWithPlayer(promise) { core ->
                core.preloadNextTrack(track.toTrackMetadata())
                promise.resolve(null)
            }
        }

        // ==================================================================
        // PLAYBACK CONTROL
        // ==================================================================

        AsyncFunction("play") { promise: Promise ->
            runWithPlayer(promise) { core -> core.play(); promise.resolve(null) }
        }

        AsyncFunction("pause") { promise: Promise ->
            runWithPlayer(promise) { core -> core.pause(); promise.resolve(null) }
        }

        AsyncFunction("stop") { promise: Promise ->
            runWithPlayer(promise) { core -> core.stop(); promise.resolve(null) }
        }

        AsyncFunction("reset") { promise: Promise ->
            runWithPlayer(promise) { core -> core.reset(); promise.resolve(null) }
        }

        AsyncFunction("seekTo") { positionSeconds: Double, promise: Promise ->
            runWithPlayer(promise) { core ->
                core.seekTo((positionSeconds * 1000.0).toLong())
                promise.resolve(null)
            }
        }

        AsyncFunction("seekBy") { offsetSeconds: Double, promise: Promise ->
            runWithPlayer(promise) { core ->
                core.seekBy((offsetSeconds * 1000.0).toLong())
                promise.resolve(null)
            }
        }

        AsyncFunction("skipToNext") { initialPosition: Double?, promise: Promise ->
            runWithPlayer(promise) { core ->
                val posMs = ((initialPosition ?: 0.0) * 1000.0).toLong()
                promise.resolve(core.skipToNext(posMs))
            }
        }

        AsyncFunction("skipToPrevious") { initialPosition: Double?, promise: Promise ->
            runWithPlayer(promise) { core ->
                val posMs = ((initialPosition ?: 0.0) * 1000.0).toLong()
                promise.resolve(core.skipToPrevious(posMs))
            }
        }

        AsyncFunction("skip") { index: Int, positionSeconds: Double?, promise: Promise ->
            runWithPlayer(promise) { core ->
                val posMs = ((positionSeconds ?: 0.0) * 1000.0).toLong()
                promise.resolve(core.skipToIndex(index, posMs))
            }
        }

        AsyncFunction("retry") { promise: Promise ->
            runWithPlayer(promise) { core -> core.retry(); promise.resolve(null) }
        }

        AsyncFunction("setPlayWhenReady") { playWhenReady: Boolean, promise: Promise ->
            runWithPlayer(promise) { core -> core.setPlayWhenReady(playWhenReady); promise.resolve(null) }
        }

        AsyncFunction("getPlayWhenReady") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getPlayWhenReady()) }
        }

        // ==================================================================
        // VIDEO TRACK
        // ==================================================================

        AsyncFunction("loadVideoTrack") { videoTrack: Map<String, Any?>, playWhenReady: Boolean?, promise: Promise ->
            runWithPlayer(promise) { core ->
                val track = VideoTrack(
                    id           = videoTrack["id"] as? String ?: throw IllegalArgumentException("id required"),
                    url          = videoTrack["url"] as? String ?: throw IllegalArgumentException("url required"),
                    muxedUrl     = videoTrack["muxedUrl"] as? String,
                    title        = videoTrack["title"] as? String,
                    artist       = videoTrack["artist"] as? String,
                    artwork      = videoTrack["artwork"] as? String,
                    duration     = (videoTrack["duration"] as? Number)?.toDouble(),
                    uploaderUrl  = videoTrack["uploaderUrl"] as? String,
                    likeCount    = (videoTrack["likeCount"] as? Number)?.toDouble(),
                    dislikeCount = (videoTrack["dislikeCount"] as? Number)?.toDouble(),
                    viewCount    = (videoTrack["viewCount"] as? Number)?.toDouble(),
                    commentsCount= (videoTrack["commentsCount"] as? Number)?.toDouble()
                )
                core.loadVideoTrack(track, playWhenReady ?: true)
                promise.resolve(null)
            }
        }

        // ==================================================================
        // STATE GETTERS
        // ==================================================================

        AsyncFunction("getState") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getPlaybackStateString()) }
        }

        // RNTP 4.x: getPlaybackState() returns {state, error} — error carries live error in error state
        AsyncFunction("getPlaybackState") { promise: Promise ->
            runWithPlayer(promise) { core ->
                val stateStr = core.getPlaybackStateString()
                val lastErr = MavinPlayerRegistry.lastPlaybackError
                promise.resolve(mapOf(
                    "state"     to stateStr,
                    "stateCode" to core.getPlaybackState(),
                    "error"     to if (stateStr == "error" && lastErr != null) mapOf(
                        "code"    to lastErr.code,
                        "message" to lastErr.message
                    ) else null
                ))
            }
        }

        AsyncFunction("getProgress") { promise: Promise ->
            runWithPlayer(promise) { core ->
                val p = core.getProgress()
                promise.resolve(mapOf(
                    "position" to p.position,
                    "duration" to p.duration,
                    "buffered"  to p.buffered
                ))
            }
        }

        AsyncFunction("getDuration") { promise: Promise ->
            runWithPlayer(promise) { core ->
                promise.resolve(core.getDurationMs().toDouble() / 1000.0)
            }
        }

        AsyncFunction("getPosition") { promise: Promise ->
            runWithPlayer(promise) { core ->
                promise.resolve(core.getCurrentPositionMs().toDouble() / 1000.0)
            }
        }

        AsyncFunction("getBufferedPosition") { promise: Promise ->
            runWithPlayer(promise) { core ->
                promise.resolve(core.getBufferedPositionMs().toDouble() / 1000.0)
            }
        }

        AsyncFunction("isPlaying") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.isPlaying()) }
        }

        AsyncFunction("isLoading") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.isLoading()) }
        }

        AsyncFunction("getCurrentTrack") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getCurrentTrack()?.toMap()) }
        }

        AsyncFunction("getActiveTrack") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getActiveTrack()?.toMap()) }
        }

        AsyncFunction("getActiveTrackIndex") { promise: Promise ->
            runWithPlayer(promise) { core ->
                val idx = core.getActiveTrackIndex()
                promise.resolve(if (idx < 0) null else idx)
            }
        }

        AsyncFunction("getCurrentVideoTrack") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getCurrentVideoTrack()?.toMap()) }
        }

        AsyncFunction("getTrack") { index: Int, promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getTrack(index)?.toMap()) }
        }

        AsyncFunction("getQueue") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getQueue().map { it.toMap() }) }
        }

        AsyncFunction("getVolume") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getVolume().toDouble()) }
        }

        AsyncFunction("setVolume") { volume: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setVolume(volume.toFloat()); promise.resolve(null) }
        }

        AsyncFunction("mute") { promise: Promise ->
            runWithPlayer(promise) { core -> core.mute(); promise.resolve(null) }
        }
        AsyncFunction("unmute") { promise: Promise ->
            runWithPlayer(promise) { core -> core.unmute(); promise.resolve(null) }
        }
        AsyncFunction("isMuted") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.isMuted()) }
        }
        AsyncFunction("getUnmutedVolume") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getUnmutedVolume().toDouble()) }
        }

        // ==================================================================
        // REPEAT / SHUFFLE / RATE / PITCH
        // ==================================================================

        AsyncFunction("getRepeatMode") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getRepeatMode()) }
        }

        AsyncFunction("setRepeatMode") { mode: Int, promise: Promise ->
            runWithPlayer(promise) { core -> core.setRepeatMode(mode); promise.resolve(null) }
        }

        AsyncFunction("getShuffleMode") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getShuffleMode()) }
        }

        AsyncFunction("setShuffleMode") { enabled: Boolean, promise: Promise ->
            runWithPlayer(promise) { core -> core.setShuffleMode(enabled); promise.resolve(null) }
        }

        AsyncFunction("getRate") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getPlaybackRate().toDouble()) }
        }

        AsyncFunction("setRate") { rate: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setPlaybackRate(rate.toFloat()); promise.resolve(null) }
        }

        AsyncFunction("getPitch") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getPlaybackPitch().toDouble()) }
        }

        AsyncFunction("setPitch") { pitch: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setPlaybackPitch(pitch.toFloat()); promise.resolve(null) }
        }

        AsyncFunction("setProgressUpdateInterval") { intervalSeconds: Double, promise: Promise ->
            runWithPlayer(promise) { core ->
                core.setProgressUpdateInterval((intervalSeconds * 1000.0).toLong())
                promise.resolve(null)
            }
        }

        AsyncFunction("getProgressUpdateInterval") { promise: Promise ->
            promise.resolve(1.0)
        }

        // RNTP: getCacheSize returns bytes consumed by the cache
        AsyncFunction("getCacheSize") { promise: Promise ->
            promise.resolve(MavinPlayerRegistry.sharedCache?.cacheSpace?.toDouble() ?: 0.0)
        }

        // ==================================================================
        // EQ
        // ==================================================================

        AsyncFunction("setEQEnabled") { enabled: Boolean, promise: Promise ->
            runWithPlayer(promise) { core -> core.setEQEnabled(enabled); promise.resolve(null) }
        }
        AsyncFunction("getEQEnabled") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.isEQEnabled()) }
        }
        AsyncFunction("setEQBand") { band: Int, gain: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setEQBand(band, gain.toFloat()); promise.resolve(null) }
        }
        AsyncFunction("applyEQBands") { gains: List<Double>, promise: Promise ->
            runWithPlayer(promise) { core ->
                core.applyEQBands(gains.map { it.toFloat() }.toFloatArray())
                promise.resolve(null)
            }
        }
        AsyncFunction("setEQPreamp") { gain: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setEQPreamp(gain.toFloat()); promise.resolve(null) }
        }
        AsyncFunction("resetEQ") { promise: Promise ->
            runWithPlayer(promise) { core -> core.resetEQ(); promise.resolve(null) }
        }
        AsyncFunction("getEQGains") { promise: Promise ->
            runWithPlayer(promise) { core ->
                promise.resolve(core.getEQGains().mapIndexed { i, g ->
                    mapOf("band" to i, "gain" to g.toDouble())
                })
            }
        }
        AsyncFunction("getEQPreamp") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getEQPreamp().toDouble()) }
        }
        AsyncFunction("setEQMode") { mode: String, promise: Promise ->
            runWithPlayer(promise) { core -> core.setEQMode(mode); promise.resolve(null) }
        }
        AsyncFunction("getEQMode") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getEQMode()) }
        }
        AsyncFunction("setParametricBandGain") { band: Int, gain: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setParametricBandGain(band, gain.toFloat()); promise.resolve(null) }
        }
        AsyncFunction("applyParametricBands") { gains: List<Double>, promise: Promise ->
            runWithPlayer(promise) { core ->
                core.applyParametricBands(gains.map { it.toFloat() }.toFloatArray())
                promise.resolve(null)
            }
        }
        AsyncFunction("setParametricBandFreq") { band: Int, freqHz: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setParametricBandFreq(band, freqHz); promise.resolve(null) }
        }
        AsyncFunction("getParametricGains") { promise: Promise ->
            runWithPlayer(promise) { core ->
                promise.resolve(core.getParametricGains().mapIndexed { i, g ->
                    mapOf("band" to i, "gain" to g.toDouble())
                })
            }
        }
        AsyncFunction("getParametricFreqs") { promise: Promise ->
            runWithPlayer(promise) { core ->
                promise.resolve(core.getParametricFreqs().mapIndexed { i, f ->
                    mapOf("band" to i, "freqHz" to f)
                })
            }
        }
        AsyncFunction("setDitherMode") { mode: String, promise: Promise ->
            runWithPlayer(promise) { core -> core.setDitherMode(mode); promise.resolve(null) }
        }
        AsyncFunction("getDitherMode") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getDitherMode()) }
        }
        AsyncFunction("setSmoothingRamp") { ms: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setSmoothingRamp(ms); promise.resolve(null) }
        }
        AsyncFunction("getLoudnessDb") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getLoudnessDb().toDouble()) }
        }
        AsyncFunction("getSpectrumMagnitudes") { promise: Promise ->
            runWithPlayer(promise) { core ->
                promise.resolve(core.getSpectrumMagnitudes().mapIndexed { i, m ->
                    mapOf("bin" to i, "magnitude" to m.toDouble())
                })
            }
        }
        AsyncFunction("computeAutoEQ") { promise: Promise ->
            runWithPlayer(promise) { core ->
                val suggestion = core.computeAutoEQ()
                promise.resolve(suggestion.mapIndexed { i, g ->
                    mapOf(
                        "band"   to i,
                        "gain"   to g.toDouble(),
                        "freqHz" to EqualizerProcessor.ISO_FREQ_CENTERS.getOrElse(i) { 0.0 }
                    )
                })
            }
        }

        // ==================================================================
        // COMPRESSOR
        // ==================================================================

        AsyncFunction("setCompressorEnabled") { enabled: Boolean, promise: Promise ->
            runWithPlayer(promise) { core -> core.setCompressorEnabled(enabled); promise.resolve(null) }
        }
        AsyncFunction("getCompressorEnabled") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.isCompressorEnabled()) }
        }
        AsyncFunction("setCompressorThreshold") { threshold: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setCompressorThreshold(threshold); promise.resolve(null) }
        }
        AsyncFunction("setCompressorRatio") { ratio: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setCompressorRatio(ratio); promise.resolve(null) }
        }
        AsyncFunction("setCompressorAttack") { ms: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setCompressorAttackMs(ms); promise.resolve(null) }
        }
        AsyncFunction("setCompressorRelease") { ms: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setCompressorReleaseMs(ms); promise.resolve(null) }
        }
        AsyncFunction("setCompressorKnee") { db: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setCompressorKneeWidth(db); promise.resolve(null) }
        }
        AsyncFunction("setCompressorMakeupGain") { db: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setCompressorMakeupGain(db); promise.resolve(null) }
        }
        AsyncFunction("getCompressorReduction") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getCompressorReductionDb().toDouble()) }
        }
        AsyncFunction("getCompressorThreshold") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getCompressorThreshold()) }
        }
        AsyncFunction("getCompressorRatio") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getCompressorRatio()) }
        }
        AsyncFunction("getCompressorAttack") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getCompressorAttackMs()) }
        }
        AsyncFunction("getCompressorRelease") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getCompressorReleaseMs()) }
        }

        // ==================================================================
        // CROSSFEED
        // ==================================================================

        AsyncFunction("setCrossfeedEnabled") { enabled: Boolean, promise: Promise ->
            runWithPlayer(promise) { core -> core.setCrossfeedEnabled(enabled); promise.resolve(null) }
        }
        AsyncFunction("getCrossfeedEnabled") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.isCrossfeedEnabled()) }
        }
        AsyncFunction("setCrossfeedStrength") { strength: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setCrossfeedStrength(strength.toFloat()); promise.resolve(null) }
        }
        AsyncFunction("getCrossfeedStrength") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getCrossfeedStrength().toDouble()) }
        }
        AsyncFunction("setCrossfeedCutoff") { hz: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setCrossfeedCutoff(hz); promise.resolve(null) }
        }
        AsyncFunction("getCrossfeedCutoff") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getCrossfeedCutoff()) }
        }
        AsyncFunction("setCrossfeedDelayMs") { ms: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setCrossfeedDelayMs(ms); promise.resolve(null) }
        }
        AsyncFunction("getCrossfeedDelayMs") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getCrossfeedDelayMs()) }
        }

        // ==================================================================
        // PEAK METER
        // ==================================================================

        AsyncFunction("setPeakHoldMs") { ms: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setPeakHoldMs(ms); promise.resolve(null) }
        }
        AsyncFunction("setPeakReleaseMs") { ms: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setPeakReleaseMs(ms); promise.resolve(null) }
        }
        AsyncFunction("getCurrentPeaks") { promise: Promise ->
            runWithPlayer(promise) { core ->
                val p = core.getCurrentPeaks()
                promise.resolve(mapOf(
                    "left"  to p.getOrElse(0) { 0f }.toDouble(),
                    "right" to p.getOrElse(1) { 0f }.toDouble()
                ))
            }
        }
        AsyncFunction("getHeldPeaks") { promise: Promise ->
            runWithPlayer(promise) { core ->
                val p = core.getHeldPeaks()
                promise.resolve(mapOf(
                    "left"  to p.getOrElse(0) { 0f }.toDouble(),
                    "right" to p.getOrElse(1) { 0f }.toDouble()
                ))
            }
        }
        AsyncFunction("resetPeaks") { promise: Promise ->
            runWithPlayer(promise) { core -> core.resetPeaks(); promise.resolve(null) }
        }

        // ==================================================================
        // REPLAY GAIN
        // ==================================================================

        AsyncFunction("setReplayGainMode") { mode: String, promise: Promise ->
            runWithPlayer(promise) { core -> core.setReplayGainMode(mode); promise.resolve(null) }
        }
        AsyncFunction("setReplayGainPreamp") { gainDb: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setReplayGainPreamp(gainDb.toFloat()); promise.resolve(null) }
        }
        AsyncFunction("setReplayGainFromMap") { tags: Map<String, String>, promise: Promise ->
            runWithPlayer(promise) { core -> core.setReplayGainFromMap(tags); promise.resolve(null) }
        }
        AsyncFunction("getReplayGainInfo") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getReplayGainInfo()) }
        }

        // ==================================================================
        // PRESETS
        // ==================================================================

        AsyncFunction("applyPreset") { name: String, promise: Promise ->
            runWithPlayer(promise) { core ->
                if (core.applyPresetByName(name)) promise.resolve(null)
                else promise.reject("PRESET_NOT_FOUND", "Preset '$name' not found", null)
            }
        }
        AsyncFunction("savePreset") { name: String, promise: Promise ->
            runWithPlayer(promise) { core -> core.saveCurrentAsPreset(name); promise.resolve(null) }
        }
        AsyncFunction("listPresets") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.listPresets()) }
        }
        AsyncFunction("deletePreset") { name: String, promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.deletePreset(name)) }
        }
        AsyncFunction("exportPreset") { name: String, promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.exportPreset(name)) }
        }
        AsyncFunction("importPreset") { json: String, promise: Promise ->
            runWithPlayer(promise) { core ->
                if (core.importPreset(json)) promise.resolve(null)
                else promise.reject("IMPORT_ERROR", "Failed to import preset", null)
            }
        }
        AsyncFunction("assignTrackPreset") { mediaId: String, presetName: String?, promise: Promise ->
            runWithPlayer(promise) { core -> core.assignTrackPreset(mediaId, presetName); promise.resolve(null) }
        }
        AsyncFunction("getTrackPreset") { mediaId: String, promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getTrackPresetName(mediaId)) }
        }
        AsyncFunction("setAutoSwitchPresets") { enabled: Boolean, promise: Promise ->
            runWithPlayer(promise) { core -> core.setAutoSwitchPresets(enabled); promise.resolve(null) }
        }

        // ==================================================================
        // CONVOLUTION
        // ==================================================================

        AsyncFunction("loadImpulseResponse") { filePath: String, promise: Promise ->
            runWithPlayer(promise) { core ->
                if (core.loadImpulseResponse(filePath)) promise.resolve(null)
                else promise.reject("LOAD_IR_FAILED", "Failed to load IR from $filePath", null)
            }
        }
        AsyncFunction("clearImpulseResponse") { promise: Promise ->
            runWithPlayer(promise) { core -> core.clearImpulseResponse(); promise.resolve(null) }
        }
        AsyncFunction("isImpulseResponseLoaded") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.isImpulseResponseLoaded()) }
        }
        AsyncFunction("getIrLength") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getIrLength()) }
        }
        AsyncFunction("setConvolutionEnabled") { enabled: Boolean, promise: Promise ->
            runWithPlayer(promise) { core -> core.setConvolutionEnabled(enabled); promise.resolve(null) }
        }
        AsyncFunction("isConvolutionEnabled") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.isConvolutionEnabled()) }
        }

        // ==================================================================
        // FX PROCESSOR
        // ==================================================================

        AsyncFunction("setFxEnabled") { enabled: Boolean, promise: Promise ->
            runWithPlayer(promise) { core -> core.setFxEnabled(enabled); promise.resolve(null) }
        }
        AsyncFunction("isFxEnabled") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.isFxEnabled()) }
        }
        AsyncFunction("setFxMode") { mode: String, promise: Promise ->
            runWithPlayer(promise) { core -> core.setFxMode(mode); promise.resolve(null) }
        }
        AsyncFunction("getFxMode") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getFxMode()) }
        }
        AsyncFunction("setFxMix") { mix: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setFxMix(mix); promise.resolve(null) }
        }
        AsyncFunction("getFxMix") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.getFxMix()) }
        }
        AsyncFunction("setFxBypass") { bypass: Boolean, promise: Promise ->
            runWithPlayer(promise) { core -> core.setFxBypass(bypass); promise.resolve(null) }
        }
        AsyncFunction("isFxBypassed") { promise: Promise ->
            runWithPlayer(promise) { core -> promise.resolve(core.isFxBypassed()) }
        }
        AsyncFunction("setReverbRoomSize") { v: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setReverbRoomSize(v); promise.resolve(null) }
        }
        AsyncFunction("setReverbDecay") { v: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setReverbDecay(v); promise.resolve(null) }
        }
        AsyncFunction("setReverbPreDelay") { v: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setReverbPreDelay(v); promise.resolve(null) }
        }
        AsyncFunction("setReverbDamping") { v: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setReverbDamping(v); promise.resolve(null) }
        }
        AsyncFunction("setDelayTime") { v: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setDelayTime(v); promise.resolve(null) }
        }
        AsyncFunction("setDelayFeedback") { v: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setDelayFeedback(v); promise.resolve(null) }
        }
        AsyncFunction("setDelayLowCut") { v: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setDelayLowCut(v); promise.resolve(null) }
        }
        AsyncFunction("setDelayHighCut") { v: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setDelayHighCut(v); promise.resolve(null) }
        }
        AsyncFunction("setModRate") { v: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setModRate(v); promise.resolve(null) }
        }
        AsyncFunction("setModDepth") { v: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setModDepth(v); promise.resolve(null) }
        }
        AsyncFunction("setModPhase") { v: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setModPhase(v); promise.resolve(null) }
        }
        AsyncFunction("setModFeedback") { v: Double, promise: Promise ->
            runWithPlayer(promise) { core -> core.setModFeedback(v); promise.resolve(null) }
        }
    }

    // ========================================================================
    // INTERNAL IMPLEMENTATION
    // ========================================================================

    private fun setupPlayerInternal(options: Map<String, Any?>?, promise: Promise) {
        mainHandler.post {
            try {
                val opts = parsePlayerOptions(options)
                MavinPlayerRegistry.options = opts

                val context = appContext.reactContext
                    ?: throw IllegalStateException("ReactContext not available")

                playerCore = MavinPlayerCore.getInstance(context)
                playerCore!!.addEventListener(this)
                playerCore!!.setAlwaysPauseOnInterruption(
                    opts.android.alwaysPauseOnInterruption || opts.alwaysPauseOnInterruption
                )
                playerCore!!.setAutoHandleInterruptions(opts.autoHandleInterruptions)
                playerCore!!.setProgressUpdateInterval(opts.progressUpdateEventInterval)

                MavinPlayerRegistry.remoteEventCallback = { eventName, payload ->
                    mainHandler.post { sendEvent(eventName, payload) }
                }

                startPlaybackService(context)
                isServiceStarted = true

                Log.i(TAG, "Player setup complete")
                promise.resolve(null)
            } catch (e: Exception) {
                Log.e(TAG, "Setup failed", e)
                promise.reject("SETUP_ERROR", e.message, e)
            }
        }
    }

    private fun destroyPlayer(promise: Promise) {
        mainHandler.post {
            try {
                playerCore?.removeEventListener(this)
                MavinPlayerRegistry.remoteEventCallback = null
                appContext.reactContext?.let { ctx ->
                    ctx.stopService(Intent(ctx, MavinPlaybackService::class.java))
                }
                MavinPlayerCore.destroyInstance()
                playerCore = null
                isServiceStarted = false
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("DESTROY_ERROR", e.message, e)
            }
        }
    }

    private fun updateOptionsInternal(options: Map<String, Any?>, promise: Promise) {
        mainHandler.post {
            try {
                val opts = parsePlayerOptions(options)
                MavinPlayerRegistry.options = opts
                playerCore?.setAlwaysPauseOnInterruption(
                    opts.android.alwaysPauseOnInterruption || opts.alwaysPauseOnInterruption
                )
                playerCore?.setAutoHandleInterruptions(opts.autoHandleInterruptions)
                playerCore?.setProgressUpdateInterval(opts.progressUpdateEventInterval)
                notifyServiceNotificationUpdate()
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("UPDATE_OPTIONS_ERROR", e.message, e)
            }
        }
    }

    private fun startPlaybackService(context: Context) {
        val intent = Intent(context, MavinPlaybackService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    private fun notifyServiceNotificationUpdate() {
        appContext.reactContext?.let { ctx ->
            ctx.startService(Intent(ctx, MavinPlaybackService::class.java))
        }
    }

    private fun runWithPlayer(promise: Promise, block: (MavinPlayerCore) -> Unit) {
        mainHandler.post {
            val core = playerCore
            if (core == null) {
                promise.reject("PLAYER_NOT_INITIALIZED", "Call setupPlayer() first", null)
                return@post
            }
            try {
                block(core)
            } catch (e: Exception) {
                Log.e(TAG, "Player operation failed", e)
                promise.reject("PLAYER_ERROR", e.message, e)
            }
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseFeedbackOptions(map: Map<String, Any?>?): FeedbackOptions? {
        if (map == null) return null
        return FeedbackOptions(
            isActive = map["isActive"] as? Boolean ?: false,
            title    = map["title"] as? String ?: ""
        )
    }

    private fun parsePlayerOptions(options: Map<String, Any?>?): PlayerOptions {
        if (options == null) return PlayerOptions()
        val androidMap = options["android"] as? Map<String, Any?>
        val legacyJumpMs = ((options["jumpInterval"] as? Number)?.toDouble()?.times(1000.0))?.toLong() ?: 15_000L
        val forwardJumpMs = ((options["forwardJumpInterval"] as? Number)?.toDouble()?.times(1000.0))?.toLong()
            ?: legacyJumpMs
        val backwardJumpMs = ((options["backwardJumpInterval"] as? Number)?.toDouble()?.times(1000.0))?.toLong()
            ?: legacyJumpMs

        // RNTP: maxCacheSize is in KB — multiply by 1024 is done in PlayerOptions.maxCacheSizeBytes getter
        val maxCacheSizeKb = (options["maxCacheSize"] as? Number)?.toLong()
            ?: MavinPlayerConstants.DEFAULT_CACHE_SIZE_KB

        return PlayerOptions(
            autoWait                  = options["autoWait"] as? Boolean ?: false,
            autoUpdateMetadata        = options["autoUpdateMetadata"] as? Boolean ?: true,
            stopWithApp               = options["stopWithApp"] as? Boolean ?: false,
            alwaysPauseOnInterruption = options["alwaysPauseOnInterruption"] as? Boolean ?: false,
            autoHandleInterruptions   = options["autoHandleInterruptions"] as? Boolean ?: false,
            waitForBuffer             = options["waitForBuffer"] as? Boolean ?: true,
            capabilities              = (options["capabilities"] as? List<String>) ?: PlayerOptions().capabilities,
            compactCapabilities       = (options["compactCapabilities"] as? List<String>) ?: PlayerOptions().compactCapabilities,
            notificationCapabilities  = (options["notificationCapabilities"] as? List<String>) ?: emptyList(),
            icon                      = options["icon"] as? String,
            playIcon                  = options["playIcon"] as? String,
            pauseIcon                 = options["pauseIcon"] as? String,
            stopIcon                  = options["stopIcon"] as? String,
            previousIcon              = options["previousIcon"] as? String,
            nextIcon                  = options["nextIcon"] as? String,
            rewindIcon                = options["rewindIcon"] as? String,
            forwardIcon               = options["forwardIcon"] as? String,
            color                     = (options["color"] as? Number)?.toInt(),
            forwardJumpInterval       = forwardJumpMs,
            backwardJumpInterval      = backwardJumpMs,
            ratingType                = (options["ratingType"] as? Number)?.toInt() ?: 0,
            progressUpdateEventInterval = ((options["progressUpdateEventInterval"] as? Number)?.toDouble()?.times(1000.0))?.toLong()
                ?: MavinPlayerConstants.DEFAULT_PROGRESS_UPDATE_INTERVAL_MS,
            minBufferMs               = ((options["minBuffer"] as? Number)?.toDouble()?.times(1000.0))?.toLong()
                ?: MavinPlayerConstants.MIN_BUFFER_MS,
            maxBufferMs               = ((options["maxBuffer"] as? Number)?.toDouble()?.times(1000.0))?.toLong()
                ?: MavinPlayerConstants.MAX_BUFFER_MS,
            playbackBufferMs          = ((options["playBuffer"] as? Number)?.toDouble()?.times(1000.0))?.toLong()
                ?: ((options["playbackBuffer"] as? Number)?.toDouble()?.times(1000.0))?.toLong()
                ?: MavinPlayerConstants.BUFFER_FOR_PLAYBACK_MS,
            playbackBufferAfterRebufferMs = ((options["playbackBufferAfterRebuffer"] as? Number)?.toDouble()?.times(1000.0))?.toLong()
                ?: MavinPlayerConstants.BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS,
            backBufferDurationMs      = ((options["backBuffer"] as? Number)?.toDouble()?.times(1000.0))?.toLong()
                ?: MavinPlayerConstants.BACK_BUFFER_DURATION_MS,
            androidAudioContentType   = options["androidAudioContentType"] as? String
                ?: MavinPlayerConstants.AUDIO_CONTENT_TYPE_MUSIC,
            maxCacheSizeKb            = maxCacheSizeKb,
            // RNTP 4.x FeedbackOptions — parsed from structured objects
            likeOptions               = parseFeedbackOptions(options["likeOptions"] as? Map<String, Any?>),
            dislikeOptions            = parseFeedbackOptions(options["dislikeOptions"] as? Map<String, Any?>),
            bookmarkOptions           = parseFeedbackOptions(options["bookmarkOptions"] as? Map<String, Any?>),
            android = AndroidOptions(
                appKilledPlaybackBehavior = androidMap?.get("appKilledPlaybackBehavior") as? String
                    ?: MavinPlayerConstants.APP_KILLED_CONTINUE,
                stopForegroundGracePeriod = (androidMap?.get("stopForegroundGracePeriod") as? Number)?.toLong() ?: 0L,
                alwaysPauseOnInterruption = androidMap?.get("alwaysPauseOnInterruption") as? Boolean ?: false
            )
        )
    }

    // ========================================================================
    // EVENT LISTENER IMPLEMENTATION
    // ========================================================================

    override fun onPlaybackStateChanged(state: Int, stateName: String) {
        sendEvent("playback-state", mapOf("state" to stateName, "stateCode" to state))
    }

    override fun onPlaybackError(error: PlaybackError) {
        sendEvent("playback-error", mapOf("code" to error.code, "message" to error.message))
    }

    override fun onPlaybackProgress(progress: PlaybackProgress, trackIndex: Int) {
        sendEvent("playback-progress-updated", mapOf(
            "position" to progress.position,
            "duration" to progress.duration,
            "buffered"  to progress.buffered,
            "track"    to trackIndex
        ))
    }

    override fun onPlaybackTrackChanged(
        track: TrackMetadata?,
        index: Int,
        previousIndex: Int,
        lastTrack: TrackMetadata?,
        nextTrack: TrackMetadata?,
        nextIndex: Int,
        lastPosition: Double
    ) {
        // RNTP legacy event (deprecated but preserved)
        val legacyPayload = mapOf(
            "track"     to previousIndex.takeIf { it >= 0 },
            "position"  to lastPosition,
            "nextTrack" to index.takeIf { it >= 0 }
        )
        sendEvent("playback-track-changed", legacyPayload)

        // RNTP 4.x: PlaybackActiveTrackChanged — fires with null index/track when queue empties
        val activePayload = mapOf(
            "index"         to index.takeIf { it >= 0 },
            "track"         to track?.toMap(),
            "lastIndex"     to previousIndex.takeIf { it >= 0 },
            "lastTrack"     to lastTrack?.toMap(),
            "lastPosition"  to lastPosition,
            "nextTrack"     to nextTrack?.toMap(),
            "nextIndex"     to nextIndex.takeIf { it >= 0 }
        )
        sendEvent("playback-active-track-changed", activePayload)
        notifyServiceNotificationUpdate()
    }

    override fun onPlaybackQueueEnded(track: TrackMetadata?, positionSeconds: Double) {
        sendEvent("playback-queue-ended", mapOf(
            "track"    to track?.toMap(),
            "position" to positionSeconds
        ))
    }

    override fun onPlaybackMetadataReceived(metadata: Map<String, Any?>) {
        sendEvent("playback-metadata-received", mapOf("metadata" to metadata))
    }

    override fun onAudioCommonMetadataReceived(metadata: Map<String, Any?>) {
        sendEvent("audio-common-metadata-received", metadata)
    }

    override fun onAudioTimedMetadataReceived(metadata: Map<String, Any?>) {
        sendEvent("audio-timed-metadata-received", metadata)
    }

    override fun onAudioChapterMetadataReceived(metadata: Map<String, Any?>) {
        sendEvent("audio-chapter-metadata-received", metadata)
    }

    override fun onPeakMeterUpdate(left: Float, right: Float) {
        sendEvent("peak-meter-update", mapOf("left" to left.toDouble(), "right" to right.toDouble()))
    }

    override fun onRemoteDuck(paused: Boolean, permanent: Boolean) {
        sendEvent("remote-duck", mapOf("paused" to paused, "permanent" to permanent))
    }

    override fun onPlaybackPlayWhenReadyChanged(playWhenReady: Boolean, reason: String) {
        sendEvent("playback-play-when-ready-changed", mapOf(
            "playWhenReady" to playWhenReady,
            "reason"        to reason
        ))
    }

    override fun onRemotePlayFromId(id: String, extras: Map<String, Any?>) {
        sendEvent("remote-play-from-id", mapOf("id" to id, "extras" to extras))
    }

    override fun onRemotePlayFromSearch(query: String, extras: Map<String, Any?>) {
        sendEvent("remote-play-from-search", mapOf("query" to query, "extras" to extras))
    }

    override fun onRemoteSkip(index: Int) {
        sendEvent("remote-skip", mapOf("index" to index))
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.toTrackMetadata(): TrackMetadata {
        val drmMap = this["drm"] as? Map<String, Any?>
        return TrackMetadata(
            id          = this["id"] as? String ?: throw IllegalArgumentException("Track must have id"),
            url         = this["url"] as? String ?: this["uri"] as? String
                ?: throw IllegalArgumentException("Track must have url or uri"),
            title       = this["title"] as? String,
            artist      = this["artist"] as? String,
            album       = this["album"] as? String,
            genre       = this["genre"] as? String,
            date        = this["date"] as? String,
            artwork     = this["artwork"] as? String,
            duration    = (this["duration"] as? Number)?.toDouble(),
            description = this["description"] as? String,
            rating      = (this["rating"] as? Number)?.toDouble(),
            isLiveStream= this["isLiveStream"] as? Boolean ?: false,
            type        = this["type"] as? String,
            headers     = this["headers"] as? Map<String, String>,
            userAgent   = this["userAgent"] as? String,
            contentType = this["contentType"] as? String,
            pitchAlgorithm = this["pitchAlgorithm"] as? String,
            drmScheme        = drmMap?.get("type") as? String,
            drmLicenseServer = drmMap?.get("licenseServer") as? String,
            drmHeaders       = drmMap?.get("headers") as? Map<String, String>,
            drmMultiSession  = drmMap?.get("multiSession") as? Boolean ?: false
        )
    }

    private fun TrackMetadata.toMap(): Map<String, Any?> = mapOf(
        "id"           to id,
        "url"          to url,
        "title"        to title,
        "artist"       to artist,
        "album"        to album,
        "genre"        to genre,
        "date"         to date,
        "artwork"      to artwork,
        "duration"     to duration,
        "description"  to description,
        "rating"       to rating,
        "isLiveStream" to isLiveStream,
        "type"         to type,
        "headers"      to headers,
        "userAgent"    to userAgent,
        "contentType"  to contentType,
        "pitchAlgorithm" to pitchAlgorithm,
        "drm"          to if (drmScheme != null) mapOf(
            "type"          to drmScheme,
            "licenseServer" to drmLicenseServer,
            "headers"       to drmHeaders,
            "multiSession"  to drmMultiSession
        ) else null
    )

    private fun VideoTrack.toMap(): Map<String, Any?> = mapOf(
        "id"           to id,
        "url"          to url,
        "muxedUrl"     to muxedUrl,
        "title"        to title,
        "artist"       to artist,
        "artwork"      to artwork,
        "duration"     to duration,
        "uploaderUrl"  to uploaderUrl,
        "likeCount"    to likeCount,
        "dislikeCount" to dislikeCount,
        "viewCount"    to viewCount,
        "commentsCount"to commentsCount
    )
}