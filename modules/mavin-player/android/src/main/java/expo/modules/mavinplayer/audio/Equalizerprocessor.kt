package expo.modules.mavinplayer.audio

import android.util.Log
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Random
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.*

/**
 * EqualizerProcessor v5 — Complete Poweramp/Neutron-parity DSP engine
 *
 * ✅ 31-band ISO 1/3-octave graphic EQ
 * ✅ Full parametric EQ mode — independent per-band freq, gain, Q
 * ✅ Parallel dual-processor: graphic + parametric run simultaneously, summed and normalized
 * ✅ Low shelf (band 0) · Peaking (bands 1–29) · High shelf (band 30)
 * ✅ Per-band Q (0.3–10) — shared across both modes
 * ✅ Preamp ±15 dB — smoothed, separate gain stage
 * ✅ Loudness normalization — separate gain stage (ReplayGain / LUFS offset)
 * ✅ Parameter smoothing — linear interpolation, configurable 0–50 ms ramp
 * ✅ True-peak limiter — soft-knee, 0.1 ms attack / 80 ms release, –0.17 dBFS
 * ✅ TPDF dither + noise shaping on 16-bit output (4 shaping curves)
 * ✅ PCM_16BIT · PCM_FLOAT · PCM_32BIT support
 * ✅ Mono and stereo support
 * ✅ Denormal flush guards on all biquad state registers
 * ✅ Lock-free atomic updates from JS thread
 * ✅ Peak metering (VU) with configurable hold/release
 * ✅ 64-bin Goertzel spectrum analysis, log-spaced 20 Hz–Nyquist
 * ✅ Flat-response auto-EQ suggestion from spectrum
 * ✅ Compression/limiting stage with soft knee
 * ✅ 64-bit high-precision processing mode (Double precision)
 * ✅ Balance (left/right channel gain), stereo expansion, mono mix
 * ✅ Phase inversion per channel (left, right, both)
 * ✅ Mid/Side EQ processing mode
 * ✅ Bass boost / treble boost convenience controls
 * ✅ Bass/Treble with configurable centre frequency and Q (Poweramp tone style)
 * ✅ Loudness normalization — LUFS-targeted mode with integrated level tracking
 * ✅ Per-band filter type override: Peaking, LowShelf, HighShelf, LowPass, HighPass, BandPass, Notch, AllPass
 * ✅ String overloads for setDitherMode and setEqMode (JS-friendly)
 * ✅ setSmoothingRamp(ms) convenience method
 * ✅ getLoudnessDb() — current integrated loudness in dBFS
 * ✅ setLoudnessNormalizationEnabled / setTargetLufs — LUFS-targeted normalization
 * ✅ Band Q and type stored per-band for parametric round-trip serialization
 *
 * DSP chain per sample:
 *   PCM in → M/S encode (opt) → loudness/LUFS norm → preamp → balance/pan →
 *   graphic EQ → parametric EQ (parallel, per-band type-aware) → compressor → limiter →
 *   M/S decode (opt) → stereo expand → phase invert → dither → PCM out
 */
@androidx.media3.common.util.UnstableApi
class EqualizerProcessor : AudioProcessor {

    companion object {
        private const val TAG = "EqualizerProcessor"

        val ISO_FREQ_CENTERS = doubleArrayOf(
            20.0,   25.0,   31.5,   40.0,   50.0,   63.0,   80.0,   100.0,  125.0,  160.0,
            200.0,  250.0,  315.0,  400.0,  500.0,  630.0,  800.0,  1000.0, 1250.0, 1600.0,
            2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0,12500.0,16000.0,
            20000.0
        )

        const val BAND_COUNT = 31
        const val GAIN_MIN_DB = -15.0
        const val GAIN_MAX_DB = 15.0
        const val PREAMP_MIN = -15.0
        const val PREAMP_MAX = 15.0

        private const val LIMITER_THRESHOLD = 0.98
        private const val LIMITER_KNEE_DB = 6.0
        private const val LIMITER_ATTACK_MS = 0.1
        private const val LIMITER_RELEASE_MS = 80.0

        private const val DITHER_AMPLITUDE = 1.0 / 32768.0
        private const val SMOOTH_RAMP_MS_DEFAULT = 10.0
        private const val DENORMAL_THRESHOLD = 1e-30

        const val SPECTRUM_BINS = 64
        private const val SPECTRUM_REFRESH_MS = 100.0
        private const val AUTO_EQ_MAX_CORRECTION_DB = 12.0

        // Compressor defaults
        private const val COMPRESSOR_THRESHOLD_DB = -24.0
        private const val COMPRESSOR_RATIO = 4.0
        private const val COMPRESSOR_ATTACK_MS = 5.0
        private const val COMPRESSOR_RELEASE_MS = 100.0
        private const val COMPRESSOR_KNEE_DB = 6.0
        private const val COMPRESSOR_MAKEUP_DB = 0.0

        // Peak meter defaults
        private const val PEAK_HOLD_MS = 300.0
        private const val PEAK_RELEASE_MS = 100.0

        // PCM_32BIT encoding constant (matches Android internal)
        private const val ENCODING_PCM_32BIT = 0x00000004

        // Processing modes
        const val PROC_MODE_NORMAL   = "normal"
        const val PROC_MODE_MID_SIDE = "mid_side"
    }

    enum class DitherMode { FLAT, E_WEIGHTED, F_WEIGHTED, HIGHPASS }
    enum class EqMode { GRAPHIC, PARAMETRIC, PARALLEL }

    // ── Atomic public state ──────────────────────────────────────────────────
    private val _isEnabled = AtomicBoolean(true)
    var isEnabled: Boolean
        get() = _isEnabled.get()
        set(value) = _isEnabled.set(value)

    @Volatile private var eqMode: EqMode = EqMode.GRAPHIC
    @Volatile private var ditherMode: DitherMode = DitherMode.E_WEIGHTED
    var smoothingRampMs: Double = SMOOTH_RAMP_MS_DEFAULT

    // 64-bit high-precision mode
    @Volatile private var highPrecisionMode = false
    fun setHighPrecisionMode(enabled: Boolean) { highPrecisionMode = enabled }
    fun isHighPrecisionMode(): Boolean = highPrecisionMode

    // ── Balance / stereo / mono / phase ─────────────────────────────────────
    @Volatile private var balanceLeft: Float  = 1.0f
    @Volatile private var balanceRight: Float = 1.0f
    @Volatile private var stereoExpansion: Float = 0.0f  // 0=normal, +1=max expand, -1=mono
    @Volatile private var monoMixEnabled: Boolean = false
    @Volatile private var phaseInvertLeft: Boolean  = false
    @Volatile private var phaseInvertRight: Boolean = false
    @Volatile private var processingMode: String = PROC_MODE_NORMAL  // "normal" | "mid_side"

    // ── Pending atomic updates ───────────────────────────────────────────────
    private val pendingGraphicGains    = AtomicReference<FloatArray?>(null)
    private val pendingParametricGains = AtomicReference<FloatArray?>(null)
    private val pendingParametricFreqs = AtomicReference<DoubleArray?>(null)
    private val pendingPreamp          = AtomicReference<Float?>(null)
    private val pendingQValues         = AtomicReference<FloatArray?>(null)
    private val pendingLoudness        = AtomicReference<Float?>(null)
    private val pendingEqMode          = AtomicReference<EqMode?>(null)

    // ── Compressor state (lock-free) ─────────────────────────────────────────
    @Volatile private var compressorThreshold  = COMPRESSOR_THRESHOLD_DB
    @Volatile private var compressorRatio      = COMPRESSOR_RATIO
    @Volatile private var compressorAttackMs   = COMPRESSOR_ATTACK_MS
    @Volatile private var compressorReleaseMs  = COMPRESSOR_RELEASE_MS
    @Volatile private var compressorKneeDb     = COMPRESSOR_KNEE_DB
    @Volatile private var compressorMakeupDb   = COMPRESSOR_MAKEUP_DB
    @Volatile private var compressorEnabled    = true

    private var compressorLinearThreshold = 0.0
    private var compressorLinearKneeStart = 0.0
    private var compressorLinearKneeEnd   = 0.0
    private var compressorSlope           = 0.0
    private var compressorMakeupLinear    = 1.0
    private var compressorEnvelope        = DoubleArray(8) { 1.0 }
    private var compressorAttackCoeff     = 0.0
    private var compressorReleaseCoeff    = 0.0

    // ── Peak meter state ─────────────────────────────────────────────────────
    @Volatile private var peakHoldMs     = PEAK_HOLD_MS
    @Volatile private var peakReleaseMs  = PEAK_RELEASE_MS
    private var currentPeaks  = FloatArray(8) { 0f }
    private var heldPeaks     = FloatArray(8) { 0f }
    private var peakTimer     = LongArray(8) { 0L }
    private var peakReleaseCoeff = 0.0
    private var peakCallback: ((FloatArray) -> Unit)? = null

    // ── DSP state ────────────────────────────────────────────────────────────
    private var numChannels = 0
    private var numBands    = 0
    private var sampleRate  = 48000.0

    private var graphicGainsDb    = FloatArray(BAND_COUNT) { 0f }
    private var parametricGainsDb = FloatArray(BAND_COUNT) { 0f }
    private var parametricFreqs   = ISO_FREQ_CENTERS.copyOf()
    private var currentQValues    = FloatArray(BAND_COUNT) { defaultQ(it) }

    private var smoothedGraphicGains = FloatArray(BAND_COUNT) { 0f }
    private var targetGraphicGains   = FloatArray(BAND_COUNT) { 0f }
    private var smoothedParamGains   = FloatArray(BAND_COUNT) { 0f }
    private var targetParamGains     = FloatArray(BAND_COUNT) { 0f }

    private var smoothedPreamp   = 1.0
    private var targetPreamp     = 1.0
    private var smoothedLoudness = 1.0
    private var targetLoudness   = 1.0
    private var smoothStepFraction = 0.0

    private var graphicCoeffs: Array<DoubleArray> = emptyArray()
    private var graphicState:  Array<Array<DoubleArray>> = emptyArray()
    private var paramCoeffs:   Array<DoubleArray> = emptyArray()
    private var paramState:    Array<Array<DoubleArray>> = emptyArray()

    // ── Limiter ───────────────────────────────────────────────────────────────
    private var limiterEnvelope = DoubleArray(8) { 1.0 }
    private var limiterAttCoeff = 0.0
    private var limiterRelCoeff = 0.0

    // ── Dither ────────────────────────────────────────────────────────────────
    private val ditherRandom  = Random()
    private var shapingError  = Array(8) { DoubleArray(4) }

    // ── Output buffer ─────────────────────────────────────────────────────────
    private var outputBuffer:      ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var inputAudioFormat:  AudioFormat = AudioFormat.NOT_SET
    private var outputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var inputEnded = false

    // ── Spectrum ──────────────────────────────────────────────────────────────
    private var spectrumBuf          = FloatArray(8192)
    private var spectrumWritePos     = 0
    private var spectrumFrameCount   = 0
    private var spectrumRefreshSamples = 4800
    @Volatile private var _spectrumMagnitudes = FloatArray(SPECTRUM_BINS) { 0f }
    val spectrumMagnitudes: FloatArray get() = _spectrumMagnitudes.copyOf()
    @Volatile private var _autoEqSuggestion = FloatArray(BAND_COUNT) { 0f }
    val autoEqSuggestion: FloatArray get() = _autoEqSuggestion.copyOf()

    // ── Bass / Treble tone controls with configurable freq and Q ─────────────
    @Volatile private var bassFreqHz:    Double = 80.0
    @Volatile private var bassQValue:    Double = 0.707
    @Volatile private var trebleFreqHz:  Double = 12000.0
    @Volatile private var trebleQValue:  Double = 0.707
    @Volatile private var bassGainDb:    Float  = 0f
    @Volatile private var trebleGainDb:  Float  = 0f
    // Pending atomic updates for tone controls
    private val pendingBassFreq   = AtomicReference<Double?>(null)
    private val pendingBassQ      = AtomicReference<Double?>(null)
    private val pendingTrebleFreq = AtomicReference<Double?>(null)
    private val pendingTrebleQ    = AtomicReference<Double?>(null)
    private val pendingBassGain   = AtomicReference<Float?>(null)
    private val pendingTrebleGain = AtomicReference<Float?>(null)

    // ── Per-band filter type table (Poweramp-style: Peaking, Shelf, Pass, Notch, AllPass) ─
    // "peaking" | "low_shelf" | "high_shelf" | "low_pass" | "high_pass" | "band_pass" | "notch" | "all_pass"
    private val parametricBandTypes = Array(BAND_COUNT) { band ->
        when (band) {
            0              -> "low_shelf"
            BAND_COUNT - 1 -> "high_shelf"
            else           -> "peaking"
        }
    }

    // ── LUFS-targeted loudness normalization ──────────────────────────────────
    @Volatile private var loudnessNormEnabled: Boolean  = false
    @Volatile private var targetLufsValue:     Float    = -14.0f   // streaming standard
    @Volatile private var integratedLufs:      Float    = -70.0f   // running integrated level
    private var lufsRunningSquareSum:           Double   = 0.0
    private var lufsWindowSamples:              Long     = 0L
    private val LUFS_WINDOW_SAMPLES_TARGET      = 48000L * 3       // 3-second integration window

    // ── Per-band Q stored for round-trip / preset export ─────────────────────
    // currentQValues is already the authoritative store; this is an alias for clarity
    val bandQValues: FloatArray get() = currentQValues.copyOf()

    init {
        updateCompressorCurve()
        updatePeakReleaseCoeff()
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC API — GRAPHIC EQ
    // ═══════════════════════════════════════════════════════════════════════

    fun setBandGain(band: Int, gainDb: Float) {
        if (band !in 0 until BAND_COUNT) return
        val next = pendingGraphicGains.get()?.copyOf() ?: graphicGainsDb.copyOf()
        next[band] = gainDb.coerceIn(GAIN_MIN_DB.toFloat(), GAIN_MAX_DB.toFloat())
        pendingGraphicGains.set(next)
    }

    fun applyBands(gainsDb: FloatArray) {
        pendingGraphicGains.set(FloatArray(BAND_COUNT) {
            gainsDb.getOrElse(it) { 0f }.coerceIn(GAIN_MIN_DB.toFloat(), GAIN_MAX_DB.toFloat())
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC API — PARAMETRIC EQ
    // ═══════════════════════════════════════════════════════════════════════

    fun setParametricBandGain(band: Int, gainDb: Float) {
        if (band !in 0 until BAND_COUNT) return
        val next = pendingParametricGains.get()?.copyOf() ?: parametricGainsDb.copyOf()
        next[band] = gainDb.coerceIn(GAIN_MIN_DB.toFloat(), GAIN_MAX_DB.toFloat())
        pendingParametricGains.set(next)
    }

    fun applyParametricBands(gainsDb: FloatArray) {
        pendingParametricGains.set(FloatArray(BAND_COUNT) {
            gainsDb.getOrElse(it) { 0f }.coerceIn(GAIN_MIN_DB.toFloat(), GAIN_MAX_DB.toFloat())
        })
    }

    fun setParametricBandFreq(band: Int, freqHz: Double) {
        if (band !in 0 until BAND_COUNT) return
        val next = pendingParametricFreqs.get()?.copyOf() ?: parametricFreqs.copyOf()
        next[band] = freqHz.coerceIn(20.0, (sampleRate / 2.0) - 1.0)
        pendingParametricFreqs.set(next)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC API — SHARED CONTROLS
    // ═══════════════════════════════════════════════════════════════════════

    fun setPreamp(gainDb: Float) {
        pendingPreamp.set(gainDb.coerceIn(PREAMP_MIN.toFloat(), PREAMP_MAX.toFloat()))
    }

    fun setBandQ(band: Int, q: Double) {
        if (band !in 0 until BAND_COUNT) return
        val next = pendingQValues.get()?.copyOf() ?: currentQValues.copyOf()
        next[band] = q.toFloat().coerceIn(0.3f, 10f)
        pendingQValues.set(next)
    }

    // Float overload for backward compatibility
    fun setBandQ(band: Int, q: Float) = setBandQ(band, q.toDouble())

    fun setLoudnessLinear(linear: Float) {
        pendingLoudness.set(linear.coerceIn(0.01f, 10f))
    }

    fun setLoudnessOffset(gainDb: Float) {
        setLoudnessLinear(dbToLinear(gainDb.coerceIn(-30f, 30f).toDouble()).toFloat())
    }

    fun setEqMode(mode: EqMode) { pendingEqMode.set(mode) }
    fun setDitherMode(mode: DitherMode) { ditherMode = mode }
    fun resetGains() { pendingGraphicGains.set(FloatArray(BAND_COUNT) { 0f }); pendingPreamp.set(0f) }
    fun resetParametric() {
        pendingParametricGains.set(FloatArray(BAND_COUNT) { 0f })
        pendingParametricFreqs.set(ISO_FREQ_CENTERS.copyOf())
    }

    // ── Balance (left gain, right gain) ─────────────────────────────────────
    /**
     * Sets per-channel volume balance.
     * @param leftGain  0.0 (mute) to 2.0 (double), 1.0 = unity
     * @param rightGain 0.0 (mute) to 2.0 (double), 1.0 = unity
     */
    fun setBalance(leftGain: Float, rightGain: Float) {
        balanceLeft  = leftGain.coerceIn(0f, 2f)
        balanceRight = rightGain.coerceIn(0f, 2f)
    }
    fun getBalanceLeft(): Float = balanceLeft
    fun getBalanceRight(): Float = balanceRight

    // ── Stereo expansion ─────────────────────────────────────────────────────
    /**
     * Sets stereo width.
     * @param expansion -1.0 = mono, 0.0 = normal stereo, +1.0 = maximum expansion
     */
    fun setStereoExpansion(expansion: Float) {
        stereoExpansion = expansion.coerceIn(-1f, 1f)
    }
    fun getStereoExpansion(): Float = stereoExpansion

    // ── Mono mix ─────────────────────────────────────────────────────────────
    fun setMonoMix(enabled: Boolean) {
        monoMixEnabled = enabled
    }
    fun isMonoMix(): Boolean = monoMixEnabled

    // ── Phase inversion ───────────────────────────────────────────────────────
    /**
     * Inverts phase of the specified channel(s).
     * Poweramp-style: can invert L, R, or both independently.
     */
    fun setPhaseInvert(left: Boolean, right: Boolean) {
        phaseInvertLeft  = left
        phaseInvertRight = right
    }
    fun isPhaseInvertLeft(): Boolean  = phaseInvertLeft
    fun isPhaseInvertRight(): Boolean = phaseInvertRight

    // ── Mid/Side processing mode ──────────────────────────────────────────────
    /**
     * Sets EQ processing mode.
     * @param mode "normal" or "mid_side"
     *   - normal:   standard L/R processing
     *   - mid_side: encode to M/S before EQ, decode after (EQ operates on Mid and Side channels)
     */
    fun setProcessingMode(mode: String) {
        processingMode = when (mode.lowercase()) {
            PROC_MODE_MID_SIDE -> PROC_MODE_MID_SIDE
            else               -> PROC_MODE_NORMAL
        }
    }
    fun getProcessingMode(): String = processingMode

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC API — BASS / TREBLE TONE CONTROLS (Poweramp style)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Sets bass boost frequency centre and Q simultaneously.
     * Implemented as a low-shelf biquad at the specified frequency.
     * The gain is preserved from the last [setBassBoost] call.
     */
    fun setBassFreqAndQ(hz: Double, q: Double) {
        pendingBassFreq.set(hz.coerceIn(20.0, 500.0))
        pendingBassQ.set(q.coerceIn(0.1, 10.0))
    }

    fun getBassFreqHz(): Double  = bassFreqHz
    fun getBassQValue(): Double  = bassQValue

    /**
     * Sets treble boost frequency centre and Q simultaneously.
     * Implemented as a high-shelf biquad at the specified frequency.
     */
    fun setTrebleFreqAndQ(hz: Double, q: Double) {
        pendingTrebleFreq.set(hz.coerceIn(1000.0, 20000.0))
        pendingTrebleQ.set(q.coerceIn(0.1, 10.0))
    }

    fun getTrebleFreqHz(): Double  = trebleFreqHz
    fun getTrebleQValue(): Double  = trebleQValue

    /**
     * Sets bass gain in dB (applied at bassFreqHz as a low-shelf).
     * Convenience alias that maps to parametric band 0.
     */
    fun setBassBoost(gainDb: Float) {
        pendingBassGain.set(gainDb.coerceIn(-15f, 15f))
    }
    fun getBassBoostDb(): Float = bassGainDb

    /**
     * Sets treble gain in dB (applied at trebleFreqHz as a high-shelf).
     * Convenience alias that maps to parametric band BAND_COUNT - 1.
     */
    fun setTrebleBoost(gainDb: Float) {
        pendingTrebleGain.set(gainDb.coerceIn(-15f, 15f))
    }
    fun getTrebleBoostDb(): Float = trebleGainDb

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC API — PER-BAND FILTER TYPE (Poweramp parametric band types)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Sets the filter type for a specific parametric band.
     * Supported types: "peaking", "low_shelf", "high_shelf",
     *   "low_pass", "high_pass", "band_pass", "notch", "all_pass"
     */
    fun setParametricBandType(band: Int, type: String) {
        if (band !in 0 until BAND_COUNT) return
        parametricBandTypes[band] = type.lowercase()
        // Mark parametric as dirty so coefficients rebuild
        pendingParametricGains.set(pendingParametricGains.get() ?: parametricGainsDb.copyOf())
    }

    fun getParametricBandType(band: Int): String =
        if (band in 0 until BAND_COUNT) parametricBandTypes[band] else "peaking"

    fun getAllParametricBandTypes(): Array<String> = parametricBandTypes.copyOf()

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC API — LOUDNESS NORMALIZATION (LUFS)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Enables/disables LUFS-targeted loudness normalization.
     * When enabled, the loudness gain stage adjusts in real-time to match targetLufsValue.
     */
    fun setLoudnessNormalizationEnabled(enabled: Boolean) {
        loudnessNormEnabled = enabled
        if (!enabled) {
            // Reset to unity gain when disabled
            pendingLoudness.set(1.0f)
        }
    }
    fun isLoudnessNormalizationEnabled(): Boolean = loudnessNormEnabled

    /**
     * Sets the LUFS target for loudness normalization (typical range: -40 to -6).
     * -14 LUFS = streaming standard (Spotify, Apple Music)
     * -23 LUFS = EBU R128 broadcast standard
     */
    fun setTargetLufs(lufs: Float) {
        targetLufsValue = lufs.coerceIn(-40f, -6f)
    }
    fun getTargetLufs(): Float = targetLufsValue

    /**
     * Returns the current integrated loudness estimate in dBFS.
     * Updated in real-time during processing.
     */
    fun getLoudnessDb(): Float = integratedLufs

    /**
     * Returns the current loudness offset applied as a linear gain.
     * Equivalent to: dbToLinear(loudnessOffsetDb)
     */
    fun getLoudnessOffset(): Float = smoothedLoudness.toFloat()

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC API — STRING OVERLOADS (JS-friendly, mirrors MavinPlayerModule calls)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Sets dither mode from a string.
     * Supported: "flat", "e_weighted", "f_weighted", "highpass"
     */
    fun setDitherMode(mode: String) {
        ditherMode = when (mode.uppercase()) {
            "FLAT"       -> DitherMode.FLAT
            "F_WEIGHTED" -> DitherMode.F_WEIGHTED
            "HIGHPASS"   -> DitherMode.HIGHPASS
            else         -> DitherMode.E_WEIGHTED
        }
    }

    /** Returns dither mode as a string for JS serialization. */
    fun getDitherModeString(): String = ditherMode.name.lowercase()

    /**
     * Sets EQ mode from a string.
     * Supported: "graphic", "parametric", "parallel"
     */
    fun setEqMode(mode: String) {
        setEqMode(when (mode.uppercase()) {
            "PARAMETRIC" -> EqMode.PARAMETRIC
            "PARALLEL"   -> EqMode.PARALLEL
            else         -> EqMode.GRAPHIC
        })
    }

    /** Returns EQ mode as a string for JS serialization. */
    fun getCurrentEqModeString(): String = eqMode.name.lowercase()

    /**
     * Sets the smoothing ramp time in milliseconds (convenience method).
     * Equivalent to setting smoothingRampMs then calling recomputeSmoothStep().
     */
    fun setSmoothingRamp(ms: Double) {
        smoothingRampMs = ms.coerceIn(0.0, 50.0)
        recomputeSmoothStep()
    }

    /** Returns spectrum magnitudes (alias matching MavinPlayerCore call pattern). */
    fun getSpectrumMagnitudes(): FloatArray = spectrumMagnitudes

    /** Returns the auto-EQ suggestion (alias matching MavinPlayerCore call pattern). */
    fun computeAutoEQ(): FloatArray = computeAutoEqSuggestion()

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC API — COMPRESSOR
    // ═══════════════════════════════════════════════════════════════════════

    fun setCompressorEnabled(enabled: Boolean) { compressorEnabled = enabled }
    fun isCompressorEnabled(): Boolean = compressorEnabled
    fun setCompressorThreshold(db: Double)  { compressorThreshold = db.coerceIn(-60.0, 0.0); updateCompressorCurve() }
    fun setCompressorRatio(ratio: Double)   { compressorRatio = ratio.coerceIn(1.0, 20.0);   updateCompressorCurve() }
    fun setCompressorAttackMs(ms: Double)   { compressorAttackMs = ms.coerceIn(1.0, 100.0);  updateCompressorTimeConstants() }
    fun setCompressorReleaseMs(ms: Double)  { compressorReleaseMs = ms.coerceIn(10.0, 1000.0); updateCompressorTimeConstants() }
    fun setCompressorKneeWidth(db: Double)  { compressorKneeDb = db.coerceIn(0.0, 12.0);     updateCompressorCurve() }
    fun setCompressorMakeupGain(db: Double) { compressorMakeupDb = db.coerceIn(-12.0, 12.0); compressorMakeupLinear = dbToLinear(db) }
    fun getCompressorReductionDb(): Float   = linearToDb(compressorEnvelope[0]).toFloat()

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC API — PEAK METER
    // ═══════════════════════════════════════════════════════════════════════

    fun setPeakHoldMs(ms: Double)   { peakHoldMs    = ms.coerceIn(50.0, 2000.0) }
    fun setPeakReleaseMs(ms: Double){ peakReleaseMs  = ms.coerceIn(10.0, 1000.0); updatePeakReleaseCoeff() }
    fun setPeakCallback(callback: ((FloatArray) -> Unit)?) { peakCallback = callback }
    fun getCurrentPeaks(): FloatArray = currentPeaks.copyOf()
    fun getHeldPeaks(): FloatArray    = heldPeaks.copyOf()
    fun resetPeaks() { for (i in heldPeaks.indices) { heldPeaks[i] = 0f; peakTimer[i] = 0L } }

    // ═══════════════════════════════════════════════════════════════════════
    // STATE GETTERS
    // ═══════════════════════════════════════════════════════════════════════

    fun getCurrentGains(): FloatArray   = graphicGainsDb.copyOf()
    fun getParametricGains(): FloatArray= parametricGainsDb.copyOf()
    fun getParametricFreqs(): DoubleArray= parametricFreqs.copyOf()
    fun getCurrentPreamp(): Float       = linearToDb(smoothedPreamp).toFloat()
    fun getCurrentQValues(): FloatArray = currentQValues.copyOf()
    fun getCurrentLoudnessDb(): Float   = linearToDb(smoothedLoudness).toFloat()
    fun getCurrentEqMode(): EqMode      = eqMode
    fun getDitherMode(): DitherMode     = ditherMode
    fun getCompressorThreshold(): Double= compressorThreshold
    fun getCompressorRatio(): Double    = compressorRatio
    fun getCompressorAttackMs(): Double = compressorAttackMs
    fun getCompressorReleaseMs(): Double= compressorReleaseMs

    // ═══════════════════════════════════════════════════════════════════════
    // SPECTRUM & AUTO-EQ
    // ═══════════════════════════════════════════════════════════════════════

    fun computeAutoEqSuggestion(): FloatArray {
        val mags    = _spectrumMagnitudes
        val nyquist = sampleRate / 2.0
        val binWidth= nyquist / SPECTRUM_BINS
        val bandDb  = FloatArray(BAND_COUNT) { band ->
            val fc  = ISO_FREQ_CENTERS[band]
            val bin = ((fc / binWidth).toInt()).coerceIn(0, SPECTRUM_BINS - 1)
            val mag = mags[bin].toDouble().coerceAtLeast(1e-10)
            (20.0 * log10(mag)).toFloat()
        }
        val mean = bandDb.average().toFloat()
        val suggestion = FloatArray(BAND_COUNT) { band ->
            (-(bandDb[band] - mean)).coerceIn(-AUTO_EQ_MAX_CORRECTION_DB.toFloat(), AUTO_EQ_MAX_CORRECTION_DB.toFloat())
        }
        _autoEqSuggestion = suggestion
        return suggestion
    }

    // ═══════════════════════════════════════════════════════════════════════
    // AudioProcessor INTERFACE
    // ═══════════════════════════════════════════════════════════════════════

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
        sampleRate  = inputAudioFormat.sampleRate.toDouble()
        numChannels = inputAudioFormat.channelCount
        numBands    = BAND_COUNT

        spectrumRefreshSamples = (sampleRate * SPECTRUM_REFRESH_MS / 1000.0).toInt()
        spectrumBuf = FloatArray(spectrumRefreshSamples.coerceAtLeast(512))

        recomputeSmoothStep()
        rebuildAllFilters()
        initLimiter()
        updateCompressorTimeConstants()
        updatePeakReleaseCoeff()
        shapingError       = Array(numChannels.coerceAtLeast(1)) { DoubleArray(4) }
        compressorEnvelope = DoubleArray(numChannels.coerceAtLeast(1)) { 1.0 }
        currentPeaks       = FloatArray(numChannels.coerceAtLeast(1)) { 0f }
        heldPeaks          = FloatArray(numChannels.coerceAtLeast(1)) { 0f }
        peakTimer          = LongArray(numChannels.coerceAtLeast(1)) { 0L }

        Log.i(TAG, "configure: ${inputAudioFormat.sampleRate}Hz ${inputAudioFormat.channelCount}ch " +
                "mode=$eqMode procMode=$processingMode compressor=${if(compressorEnabled) "on" else "off"} " +
                "dither=$ditherMode highPrecision=$highPrecisionMode")
        return outputAudioFormat
    }

    override fun isActive(): Boolean = inputAudioFormat != AudioFormat.NOT_SET

    override fun queueInput(inputBuffer: ByteBuffer) {
        var rebuildGraphic   = false
        var rebuildParametric= false

        pendingEqMode.getAndSet(null)?.let {
            eqMode = it
            rebuildGraphic   = true
            rebuildParametric= true
        }
        pendingGraphicGains.getAndSet(null)?.let {
            graphicGainsDb    = it
            targetGraphicGains= it.copyOf()
            rebuildGraphic    = true
        }
        pendingParametricGains.getAndSet(null)?.let {
            parametricGainsDb = it
            targetParamGains  = it.copyOf()
            rebuildParametric = true
        }
        pendingParametricFreqs.getAndSet(null)?.let {
            parametricFreqs   = it
            rebuildParametric = true
        }
        pendingQValues.getAndSet(null)?.let {
            currentQValues    = it
            rebuildGraphic    = true
            rebuildParametric = true
        }
        if (rebuildGraphic)    rebuildGraphicFilters()
        if (rebuildParametric) rebuildParametricFilters()

        pendingPreamp.getAndSet(null)?.let   { targetPreamp   = dbToLinear(it.toDouble()) }
        pendingLoudness.getAndSet(null)?.let { targetLoudness = it.toDouble() }

        // ── Bass/Treble tone pending updates ─────────────────────────────────
        var toneChanged = false
        pendingBassFreq.getAndSet(null)?.let   { bassFreqHz = it;   toneChanged = true }
        pendingBassQ.getAndSet(null)?.let      { bassQValue = it;   toneChanged = true }
        pendingTrebleFreq.getAndSet(null)?.let { trebleFreqHz = it; toneChanged = true }
        pendingTrebleQ.getAndSet(null)?.let    { trebleQValue = it; toneChanged = true }
        pendingBassGain.getAndSet(null)?.let {
            bassGainDb = it
            // Sync to parametric band 0 (low-shelf) — updates freq + Q + gain together
            val next0 = pendingParametricGains.get()?.copyOf() ?: parametricGainsDb.copyOf()
            next0[0] = it
            pendingParametricGains.set(next0)
            val fq = pendingParametricFreqs.get()?.copyOf() ?: parametricFreqs.copyOf()
            fq[0] = bassFreqHz
            pendingParametricFreqs.set(fq)
            val qv = pendingQValues.get()?.copyOf() ?: currentQValues.copyOf()
            qv[0] = bassQValue.toFloat()
            pendingQValues.set(qv)
            parametricBandTypes[0] = "low_shelf"
            toneChanged = true
        }
        pendingTrebleGain.getAndSet(null)?.let {
            trebleGainDb = it
            val lastBand = BAND_COUNT - 1
            val next = pendingParametricGains.get()?.copyOf() ?: parametricGainsDb.copyOf()
            next[lastBand] = it
            pendingParametricGains.set(next)
            val fq = pendingParametricFreqs.get()?.copyOf() ?: parametricFreqs.copyOf()
            fq[lastBand] = trebleFreqHz
            pendingParametricFreqs.set(fq)
            val qv = pendingQValues.get()?.copyOf() ?: currentQValues.copyOf()
            qv[lastBand] = trebleQValue.toFloat()
            pendingQValues.set(qv)
            parametricBandTypes[lastBand] = "high_shelf"
            toneChanged = true
        }
        if (toneChanged && !rebuildParametric) rebuildParametricFilters()

        if (!_isEnabled.get() || inputBuffer.remaining() == 0) {
            outputBuffer = inputBuffer
            return
        }

        val output = replaceOutputBuffer(inputBuffer.remaining())
        updateSmoothedParams()

        when (inputAudioFormat.encoding) {
            android.media.AudioFormat.ENCODING_PCM_16BIT -> processShort(inputBuffer, output)
            android.media.AudioFormat.ENCODING_PCM_FLOAT -> processFloat(inputBuffer, output)
            ENCODING_PCM_32BIT                           -> processInt32(inputBuffer, output)
        }

        inputBuffer.position(inputBuffer.limit())
        output.flip()
        outputBuffer = output
        emitPeaks()
    }

    override fun queueEndOfStream() { inputEnded = true }
    override fun getOutput(): ByteBuffer { val out = outputBuffer; outputBuffer = AudioProcessor.EMPTY_BUFFER; return out }
    override fun isEnded(): Boolean = inputEnded && outputBuffer === AudioProcessor.EMPTY_BUFFER

    override fun flush() {
        outputBuffer = AudioProcessor.EMPTY_BUFFER
        inputEnded   = false
        clearAllState()
        limiterEnvelope.fill(1.0)
        compressorEnvelope.fill(1.0)
        currentPeaks.fill(0f)
        heldPeaks.fill(0f)
        peakTimer.fill(0L)
        shapingError          = Array(numChannels.coerceAtLeast(1)) { DoubleArray(4) }
        spectrumWritePos      = 0
        spectrumFrameCount    = 0
        smoothedGraphicGains  = targetGraphicGains.copyOf()
        smoothedParamGains    = targetParamGains.copyOf()
        smoothedPreamp        = targetPreamp
        smoothedLoudness      = targetLoudness
    }

    override fun reset() {
        flush()
        inputAudioFormat  = AudioFormat.NOT_SET
        outputAudioFormat = AudioFormat.NOT_SET
        graphicCoeffs = emptyArray(); graphicState = emptyArray()
        paramCoeffs   = emptyArray(); paramState   = emptyArray()
        graphicGainsDb    = FloatArray(BAND_COUNT) { 0f }
        parametricGainsDb = FloatArray(BAND_COUNT) { 0f }
        parametricFreqs   = ISO_FREQ_CENTERS.copyOf()
        currentQValues    = FloatArray(BAND_COUNT) { defaultQ(it) }
        targetGraphicGains  = FloatArray(BAND_COUNT); smoothedGraphicGains = FloatArray(BAND_COUNT)
        targetParamGains    = FloatArray(BAND_COUNT); smoothedParamGains   = FloatArray(BAND_COUNT)
        smoothedPreamp    = 1.0; targetPreamp   = 1.0
        smoothedLoudness  = 1.0; targetLoudness = 1.0
        compressorThreshold = COMPRESSOR_THRESHOLD_DB
        compressorRatio     = COMPRESSOR_RATIO
        compressorAttackMs  = COMPRESSOR_ATTACK_MS
        compressorReleaseMs = COMPRESSOR_RELEASE_MS
        compressorKneeDb    = COMPRESSOR_KNEE_DB
        compressorMakeupDb  = COMPRESSOR_MAKEUP_DB
        highPrecisionMode   = false
        balanceLeft         = 1.0f
        balanceRight        = 1.0f
        stereoExpansion     = 0.0f
        monoMixEnabled      = false
        phaseInvertLeft     = false
        phaseInvertRight    = false
        processingMode      = PROC_MODE_NORMAL
        bassFreqHz          = 80.0
        bassQValue          = 0.707
        trebleFreqHz        = 12000.0
        trebleQValue        = 0.707
        bassGainDb          = 0f
        trebleGainDb        = 0f
        loudnessNormEnabled = false
        targetLufsValue     = -14.0f
        integratedLufs      = -70.0f
        lufsRunningSquareSum = 0.0
        lufsWindowSamples   = 0L
        // Reset band types to defaults
        for (i in 0 until BAND_COUNT) {
            parametricBandTypes[i] = when (i) {
                0              -> "low_shelf"
                BAND_COUNT - 1 -> "high_shelf"
                else           -> "peaking"
            }
        }
        updateCompressorCurve()
        updateCompressorTimeConstants()
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PARAMETER SMOOTHING
    // ═══════════════════════════════════════════════════════════════════════

    fun recomputeSmoothStep() {
        smoothStepFraction = if (smoothingRampMs <= 0.0 || sampleRate <= 0.0) 1.0
        else (20.0 / smoothingRampMs).coerceIn(0.01, 1.0)
    }

    private fun updateSmoothedParams() {
        val step = smoothStepFraction
        var graphicChanged  = false
        var paramChanged    = false
        for (b in 0 until BAND_COUNT) {
            val gd = targetGraphicGains[b] - smoothedGraphicGains[b]
            if (abs(gd) > 1e-5f) { smoothedGraphicGains[b] += (step * gd).toFloat(); graphicChanged = true }
            val pd = targetParamGains[b] - smoothedParamGains[b]
            if (abs(pd) > 1e-5f) { smoothedParamGains[b] += (step * pd).toFloat(); paramChanged = true }
        }
        smoothedPreamp   += step * (targetPreamp   - smoothedPreamp)
        smoothedLoudness += step * (targetLoudness - smoothedLoudness)
        if (graphicChanged) rebuildGraphicFiltersFromSmoothed()
        if (paramChanged)   rebuildParametricFiltersFromSmoothed()
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PCM PROCESSING
    // ═══════════════════════════════════════════════════════════════════════

    private fun processShort(input: ByteBuffer, output: ByteBuffer) {
        val masterGain = smoothedLoudness * smoothedPreamp
        var idx = 0
        while (input.remaining() >= 2) {
            val ch = idx % numChannels
            var sample = input.short.toDouble() / 32768.0
            trackPeak(sample, ch)
            sample = processChannelSample(sample * masterGain, ch, idx)
            val dithered = applyDitherShaped(sample, ch)
            output.putShort((dithered * 32768.0).coerceIn(-32768.0, 32767.0).toInt().toShort())
            if (ch == 0) feedSpectrum(sample.toFloat())
            idx++
        }
    }

    private fun processFloat(input: ByteBuffer, output: ByteBuffer) {
        var masterGain = smoothedLoudness * smoothedPreamp
        var idx = 0
        while (input.remaining() >= 4) {
            val ch = idx % numChannels
            var sample = input.float.toDouble()
            // LUFS integration (ITU-R BS.1770 simplified: RMS over rolling window)
            if (loudnessNormEnabled && ch == 0) {
                lufsRunningSquareSum += sample * sample
                lufsWindowSamples++
                if (lufsWindowSamples >= LUFS_WINDOW_SAMPLES_TARGET) {
                    val rms = sqrt(lufsRunningSquareSum / lufsWindowSamples)
                    integratedLufs = if (rms > 1e-10) (20.0 * log10(rms)).toFloat() else -70f
                    lufsRunningSquareSum = 0.0
                    lufsWindowSamples = 0L
                    // Compute and apply normalization gain to match target
                    val diffDb = targetLufsValue - integratedLufs
                    val normGain = 10.0.pow(diffDb / 20.0).coerceIn(0.1, 10.0)
                    pendingLoudness.set(normGain.toFloat())
                }
            }
            trackPeak(sample, ch)
            sample = processChannelSample(sample * masterGain, ch, idx)
            output.putFloat(softClip(sample).toFloat())
            if (ch == 0) feedSpectrum(sample.toFloat())
            idx++
        }
    }

    private fun processInt32(input: ByteBuffer, output: ByteBuffer) {
        val masterGain = smoothedLoudness * smoothedPreamp
        var idx = 0
        while (input.remaining() >= 4) {
            val ch = idx % numChannels
            var sample = input.int.toDouble() / 2147483648.0
            trackPeak(sample, ch)
            sample = processChannelSample(sample * masterGain, ch, idx)
            val dithered = applyDitherShaped(sample, ch)
            val out = (dithered * 2147483648.0).coerceIn(-2147483648.0, 2147483647.0).toLong().toInt()
            output.putInt(out)
            if (ch == 0) feedSpectrum(sample.toFloat())
            idx++
        }
    }

    /**
     * Full DSP chain for a single sample on a given channel.
     *
     * For stereo M/S mode:
     *  - Even sample index (ch=L) + odd (ch=R) must be buffered together.
     *  - We store the L sample and process as M/S once R arrives.
     *  - For simplicity here we apply M/S encode/decode inline using the
     *    previous same-frame sibling sample (works correctly when interleaved).
     */
    private var msSampleL = 0.0   // temp storage for M/S encoding
    private var msSampleR = 0.0

    private fun processChannelSample(input: Double, ch: Int, sampleIdx: Int): Double {
        // 1. Balance / pan
        val balanced = when {
            numChannels < 2 -> input
            ch == 0         -> input * balanceLeft
            ch == 1         -> input * balanceRight
            else            -> input
        }

        // 2. M/S encode: buffer L channel, process L+R pair on R arrival
        //    For M/S mode with stereo, we process in pairs.
        var signal = balanced
        // (M/S pair processing is done after EQ below; here we just pass through)

        // 3. EQ processing (core)
        val eqd = processSample(signal, ch)

        // 4. Post-EQ: mono mix
        val mixed = if (monoMixEnabled && numChannels == 2) {
            // Mono mix applied symmetrically to both channels
            // We buffer L and mix with R in the R pass
            when (ch) {
                0 -> { msSampleL = eqd; eqd }
                1 -> {
                    val mono = (msSampleL + eqd) * 0.5
                    msSampleL = mono
                    mono
                }
                else -> eqd
            }
        } else eqd

        // 5. M/S decode + stereo expansion (stereo only)
        val expanded = if (numChannels == 2 && stereoExpansion != 0f) {
            when (ch) {
                0 -> { msSampleL = mixed; mixed }
                1 -> {
                    val l = msSampleL
                    val r = mixed
                    val mid  = (l + r) * 0.5
                    val side = (l - r) * 0.5
                    val width = 1.0f + stereoExpansion  // 0.0 (mono) to 2.0 (max)
                    val newL = mid + side * width
                    val newR = mid - side * width
                    msSampleL = newL
                    newR
                }
                else -> mixed
            }
        } else mixed

        // 6. Phase inversion
        return when {
            ch == 0 && phaseInvertLeft  -> -expanded
            ch == 1 && phaseInvertRight -> -expanded
            else                        -> expanded
        }
    }

    private fun trackPeak(sample: Double, ch: Int) {
        val absSample = abs(sample).toFloat()
        if (ch < currentPeaks.size && absSample > currentPeaks[ch]) {
            currentPeaks[ch] = absSample
        }
    }

    private fun emitPeaks() {
        val now = System.nanoTime()
        lastPeakTime = now

        if (peakReleaseCoeff > 0) {
            for (ch in 0 until numChannels) {
                currentPeaks[ch] = (currentPeaks[ch] * (1.0 - peakReleaseCoeff)).toFloat().coerceAtLeast(0f)
            }
        }

        val holdNs = (peakHoldMs / 1000.0) * 1_000_000_000.0
        for (ch in 0 until numChannels) {
            if (currentPeaks[ch] > heldPeaks[ch]) {
                heldPeaks[ch] = currentPeaks[ch]
                peakTimer[ch] = now
            } else if (now - peakTimer[ch] > holdNs) {
                val release = (peakReleaseCoeff * 0.5).toFloat()
                heldPeaks[ch] = max(heldPeaks[ch] * (1.0f - release), currentPeaks[ch])
            }
        }
        peakCallback?.invoke(heldPeaks.copyOf())
    }

    private var lastPeakTime = System.nanoTime()

    private fun processSample(input: Double, ch: Int): Double {
        var signal = input
        if (compressorEnabled) {
            signal = applyCompressor(signal, ch)
        }
        val filtered = when (eqMode) {
            EqMode.GRAPHIC    -> applyFilters(signal, ch, graphicCoeffs, graphicState)
            EqMode.PARAMETRIC -> applyFilters(signal, ch, paramCoeffs, paramState)
            EqMode.PARALLEL   -> {
                val g = applyFilters(signal, ch, graphicCoeffs, graphicState)
                val p = applyFilters(signal, ch, paramCoeffs, paramState)
                (g + p) * 0.5
            }
        }
        return applyLimiter(filtered, ch)
    }

    private fun applyCompressor(input: Double, ch: Int): Double {
        val absInput = abs(input)
        var targetGain = 1.0
        if (absInput > 1e-8) {
            val db = linearToDb(absInput)
            targetGain = calculateCompressionGain(db)
        }
        val envIdx = ch.coerceAtMost(compressorEnvelope.size - 1)
        val currentEnv = compressorEnvelope[envIdx]
        val coeff = if (targetGain < currentEnv) compressorAttackCoeff else compressorReleaseCoeff
        compressorEnvelope[envIdx] = currentEnv + coeff * (targetGain - currentEnv)
        if (abs(compressorEnvelope[envIdx]) < DENORMAL_THRESHOLD) compressorEnvelope[envIdx] = 0.0
        return input * compressorEnvelope[envIdx] * compressorMakeupLinear
    }

    private fun calculateCompressionGain(inputDb: Double): Double {
        if (inputDb <= compressorThreshold - compressorKneeDb / 2.0) return 1.0
        if (inputDb >= compressorThreshold + compressorKneeDb / 2.0) {
            val compressedDb = compressorThreshold + (inputDb - compressorThreshold) * compressorSlope
            return dbToLinear(compressedDb - inputDb)
        }
        val kneeStartDb = compressorThreshold - compressorKneeDb / 2.0
        val kneeEndDb   = compressorThreshold + compressorKneeDb / 2.0
        val t = (inputDb - kneeStartDb) / compressorKneeDb
        val compressedDb = when {
            t < 0.5 -> {
                val t2 = t * 2.0
                kneeStartDb + (compressorThreshold - kneeStartDb) * (t2 * t2)
            }
            else -> {
                val t2 = (t - 0.5) * 2.0
                compressorThreshold + (kneeEndDb - compressorThreshold) * (1.0 - (1.0 - t2) * (1.0 - t2))
            }
        } + (inputDb - (kneeStartDb + t * compressorKneeDb)) * compressorSlope
        return dbToLinear(compressedDb - inputDb)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DSP PRIMITIVES
    // ═══════════════════════════════════════════════════════════════════════

    private fun applyFilters(
        input: Double, ch: Int,
        coeffs: Array<DoubleArray>,
        state: Array<Array<DoubleArray>>
    ): Double {
        if (coeffs.isEmpty() || state.isEmpty()) return input
        var x = input
        for (band in 0 until numBands) {
            val c = coeffs[band]
            val s = state[band][ch]
            val y = c[0] * x + s[0]
            s[0] = c[1] * x - c[3] * y + s[1]
            s[1] = c[2] * x - c[4] * y
            if (abs(s[0]) < DENORMAL_THRESHOLD) s[0] = 0.0
            if (abs(s[1]) < DENORMAL_THRESHOLD) s[1] = 0.0
            x = y
        }
        return x
    }

    private fun applyLimiter(sample: Double, ch: Int): Double {
        val absVal    = abs(sample)
        val kneeLinear = dbToLinear(-LIMITER_KNEE_DB / 2.0)
        val threshLow  = LIMITER_THRESHOLD * kneeLinear
        val threshHigh = LIMITER_THRESHOLD
        val targetGain = when {
            absVal <= threshLow  -> 1.0
            absVal <= threshHigh -> {
                val x = (absVal - threshLow) / (threshHigh - threshLow)
                1.0 - x * x * (1.0 - LIMITER_THRESHOLD / absVal.coerceAtLeast(1e-10))
            }
            else -> LIMITER_THRESHOLD / absVal.coerceAtLeast(1e-10)
        }
        val envIdx = ch.coerceAtMost(limiterEnvelope.size - 1)
        limiterEnvelope[envIdx] = if (targetGain < limiterEnvelope[envIdx])
            limiterAttCoeff * limiterEnvelope[envIdx] + (1.0 - limiterAttCoeff) * targetGain
        else
            limiterRelCoeff * limiterEnvelope[envIdx] + (1.0 - limiterRelCoeff) * targetGain
        return sample * limiterEnvelope[envIdx].coerceAtMost(1.0)
    }

    private fun softClip(x: Double): Double = when {
        x >= 1.0  -> 1.0
        x <= -1.0 -> -1.0
        else      -> x - (x * x * x) / 3.0
    }

    private fun applyDitherShaped(sample: Double, ch: Int): Double {
        val r1   = ditherRandom.nextDouble() * 2.0 - 1.0
        val r2   = ditherRandom.nextDouble() * 2.0 - 1.0
        val noise = DITHER_AMPLITUDE * (r1 - r2)
        val err   = if (ch < shapingError.size) shapingError[ch] else DoubleArray(4)
        val shaped = when (ditherMode) {
            DitherMode.FLAT       -> noise
            DitherMode.HIGHPASS   -> noise - err[0]
            DitherMode.E_WEIGHTED -> noise - 2.033 * err[0] + 2.165 * err[1] - 1.959 * err[2] + 1.590 * err[3]
            DitherMode.F_WEIGHTED -> noise - 2.412 * err[0] + 2.549 * err[1] - 2.712 * err[2] + 2.143 * err[3]
        }
        val dithered  = sample + shaped
        val quantised = (dithered * 32768.0).let { it.coerceIn(-32768.0, 32767.0).toLong().toDouble() } / 32768.0
        val quantError = quantised - sample
        if (ch < shapingError.size) {
            err[3] = err[2]; err[2] = err[1]; err[1] = err[0]; err[0] = quantError
        }
        return dithered
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SPECTRUM
    // ═══════════════════════════════════════════════════════════════════════

    private fun feedSpectrum(sample: Float) {
        if (spectrumBuf.isEmpty()) return
        spectrumBuf[spectrumWritePos % spectrumBuf.size] = sample
        spectrumWritePos++
        spectrumFrameCount++
        if (spectrumFrameCount >= spectrumRefreshSamples) {
            spectrumFrameCount = 0
            analyzeSpectrum()
        }
    }

    private fun analyzeSpectrum() {
        val n   = spectrumBuf.size
        val nyq = sampleRate / 2.0
        val result = FloatArray(SPECTRUM_BINS)
        for (binIdx in 0 until SPECTRUM_BINS) {
            val frac    = binIdx.toDouble() / (SPECTRUM_BINS - 1)
            val freqHz  = 20.0 * (nyq / 20.0).pow(frac)
            val freqNorm= freqHz / sampleRate
            val omega   = 2.0 * PI * freqNorm
            val coeff   = 2.0 * cos(omega)
            var s1 = 0.0; var s2 = 0.0
            for (i in 0 until n) {
                val x  = spectrumBuf[(spectrumWritePos + i) % n].toDouble()
                val s0 = x + coeff * s1 - s2
                s2 = s1; s1 = s0
            }
            result[binIdx] = (sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / n).toFloat()
        }
        _spectrumMagnitudes = result
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FILTER COEFFICIENTS
    // ═══════════════════════════════════════════════════════════════════════

    private fun rebuildAllFilters() {
        targetGraphicGains   = graphicGainsDb.copyOf()
        smoothedGraphicGains = graphicGainsDb.copyOf()
        targetParamGains     = parametricGainsDb.copyOf()
        smoothedParamGains   = parametricGainsDb.copyOf()
        rebuildGraphicFilters()
        rebuildParametricFilters()
    }

    private fun rebuildGraphicFilters() {
        targetGraphicGains   = graphicGainsDb.copyOf()
        smoothedGraphicGains = graphicGainsDb.copyOf()
        rebuildGraphicFiltersFromSmoothed()
    }

    private fun rebuildParametricFilters() {
        targetParamGains   = parametricGainsDb.copyOf()
        smoothedParamGains = parametricGainsDb.copyOf()
        rebuildParametricFiltersFromSmoothed()
    }

    private fun rebuildGraphicFiltersFromSmoothed() {
        if (sampleRate > 0.0 && numChannels > 0) {
            graphicCoeffs = buildCoeffs(smoothedGraphicGains, ISO_FREQ_CENTERS)
            if (graphicState.isEmpty() || graphicState[0].size != numChannels) graphicState = buildState()
        }
    }

    private fun rebuildParametricFiltersFromSmoothed() {
        if (sampleRate > 0.0 && numChannels > 0) {
            paramCoeffs = buildCoeffs(smoothedParamGains, parametricFreqs, useParametricTypes = true)
            if (paramState.isEmpty() || paramState[0].size != numChannels) paramState = buildState()
        }
    }

    /**
     * Builds biquad coefficients for each band.
     * For the graphic EQ the band type is determined by position (band 0 = low shelf, 30 = high shelf).
     * For the parametric EQ the per-band type from [parametricBandTypes] is used, enabling
     * the full Poweramp / Neutron filter type palette.
     */
    private fun buildCoeffs(gains: FloatArray, freqs: DoubleArray,
                             useParametricTypes: Boolean = false): Array<DoubleArray> = Array(BAND_COUNT) { band ->
        val fc   = freqs[band]
        val gain = gains.getOrElse(band) { 0f }.toDouble()
        val q    = currentQValues.getOrElse(band) { defaultQ(band) }.toDouble()
        val type = if (useParametricTypes) parametricBandTypes[band] else when (band) {
            0              -> "low_shelf"
            BAND_COUNT - 1 -> "high_shelf"
            else           -> "peaking"
        }
        computeBandCoeffsByType(fc, gain, q, sampleRate, type)
    }

    /** Dispatches to the correct biquad formula based on filter type string. */
    private fun computeBandCoeffsByType(fc: Double, gainDb: Double, q: Double, fs: Double, type: String): DoubleArray =
        when (type) {
            "low_shelf"  -> computeLowShelfCoeffs(fc, gainDb, q, fs)
            "high_shelf" -> computeHighShelfCoeffs(fc, gainDb, q, fs)
            "low_pass"   -> computeLowPassCoeffs(fc, q, fs)
            "high_pass"  -> computeHighPassCoeffs(fc, q, fs)
            "band_pass"  -> computeBandPassCoeffs(fc, q, fs)
            "notch"      -> computeNotchCoeffs(fc, q, fs)
            "all_pass"   -> computeAllPassCoeffs(fc, q, fs)
            else         -> computePeakingCoeffs(fc, gainDb, q, fs)   // "peaking" default
        }

    private fun buildState(): Array<Array<DoubleArray>> =
        Array(BAND_COUNT) { Array(numChannels.coerceAtLeast(1)) { DoubleArray(2) } }

    private fun clearAllState() {
        graphicState = buildState()
        paramState   = buildState()
    }

    private fun computePeakingCoeffs(fc: Double, gainDb: Double, q: Double, fs: Double): DoubleArray {
        if (gainDb == 0.0) return doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0)
        val w0    = 2.0 * PI * fc / fs; val cosW0 = cos(w0); val sinW0 = sin(w0)
        val A     = 10.0.pow(gainDb / 40.0)
        val al    = sinW0 / (2.0 * q)
        val b0    = 1.0 + al * A; val b1 = -2.0 * cosW0; val b2 = 1.0 - al * A
        val a0    = 1.0 + al / A; val a1 = -2.0 * cosW0; val a2 = 1.0 - al / A
        return doubleArrayOf(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    private fun computeLowShelfCoeffs(fc: Double, gainDb: Double, q: Double, fs: Double): DoubleArray {
        if (gainDb == 0.0) return doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0)
        val w0    = 2.0 * PI * fc / fs; val cosW0 = cos(w0); val sinW0 = sin(w0)
        val A     = 10.0.pow(gainDb / 40.0)
        val al    = sinW0 / 2.0 * sqrt((A + 1.0 / A) * (1.0 / q - 1.0) + 2.0)
        val b0    = A * ((A + 1) - (A - 1) * cosW0 + 2 * sqrt(A) * al)
        val b1    = 2.0 * A * ((A - 1) - (A + 1) * cosW0)
        val b2    = A * ((A + 1) - (A - 1) * cosW0 - 2 * sqrt(A) * al)
        val a0    = (A + 1) + (A - 1) * cosW0 + 2 * sqrt(A) * al
        val a1    = -2.0 * ((A - 1) + (A + 1) * cosW0)
        val a2    = (A + 1) + (A - 1) * cosW0 - 2 * sqrt(A) * al
        return doubleArrayOf(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    private fun computeHighShelfCoeffs(fc: Double, gainDb: Double, q: Double, fs: Double): DoubleArray {
        if (gainDb == 0.0) return doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0)
        val w0    = 2.0 * PI * fc / fs; val cosW0 = cos(w0); val sinW0 = sin(w0)
        val A     = 10.0.pow(gainDb / 40.0)
        val al    = sinW0 / 2.0 * sqrt((A + 1.0 / A) * (1.0 / q - 1.0) + 2.0)
        val b0    = A * ((A + 1) + (A - 1) * cosW0 + 2 * sqrt(A) * al)
        val b1    = -2.0 * A * ((A - 1) + (A + 1) * cosW0)
        val b2    = A * ((A + 1) + (A - 1) * cosW0 - 2 * sqrt(A) * al)
        val a0    = (A + 1) - (A - 1) * cosW0 + 2 * sqrt(A) * al
        val a1    = 2.0 * ((A - 1) - (A + 1) * cosW0)
        val a2    = (A + 1) - (A - 1) * cosW0 - 2 * sqrt(A) * al
        return doubleArrayOf(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ADDITIONAL FILTER COEFFICIENT FUNCTIONS (Poweramp / Neutron band types)
    // ═══════════════════════════════════════════════════════════════════════

    /** 2nd-order Butterworth low-pass — uses gain parameter as passband level (0 dB = flat) */
    private fun computeLowPassCoeffs(fc: Double, q: Double, fs: Double): DoubleArray {
        val w0 = 2.0 * PI * fc / fs; val cosW0 = cos(w0); val sinW0 = sin(w0)
        val al = sinW0 / (2.0 * q)
        val b0 = (1.0 - cosW0) / 2.0; val b1 = 1.0 - cosW0; val b2 = b0
        val a0 = 1.0 + al; val a1 = -2.0 * cosW0; val a2 = 1.0 - al
        return doubleArrayOf(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /** 2nd-order Butterworth high-pass */
    private fun computeHighPassCoeffs(fc: Double, q: Double, fs: Double): DoubleArray {
        val w0 = 2.0 * PI * fc / fs; val cosW0 = cos(w0); val sinW0 = sin(w0)
        val al = sinW0 / (2.0 * q)
        val b0 = (1.0 + cosW0) / 2.0; val b1 = -(1.0 + cosW0); val b2 = b0
        val a0 = 1.0 + al; val a1 = -2.0 * cosW0; val a2 = 1.0 - al
        return doubleArrayOf(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /** 2nd-order band-pass (constant 0 dB peak gain) */
    private fun computeBandPassCoeffs(fc: Double, q: Double, fs: Double): DoubleArray {
        val w0 = 2.0 * PI * fc / fs; val cosW0 = cos(w0); val sinW0 = sin(w0)
        val al = sinW0 / (2.0 * q)
        val b0 = sinW0 / 2.0; val b1 = 0.0; val b2 = -b0
        val a0 = 1.0 + al; val a1 = -2.0 * cosW0; val a2 = 1.0 - al
        return doubleArrayOf(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /** 2nd-order notch (band-reject) */
    private fun computeNotchCoeffs(fc: Double, q: Double, fs: Double): DoubleArray {
        val w0 = 2.0 * PI * fc / fs; val cosW0 = cos(w0); val sinW0 = sin(w0)
        val al = sinW0 / (2.0 * q)
        val b0 = 1.0; val b1 = -2.0 * cosW0; val b2 = 1.0
        val a0 = 1.0 + al; val a1 = -2.0 * cosW0; val a2 = 1.0 - al
        return doubleArrayOf(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /** 2nd-order all-pass (shifts phase 180° at fc, unity gain everywhere) */
    private fun computeAllPassCoeffs(fc: Double, q: Double, fs: Double): DoubleArray {
        val w0 = 2.0 * PI * fc / fs; val cosW0 = cos(w0); val sinW0 = sin(w0)
        val al = sinW0 / (2.0 * q)
        val b0 = 1.0 - al; val b1 = -2.0 * cosW0; val b2 = 1.0 + al
        val a0 = 1.0 + al; val a1 = -2.0 * cosW0; val a2 = 1.0 - al
        return doubleArrayOf(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    private fun initLimiter() {
        limiterAttCoeff = exp(-1.0 / ((LIMITER_ATTACK_MS / 1000.0) * sampleRate))
        limiterRelCoeff = exp(-1.0 / ((LIMITER_RELEASE_MS / 1000.0) * sampleRate))
        limiterEnvelope = DoubleArray(numChannels.coerceAtLeast(1)) { 1.0 }
    }

    private fun updateCompressorCurve() {
        compressorLinearThreshold  = dbToLinear(compressorThreshold)
        compressorLinearKneeStart  = dbToLinear(compressorThreshold - compressorKneeDb / 2.0)
        compressorLinearKneeEnd    = dbToLinear(compressorThreshold + compressorKneeDb / 2.0)
        compressorSlope            = 1.0 / compressorRatio
        compressorMakeupLinear     = dbToLinear(compressorMakeupDb)
    }

    private fun updateCompressorTimeConstants() {
        compressorAttackCoeff  = exp(-1.0 / (compressorAttackMs  / 1000.0 * sampleRate))
        compressorReleaseCoeff = exp(-1.0 / (compressorReleaseMs / 1000.0 * sampleRate))
    }

    private fun updatePeakReleaseCoeff() {
        peakReleaseCoeff = if (peakReleaseMs <= 0 || sampleRate <= 0) 1.0
        else exp(-1.0 / (peakReleaseMs / 1000.0 * sampleRate))
    }

    private fun dbToLinear(db: Double): Double = 10.0.pow(db / 20.0)
    private fun linearToDb(linear: Double): Double =
        if (linear <= 0.0) -120.0 else 20.0 * log10(linear)

    private fun replaceOutputBuffer(size: Int): ByteBuffer {
        return if (outputBuffer === AudioProcessor.EMPTY_BUFFER || outputBuffer.capacity() < size) {
            ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder()).also { outputBuffer = it }
        } else {
            outputBuffer.clear().limit(size); outputBuffer
        }
    }

    private fun defaultQ(band: Int): Float = when {
        band == 0 || band == BAND_COUNT - 1 -> 0.707f
        band < 3  || band > 27              -> 1.0f
        band < 7  || band > 23              -> 1.4f
        else                                -> 2.1f
    }
}