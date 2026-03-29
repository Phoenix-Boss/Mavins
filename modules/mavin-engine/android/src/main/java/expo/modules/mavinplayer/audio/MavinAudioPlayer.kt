package expo.modules.mavinplayer.audio

import android.content.Context
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
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
import expo.modules.autoeqengine.EqualizerProcessor
import java.io.File

@UnstableApi
class MavinAudioPlayer(private val context: Context) {

    companion object {
        private const val TAG = "MavinAudioPlayer"
        private const val CACHE_SIZE_BYTES = 200L * 1024 * 1024
    }

    val equalizerProcessor = EqualizerProcessor()
    val player: ExoPlayer
    private val cache: SimpleCache

    var onPlaybackStateChanged: ((state: Int) -> Unit)? = null
    var onTrackChanged: ((index: Int) -> Unit)? = null
    var onError: ((message: String, code: String) -> Unit)? = null
    var onPositionDiscontinuity: (() -> Unit)? = null

    init {
        val cacheDir = File(context.cacheDir, "mavin_audio_cache")
        cache = SimpleCache(cacheDir, LeastRecentlyUsedCacheEvictor(CACHE_SIZE_BYTES))

        val httpFactory = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(15_000)
            .setAllowCrossProtocolRedirects(true)

        val cacheFactory = CacheDataSource.Factory()
            .setCache(cache)
            .setUpstreamDataSourceFactory(httpFactory)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

        val mediaSourceFactory = DefaultMediaSourceFactory(context)
            .setDataSourceFactory(cacheFactory)

        val renderersFactory = object : DefaultRenderersFactory(context) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioTrackPlaybackParams: Boolean
            ): AudioSink {
                return DefaultAudioSink.Builder(context)
                    .setAudioProcessors(arrayOf(equalizerProcessor))
                    .setEnableFloatOutput(enableFloatOutput)
                    .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                    .build()
            }
        }.also {
            it.setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF)
        }

        val trackSelector = DefaultTrackSelector(context).apply {
            setParameters(buildUponParameters().setForceHighestSupportedBitrate(true))
        }

        player = ExoPlayer.Builder(context)
            .setRenderersFactory(renderersFactory)
            .setMediaSourceFactory(mediaSourceFactory)
            .setTrackSelector(trackSelector)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                true
            )
            .setHandleAudioBecomingNoisy(true)
            .build()

        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                Log.d(TAG, "playbackState=$state")
                onPlaybackStateChanged?.invoke(state)
            }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                val index = player.currentMediaItemIndex
                Log.d(TAG, "trackChanged index=$index")
                onTrackChanged?.invoke(index)
            }
            override fun onPlayerError(error: PlaybackException) {
                Log.e(TAG, "playerError: ${error.message}", error)
                onError?.invoke(error.message ?: "Unknown error", error.errorCodeName)
            }
            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int
            ) {
                onPositionDiscontinuity?.invoke()
            }
        })

        Log.i(TAG, "✅ MavinAudioPlayer initialised with full DSP chain (parametric + smoothing + spectrum)")
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PLAYBACK CONTROL
    // ═════════════════════════════════════════════════════════════════════════

    fun load(track: TrackData) {
        player.setMediaItem(buildMediaItem(track))
        player.prepare()
    }

    fun setQueue(tracks: List<TrackData>, startIndex: Int = 0) {
        player.setMediaItems(tracks.map { buildMediaItem(it) }, startIndex, C.TIME_UNSET)
        player.prepare()
    }

    fun addToQueue(track: TrackData)      { player.addMediaItem(buildMediaItem(track)) }
    fun play()                            { player.play() }
    fun pause()                           { player.pause() }
    fun stop()                            { player.stop() }
    fun seekTo(positionMs: Long)          { player.seekTo(positionMs) }
    fun skipToNext()                      { player.seekToNext() }
    fun skipToPrevious()                  { player.seekToPrevious() }
    fun skipToIndex(index: Int)           { player.seekTo(index, C.TIME_UNSET) }
    fun setRepeatMode(mode: Int)          { player.repeatMode = mode }
    fun setShuffleModeEnabled(e: Boolean) { player.shuffleModeEnabled = e }
    fun setVolume(volume: Float)          { player.volume = volume.coerceIn(0f, 1f) }

    // ═════════════════════════════════════════════════════════════════════════
    // STATE QUERIES
    // ═════════════════════════════════════════════════════════════════════════

    fun getCurrentPosition(): Long  = player.currentPosition
    fun getDuration(): Long         = player.duration.takeIf { it != C.TIME_UNSET } ?: 0L
    fun getBufferedPosition(): Long = player.bufferedPosition
    fun isPlaying(): Boolean        = player.isPlaying
    fun getPlaybackState(): Int     = player.playbackState
    fun getCurrentIndex(): Int      = player.currentMediaItemIndex
    fun getQueueSize(): Int         = player.mediaItemCount

    fun getCurrentTrackInfo(): Map<String, Any?> {
        val meta = player.currentMediaItem?.mediaMetadata
        return mapOf(
            "title"    to (meta?.title?.toString() ?: ""),
            "artist"   to (meta?.artist?.toString() ?: ""),
            "album"    to (meta?.albumTitle?.toString() ?: ""),
            "duration" to getDuration(),
            "index"    to getCurrentIndex(),
        )
    }

    // ═════════════════════════════════════════════════════════════════════════
    // EQ CONTROL — GRAPHIC
    // ═════════════════════════════════════════════════════════════════════════

    fun setEQEnabled(enabled: Boolean)           { equalizerProcessor.isEnabled = enabled }
    fun setEQBand(band: Int, gainDb: Float)      { equalizerProcessor.setBandGain(band, gainDb) }
    fun applyEQBands(gainsDb: FloatArray)        { equalizerProcessor.applyBands(gainsDb) }
    fun setEQPreamp(gainDb: Float)               { equalizerProcessor.setPreamp(gainDb) }
    fun setEQBandQ(band: Int, q: Float)          { equalizerProcessor.setBandQ(band, q) }
    fun resetEQ()                                { equalizerProcessor.resetGains() }

    // ═════════════════════════════════════════════════════════════════════════
    // EQ CONTROL — PARAMETRIC
    // ═════════════════════════════════════════════════════════════════════════

    fun setParametricBandGain(band: Int, gainDb: Float) {
        equalizerProcessor.setParametricBandGain(band, gainDb)
    }
    fun applyParametricBands(gainsDb: FloatArray) {
        equalizerProcessor.applyParametricBands(gainsDb)
    }
    fun setParametricBandFreq(band: Int, freqHz: Double) {
        equalizerProcessor.setParametricBandFreq(band, freqHz)
    }
    fun resetParametric() { equalizerProcessor.resetParametric() }

    fun setEQMode(mode: String) {
        val m = when (mode.uppercase()) {
            "PARAMETRIC" -> EqualizerProcessor.EqMode.PARAMETRIC
            else         -> EqualizerProcessor.EqMode.GRAPHIC
        }
        equalizerProcessor.setEqMode(m)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // EQ CONTROL — LOUDNESS NORMALIZATION
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Apply loudness normalization offset in dB.
     * Pass your ReplayGain track or album gain value directly.
     * Positive = boost, negative = attenuate.
     * Applied before preamp in DSP chain, covered by the limiter.
     */
    fun setLoudnessOffset(gainDb: Float) { equalizerProcessor.setLoudnessOffset(gainDb) }

    // ═════════════════════════════════════════════════════════════════════════
    // EQ CONTROL — SMOOTHING
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Set the parameter smoothing ramp time in milliseconds.
     * Default: 10 ms. Set to 0 for immediate (may cause zipper noise on fast moves).
     * Recommended range: 5–20 ms.
     */
    fun setSmoothingRamp(ms: Double) {
        equalizerProcessor.smoothingRampMs = ms.coerceIn(0.0, 50.0)
        equalizerProcessor.recomputeSmoothStep()
    }

    // ═════════════════════════════════════════════════════════════════════════
    // EQ STATE GETTERS
    // ═════════════════════════════════════════════════════════════════════════

    fun getEQGains(): FloatArray           = equalizerProcessor.getCurrentGains()
    fun getEQPreamp(): Float               = equalizerProcessor.getCurrentPreamp()
    fun getEQQValues(): FloatArray         = equalizerProcessor.getCurrentQValues()
    fun isEQEnabled(): Boolean             = equalizerProcessor.isEnabled
    fun getParametricGains(): FloatArray   = equalizerProcessor.getParametricGains()
    fun getParametricFreqs(): DoubleArray  = equalizerProcessor.getParametricFreqs()
    fun getLoudnessOffset(): Float         = equalizerProcessor.getCurrentLoudnessOffset()
    fun getEQMode(): String                = equalizerProcessor.getCurrentEqMode().name

    // ═════════════════════════════════════════════════════════════════════════
    // SPECTRUM ANALYSIS & AUTO-EQ
    // ═════════════════════════════════════════════════════════════════════════

    /** Latest real-time spectrum magnitudes — 64 bins, log-spaced 20 Hz → Nyquist, linear 0..1. */
    fun getSpectrumMagnitudes(): FloatArray = equalizerProcessor.spectrumMagnitudes

    /**
     * Compute an auto-EQ correction suggestion from the current spectrum.
     * Returns suggested gains array (FloatArray, length 31).
     * Call applyEQBands(result) to apply, or present to user first.
     */
    fun computeAutoEQ(): FloatArray = equalizerProcessor.computeAutoEqSuggestion()

    // ═════════════════════════════════════════════════════════════════════════
    // CLEANUP
    // ═════════════════════════════════════════════════════════════════════════

    private fun buildMediaItem(track: TrackData): MediaItem {
        val meta = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .also { track.artworkUri?.let { uri -> it.setArtworkUri(android.net.Uri.parse(uri)) } }
            .build()
        return MediaItem.Builder()
            .setUri(track.uri)
            .setMediaId(track.id)
            .setMediaMetadata(meta)
            .build()
    }

    fun release() {
        player.release()
        cache.release()
        Log.i(TAG, "MavinAudioPlayer released")
    }
}

data class TrackData(
    val id: String,
    val uri: String,
    val title: String?  = null,
    val artist: String? = null,
    val album: String?  = null,
    val artworkUri: String?           = null,
    val duration: Long?               = null,
    val headers: Map<String, String>? = null,
)