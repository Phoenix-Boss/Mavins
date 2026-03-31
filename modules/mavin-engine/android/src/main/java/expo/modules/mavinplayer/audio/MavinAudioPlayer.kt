package expo.modules.mavinplayer.audio

import android.content.Context
import android.media.AudioFormat
import android.media.AudioManager
import android.os.Build
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
import expo.modules.autoeqengine.CompressorProcessor
import expo.modules.autoeqengine.ConvolutionProcessor
import expo.modules.autoeqengine.CrossfeedProcessor
import expo.modules.autoeqengine.EqPresetManager
import expo.modules.autoeqengine.EqualizerProcessor
import expo.modules.autoeqengine.FxProcessor
import expo.modules.autoeqengine.PeakMeterProcessor
import expo.modules.autoeqengine.ReplayGainParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File

@UnstableApi
class MavinAudioPlayer(private val context: Context) {

    companion object {
        private const val TAG = "MavinAudioPlayer"
        private const val CACHE_SIZE_BYTES = 200L * 1024 * 1024
    }

    // ── DSP processors ────────────────────────────────────────────────────────
    val equalizerProcessor = EqualizerProcessor()
    lateinit var compressorProcessor: CompressorProcessor
    lateinit var crossfeedProcessor: CrossfeedProcessor
    lateinit var peakMeterProcessor: PeakMeterProcessor
    lateinit var convolutionProcessor: ConvolutionProcessor
    lateinit var fxProcessor: FxProcessor
    lateinit var usbDacController: UsbDacController
    lateinit var audioFormatDetector: AudioFormatDetector

    val presetManager = EqPresetManager(context)
    val player: ExoPlayer
    private val cache: SimpleCache

    // ── ReplayGain state ──────────────────────────────────────────────────────
    private var replayGainMode = ReplayGainParser.Mode.TRACK
    private var replayGainPreampDb = 0f
    private var currentRgInfo = ReplayGainParser.EMPTY

    // ── Crossfade ─────────────────────────────────────────────────────────────
    private var crossfadeEnabled = false
    private var crossfadeDurationMs = 2000L

    // ── Feature flags ─────────────────────────────────────────────────────────
    private var autoSwitchPresets = true
    private var offlineMode = false

    // ── Background scope ──────────────────────────────────────────────────────
    private val ioScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // ── Callbacks ─────────────────────────────────────────────────────────────
    var onPlaybackStateChanged: ((state: Int) -> Unit)? = null
    var onTrackChanged: ((index: Int) -> Unit)? = null
    var onError: ((message: String, code: String) -> Unit)? = null
    var onPositionDiscontinuity: (() -> Unit)? = null
    var onReplayGainApplied: ((trackGain: Float?, albumGain: Float?, appliedDb: Float) -> Unit)? = null
    var onPeakMeter: ((leftPeak: Float, rightPeak: Float) -> Unit)? = null
    var onUsbDacConnected: ((dacInfo: UsbDacController.DacInfo) -> Unit)? = null
    var onUsbDacDisconnected: (() -> Unit)? = null

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

        // Initialise processors
        compressorProcessor   = CompressorProcessor()
        crossfeedProcessor    = CrossfeedProcessor()
        peakMeterProcessor    = PeakMeterProcessor()
        convolutionProcessor  = ConvolutionProcessor(context)
        fxProcessor           = FxProcessor()
        usbDacController      = UsbDacController(context)
        audioFormatDetector   = AudioFormatDetector(context)

        // Peak meter callback
        peakMeterProcessor.setPeakCallback { peaks ->
            if (peaks.size >= 2) onPeakMeter?.invoke(peaks[0], peaks[1])
        }

        // USB DAC callbacks
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
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(), true
            )
            .setHandleAudioBecomingNoisy(true)
            .build()

        // NOTE: setAudioOffloadSchedulingEnabled was removed in Media3 1.2+.
        // Gapless playback is handled automatically by ExoPlayer via back-to-back
        // MediaItem preparation; no explicit call needed.
        Log.d(TAG, "Gapless playback configured (automatic via ExoPlayer)")

        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                onPlaybackStateChanged?.invoke(state)
            }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                val index = player.currentMediaItemIndex
                onTrackChanged?.invoke(index)
                mediaItem?.let { handleTrackTransition(it) }
            }
            override fun onPlayerError(error: PlaybackException) {
                onError?.invoke(error.message ?: "Unknown error", error.errorCodeName)
            }
            override fun onPositionDiscontinuity(
                old: Player.PositionInfo, new: Player.PositionInfo, reason: Int
            ) { onPositionDiscontinuity?.invoke() }
        })

        Log.i(TAG, "✅ MavinAudioPlayer ready — EQ · Compressor · Crossfeed · Convolution · FX · Peak Meter · USB DAC · ReplayGain · Presets · Gapless")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CROSSFADE
    // ─────────────────────────────────────────────────────────────────────────

    fun setCrossfadeEnabled(enabled: Boolean) {
        crossfadeEnabled = enabled
        Log.d(TAG, "Crossfade enabled=$enabled (${crossfadeDurationMs}ms)")
    }

    fun isCrossfadeEnabled(): Boolean = crossfadeEnabled

    fun setCrossfadeDurationMs(durationMs: Long) {
        crossfadeDurationMs = durationMs.coerceIn(500L, 10_000L)
    }

    fun getCrossfadeDurationMs(): Long = crossfadeDurationMs

    // ─────────────────────────────────────────────────────────────────────────
    // OFFLINE MODE
    // ─────────────────────────────────────────────────────────────────────────

    fun setOfflineMode(enabled: Boolean) {
        offlineMode = enabled
        Log.i(TAG, "Offline mode: $enabled")
    }

    fun isOfflineMode(): Boolean = offlineMode

    // ─────────────────────────────────────────────────────────────────────────
    // 64-BIT PROCESSING
    // ─────────────────────────────────────────────────────────────────────────

    fun set64BitProcessingEnabled(enabled: Boolean) {
        equalizerProcessor.setHighPrecisionMode(enabled)
        Log.i(TAG, "64-bit processing: $enabled")
    }

    fun is64BitProcessingEnabled(): Boolean = equalizerProcessor.isHighPrecisionMode()

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

    fun addToQueue(track: TrackData)      { player.addMediaItem(buildMediaItem(track)) }
    fun play()                            { player.play() }
    fun pause()                           { player.pause() }
    fun stop()                            { player.stop() }
    fun seekTo(ms: Long)                  { player.seekTo(ms) }
    fun skipToNext()                      { player.seekToNext() }
    fun skipToPrevious()                  { player.seekToPrevious() }
    fun skipToIndex(index: Int)           { player.seekTo(index, C.TIME_UNSET) }
    fun setRepeatMode(mode: Int)          { player.repeatMode = mode }
    fun setShuffleModeEnabled(e: Boolean) { player.shuffleModeEnabled = e }
    fun setVolume(volume: Float)          { player.volume = volume.coerceIn(0f, 1f) }

    // ─────────────────────────────────────────────────────────────────────────
    // PLAYBACK SPEED
    // ─────────────────────────────────────────────────────────────────────────

    fun setPlaybackSpeed(speed: Float) {
        player.setPlaybackParameters(PlaybackParameters(speed.coerceIn(0.5f, 3.0f)))
    }

    fun getPlaybackSpeed(): Float = player.playbackParameters.speed

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

    fun getCurrentTrackInfo(): Map<String, Any?> {
        val meta = player.currentMediaItem?.mediaMetadata
        return mapOf(
            "title"    to (meta?.title?.toString()      ?: ""),
            "artist"   to (meta?.artist?.toString()     ?: ""),
            "album"    to (meta?.albumTitle?.toString() ?: ""),
            "duration" to getDuration(),
            "index"    to getCurrentIndex(),
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EQ — GRAPHIC
    // ─────────────────────────────────────────────────────────────────────────

    fun setEQEnabled(enabled: Boolean)       { equalizerProcessor.isEnabled = enabled }
    fun setEQBand(band: Int, gainDb: Float)  { equalizerProcessor.setBandGain(band, gainDb) }
    fun applyEQBands(gainsDb: FloatArray)    { equalizerProcessor.applyBands(gainsDb) }
    fun setEQPreamp(gainDb: Float)           { equalizerProcessor.setPreamp(gainDb) }
    fun setEQBandQ(band: Int, q: Float)      { equalizerProcessor.setBandQ(band, q) }
    fun resetEQ()                            { equalizerProcessor.resetGains() }

    // ─────────────────────────────────────────────────────────────────────────
    // EQ — PARAMETRIC
    // ─────────────────────────────────────────────────────────────────────────

    fun setParametricBandGain(band: Int, gainDb: Float)  { equalizerProcessor.setParametricBandGain(band, gainDb) }
    fun applyParametricBands(gainsDb: FloatArray)        { equalizerProcessor.applyParametricBands(gainsDb) }
    fun setParametricBandFreq(band: Int, freqHz: Double) { equalizerProcessor.setParametricBandFreq(band, freqHz) }
    fun resetParametric()                                { equalizerProcessor.resetParametric() }

    fun setEQMode(mode: String) {
        val m = when (mode.uppercase()) {
            "PARAMETRIC" -> EqualizerProcessor.EqMode.PARAMETRIC
            "PARALLEL"   -> EqualizerProcessor.EqMode.PARALLEL
            else         -> EqualizerProcessor.EqMode.GRAPHIC
        }
        equalizerProcessor.setEqMode(m)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EQ — DITHER / SMOOTHING
    // ─────────────────────────────────────────────────────────────────────────

    fun setDitherMode(mode: String) {
        val m = when (mode.uppercase()) {
            "HIGHPASS"   -> EqualizerProcessor.DitherMode.HIGHPASS
            "E_WEIGHTED" -> EqualizerProcessor.DitherMode.E_WEIGHTED
            "F_WEIGHTED" -> EqualizerProcessor.DitherMode.F_WEIGHTED
            else         -> EqualizerProcessor.DitherMode.FLAT
        }
        equalizerProcessor.setDitherMode(m)
    }

    fun getDitherMode(): String = equalizerProcessor.getDitherMode().name

    fun setSmoothingRamp(ms: Double) {
        equalizerProcessor.smoothingRampMs = ms.coerceIn(0.0, 50.0)
        equalizerProcessor.recomputeSmoothStep()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // COMPRESSOR (DRC)
    // ─────────────────────────────────────────────────────────────────────────

    fun setCompressorEnabled(enabled: Boolean)  { compressorProcessor.setEnabled(enabled) }
    fun isCompressorEnabled(): Boolean           = compressorProcessor.isEnabled()
    fun setCompressorThreshold(db: Double)       { compressorProcessor.setThreshold(db) }
    fun setCompressorRatio(ratio: Double)        { compressorProcessor.setRatio(ratio) }
    fun setCompressorAttackMs(ms: Double)        { compressorProcessor.setAttackMs(ms) }
    fun setCompressorReleaseMs(ms: Double)       { compressorProcessor.setReleaseMs(ms) }
    fun setCompressorKneeWidth(db: Double)       { compressorProcessor.setKneeWidth(db) }
    fun setCompressorMakeupGain(db: Double)      { compressorProcessor.setMakeupGain(db) }
    fun getCompressorReductionDb(): Float        = compressorProcessor.getReductionDb()
    fun getCompressorThreshold(): Double         = compressorProcessor.getThreshold()
    fun getCompressorRatio(): Double             = compressorProcessor.getRatio()
    fun getCompressorAttackMs(): Double          = compressorProcessor.getAttackMs()
    fun getCompressorReleaseMs(): Double         = compressorProcessor.getReleaseMs()

    // ─────────────────────────────────────────────────────────────────────────
    // CROSSFEED
    // ─────────────────────────────────────────────────────────────────────────

    fun setCrossfeedEnabled(enabled: Boolean)    { crossfeedProcessor.setEnabled(enabled) }
    fun isCrossfeedEnabled(): Boolean            = crossfeedProcessor.isEnabled()
    fun setCrossfeedStrength(strength: Float)    { crossfeedProcessor.setStrength(strength) }
    fun setCrossfeedCutoff(hz: Double)           { crossfeedProcessor.setCutoffFrequency(hz) }
    fun getCrossfeedStrength(): Float            = crossfeedProcessor.getStrength()
    fun getCrossfeedCutoff(): Double             = crossfeedProcessor.getCutoffFrequency()

    // ─────────────────────────────────────────────────────────────────────────
    // PEAK METER (VU)
    // ─────────────────────────────────────────────────────────────────────────

    fun setPeakHoldMs(ms: Double)       { peakMeterProcessor.setPeakHoldMs(ms) }
    fun setPeakReleaseMs(ms: Double)    { peakMeterProcessor.setReleaseMs(ms) }
    fun getCurrentPeaks(): FloatArray   = peakMeterProcessor.getCurrentPeaks()
    fun getHeldPeaks(): FloatArray      = peakMeterProcessor.getHeldPeaks()
    fun resetPeaks()                    { peakMeterProcessor.resetPeaks() }

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
        "trackGain"  to currentRgInfo.trackGain,
        "albumGain"  to currentRgInfo.albumGain,
        "trackPeak"  to currentRgInfo.trackPeak,
        "albumPeak"  to currentRgInfo.albumPeak,
        "source"     to currentRgInfo.source,
        "mode"       to replayGainMode.name,
        "preampDb"   to replayGainPreampDb
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

    fun listPresets(): List<String>            = presetManager.listPresets()
    fun deletePreset(name: String): Boolean    = presetManager.deletePreset(name)
    fun exportPreset(name: String): String?    = presetManager.exportPreset(name)
    fun importPreset(json: String): Boolean    = presetManager.importPreset(json) != null
    fun assignTrackPreset(mediaId: String, presetName: String?) = presetManager.assignTrackPreset(mediaId, presetName)
    fun getTrackPreset(mediaId: String): String? = presetManager.getTrackPreset(mediaId)
    fun setAutoSwitchPresets(enabled: Boolean) { autoSwitchPresets = enabled }

    // ─────────────────────────────────────────────────────────────────────────
    // USB DAC CONTROL
    // ─────────────────────────────────────────────────────────────────────────

    fun isUsbDacConnected(): Boolean                          = usbDacController.isDacConnected
    fun getCurrentDacInfo(): UsbDacController.DacInfo?        = usbDacController.currentDacInfo
    fun getDacCapabilities(): UsbDacController.DacCapabilities? = usbDacController.dacCapabilities
    fun enableDirectUsbRouting(enabled: Boolean): Boolean     = usbDacController.enableDirectUsbRouting(enabled)
    fun isDirectUsbRoutingEnabled(): Boolean                  = usbDacController.isDirectUsbRoutingEnabled()
    fun setPreferredDacSampleRate(rate: Int): Boolean         = usbDacController.setPreferredSampleRate(rate)
    fun setPreferredDacBitDepth(depth: Int): Boolean          = usbDacController.setPreferredBitDepth(depth)
    fun rescanUsbDevices()                                    { usbDacController.rescanDevices() }

    // ─────────────────────────────────────────────────────────────────────────
    // AUDIO FORMAT DETECTION
    // ─────────────────────────────────────────────────────────────────────────

    fun getAudioCapabilities(): AudioFormatDetector.AudioCapabilities = audioFormatDetector.getAudioCapabilities()
    fun getOptimalAudioFormat(): AudioFormatDetector.OptimalFormat     = audioFormatDetector.getOptimalFormat()
    fun isHiResAudioCapable(): Boolean                                 = audioFormatDetector.isHdAudioCapable()
    fun getMaxSampleRate(): Int                                        = audioFormatDetector.getMaxSampleRate()
    fun getMaxBitDepth(): Int                                          = audioFormatDetector.getMaxBitDepth()

    // ─────────────────────────────────────────────────────────────────────────
    // CONVOLUTION PROCESSOR
    // ─────────────────────────────────────────────────────────────────────────

    fun loadImpulseResponse(filePath: String): Boolean = convolutionProcessor.loadImpulseResponse(filePath)
    fun clearImpulseResponse()                         { convolutionProcessor.clearImpulseResponse() }
    fun isImpulseResponseLoaded(): Boolean             = convolutionProcessor.isImpulseResponseLoaded()
    fun getIrLength(): Int                             = convolutionProcessor.getIrLength()
    fun setConvolutionEnabled(enabled: Boolean)        { convolutionProcessor.isEnabled = enabled }
    fun isConvolutionEnabled(): Boolean                = convolutionProcessor.isEnabled

    // ─────────────────────────────────────────────────────────────────────────
    // FX PROCESSOR (REVERB, DELAY, CHORUS, FLANGER, PHASER)
    // ─────────────────────────────────────────────────────────────────────────

    fun setFxEnabled(enabled: Boolean)   { fxProcessor.isEnabled = enabled }
    fun isFxEnabled(): Boolean           = fxProcessor.isEnabled

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

    // Use the public getFxMode() getter on FxProcessor instead of accessing private fxMode field
    fun getFxMode(): String                      = fxProcessor.getFxMode().name
    fun setFxMix(mix: Double)                    { fxProcessor.setMix(mix / 100.0) }
    fun getFxMix(): Double                       = fxProcessor.getMix() * 100.0
    fun setFxBypass(bypass: Boolean)             { fxProcessor.setBypass(bypass) }
    fun isFxBypassed(): Boolean                  = fxProcessor.isBypassed()
    fun setReverbRoomSize(value: Double)         { fxProcessor.setReverbRoomSize(value / 100.0) }
    fun setReverbDecay(value: Double)            { fxProcessor.setReverbDecay(value / 100.0) }
    fun setReverbPreDelay(value: Double)         { fxProcessor.setReverbPreDelay(value / 100.0) }
    fun setReverbDamping(value: Double)          { fxProcessor.setReverbDamping(value / 100.0) }
    fun setDelayTime(value: Double)              { fxProcessor.setDelayTime(value / 100.0) }
    fun setDelayFeedback(value: Double)          { fxProcessor.setDelayFeedback(value / 100.0) }
    fun setDelayLowCut(value: Double)            { fxProcessor.setDelayLowCut(value / 100.0) }
    fun setDelayHighCut(value: Double)           { fxProcessor.setDelayHighCut(value / 100.0) }
    fun setModRate(value: Double)                { fxProcessor.setModRate(value / 100.0) }
    fun setModDepth(value: Double)               { fxProcessor.setModDepth(value / 100.0) }
    fun setModPhase(value: Double)               { fxProcessor.setModPhase(value / 100.0) }
    fun setModFeedback(value: Double)            { fxProcessor.setModFeedback(value / 100.0) }

    // ─────────────────────────────────────────────────────────────────────────
    // STATE GETTERS
    // ─────────────────────────────────────────────────────────────────────────

    fun getEQGains(): FloatArray            = equalizerProcessor.getCurrentGains()
    fun getEQPreamp(): Float                = equalizerProcessor.getCurrentPreamp()
    fun getEQQValues(): FloatArray          = equalizerProcessor.getCurrentQValues()
    fun isEQEnabled(): Boolean              = equalizerProcessor.isEnabled
    fun getParametricGains(): FloatArray    = equalizerProcessor.getParametricGains()
    fun getParametricFreqs(): DoubleArray   = equalizerProcessor.getParametricFreqs()
    fun getLoudnessDb(): Float              = equalizerProcessor.getCurrentLoudnessDb()
    fun getEQMode(): String                 = equalizerProcessor.getCurrentEqMode().name
    fun getSpectrumMagnitudes(): FloatArray = equalizerProcessor.spectrumMagnitudes
    fun computeAutoEQ(): FloatArray         = equalizerProcessor.computeAutoEqSuggestion()

    // ─────────────────────────────────────────────────────────────────────────
    // TRACK TRANSITION
    // ─────────────────────────────────────────────────────────────────────────

    private fun handleTrackTransition(mediaItem: MediaItem) {
        val mediaId  = mediaItem.mediaId
        val localUri = mediaItem.localConfiguration?.uri?.path

        if (autoSwitchPresets) {
            val presetName = presetManager.getTrackPreset(mediaId)
            if (presetName != null) {
                applyPresetByName(presetName)
                Log.i(TAG, "Auto-switched preset for $mediaId → $presetName")
            }
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
            Log.i(TAG, "ReplayGain applied: ${gainDb}dB (mode=$replayGainMode src=${info.source})")
            onReplayGainApplied?.invoke(info.trackGain, info.albumGain, gainDb)
        } else {
            equalizerProcessor.setLoudnessLinear(1f)
            Log.d(TAG, "No ReplayGain data for track (src=${info.source})")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────

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
        usbDacController.release()
        player.release()
        cache.release()
        Log.i(TAG, "MavinAudioPlayer released")
    }
}

data class TrackData(
    val id: String,
    val uri: String,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val artworkUri: String? = null,
    val duration: Long? = null,
    val headers: Map<String, String>? = null,
    val replayGainTags: Map<String, String>? = null
)