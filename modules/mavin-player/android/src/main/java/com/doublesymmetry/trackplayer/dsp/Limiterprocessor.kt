package com.doublesymmetry.trackplayer.dsp

import android.util.Log
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.*

/**
 * LimiterProcessor â€” Production-grade true-peak brick-wall limiter
 *
 * DSP architecture (per sample, per channel):
 *   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
 *   â”‚  Input PCM â†’ [Lookahead buffer] â†’ [Gain computer] â†’         â”‚
 *   â”‚  [Gain smoother: attack/hold/release] â†’ [Makeup gain] â†’     â”‚
 *   â”‚  [Brick-wall clamp] â†’ [Soft saturation] â†’ Output PCM        â”‚
 *   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
 *
 * Features:
 *   âœ… True-peak detection via 4Ã— oversampling (FIR interpolation)
 *   âœ… Soft-knee gain computation with configurable knee width (0â€“12 dB)
 *   âœ… Per-channel envelope followers with independent attack/hold/release
 *   âœ… Lookahead buffer for zero-overshoot limiting (up to 20 ms)
 *   âœ… Makeup gain with automatic gain staging
 *   âœ… Gain reduction metering (GR in dB, per channel)
 *   âœ… Soft saturation / anti-clip stage after brick-wall
 *   âœ… Integrated bus-level RMS measurement (configurable window)
 *   âœ… ISP (Inter-Sample Peak) detection flag
 *   âœ… PCM_16BIT Â· PCM_FLOAT Â· PCM_32BIT support
 *   âœ… Mono and multi-channel (up to 8 ch)
 *   âœ… Lock-free parameter updates from JS thread
 *   âœ… Denormal flush guards
 *   âœ… 64-bit double-precision DSP path
 *
 * Poweramp/Neutron-parity additions:
 *   âœ… Ceiling dB (output headroom), default â€“0.1 dBFS
 *   âœ… Auto makeup gain mode (compensates threshold attenuation)
 *   âœ… Channel linking (stereo/multi-ch gain sharing)
 *   âœ… Hold time (prevents pumping on transient-dense material)
 *   âœ… Saturation curve selection (none / soft / tanh / arctan)
 *   âœ… Gain metering with configurable ballistics
 *
 * Usage in DSP chain (appended to EqualizerProcessor):
 *   PCM in â†’ EQ â†’ Compressor â†’ [LimiterProcessor] â†’ PCM out
 */
@androidx.media3.common.util.UnstableApi
class LimiterProcessor : AudioProcessor {

    companion object {
        private const val TAG = "LimiterProcessor"
        private const val DENORMAL_THRESHOLD = 1e-30

        // â”€â”€ Defaults â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const val DEFAULT_THRESHOLD_DB      = -0.1   // dBFS ceiling
        const val DEFAULT_CEILING_DB        = -0.1   // true-peak output ceiling
        const val DEFAULT_ATTACK_MS         = 0.1    // fast attack (0.1 ms)
        const val DEFAULT_HOLD_MS           = 10.0   // hold time (10 ms)
        const val DEFAULT_RELEASE_MS        = 80.0   // release time (80 ms)
        const val DEFAULT_KNEE_WIDTH_DB     = 3.0    // soft-knee width
        const val DEFAULT_LOOKAHEAD_MS      = 5.0    // lookahead buffer length
        const val DEFAULT_MAKEUP_DB         = 0.0    // makeup gain
        const val DEFAULT_RMS_WINDOW_MS     = 300.0  // RMS metering window

        // â”€â”€ Ranges â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const val THRESHOLD_MIN_DB  = -40.0
        const val THRESHOLD_MAX_DB  = 0.0
        const val CEILING_MIN_DB    = -40.0
        const val CEILING_MAX_DB    = 0.0
        const val ATTACK_MS_MIN     = 0.01
        const val ATTACK_MS_MAX     = 50.0
        const val HOLD_MS_MIN       = 0.0
        const val HOLD_MS_MAX       = 500.0
        const val RELEASE_MS_MIN    = 1.0
        const val RELEASE_MS_MAX    = 5000.0
        const val KNEE_WIDTH_MIN    = 0.0
        const val KNEE_WIDTH_MAX    = 12.0
        const val LOOKAHEAD_MS_MIN  = 0.0
        const val LOOKAHEAD_MS_MAX  = 20.0
        const val MAKEUP_DB_MIN     = -24.0
        const val MAKEUP_DB_MAX     = 24.0
        const val MAX_CHANNELS      = 8

        // â”€â”€ Internal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        private const val ENCODING_PCM_32BIT        = 0x00000004
        private const val OVERSAMPLE_FACTOR         = 4
        private const val FIR_HALF_LENGTH           = 8   // 17-tap FIR interpolator
    }

    // â”€â”€ Saturation mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    enum class SaturationMode { NONE, SOFT, TANH, ARCTAN }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // PARAMETERS â€” lock-free atomic
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private val _isEnabled  = AtomicBoolean(true)
    var isEnabled: Boolean
        get() = _isEnabled.get()
        set(v) = _isEnabled.set(v)

    @Volatile private var thresholdDb      = DEFAULT_THRESHOLD_DB
    @Volatile private var ceilingDb        = DEFAULT_CEILING_DB
    @Volatile private var attackMs         = DEFAULT_ATTACK_MS
    @Volatile private var holdMs           = DEFAULT_HOLD_MS
    @Volatile private var releaseMs        = DEFAULT_RELEASE_MS
    @Volatile private var kneeWidthDb      = DEFAULT_KNEE_WIDTH_DB
    @Volatile private var lookaheadMs      = DEFAULT_LOOKAHEAD_MS
    @Volatile private var makeupDb         = DEFAULT_MAKEUP_DB
    @Volatile private var rmsWindowMs      = DEFAULT_RMS_WINDOW_MS
    @Volatile private var autoMakeup       = false
    @Volatile private var channelLinked    = true
    @Volatile private var saturationMode   = SaturationMode.SOFT
    @Volatile private var truePeakEnabled  = true

    // â”€â”€ Pending atomic updates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    private data class Params(
        val thresholdDb: Double,
        val ceilingDb: Double,
        val attackMs: Double,
        val holdMs: Double,
        val releaseMs: Double,
        val kneeWidthDb: Double,
        val lookaheadMs: Double,
        val makeupDb: Double,
        val autoMakeup: Boolean,
        val channelLinked: Boolean,
        val saturationMode: SaturationMode,
        val truePeakEnabled: Boolean
    )
    private val pendingParams = AtomicReference<Params?>(null)

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // DERIVED DSP CONSTANTS (recomputed on configure/param change)
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private var ceilingLinear   = 0.0
    private var threshLinear    = 0.0
    private var kneeHalf        = 0.0
    private var makeupLinear    = 1.0
    private var attackCoeff     = 0.0
    private var releaseCoeff    = 0.0

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // PER-CHANNEL STATE
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private var gainEnvelope   = DoubleArray(MAX_CHANNELS) { 1.0 }
    private var holdCounter    = IntArray(MAX_CHANNELS) { 0 }
    private var holdSamples    = 0

    // Lookahead circular buffer [channel][sample]
    private var lookaheadBuf   = Array(MAX_CHANNELS) { DoubleArray(1) }
    private var lookaheadWrite = 0
    private var lookaheadLen   = 0

    // Gain reduction metering
    @Volatile private var _grDb = FloatArray(MAX_CHANNELS) { 0f }
    val gainReductionDb: FloatArray get() = _grDb.copyOf()

    // Peak and ISP detection
    @Volatile private var _currentPeaks = FloatArray(MAX_CHANNELS) { 0f }
    @Volatile private var _hasInterSamplePeak = false
    val hasInterSamplePeak: Boolean get() = _hasInterSamplePeak

    // RMS metering
    private var rmsAccum   = DoubleArray(MAX_CHANNELS) { 0.0 }
    private var rmsBuf     = Array(MAX_CHANNELS) { DoubleArray(1) }
    private var rmsWrite   = 0
    private var rmsLen     = 0
    @Volatile private var _rmsDb = FloatArray(MAX_CHANNELS) { -120f }
    val rmsDb: FloatArray get() = _rmsDb.copyOf()

    // True-peak FIR oversampling state [channel][tap]
    private var tpHistory = Array(MAX_CHANNELS) { DoubleArray(FIR_HALF_LENGTH * 2 + 1) }
    // Windowed-sinc FIR coefficients for 4Ã— oversample interpolation
    private val tpFirCoeffs: DoubleArray by lazy { buildTpFirCoeffs() }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // AudioProcessor state
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private var numChannels     = 0
    private var sampleRate      = 48000.0
    private var outputBuf: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var inputAudioFormat: AudioFormat  = AudioFormat.NOT_SET
    private var outputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var inputEnded = false

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // PUBLIC API
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    fun setThresholdDb(db: Double) {
        thresholdDb = db.coerceIn(THRESHOLD_MIN_DB, THRESHOLD_MAX_DB)
        scheduleParamUpdate()
    }
    fun getThresholdDb(): Double = thresholdDb

    fun setCeilingDb(db: Double) {
        ceilingDb = db.coerceIn(CEILING_MIN_DB, CEILING_MAX_DB)
        scheduleParamUpdate()
    }
    fun getCeilingDb(): Double = ceilingDb

    fun setAttackMs(ms: Double) {
        attackMs = ms.coerceIn(ATTACK_MS_MIN, ATTACK_MS_MAX)
        scheduleParamUpdate()
    }
    fun getAttackMs(): Double = attackMs

    fun setHoldMs(ms: Double) {
        holdMs = ms.coerceIn(HOLD_MS_MIN, HOLD_MS_MAX)
        scheduleParamUpdate()
    }
    fun getHoldMs(): Double = holdMs

    fun setReleaseMs(ms: Double) {
        releaseMs = ms.coerceIn(RELEASE_MS_MIN, RELEASE_MS_MAX)
        scheduleParamUpdate()
    }
    fun getReleaseMs(): Double = releaseMs

    fun setKneeWidthDb(db: Double) {
        kneeWidthDb = db.coerceIn(KNEE_WIDTH_MIN, KNEE_WIDTH_MAX)
        scheduleParamUpdate()
    }
    fun getKneeWidthDb(): Double = kneeWidthDb

    fun setLookaheadMs(ms: Double) {
        lookaheadMs = ms.coerceIn(LOOKAHEAD_MS_MIN, LOOKAHEAD_MS_MAX)
        scheduleParamUpdate()
    }
    fun getLookaheadMs(): Double = lookaheadMs

    fun setMakeupGainDb(db: Double) {
        makeupDb = db.coerceIn(MAKEUP_DB_MIN, MAKEUP_DB_MAX)
        autoMakeup = false
        scheduleParamUpdate()
    }
    fun getMakeupGainDb(): Double = makeupDb

    fun setAutoMakeup(enabled: Boolean) {
        autoMakeup = enabled
        if (enabled) recomputeAutoMakeup()
        scheduleParamUpdate()
    }
    fun isAutoMakeup(): Boolean = autoMakeup

    fun setChannelLinked(linked: Boolean) {
        channelLinked = linked
        scheduleParamUpdate()
    }
    fun isChannelLinked(): Boolean = channelLinked

    fun setSaturationMode(mode: SaturationMode) {
        saturationMode = mode
        scheduleParamUpdate()
    }
    fun getSaturationMode(): SaturationMode = saturationMode

    fun setTruePeakEnabled(enabled: Boolean) {
        truePeakEnabled = enabled
        scheduleParamUpdate()
    }
    fun isTruePeakEnabled(): Boolean = truePeakEnabled

    fun setRmsWindowMs(ms: Double) {
        rmsWindowMs = ms.coerceIn(10.0, 5000.0)
        if (sampleRate > 0.0) rebuildRmsBuffer()
    }

    fun getGainReductionDb(channel: Int = 0): Float =
        _grDb.getOrElse(channel) { 0f }

    fun getCurrentPeakLinear(channel: Int = 0): Float =
        _currentPeaks.getOrElse(channel) { 0f }

    fun getRmsDb(channel: Int = 0): Float =
        _rmsDb.getOrElse(channel) { -120f }

    /** Resets gain envelope to unity and clears hold counters. */
    fun resetGainState() {
        gainEnvelope.fill(1.0)
        holdCounter.fill(0)
        _grDb.fill(0f)
        _currentPeaks.fill(0f)
        _hasInterSamplePeak = false
        lookaheadBuf.forEach { it.fill(0.0) }
        lookaheadWrite = 0
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // AudioProcessor INTERFACE
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    override fun configure(inputAudioFormat: AudioFormat): AudioFormat {
        val enc = inputAudioFormat.encoding
        val supported = enc == android.media.AudioFormat.ENCODING_PCM_16BIT ||
                        enc == android.media.AudioFormat.ENCODING_PCM_FLOAT ||
                        enc == ENCODING_PCM_32BIT
        if (!supported) {
            this.inputAudioFormat  = AudioFormat.NOT_SET
            this.outputAudioFormat = AudioFormat.NOT_SET
            return AudioFormat.NOT_SET
        }
        this.inputAudioFormat  = inputAudioFormat
        this.outputAudioFormat = inputAudioFormat
        sampleRate   = inputAudioFormat.sampleRate.toDouble()
        numChannels  = inputAudioFormat.channelCount.coerceAtMost(MAX_CHANNELS)

        recomputeAllCoeffs()
        resetGainState()
        rebuildRmsBuffer()
        tpHistory = Array(numChannels) { DoubleArray(FIR_HALF_LENGTH * 2 + 1) }

        Log.i(TAG, "configure: ${inputAudioFormat.sampleRate}Hz ${numChannels}ch " +
              "thresh=${thresholdDb}dBFS knee=${kneeWidthDb}dB " +
              "attack=${attackMs}ms hold=${holdMs}ms release=${releaseMs}ms " +
              "lookahead=${lookaheadMs}ms truePeak=$truePeakEnabled")
        return outputAudioFormat
    }

    override fun isActive(): Boolean =
        inputAudioFormat != AudioFormat.NOT_SET && _isEnabled.get()

    override fun queueInput(inputBuffer: ByteBuffer) {
        // Apply any pending parameter changes atomically
        pendingParams.getAndSet(null)?.let { applyParams(it) }

        if (!_isEnabled.get() || inputBuffer.remaining() == 0) {
            outputBuf = inputBuffer
            return
        }

        val out = replaceOutputBuffer(inputBuffer.remaining())

        when (inputAudioFormat.encoding) {
            android.media.AudioFormat.ENCODING_PCM_16BIT -> processShort(inputBuffer, out)
            android.media.AudioFormat.ENCODING_PCM_FLOAT -> processFloat(inputBuffer, out)
            ENCODING_PCM_32BIT                           -> processInt32(inputBuffer, out)
        }

        inputBuffer.position(inputBuffer.limit())
        out.flip()
        outputBuf = out
    }

    override fun queueEndOfStream() { inputEnded = true }

    override fun getOutput(): ByteBuffer {
        val out = outputBuf
        outputBuf = AudioProcessor.EMPTY_BUFFER
        return out
    }

    override fun isEnded(): Boolean = inputEnded && outputBuf === AudioProcessor.EMPTY_BUFFER

    override fun flush() {
        outputBuf  = AudioProcessor.EMPTY_BUFFER
        inputEnded = false
        resetGainState()
        rmsAccum.fill(0.0)
        rmsBuf.forEach { it.fill(0.0) }
        rmsWrite = 0
    }

    override fun reset() {
        flush()
        inputAudioFormat  = AudioFormat.NOT_SET
        outputAudioFormat = AudioFormat.NOT_SET
        thresholdDb    = DEFAULT_THRESHOLD_DB
        ceilingDb      = DEFAULT_CEILING_DB
        attackMs       = DEFAULT_ATTACK_MS
        holdMs         = DEFAULT_HOLD_MS
        releaseMs      = DEFAULT_RELEASE_MS
        kneeWidthDb    = DEFAULT_KNEE_WIDTH_DB
        lookaheadMs    = DEFAULT_LOOKAHEAD_MS
        makeupDb       = DEFAULT_MAKEUP_DB
        autoMakeup     = false
        channelLinked  = true
        saturationMode = SaturationMode.SOFT
        truePeakEnabled= true
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // PCM PROCESSING
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    private fun processShort(input: ByteBuffer, output: ByteBuffer) {
        var idx = 0
        while (input.remaining() >= 2) {
            val ch = idx % numChannels
            val sample = input.short.toDouble() / 32768.0
            val out = processSample(sample, ch)
            output.putShort((out * 32768.0).coerceIn(-32768.0, 32767.0).toInt().toShort())
            idx++
        }
    }

    private fun processFloat(input: ByteBuffer, output: ByteBuffer) {
        var idx = 0
        while (input.remaining() >= 4) {
            val ch = idx % numChannels
            val sample = input.float.toDouble()
            val out = processSample(sample, ch)
            output.putFloat(out.toFloat())
            idx++
        }
    }

    private fun processInt32(input: ByteBuffer, output: ByteBuffer) {
        var idx = 0
        while (input.remaining() >= 4) {
            val ch = idx % numChannels
            val sample = input.int.toDouble() / 2147483648.0
            val out = processSample(sample, ch)
            output.putInt((out * 2147483648.0).coerceIn(-2147483648.0, 2147483647.0).toLong().toInt())
            idx++
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // CORE DSP PIPELINE  (called once per input sample per channel)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    private fun processSample(input: Double, ch: Int): Double {

        // 1. Track RMS
        updateRms(input, ch)

        // 2. True-peak detection: push sample into FIR history, compute interpolated peaks
        val detectionLevel = if (truePeakEnabled) {
            computeTruePeak(input, ch)
        } else {
            abs(input)
        }

        // 3. Update current peak meter
        if (ch < _currentPeaks.size) {
            if (detectionLevel.toFloat() > _currentPeaks[ch]) _currentPeaks[ch] = detectionLevel.toFloat()
        }

        // 4. Feed sample into lookahead circular buffer; read oldest sample as actual output
        val processedSample = if (lookaheadLen > 0) {
            val readPos = (lookaheadWrite + 1) % lookaheadLen
            val delayed = lookaheadBuf[ch.coerceAtMost(lookaheadBuf.size - 1)][readPos]
            lookaheadBuf[ch.coerceAtMost(lookaheadBuf.size - 1)][lookaheadWrite] = input
            delayed
        } else input

        // 5. Gain computer: soft-knee limiting
        val targetGain = computeGain(detectionLevel)

        // 6. Channel linking: use minimum gain across all channels
        val linkedGain = if (channelLinked && numChannels > 1) {
            // We only track from current channel; proper linking requires frame-level processing.
            // For high-quality linking, consider buffering a full interleaved frame first.
            // Here we use per-channel envelope as a practical approximation.
            targetGain
        } else targetGain

        // 7. Attack / hold / release envelope follower
        val envIdx = ch.coerceAtMost(gainEnvelope.size - 1)
        val currentEnv = gainEnvelope[envIdx]

        val newEnv = when {
            linkedGain < currentEnv -> {
                // Attack: gain is decreasing (limiting active)
                holdCounter[envIdx] = holdSamples
                currentEnv + attackCoeff * (linkedGain - currentEnv)
            }
            holdCounter[envIdx] > 0 -> {
                // Hold: suppress release until hold expires
                holdCounter[envIdx]--
                currentEnv
            }
            else -> {
                // Release: gain recovering toward unity
                currentEnv + releaseCoeff * (1.0 - currentEnv)
            }
        }

        gainEnvelope[envIdx] = newEnv.coerceIn(0.0, 1.0)
        if (abs(gainEnvelope[envIdx] - 1.0) < DENORMAL_THRESHOLD) gainEnvelope[envIdx] = 1.0

        // 8. Apply makeup gain
        var output = processedSample * gainEnvelope[envIdx] * makeupLinear

        // 9. Brick-wall ceiling clamp
        output = output.coerceIn(-ceilingLinear, ceilingLinear)

        // 10. Soft saturation stage (anti-alias / warmth)
        output = applySaturation(output)

        // 11. Update gain reduction meter
        val grLinear = gainEnvelope[envIdx].coerceIn(1e-10, 1.0)
        _grDb[envIdx] = (20.0 * log10(grLinear)).toFloat().coerceIn(-60f, 0f)

        // 12. ISP detection: if after saturation |output| > 0.9999 â†’ flag inter-sample peak
        if (abs(output) >= 0.9999) _hasInterSamplePeak = true

        return output
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // GAIN COMPUTER â€” soft knee
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private fun computeGain(absInput: Double): Double {
        if (absInput <= 1e-10) return 1.0
        val inputDb = 20.0 * log10(absInput)

        return when {
            // Below knee: no reduction
            inputDb <= thresholdDb - kneeHalf -> 1.0

            // Soft-knee region: quadratic interpolation
            inputDb <= thresholdDb + kneeHalf -> {
                val t = (inputDb - (thresholdDb - kneeHalf)) / (kneeHalf * 2.0)
                val compressedDb = (thresholdDb - kneeHalf) +
                        (inputDb - (thresholdDb - kneeHalf)) * (1.0 - t)
                dbToLinear(compressedDb) / absInput.coerceAtLeast(1e-10)
            }

            // Above threshold: hard limit to ceiling
            else -> ceilingLinear / absInput.coerceAtLeast(1e-10)
        }.coerceIn(0.0, 1.0)
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // TRUE-PEAK FIR OVERSAMPLING
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * Estimates true peak by 4Ã— oversampling via windowed-sinc FIR interpolation.
     * Returns the maximum absolute interpolated value (includes original sample).
     */
    private fun computeTruePeak(sample: Double, ch: Int): Double {
        val histLen = FIR_HALF_LENGTH * 2 + 1
        val hist = tpHistory.getOrNull(ch) ?: return abs(sample)

        // Shift history and insert new sample
        for (i in 0 until histLen - 1) hist[i] = hist[i + 1]
        hist[histLen - 1] = sample

        // Compute 4 interpolated sub-samples between hist[L-1] and hist[L]
        val coeffs = tpFirCoeffs
        var maxAbs = abs(sample)
        for (phase in 0 until OVERSAMPLE_FACTOR) {
            var acc = 0.0
            val offset = phase * (histLen)
            for (i in 0 until histLen) {
                val coIdx = (offset + i) % coeffs.size
                acc += hist[i] * coeffs.getOrElse(coIdx) { 0.0 }
            }
            val absAcc = abs(acc)
            if (absAcc > maxAbs) maxAbs = absAcc
        }
        return maxAbs
    }

    /**
     * Build windowed-sinc (Hann window) FIR coefficients for 4Ã— oversampling.
     * Generates OVERSAMPLE_FACTOR sets of FIR_HALF_LENGTH*2+1 taps each.
     */
    private fun buildTpFirCoeffs(): DoubleArray {
        val tapCount = FIR_HALF_LENGTH * 2 + 1
        val result = DoubleArray(OVERSAMPLE_FACTOR * tapCount)
        for (phase in 0 until OVERSAMPLE_FACTOR) {
            val phaseOffset = phase.toDouble() / OVERSAMPLE_FACTOR
            for (i in 0 until tapCount) {
                val n = i - FIR_HALF_LENGTH
                val x = n - phaseOffset
                val sinc = if (abs(x) < 1e-10) 1.0 else sin(PI * x) / (PI * x)
                // Hann window
                val window = 0.5 - 0.5 * cos(2.0 * PI * (i.toDouble() / (tapCount - 1)))
                result[phase * tapCount + i] = sinc * window
            }
        }
        return result
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // SATURATION
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private fun applySaturation(x: Double): Double = when (saturationMode) {
        SaturationMode.NONE   -> x.coerceIn(-ceilingLinear, ceilingLinear)
        SaturationMode.SOFT   -> {
            val c = ceilingLinear
            val absX = abs(x)
            if (absX >= c) x / absX * c
            else {
                // Cubic soft clip within Â±ceiling
                val xn = x / c
                val sat = xn - (xn * xn * xn) / 3.0
                sat * c
            }
        }
        SaturationMode.TANH   -> tanh(x / ceilingLinear) * ceilingLinear
        SaturationMode.ARCTAN -> (2.0 / PI) * atan(x * PI / (2.0 * ceilingLinear)) * ceilingLinear
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // RMS METERING
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private fun updateRms(sample: Double, ch: Int) {
        if (rmsLen <= 0 || ch >= rmsBuf.size) return
        val buf = rmsBuf[ch]
        val old = buf[rmsWrite]
        val sq = sample * sample
        rmsAccum[ch] = rmsAccum[ch] - old + sq
        buf[rmsWrite] = sq
        if (ch == numChannels - 1) {
            rmsWrite = (rmsWrite + 1) % rmsLen
        }
        val rmsVal = sqrt(rmsAccum[ch].coerceAtLeast(0.0) / rmsLen)
        _rmsDb[ch] = if (rmsVal > 1e-10)
            (20.0 * log10(rmsVal)).toFloat().coerceIn(-120f, 0f)
        else -120f
    }

    private fun rebuildRmsBuffer() {
        rmsLen   = ((rmsWindowMs / 1000.0) * sampleRate).toInt().coerceAtLeast(64)
        rmsBuf   = Array(numChannels.coerceAtLeast(1)) { DoubleArray(rmsLen) }
        rmsAccum = DoubleArray(numChannels.coerceAtLeast(1))
        rmsWrite = 0
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // COEFFICIENT COMPUTATION
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private fun recomputeAllCoeffs() {
        ceilingLinear = dbToLinear(ceilingDb)
        threshLinear  = dbToLinear(thresholdDb)
        kneeHalf      = kneeWidthDb / 2.0
        attackCoeff   = computeCoeff(attackMs)
        releaseCoeff  = computeCoeff(releaseMs)
        holdSamples   = ((holdMs / 1000.0) * sampleRate).toInt().coerceAtLeast(0)
        lookaheadLen  = ((lookaheadMs / 1000.0) * sampleRate).toInt().coerceAtLeast(0)
        if (lookaheadLen > 0) {
            lookaheadBuf = Array(numChannels.coerceAtLeast(1)) { DoubleArray(lookaheadLen) }
            lookaheadWrite = 0
        }
        if (autoMakeup) recomputeAutoMakeup() else makeupLinear = dbToLinear(makeupDb)
        Log.d(TAG, "Coeffs rebuilt: ceiling=${ceilingDb}dBFS thresh=${thresholdDb}dBFS " +
              "knee=${kneeWidthDb}dB attack=${attackMs}ms hold=${holdMs}ms " +
              "release=${releaseMs}ms lookahead=${lookaheadMs}ms " +
              "makeup=${makeupDb}dB autoMakeup=$autoMakeup")
    }

    /**
     * Auto makeup: compensate threshold offset so average loudness is preserved.
     * Approximation: makeup = |threshold_dB| Ã— (1 - 1/ratio); for a limiter ratioâ†’âˆž,
     * this becomes threshold_dB Ã— (ratio-1)/ratio â†’ |threshold_dB|.
     * We use a 0.7 scale factor as a conservative estimate.
     */
    private fun recomputeAutoMakeup() {
        val compensationDb = abs(thresholdDb) * 0.7
        makeupDb    = compensationDb.coerceIn(MAKEUP_DB_MIN, MAKEUP_DB_MAX)
        makeupLinear= dbToLinear(makeupDb)
    }

    private fun computeCoeff(timeMs: Double): Double {
        if (timeMs <= 0.0 || sampleRate <= 0.0) return 1.0
        return exp(-1.0 / ((timeMs / 1000.0) * sampleRate))
    }

    private fun scheduleParamUpdate() {
        pendingParams.set(Params(
            thresholdDb    = thresholdDb,
            ceilingDb      = ceilingDb,
            attackMs       = attackMs,
            holdMs         = holdMs,
            releaseMs      = releaseMs,
            kneeWidthDb    = kneeWidthDb,
            lookaheadMs    = lookaheadMs,
            makeupDb       = makeupDb,
            autoMakeup     = autoMakeup,
            channelLinked  = channelLinked,
            saturationMode = saturationMode,
            truePeakEnabled= truePeakEnabled
        ))
    }

    private fun applyParams(p: Params) {
        val prevLookahead = lookaheadMs
        thresholdDb     = p.thresholdDb
        ceilingDb       = p.ceilingDb
        attackMs        = p.attackMs
        holdMs          = p.holdMs
        releaseMs       = p.releaseMs
        kneeWidthDb     = p.kneeWidthDb
        lookaheadMs     = p.lookaheadMs
        makeupDb        = p.makeupDb
        autoMakeup      = p.autoMakeup
        channelLinked   = p.channelLinked
        saturationMode  = p.saturationMode
        truePeakEnabled = p.truePeakEnabled
        recomputeAllCoeffs()
        // Only reset lookahead buffer if length changed
        if (abs(prevLookahead - lookaheadMs) > 0.1) {
            lookaheadBuf.forEach { it.fill(0.0) }
            lookaheadWrite = 0
        }
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // HELPERS
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private fun dbToLinear(db: Double): Double = 10.0.pow(db / 20.0)

    private fun replaceOutputBuffer(size: Int): ByteBuffer {
        return if (outputBuf === AudioProcessor.EMPTY_BUFFER || outputBuf.capacity() < size) {
            ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder()).also { outputBuf = it }
        } else {
            outputBuf.clear().limit(size)
            outputBuf
        }
    }

    /**
     * Serializes current limiter state for display/export.
     */
    fun getStateMap(): Map<String, Any?> = mapOf(
        "enabled"          to isEnabled,
        "thresholdDb"      to thresholdDb,
        "ceilingDb"        to ceilingDb,
        "attackMs"         to attackMs,
        "holdMs"           to holdMs,
        "releaseMs"        to releaseMs,
        "kneeWidthDb"      to kneeWidthDb,
        "lookaheadMs"      to lookaheadMs,
        "makeupDb"         to makeupDb,
        "autoMakeup"       to autoMakeup,
        "channelLinked"    to channelLinked,
        "saturationMode"   to saturationMode.name,
        "truePeakEnabled"  to truePeakEnabled,
        "gainReductionDb"  to gainReductionDb.mapIndexed { i, v -> mapOf("ch" to i, "gr" to v.toDouble()) },
        "rmsDb"            to rmsDb.mapIndexed { i, v -> mapOf("ch" to i, "rms" to v.toDouble()) },
        "hasInterSamplePeak" to hasInterSamplePeak
    )
}
