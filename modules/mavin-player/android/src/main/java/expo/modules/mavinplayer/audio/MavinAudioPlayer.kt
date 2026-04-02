package expo.modules.mavinplayer.audio

import android.content.Context
import android.media.AudioFormat
import android.media.AudioManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import expo.modules.mavinplayer.audio.CompressorProcessor
import expo.modules.mavinplayer.audio.ConvolutionProcessor
import expo.modules.mavinplayer.audio.CrossfeedProcessor
import expo.modules.mavinplayer.audio.EqPresetManager
import expo.modules.mavinplayer.audio.EqualizerProcessor
import expo.modules.mavinplayer.audio.FxProcessor
import expo.modules.mavinplayer.audio.PeakMeterProcessor
import expo.modules.mavinplayer.audio.ReplayGainParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File

@UnstableApi
class MavinAudioPlayer(private val context: Context) {

    companion object {
        private const val TAG = "MavinAudioPlayer"
        private const val DEFAULT_CACHE_SIZE_BYTES = 200L * 1024 * 1024
    }

    // ── DSP processors ────────────────────────────────────────────────────────
    val equalizerProcessor   = EqualizerProcessor()
    lateinit var compressorProcessor  : CompressorProcessor
    lateinit var crossfeedProcessor   : CrossfeedProcessor
    lateinit var peakMeterProcessor   : PeakMeterProcessor
    lateinit var convolutionProcessor : ConvolutionProcessor
    lateinit var fxProcessor          : FxProcessor
    lateinit var usbDacController     : UsbDacController
    lateinit var audioFormatDetector  : AudioFormatDetector

    val presetManager = EqPresetManager(context)
    val player: ExoPlayer
    private var cache: SimpleCache
    private var cacheSizeBytes: Long = DEFAULT_CACHE_SIZE_BYTES

    // ── Wake Lock ──────────────────────────────────────────────────────────────
    private var wakeLock: PowerManager.WakeLock? = null
    private var wakeMode: Int = 0

    // ── ReplayGain state ───────────────────────────────────────────────────────
    private var replayGainMode     = ReplayGainParser.Mode.TRACK
    private var replayGainPreampDb = 0f
    private var currentRgInfo      = ReplayGainParser.EMPTY

    // ── Crossfade ──────────────────────────────────────────────────────────────
    private var crossfadeEnabled    = false
    private var crossfadeDurationMs = 2000L

    // ── Feature flags ──────────────────────────────────────────────────────────
    private var autoSwitchPresets = true
    private var offlineMode       = false

    // ── Audio attributes ───────────────────────────────────────────────────────
    private var audioUsage   = C.USAGE_MEDIA
    private var audioContent = C.AUDIO_CONTENT_TYPE_MUSIC

    // ── Progress update interval ───────────────────────────────────────────────
    private var _progressIntervalMs: Long = 1000L

    // ── playWhenReady state (RNTP parity) ──────────────────────────────────────
    private var _playWhenReady: Boolean = true

    // ── Background scope ───────────────────────────────────────────────────────
    private val ioScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // ─────────────────────────────────────────────────────────────────────────
    // CALLBACKS  — original set
    // ─────────────────────────────────────────────────────────────────────────

    var onPlaybackStateChanged  : ((state: Int) -> Unit)?  = null
    var onTrackChanged          : ((index: Int) -> Unit)?  = null
    var onError                 : ((message: String, code: String) -> Unit)? = null
    var onPositionDiscontinuity : (() -> Unit)?            = null
    var onReplayGainApplied     : ((trackGain: Float?, albumGain: Float?, appliedDb: Float) -> Unit)? = null
    var onPeakMeter             : ((leftPeak: Float, rightPeak: Float) -> Unit)? = null
    var onUsbDacConnected       : ((dacInfo: UsbDacController.DacInfo) -> Unit)? = null
    var onUsbDacDisconnected    : (() -> Unit)?            = null

    // ─────────────────────────────────────────────────────────────────────────
    // NEW RNTP-PARITY CALLBACKS
    // ─────────────────────────────────────────────────────────────────────────

    /** Fired when the queue has played through to its end. */
    var onQueueEnded         : ((position: Long) -> Unit)?                            = null

    /** Fired when the remote Stop button is pressed. */
    var onRemoteStop         : (() -> Unit)?                                          = null

    /** Fired when the user skips to a specific track from an external device (Android Auto). */
    var onRemoteSkip         : ((index: Int) -> Unit)?                                = null

    /** Fired when the user selects a track by ID from an external device (Android Auto). */
    var onRemotePlayId       : ((id: String) -> Unit)?                                = null

    /** Fired when the user triggers a voice/text search (Android Auto). */
    var onRemotePlaySearch   : ((query: String, extras: Map<String, Any?>) -> Unit)?  = null

    /** Fired when the user changes the track rating from a remote control. */
    var onRemoteSetRating    : ((rating: Float) -> Unit)?                             = null

    /** Fired when the user presses the jump-forward button on a remote control. */
    var onRemoteJumpForward  : ((interval: Double) -> Unit)?                          = null

    /** Fired when the user presses the jump-backward button on a remote control. */
    var onRemoteJumpBackward : ((interval: Double) -> Unit)?                          = null

    /**
     * Fired when an audio interruption occurs (phone call, alarm, etc.).
     * @param permanent  true = permanent loss (e.g. phone call); false = transient.
     * @param paused     true = player was paused as a result.
     */
    var onRemoteDuck         : ((permanent: Boolean, paused: Boolean) -> Unit)?       = null

    /** Fired when common (ID3 / Vorbis / QuickTime) metadata is received for the current stream. */
    var onAudioCommonMetadata: ((metadata: Map<String, Any?>) -> Unit)?               = null

    /** Fired when timed / Icy metadata is received for the current stream. */
    var onAudioTimedMetadata : ((metadata: Map<String, Any?>) -> Unit)?               = null

    /** Fired when playWhenReady changes. */
    var onPlayWhenReadyChanged: ((playWhenReady: Boolean) -> Unit)?                   = null

    // ─────────────────────────────────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────────────────────────────────

    init {
        cache = createCache(context, cacheSizeBytes)

        val httpFactory = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(15_000)
            .setAllowCrossProtocolRedirects(true)

        val cacheFactory = CacheDataSource.Factory()
            .setCache(cache)
            .setUpstreamDataSourceFactory(httpFactory)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

        compressorProcessor  = CompressorProcessor()
        crossfeedProcessor   = CrossfeedProcessor()
        peakMeterProcessor   = PeakMeterProcessor()
        convolutionProcessor = ConvolutionProcessor(context)
        fxProcessor          = FxProcessor()
        usbDacController     = UsbDacController(context)
        audioFormatDetector  = AudioFormatDetector(context)

        peakMeterProcessor.setPeakCallback { peaks ->
            if (peaks.size >= 2) onPeakMeter?.invoke(peaks[0], peaks[1])
        }

        usbDacController.onDacConnected = { dacInfo ->
            Log.i(TAG, "USB DAC connected: ${dacInfo.name}")
            onUsbDacConnected?.invoke(dacInfo)
            audioFormatDetector.clearCache()
        }
        usbDacController.onDacDisconnected = {
            Log.i(TAG, "USB DAC disconnected")
            onUsbDacDisconnected?.invoke()
            audioFormatDetector.clearCache()
        }

        val renderersFactory = object : DefaultRenderersFactory(context) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioTrackPlaybackParams: Boolean
            ): AudioSink = DefaultAudioSink.Builder(context)
                .setAudioProcessors(arrayOf(
                    equalizerProcessor,
                    compressorProcessor,
                    crossfeedProcessor,
                    convolutionProcessor,
                    fxProcessor,
                    peakMeterProcessor
                ))
                .setEnableFloatOutput(enableFloatOutput && supportsFloatOutput())
                .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                .build()
        }.also { it.setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF) }

        val trackSelector = DefaultTrackSelector(context).apply {
            setParameters(buildUponParameters().setForceHighestSupportedBitrate(true))
        }

        player = ExoPlayer.Builder(context)
            .setRenderersFactory(renderersFactory)
            .setMediaSourceFactory(DefaultMediaSourceFactory(context).setDataSourceFactory(cacheFactory))
            .setTrackSelector(trackSelector)
            .setAudioAttributes(buildAudioAttributes(), true)
            .setHandleAudioBecomingNoisy(true)
            .build()

        player.addListener(object : Player.Listener {

            override fun onPlaybackStateChanged(state: Int) {
                onPlaybackStateChanged?.invoke(state)
                // Fire queue-ended when ExoPlayer reaches STATE_ENDED with no next item
                if (state == Player.STATE_ENDED) {
                    onQueueEnded?.invoke(player.currentPosition)
                }
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                onTrackChanged?.invoke(player.currentMediaItemIndex)
                mediaItem?.let { handleTrackTransition(it) }
            }

            override fun onPlayerError(error: PlaybackException) {
                onError?.invoke(error.message ?: "Unknown error", error.errorCodeName)
            }

            override fun onPositionDiscontinuity(
                old: Player.PositionInfo, new: Player.PositionInfo, reason: Int
            ) { onPositionDiscontinuity?.invoke() }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                // Keep _playWhenReady in sync with actual player state
                if (_playWhenReady != player.playWhenReady) {
                    _playWhenReady = player.playWhenReady
                    onPlayWhenReadyChanged?.invoke(_playWhenReady)
                }
            }
        })

        Log.i(TAG, "✅ MavinAudioPlayer ready — Full RNTP Parity + USB DAC")
    }

    private fun buildAudioAttributes(): AudioAttributes =
        AudioAttributes.Builder()
            .setUsage(audioUsage)
            .setContentType(audioContent)
            .build()

    private fun createCache(context: Context, size: Long): SimpleCache {
        val cacheDir = File(context.cacheDir, "mavin_audio_cache")
        return SimpleCache(cacheDir, LeastRecentlyUsedCacheEvictor(size))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AUDIO ATTRIBUTES CONFIG
    // ─────────────────────────────────────────────────────────────────────────

    fun configureAudioAttributes(usage: String?, contentType: String?) {
        audioUsage = when (usage?.uppercase()) {
            "ALARM"                              -> C.USAGE_ALARM
            "ASSISTANCE_ACCESSIBILITY"           -> C.USAGE_ASSISTANCE_ACCESSIBILITY
            "ASSISTANCE_NAVIGATION_GUIDANCE"     -> C.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE
            "ASSISTANCE_SONIFICATION"            -> C.USAGE_ASSISTANCE_SONIFICATION
            "GAME"                               -> C.USAGE_GAME
            "NOTIFICATION"                       -> C.USAGE_NOTIFICATION
            "NOTIFICATION_COMMUNICATION_DELAYED" -> C.USAGE_NOTIFICATION_COMMUNICATION_DELAYED
            "NOTIFICATION_COMMUNICATION_INSTANT" -> C.USAGE_NOTIFICATION_COMMUNICATION_INSTANT
            "NOTIFICATION_EVENT"                 -> C.USAGE_NOTIFICATION_EVENT
            "NOTIFICATION_RINGTONE"              -> C.USAGE_NOTIFICATION_RINGTONE
            "VOICE_COMMUNICATION"                -> C.USAGE_VOICE_COMMUNICATION
            "VOICE_COMMUNICATION_SIGNALLING"     -> C.USAGE_VOICE_COMMUNICATION_SIGNALLING
            else                                 -> C.USAGE_MEDIA
        }
        audioContent = when (contentType?.uppercase()) {
            "MOVIE"        -> C.AUDIO_CONTENT_TYPE_MOVIE
            "SONIFICATION" -> C.AUDIO_CONTENT_TYPE_SONIFICATION
            "SPEECH"       -> C.AUDIO_CONTENT_TYPE_SPEECH
            "UNKNOWN"      -> C.AUDIO_CONTENT_TYPE_UNKNOWN
            else           -> C.AUDIO_CONTENT_TYPE_MUSIC
        }
    }

    fun applyAudioAttributes() {
        player.setAudioAttributes(buildAudioAttributes(), true)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CACHE CONFIGURATION
    // ─────────────────────────────────────────────────────────────────────────

    fun updateCacheConfig(sizeBytes: Long) {
        if (sizeBytes == cacheSizeBytes) return
        cacheSizeBytes = sizeBytes
        if (player.playbackState == Player.STATE_IDLE || player.playbackState == Player.STATE_ENDED) {
            cache.release()
            cache = createCache(context, cacheSizeBytes)
            Log.i(TAG, "Cache resized to $cacheSizeBytes bytes")
        } else {
            Log.w(TAG, "Cannot resize cache while playing. Will apply on next init.")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WAKE LOCK
    // ─────────────────────────────────────────────────────────────────────────

    fun setWakeMode(mode: Int) {
        wakeMode = mode
        wakeLock?.release()
        wakeLock = null
        if (mode == 1) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MavinPlayer::WakeLock")
            @Suppress("WakelockTimeout")
            wakeLock?.acquire(10 * 60 * 1000L)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CROSSFADE
    // ─────────────────────────────────────────────────────────────────────────

    fun setCrossfadeEnabled(enabled: Boolean)    { crossfadeEnabled = enabled }
    fun isCrossfadeEnabled(): Boolean            = crossfadeEnabled
    fun setCrossfadeDurationMs(durationMs: Long) { crossfadeDurationMs = durationMs.coerceIn(500L, 10_000L) }
    fun getCrossfadeDurationMs(): Long           = crossfadeDurationMs

    // ─────────────────────────────────────────────────────────────────────────
    // OFFLINE MODE
    // ─────────────────────────────────────────────────────────────────────────

    fun setOfflineMode(enabled: Boolean) { offlineMode = enabled; Log.i(TAG, "Offline mode: $enabled") }
    fun isOfflineMode(): Boolean         = offlineMode

    // ─────────────────────────────────────────────────────────────────────────
    // 64-BIT PROCESSING
    // ─────────────────────────────────────────────────────────────────────────

    fun set64BitProcessingEnabled(enabled: Boolean) { equalizerProcessor.setHighPrecisionMode(enabled) }
    fun is64BitProcessingEnabled(): Boolean         = equalizerProcessor.isHighPrecisionMode()

    // ─────────────────────────────────────────────────────────────────────────
    // PLAYBACK CONTROL
    // ─────────────────────────────────────────────────────────────────────────

    fun load(track: TrackData) {
        player.setMediaItem(buildMediaItem(track))
        player.prepare()
    }

    fun setQueue(tracks: List<TrackData>, startIndex: Int = 0) {
        player.setMediaItems(tracks.map { buildMediaItem(it) }, startIndex, C.TIME_UNSET)
        player.prepare()
    }

    fun addToQueue(track: TrackData) { player.addMediaItem(buildMediaItem(track)) }

    /** Insert a track at a specific position in the queue. */
    fun addToQueueAt(track: TrackData, index: Int) {
        val clampedIndex = index.coerceIn(0, player.mediaItemCount)
        player.addMediaItem(clampedIndex, buildMediaItem(track))
    }

    fun removeTrack(index: Int) {
        if (index in 0 until player.mediaItemCount) player.removeMediaItem(index)
    }

    fun removeUpcomingTracks() {
        val current = player.currentMediaItemIndex
        val total   = player.mediaItemCount
        if (current >= 0 && current < total - 1) {
            player.removeMediaItems(current + 1, total)
        }
    }

    fun updateTrackMetadata(index: Int, track: TrackData) {
        if (index in 0 until player.mediaItemCount) player.replaceMediaItem(index, buildMediaItem(track))
    }

    /**
     * Move a track from one queue position to another.
     * Uses Media3's built-in moveMediaItem() — O(1), no queue reconstruction needed.
     */
    fun moveTrack(fromIndex: Int, toIndex: Int) {
        val size = player.mediaItemCount
        require(fromIndex in 0 until size) { "moveTrack: fromIndex $fromIndex out of bounds (size=$size)" }
        require(toIndex in 0 until size)   { "moveTrack: toIndex $toIndex out of bounds (size=$size)" }
        if (fromIndex != toIndex) {
            player.moveMediaItem(fromIndex, toIndex)
        }
    }

    fun getTrack(index: Int): Map<String, Any?>? {
        if (index !in 0 until player.mediaItemCount) return null
        val item = player.getMediaItemAt(index)
        val meta = item.mediaMetadata
        return mapOf(
            "id"          to item.mediaId,
            "uri"         to (item.localConfiguration?.uri?.toString() ?: ""),
            "url"         to (item.localConfiguration?.uri?.toString() ?: ""),
            "title"       to (meta.title?.toString() ?: ""),
            "artist"      to (meta.artist?.toString() ?: ""),
            "album"       to (meta.albumTitle?.toString() ?: ""),
            "genre"       to (meta.genre?.toString() ?: ""),
            "description" to (meta.description?.toString() ?: ""),
            "artworkUri"  to (meta.artworkUri?.toString()),
            "artwork"     to (meta.artworkUri?.toString()),
            "index"       to index,
        )
    }

    fun reset() { player.stop(); player.clearMediaItems() }

    fun play()             { player.play() }
    fun pause()            { player.pause() }
    fun stop()             { player.stop() }
    fun seekTo(ms: Long)   { player.seekTo(ms) }

    fun skipRelative(seconds: Int) {
        val newPos = (player.currentPosition + (seconds * 1000L))
            .coerceIn(0, player.duration.takeIf { it != C.TIME_UNSET } ?: Long.MAX_VALUE)
        player.seekTo(newPos)
    }

    fun skipToNext()            { player.seekToNext() }
    fun skipToPrevious()        { player.seekToPrevious() }
    fun skipToIndex(index: Int) { player.seekTo(index, C.TIME_UNSET) }

    fun setRepeatMode(mode: Int)          { player.repeatMode = mode }
    fun setShuffleModeEnabled(e: Boolean) { player.shuffleModeEnabled = e }
    fun setVolume(volume: Float)          { player.volume = volume.coerceIn(0f, 1f) }

    // ─────────────────────────────────────────────────────────────────────────
    // PLAY-WHEN-READY  (RNTP 4.x parity)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Set playWhenReady.  When false the player is paused; when true it resumes.
     * Fires onPlayWhenReadyChanged so the JS layer can react.
     */
    fun setPlayWhenReady(playWhenReady: Boolean) {
        _playWhenReady = playWhenReady
        player.playWhenReady = playWhenReady
        onPlayWhenReadyChanged?.invoke(playWhenReady)
    }

    fun getPlayWhenReady(): Boolean = player.playWhenReady

    // ─────────────────────────────────────────────────────────────────────────
    // PLAYBACK SPEED + INDEPENDENT PITCH CONTROL
    // ─────────────────────────────────────────────────────────────────────────

    fun setPlaybackSpeed(speed: Float) {
        val current = player.playbackParameters
        player.setPlaybackParameters(PlaybackParameters(speed.coerceIn(0.5f, 3.0f), current.pitch))
    }

    fun setPlaybackPitch(pitch: Float) {
        val current = player.playbackParameters
        player.setPlaybackParameters(PlaybackParameters(current.speed, pitch.coerceIn(0.5f, 2.0f)))
    }

    fun setPlaybackParameters(speed: Float, pitch: Float) {
        player.setPlaybackParameters(
            PlaybackParameters(speed.coerceIn(0.5f, 3.0f), pitch.coerceIn(0.5f, 2.0f))
        )
    }

    fun getPlaybackSpeed(): Float = player.playbackParameters.speed
    fun getPlaybackPitch(): Float = player.playbackParameters.pitch

    // ─────────────────────────────────────────────────────────────────────────
    // STATE QUERIES
    // ─────────────────────────────────────────────────────────────────────────

    fun getCurrentPosition(): Long  = player.currentPosition
    fun getDuration(): Long         = player.duration.takeIf { it != C.TIME_UNSET } ?: 0L
    fun getBufferedPosition(): Long = player.bufferedPosition
    fun isPlaying(): Boolean        = player.isPlaying
    fun getPlaybackState(): Int     = player.playbackState
    fun getCurrentIndex(): Int      = player.currentMediaItemIndex
    fun getQueueSize(): Int         = player.mediaItemCount
    fun getVolume(): Float          = player.volume
    fun getRepeatMode(): Int        = player.repeatMode
    fun getShuffleMode(): Boolean   = player.shuffleModeEnabled
    fun getAudioFocusState(): Boolean = true

    /**
     * Returns a snapshot of the current track including its queue index.
     * Mirrors RNTP's getActiveTrack() response shape.
     */
    fun getCurrentTrackInfo(): Map<String, Any?> {
        val item = player.currentMediaItem
        val meta = item?.mediaMetadata
        val idx  = player.currentMediaItemIndex
        return mapOf(
            "id"          to (item?.mediaId ?: ""),
            "uri"         to (item?.localConfiguration?.uri?.toString() ?: ""),
            "url"         to (item?.localConfiguration?.uri?.toString() ?: ""),
            "title"       to (meta?.title?.toString() ?: ""),
            "artist"      to (meta?.artist?.toString() ?: ""),
            "album"       to (meta?.albumTitle?.toString() ?: ""),
            "genre"       to (meta?.genre?.toString() ?: ""),
            "description" to (meta?.description?.toString() ?: ""),
            "artworkUri"  to (meta?.artworkUri?.toString()),
            "artwork"     to (meta?.artworkUri?.toString()),
            "duration"    to getDuration(),
            "index"       to idx,
        )
    }

    /**
     * Returns the entire queue as a list of track maps.
     * Mirrors RNTP's getQueue().
     */
    fun getAllTracks(): List<Map<String, Any?>> =
        (0 until player.mediaItemCount).mapNotNull { getTrack(it) }

    /**
     * Returns playback state as an RNTP-compatible string.
     */
    fun getPlaybackStateString(): String = when {
        player.playbackState == Player.STATE_BUFFERING                          -> "buffering"
        player.playbackState == Player.STATE_ENDED                              -> "ended"
        player.playbackState == Player.STATE_IDLE                               -> "none"
        player.isPlaying                                                        -> "playing"
        player.playbackState == Player.STATE_READY && !player.isPlaying         -> "paused"
        else                                                                    -> "none"
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UPDATE NOW PLAYING METADATA
    // ─────────────────────────────────────────────────────────────────────────

    fun updateNowPlayingMetadata(track: TrackData) {
        val idx = player.currentMediaItemIndex
        if (idx in 0 until player.mediaItemCount) {
            player.replaceMediaItem(idx, buildMediaItem(track))
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROGRESS INTERVAL
    // ─────────────────────────────────────────────────────────────────────────

    fun setProgressIntervalMs(ms: Long) { _progressIntervalMs = ms.coerceIn(100L, 10_000L) }
    fun getProgressIntervalMs(): Long   = _progressIntervalMs

    // ─────────────────────────────────────────────────────────────────────────
    // EQ / DSP
    // ─────────────────────────────────────────────────────────────────────────

    fun setEQEnabled(enabled: Boolean)                   { equalizerProcessor.isEnabled = enabled }
    fun setEQBand(band: Int, gainDb: Float)              { equalizerProcessor.setBandGain(band, gainDb) }
    fun applyEQBands(gainsDb: FloatArray)                { equalizerProcessor.applyBands(gainsDb) }
    fun setEQPreamp(gainDb: Float)                       { equalizerProcessor.setPreamp(gainDb) }
    fun setEQBandQ(band: Int, q: Float)                  { equalizerProcessor.setBandQ(band, q) }
    fun resetEQ()                                        { equalizerProcessor.resetGains() }
    fun setParametricBandGain(band: Int, gainDb: Float)  { equalizerProcessor.setParametricBandGain(band, gainDb) }
    fun applyParametricBands(gainsDb: FloatArray)        { equalizerProcessor.applyParametricBands(gainsDb) }
    fun setParametricBandFreq(band: Int, freqHz: Double) { equalizerProcessor.setParametricBandFreq(band, freqHz) }
    fun resetParametric()                                { equalizerProcessor.resetParametric() }

    fun setEQMode(mode: String) {
        equalizerProcessor.setEqMode(when (mode.uppercase()) {
            "PARAMETRIC" -> EqualizerProcessor.EqMode.PARAMETRIC
            "PARALLEL"   -> EqualizerProcessor.EqMode.PARALLEL
            else         -> EqualizerProcessor.EqMode.GRAPHIC
        })
    }

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

    // ─────────────────────────────────────────────────────────────────────────
    // COMPRESSOR
    // ─────────────────────────────────────────────────────────────────────────

    fun setCompressorEnabled(enabled: Boolean)  { compressorProcessor.setEnabled(enabled) }
    fun isCompressorEnabled(): Boolean          = compressorProcessor.isEnabled()
    fun setCompressorThreshold(db: Double)      { compressorProcessor.setThreshold(db) }
    fun setCompressorRatio(ratio: Double)       { compressorProcessor.setRatio(ratio) }
    fun setCompressorAttackMs(ms: Double)       { compressorProcessor.setAttackMs(ms) }
    fun setCompressorReleaseMs(ms: Double)      { compressorProcessor.setReleaseMs(ms) }
    fun setCompressorKneeWidth(db: Double)      { compressorProcessor.setKneeWidth(db) }
    fun setCompressorMakeupGain(db: Double)     { compressorProcessor.setMakeupGain(db) }
    fun getCompressorReductionDb(): Float       = compressorProcessor.getReductionDb()
    fun getCompressorThreshold(): Double        = compressorProcessor.getThreshold()
    fun getCompressorRatio(): Double            = compressorProcessor.getRatio()
    fun getCompressorAttackMs(): Double         = compressorProcessor.getAttackMs()
    fun getCompressorReleaseMs(): Double        = compressorProcessor.getReleaseMs()

    // ─────────────────────────────────────────────────────────────────────────
    // CROSSFEED
    // ─────────────────────────────────────────────────────────────────────────

    fun setCrossfeedEnabled(enabled: Boolean) { crossfeedProcessor.setEnabled(enabled) }
    fun isCrossfeedEnabled(): Boolean         = crossfeedProcessor.isEnabled()

    fun setCrossfeedStrength(strength: Float) {
        val clamped = strength.coerceIn(0f, 1f)
        val db = CrossfeedProcessor.FEED_MIN_DB +
                 (CrossfeedProcessor.FEED_MAX_DB - CrossfeedProcessor.FEED_MIN_DB) * clamped
        crossfeedProcessor.setFeedDb(db)
    }

    fun getCrossfeedStrength(): Float {
        val db    = crossfeedProcessor.getFeedDb()
        val range = CrossfeedProcessor.FEED_MAX_DB - CrossfeedProcessor.FEED_MIN_DB
        return ((db - CrossfeedProcessor.FEED_MIN_DB) / range).toFloat().coerceIn(0f, 1f)
    }

    fun setCrossfeedCutoff(hz: Double)  { crossfeedProcessor.setCutoffHz(hz) }
    fun getCrossfeedCutoff(): Double    = crossfeedProcessor.getCutoffHz()
    fun setCrossfeedDelayMs(ms: Double) { crossfeedProcessor.setDelayMs(ms) }
    fun getCrossfeedDelayMs(): Double   = crossfeedProcessor.getDelayMs()

    // ─────────────────────────────────────────────────────────────────────────
    // PEAK METER
    // ─────────────────────────────────────────────────────────────────────────

    fun setPeakHoldMs(ms: Double)     { peakMeterProcessor.setPeakHoldMs(ms) }
    fun setPeakReleaseMs(ms: Double)  { peakMeterProcessor.setReleaseMs(ms) }
    fun getCurrentPeaks(): FloatArray = peakMeterProcessor.getCurrentPeaks()
    fun getHeldPeaks(): FloatArray    = peakMeterProcessor.getHeldPeaks()
    fun resetPeaks()                  { peakMeterProcessor.resetPeaks() }

    // ─────────────────────────────────────────────────────────────────────────
    // REPLAY GAIN
    // ─────────────────────────────────────────────────────────────────────────

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
        val info = ReplayGainParser.parseFromMap(tags)
        currentRgInfo = info
        applyReplayGainInternal(info)
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

    // ─────────────────────────────────────────────────────────────────────────
    // PRESETS
    // ─────────────────────────────────────────────────────────────────────────

    fun applyPresetByName(name: String): Boolean {
        val preset = presetManager.loadPreset(name) ?: return false
        applyPreset(preset)
        return true
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
        Log.i(TAG, "Preset applied: ${preset.name}")
    }

    fun saveCurrentAsPreset(name: String) {
        val preset = EqPresetManager.EqPreset(
            name            = name,
            graphicGains    = equalizerProcessor.getCurrentGains(),
            parametricGains = equalizerProcessor.getParametricGains(),
            parametricFreqs = equalizerProcessor.getParametricFreqs(),
            qValues         = equalizerProcessor.getCurrentQValues(),
            preampDb        = equalizerProcessor.getCurrentPreamp(),
            eqMode          = equalizerProcessor.getCurrentEqMode().name,
            smoothingRampMs = equalizerProcessor.smoothingRampMs
        )
        presetManager.savePreset(preset)
    }

    fun listPresets(): List<String>             = presetManager.listPresets()
    fun deletePreset(name: String): Boolean     = presetManager.deletePreset(name)
    fun exportPreset(name: String): String?     = presetManager.exportPreset(name)
    fun importPreset(json: String): Boolean     = presetManager.importPreset(json) != null
    fun assignTrackPreset(mediaId: String, presetName: String?) = presetManager.assignTrackPreset(mediaId, presetName)
    fun getTrackPreset(mediaId: String): String? = presetManager.getTrackPreset(mediaId)
    fun setAutoSwitchPresets(enabled: Boolean)  { autoSwitchPresets = enabled }

    // ─────────────────────────────────────────────────────────────────────────
    // USB DAC
    // ─────────────────────────────────────────────────────────────────────────

    fun isUsbDacConnected(): Boolean                             = usbDacController.isDacConnected
    fun getCurrentDacInfo(): UsbDacController.DacInfo?          = usbDacController.getCurrentDacInfo()
    fun getDacCapabilities(): UsbDacController.DacCapabilities? = usbDacController.getDacCapabilities()
    fun enableDirectUsbRouting(enabled: Boolean): Boolean       = usbDacController.enableDirectUsbRouting(enabled)
    fun isDirectUsbRoutingEnabled(): Boolean                    = usbDacController.isDirectUsbRoutingEnabled()
    fun setPreferredDacSampleRate(rate: Int): Boolean           = usbDacController.setPreferredSampleRate(rate)
    fun setPreferredDacBitDepth(depth: Int): Boolean            = usbDacController.setPreferredBitDepth(depth)
    fun rescanUsbDevices()                                      { usbDacController.rescanDevices() }

    // ─────────────────────────────────────────────────────────────────────────
    // AUDIO FORMAT DETECTION
    // ─────────────────────────────────────────────────────────────────────────

    fun getAudioCapabilities(): AudioFormatDetector.AudioCapabilities = audioFormatDetector.getAudioCapabilities()
    fun getOptimalAudioFormat(): AudioFormatDetector.OptimalFormat    = audioFormatDetector.getOptimalFormat()
    fun isHiResAudioCapable(): Boolean                               = audioFormatDetector.isHdAudioCapable()
    fun getMaxSampleRate(): Int                                      = audioFormatDetector.getMaxSampleRate()
    fun getMaxBitDepth(): Int                                        = audioFormatDetector.getMaxBitDepth()

    // ─────────────────────────────────────────────────────────────────────────
    // CONVOLUTION
    // ─────────────────────────────────────────────────────────────────────────

    fun loadImpulseResponse(filePath: String): Boolean = convolutionProcessor.loadImpulseResponse(filePath)
    fun clearImpulseResponse()                         { convolutionProcessor.clearImpulseResponse() }
    fun isImpulseResponseLoaded(): Boolean             = convolutionProcessor.isImpulseResponseLoaded()
    fun getIrLength(): Int                             = convolutionProcessor.getIrLength()
    fun setConvolutionEnabled(enabled: Boolean)        { convolutionProcessor.isEnabled = enabled }
    fun isConvolutionEnabled(): Boolean                = convolutionProcessor.isEnabled

    // ─────────────────────────────────────────────────────────────────────────
    // FX PROCESSOR
    // ─────────────────────────────────────────────────────────────────────────

    fun setFxEnabled(enabled: Boolean) { fxProcessor.isEnabled = enabled }
    fun isFxEnabled(): Boolean         = fxProcessor.isEnabled
    fun setFxMode(mode: String) {
        fxProcessor.setFxMode(when (mode.uppercase()) {
            "REVERB"  -> FxProcessor.FxMode.REVERB
            "DELAY"   -> FxProcessor.FxMode.DELAY
            "CHORUS"  -> FxProcessor.FxMode.CHORUS
            "FLANGER" -> FxProcessor.FxMode.FLANGER
            "PHASER"  -> FxProcessor.FxMode.PHASER
            else      -> FxProcessor.FxMode.REVERB
        })
    }
    fun getFxMode(): String            = fxProcessor.getFxMode().name
    fun setFxMix(mix: Double)          { fxProcessor.setMix(mix / 100.0) }
    fun getFxMix(): Double             = fxProcessor.getMix() * 100.0
    fun setFxBypass(bypass: Boolean)   { fxProcessor.setBypass(bypass) }
    fun isFxBypassed(): Boolean        = fxProcessor.isBypassed()

    fun setReverbRoomSize(value: Double) { fxProcessor.setReverbRoomSize(value / 100.0) }
    fun setReverbDecay(value: Double)    { fxProcessor.setReverbDecay(value / 100.0) }
    fun setReverbPreDelay(value: Double) { fxProcessor.setReverbPreDelay(value / 100.0) }
    fun setReverbDamping(value: Double)  { fxProcessor.setReverbDamping(value / 100.0) }
    fun setDelayTime(value: Double)      { fxProcessor.setDelayTime(value / 100.0) }
    fun setDelayFeedback(value: Double)  { fxProcessor.setDelayFeedback(value / 100.0) }
    fun setDelayLowCut(value: Double)    { fxProcessor.setDelayLowCut(value / 100.0) }
    fun setDelayHighCut(value: Double)   { fxProcessor.setDelayHighCut(value / 100.0) }
    fun setModRate(value: Double)        { fxProcessor.setModRate(value / 100.0) }
    fun setModDepth(value: Double)       { fxProcessor.setModDepth(value / 100.0) }
    fun setModPhase(value: Double)       { fxProcessor.setModPhase(value / 100.0) }
    fun setModFeedback(value: Double)    { fxProcessor.setModFeedback(value / 100.0) }

    // ─────────────────────────────────────────────────────────────────────────
    // EQ GETTERS
    // ─────────────────────────────────────────────────────────────────────────

    fun getEQGains(): FloatArray          = equalizerProcessor.getCurrentGains()
    fun getEQPreamp(): Float              = equalizerProcessor.getCurrentPreamp()
    fun getEQQValues(): FloatArray        = equalizerProcessor.getCurrentQValues()
    fun isEQEnabled(): Boolean            = equalizerProcessor.isEnabled
    fun getParametricGains(): FloatArray  = equalizerProcessor.getParametricGains()
    fun getParametricFreqs(): DoubleArray = equalizerProcessor.getParametricFreqs()
    fun getLoudnessDb(): Float            = equalizerProcessor.getCurrentLoudnessDb()
    fun getEQMode(): String               = equalizerProcessor.getCurrentEqMode().name
    fun getSpectrumMagnitudes(): FloatArray = equalizerProcessor.spectrumMagnitudes
    fun computeAutoEQ(): FloatArray       = equalizerProcessor.computeAutoEqSuggestion()

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL
    // ─────────────────────────────────────────────────────────────────────────

    private fun handleTrackTransition(mediaItem: MediaItem) {
        val mediaId  = mediaItem.mediaId
        val localUri = mediaItem.localConfiguration?.uri?.path
        if (autoSwitchPresets) {
            presetManager.getTrackPreset(mediaId)?.let { applyPresetByName(it) }
        }
        ioScope.launch {
            val info = if (localUri != null && !offlineMode) {
                ReplayGainParser.parse(localUri)
            } else {
                val extras = mediaItem.mediaMetadata.extras
                if (extras != null && !offlineMode) {
                    ReplayGainParser.parseFromMap(mapOf(
                        "replaygain_track_gain" to (extras.getString("replaygain_track_gain") ?: ""),
                        "replaygain_album_gain" to (extras.getString("replaygain_album_gain") ?: ""),
                        "replaygain_track_peak" to (extras.getString("replaygain_track_peak") ?: ""),
                        "replaygain_album_peak" to (extras.getString("replaygain_album_peak") ?: "")
                    ))
                } else ReplayGainParser.EMPTY
            }
            currentRgInfo = info
            applyReplayGainInternal(info)
        }
    }

    private fun applyReplayGainInternal(info: ReplayGainParser.ReplayGainInfo) {
        val gainDb = info.resolveGain(replayGainMode, replayGainPreampDb)
        if (gainDb != null && !offlineMode) {
            equalizerProcessor.setLoudnessOffset(gainDb)
            onReplayGainApplied?.invoke(info.trackGain, info.albumGain, gainDb)
        } else {
            equalizerProcessor.setLoudnessLinear(1f)
        }
    }

    private fun supportsFloatOutput(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        return am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { device ->
            device.encodings?.contains(AudioFormat.ENCODING_PCM_FLOAT) == true
        }
    }

    private fun buildMediaItem(track: TrackData): MediaItem {
        val metaBuilder = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .setGenre(track.genre)
            .setDescription(track.description)
        track.artworkUri?.let { metaBuilder.setArtworkUri(android.net.Uri.parse(it)) }
        if (track.replayGainTags != null && !offlineMode) {
            val bundle = android.os.Bundle()
            track.replayGainTags.forEach { (k, v) -> bundle.putString(k, v) }
            metaBuilder.setExtras(bundle)
        }
        val itemBuilder = MediaItem.Builder()
            .setUri(track.uri)
            .setMediaId(track.id)
            .setMediaMetadata(metaBuilder.build())
        track.headers?.let { headers ->
            itemBuilder.setRequestMetadata(
                MediaItem.RequestMetadata.Builder()
                    .setExtras(android.os.Bundle().also { b ->
                        headers.forEach { (k, v) -> b.putString(k, v) }
                    })
                    .build()
            )
        }
        return itemBuilder.build()
    }

    fun release() {
        wakeLock?.release()
        wakeLock = null
        usbDacController.release()
        player.release()
        cache.release()
        Log.i(TAG, "MavinAudioPlayer released")
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TrackData
// ─────────────────────────────────────────────────────────────────────────────

data class TrackData(
    val id             : String,
    val uri            : String,
    val title          : String?              = null,
    val artist         : String?              = null,
    val album          : String?              = null,
    val artworkUri     : String?              = null,
    val duration       : Long?                = null,
    val headers        : Map<String, String>? = null,
    val replayGainTags : Map<String, String>? = null,
    val genre          : String?              = null,
    val description    : String?              = null,
    val date           : String?              = null,
    val rating         : Float?               = null,
    val isLiveStream   : Boolean              = false,
)