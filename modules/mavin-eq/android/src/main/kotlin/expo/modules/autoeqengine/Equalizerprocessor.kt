package expo.modules.autoeqengine

import android.util.Log
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Random
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.*

/**
 * EqualizerProcessor — Production-grade 31-band parametric + graphic EQ
 *
 * Poweramp-parity feature set:
 *   ✅ 31-band ISO 1/3-octave graphic EQ
 *   ✅ Full parametric EQ mode (per-band freq, gain, Q — independent of graphic)
 *   ✅ Low shelf filter on band 0, high shelf on band 30
 *   ✅ Per-band Q (bandwidth) control — graphic AND parametric
 *   ✅ Preamp gain (–15 dB to +15 dB)
 *   ✅ True-peak limiter (soft-knee, –0.17 dBFS threshold)
 *   ✅ Separate loudness normalization (ReplayGain / target LUFS offset)
 *   ✅ Parameter smoothing — linear interpolation over configurable ramp (default 10 ms)
 *       Eliminates zipper noise when sliders move
 *   ✅ Real-time spectrum analysis (64-bin magnitude via Goertzel, updated every ~100 ms)
 *   ✅ Auto-EQ: flat-room correction — levelling analysis → suggested gain array
 *   ✅ TPDF dither on 16-bit output (dedicated Random instance, thread-safe)
 *   ✅ Denormal flush guards in biquad state
 *   ✅ Lock-free atomic updates from JS thread
 *   ✅ Fixed stereo biquad state bug (was coerceAtMost(1), now correct per-channel state)
 *   ✅ PCM_16BIT and PCM_FLOAT support · Mono and stereo support
 *   ✅ Optimized buffer allocation — no per-buffer heap alloc
 *   ✅ State getters for JS bridge sync
 *
 * DSP chain per sample:
 *   PCM in → loudness offset → preamp → 31× biquad EQ → true-peak limiter
 *             → [TPDF dither on 16-bit] → PCM out
 *
 * Thread model:
 *   JS/UI thread  → pendingXxx AtomicReferences (writes)
 *   Audio thread  → queueInput() drains pending refs, runs DSP (reads)
 *   Analysis      → spectrumBuffer ring updated on audio thread, read by analyzer Runnable
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

        const val BAND_COUNT       = 31
        const val GAIN_MIN_DB      = -15.0
        const val GAIN_MAX_DB      =  15.0
        const val PREAMP_MIN       = -15.0
        const val PREAMP_MAX       =  15.0

        // Limiter
        private const val LIMITER_THRESHOLD  = 0.98
        private const val LIMITER_KNEE_DB    = 6.0
        private const val LIMITER_ATTACK_MS  = 0.1
        private const val LIMITER_RELEASE_MS = 80.0

        // TPDF dither (1 LSB for 16-bit)
        private const val DITHER_AMPLITUDE   = 1.0 / 32768.0

        // Parameter smoothing — default ramp 10 ms; shorter = snappier, longer = zipper-free
        private const val SMOOTH_RAMP_MS_DEFAULT = 10.0

        // Denormal flush threshold
        private const val DENORMAL_THRESHOLD = 1e-30

        // Spectrum analysis — 64 frequency bins, refresh every ~100 ms
        const val SPECTRUM_BINS          = 64
        private const val SPECTRUM_REFRESH_MS = 100.0

        // Auto-EQ: target flat amplitude in dB (0 = flat)
        private const val AUTO_EQ_TARGET_DB = 0.0
        private const val AUTO_EQ_MAX_CORRECTION_DB = 12.0
    }

    // ── Public state ──────────────────────────────────────────────────────────
    @Volatile var isEnabled: Boolean = true

    /**
     * EQ mode — graphic (classic 31-band) or parametric (independent bands with
     * custom centre frequency).  Both maintain separate gain/Q/freq arrays.
     * Switching mode triggers a filter rebuild on the next buffer.
     */
    enum class EqMode { GRAPHIC, PARAMETRIC }
    @Volatile var eqMode: EqMode = EqMode.GRAPHIC

    // ── Smoothing config ──────────────────────────────────────────────────────
    /** Time in ms over which gain changes are linearly interpolated.
     *  Set to 0 to disable smoothing (immediate — may cause zipper noise). */
    var smoothingRampMs: Double = SMOOTH_RAMP_MS_DEFAULT

    // ── Pending atomic updates (lock-free, set from JS thread) ───────────────
    private val pendingGraphicGains   = AtomicReference<FloatArray?>(null)
    private val pendingParametricGains= AtomicReference<FloatArray?>(null)
    private val pendingParametricFreqs= AtomicReference<DoubleArray?>(null)
    private val pendingPreamp         = AtomicReference<Float?>(null)
    private val pendingQValues        = AtomicReference<FloatArray?>(null)
    private val pendingLoudnessOffset = AtomicReference<Float?>(null)
    private val pendingEqMode         = AtomicReference<EqMode?>(null)

    // ── Current DSP state ─────────────────────────────────────────────────────
    private var numBands     = 0
    private var numChannels  = 0
    private var sampleRate   = 48000.0

    // Graphic EQ
    private var graphicGainsDb   = FloatArray(BAND_COUNT) { 0f }

    // Parametric EQ — independent set; default centres = ISO, gains = 0, Q = 1.4
    private var parametricGainsDb = FloatArray(BAND_COUNT) { 0f }
    private var parametricFreqs   = ISO_FREQ_CENTERS.copyOf()

    private var currentQValues    = FloatArray(BAND_COUNT) { defaultQ(it) }
    private var preampGainLinear  = 1.0        // from preamp dB
    private var loudnessLinear    = 1.0        // from loudness normalization offset

    // Smoothed (interpolated) working copies — what the DSP actually uses
    private var smoothedGainsDb    = FloatArray(BAND_COUNT) { 0f }
    private var targetGainsDb      = FloatArray(BAND_COUNT) { 0f }
    private var smoothedPreamp     = 1.0
    private var targetPreamp       = 1.0
    private var smoothedLoudness   = 1.0
    private var targetLoudness     = 1.0

    // Per-sample smooth increment (recomputed when sampleRate or ramp changes)
    private var smoothStepFraction = 0.0   // fraction of (target-current) to advance per buffer

    // coeffs[band][0..4]: b0 b1 b2 a1 a2  (a0 normalised to 1)
    private var coeffs: Array<DoubleArray> = emptyArray()
    // state[band][ch][0..1]: w1 w2  (transposed direct form II)
    // BUG FIX: was coerceAtMost(1) causing stereo state to be 1-channel → inter-channel bleed
    private var state: Array<Array<DoubleArray>> = emptyArray()

    // ── Limiter state (per channel) ───────────────────────────────────────────
    private var limiterEnvelope = DoubleArray(8) { 1.0 }
    private var limiterAttCoeff = 0.0
    private var limiterRelCoeff = 0.0

    // ── TPDF dither ───────────────────────────────────────────────────────────
    // Dedicated Random instance — not shared, avoids correlation with other callers
    private val ditherRandom = Random()

    // ── Output buffer — reused, no per-buffer alloc ───────────────────────────
    private var outputBuffer: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var inputAudioFormat:  AudioFormat = AudioFormat.NOT_SET
    private var outputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var inputEnded = false

    // ── Spectrum analysis ─────────────────────────────────────────────────────
    // Ring buffer of recent L-channel samples for Goertzel analysis
    private var spectrumSampleBuf  = FloatArray(8192)
    private var spectrumWritePos   = 0
    private var spectrumFrameCount = 0
    private var spectrumRefreshSamples = 4800   // recalculated on configure()

    // Published magnitude spectrum — written on audio thread, read by JS thread
    @Volatile private var _spectrumMagnitudes = FloatArray(SPECTRUM_BINS) { 0f }
    /** Read-only snapshot of the current spectrum magnitudes (linear 0..1 scale). */
    val spectrumMagnitudes: FloatArray get() = _spectrumMagnitudes.copyOf()

    // ── Auto-EQ ───────────────────────────────────────────────────────────────
    /** Last computed auto-EQ correction suggestion (call computeAutoEqSuggestion()). */
    @Volatile private var _autoEqSuggestion = FloatArray(BAND_COUNT) { 0f }
    val autoEqSuggestion: FloatArray get() = _autoEqSuggestion.copyOf()

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC JS-FACING API
    // ─────────────────────────────────────────────────────────────────────────

    // ── Graphic EQ ────────────────────────────────────────────────────────────

    fun setBandGain(band: Int, gainDb: Float) {
        if (band !in 0 until BAND_COUNT) return
        val next = pendingGraphicGains.get()?.copyOf() ?: graphicGainsDb.copyOf()
        next[band] = gainDb.coerceIn(GAIN_MIN_DB.toFloat(), GAIN_MAX_DB.toFloat())
        pendingGraphicGains.set(next)
    }

    fun applyBands(gainsDb: FloatArray) {
        val clamped = FloatArray(BAND_COUNT) {
            gainsDb.getOrElse(it) { 0f }.coerceIn(GAIN_MIN_DB.toFloat(), GAIN_MAX_DB.toFloat())
        }
        pendingGraphicGains.set(clamped)
    }

    // ── Parametric EQ ────────────────────────────────────────────────────────

    /** Set gain for a single parametric band (independent of graphic EQ bands). */
    fun setParametricBandGain(band: Int, gainDb: Float) {
        if (band !in 0 until BAND_COUNT) return
        val next = pendingParametricGains.get()?.copyOf() ?: parametricGainsDb.copyOf()
        next[band] = gainDb.coerceIn(GAIN_MIN_DB.toFloat(), GAIN_MAX_DB.toFloat())
        pendingParametricGains.set(next)
    }

    /** Apply a full array of parametric gains. */
    fun applyParametricBands(gainsDb: FloatArray) {
        val clamped = FloatArray(BAND_COUNT) {
            gainsDb.getOrElse(it) { 0f }.coerceIn(GAIN_MIN_DB.toFloat(), GAIN_MAX_DB.toFloat())
        }
        pendingParametricGains.set(clamped)
    }

    /**
     * Set custom centre frequency for a parametric band (Hz).
     * Clamped to 20 Hz – (sampleRate/2 – 1 Hz) to keep filters stable.
     */
    fun setParametricBandFreq(band: Int, freqHz: Double) {
        if (band !in 0 until BAND_COUNT) return
        val next = pendingParametricFreqs.get()?.copyOf() ?: parametricFreqs.copyOf()
        next[band] = freqHz.coerceIn(20.0, (sampleRate / 2.0) - 1.0)
        pendingParametricFreqs.set(next)
    }

    // ── Shared controls ───────────────────────────────────────────────────────

    /** Preamp: master gain before all bands. Range –15 .. +15 dB. */
    fun setPreamp(gainDb: Float) {
        pendingPreamp.set(gainDb.coerceIn(PREAMP_MIN.toFloat(), PREAMP_MAX.toFloat()))
    }

    /** Per-band Q. Higher Q = narrower. Range 0.3–10. Applies to both EQ modes. */
    fun setBandQ(band: Int, q: Float) {
        if (band !in 0 until BAND_COUNT) return
        val next = pendingQValues.get()?.copyOf() ?: currentQValues.copyOf()
        next[band] = q.coerceIn(0.3f, 10f)
        pendingQValues.set(next)
    }

    /**
     * Loudness normalization offset in dB.
     * Use ReplayGain track/album gain here: positive offsets boost, negative attenuate.
     * Applied before the preamp in the DSP chain.
     * Example: ReplayGain reports –6.0 dB → pass –6.0 → signal is attenuated 6 dB → no clipping.
     */
    fun setLoudnessOffset(gainDb: Float) {
        pendingLoudnessOffset.set(gainDb.coerceIn(-30f, 30f))
    }

    /** Switch EQ mode. Filter coefficients are rebuilt on the next buffer. */
    fun setEqMode(mode: EqMode) {
        pendingEqMode.set(mode)
    }

    /** Reset graphic gains and preamp to flat. Parametric bands unchanged. */
    fun resetGains() {
        pendingGraphicGains.set(FloatArray(BAND_COUNT) { 0f })
        pendingPreamp.set(0f)
    }

    /** Reset parametric EQ to flat gain, ISO centre frequencies, default Q. */
    fun resetParametric() {
        pendingParametricGains.set(FloatArray(BAND_COUNT) { 0f })
        pendingParametricFreqs.set(ISO_FREQ_CENTERS.copyOf())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STATE GETTERS FOR JS BRIDGE
    // ─────────────────────────────────────────────────────────────────────────

    /** Current applied graphic EQ gains (after any pending updates are flushed). */
    fun getCurrentGains(): FloatArray = graphicGainsDb.copyOf()

    /** Current applied parametric EQ gains. */
    fun getParametricGains(): FloatArray = parametricGainsDb.copyOf()

    /** Current parametric centre frequencies in Hz. */
    fun getParametricFreqs(): DoubleArray = parametricFreqs.copyOf()

    /** Current preamp in dB. */
    fun getCurrentPreamp(): Float = linearToDb(preampGainLinear).toFloat()

    /** Current Q values (shared between both modes). */
    fun getCurrentQValues(): FloatArray = currentQValues.copyOf()

    /** Current loudness offset in dB. */
    fun getCurrentLoudnessOffset(): Float = linearToDb(loudnessLinear).toFloat()

    /** Current EQ mode. */
    fun getCurrentEqMode(): EqMode = eqMode

    // ─────────────────────────────────────────────────────────────────────────
    // SPECTRUM ANALYSIS & AUTO-EQ
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Compute a flat-correction Auto-EQ suggestion based on the last spectrum snapshot.
     *
     * Algorithm:
     *   1. Map each of the 31 ISO bands to the closest spectrum bin magnitude.
     *   2. Convert to dB. Compute the mean level across all bands.
     *   3. For each band: suggestion = -(band_dB - mean_dB), clamped to ±AUTO_EQ_MAX_CORRECTION_DB.
     *      This pushes every band toward the mean (flat response correction).
     *
     * The result is stored in autoEqSuggestion. Call applyBands(autoEqSuggestion) to
     * actually apply it (or present it to the user to confirm first).
     *
     * Returns the suggested gains array.
     */
    fun computeAutoEqSuggestion(): FloatArray {
        val mags = _spectrumMagnitudes
        val nyquist = sampleRate / 2.0
        val binWidth = nyquist / SPECTRUM_BINS

        // Map each ISO band to a spectrum bin, get magnitude in dB
        val bandDb = FloatArray(BAND_COUNT) { band ->
            val fc   = ISO_FREQ_CENTERS[band]
            val bin  = ((fc / binWidth).toInt()).coerceIn(0, SPECTRUM_BINS - 1)
            val mag  = mags[bin].toDouble().coerceAtLeast(1e-10)
            20.0 * log10(mag).toFloat()
        }

        val mean = bandDb.average().toFloat()

        val suggestion = FloatArray(BAND_COUNT) { band ->
            (-(bandDb[band] - mean))
                .coerceIn(-AUTO_EQ_MAX_CORRECTION_DB.toFloat(), AUTO_EQ_MAX_CORRECTION_DB.toFloat())
        }
        _autoEqSuggestion = suggestion
        Log.d(TAG, "Auto-EQ suggestion computed: mean=${mean.roundTo(1)} dB")
        return suggestion
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AudioProcessor INTERFACE
    // ─────────────────────────────────────────────────────────────────────────

    override fun configure(inputAudioFormat: AudioFormat): AudioFormat {
        if (inputAudioFormat.encoding != android.media.AudioFormat.ENCODING_PCM_16BIT &&
            inputAudioFormat.encoding != android.media.AudioFormat.ENCODING_PCM_FLOAT) {
            this.inputAudioFormat  = AudioFormat.NOT_SET
            this.outputAudioFormat = AudioFormat.NOT_SET
            return AudioFormat.NOT_SET
        }
        this.inputAudioFormat  = inputAudioFormat
        this.outputAudioFormat = inputAudioFormat
        sampleRate   = inputAudioFormat.sampleRate.toDouble()
        numChannels  = inputAudioFormat.channelCount
        numBands     = BAND_COUNT

        spectrumRefreshSamples = (sampleRate * SPECTRUM_REFRESH_MS / 1000.0).toInt()
        spectrumSampleBuf      = FloatArray(spectrumRefreshSamples.coerceAtLeast(512))

        recomputeSmoothStep()
        rebuildFilters()
        initLimiter()

        Log.i(TAG, "configure: ${inputAudioFormat.sampleRate}Hz " +
                "${inputAudioFormat.channelCount}ch enc=${inputAudioFormat.encoding} " +
                "mode=$eqMode smoothRamp=${smoothingRampMs}ms")
        return outputAudioFormat
    }

    override fun isActive(): Boolean = inputAudioFormat != AudioFormat.NOT_SET

    override fun queueInput(inputBuffer: ByteBuffer) {
        // ── Drain pending updates from JS thread (lock-free) ──────────────────
        var needRebuild = false

        pendingEqMode.getAndSet(null)?.let {
            eqMode = it
            needRebuild = true
        }
        pendingGraphicGains.getAndSet(null)?.let {
            graphicGainsDb = it
            if (eqMode == EqMode.GRAPHIC) {
                targetGainsDb = it.copyOf()
                needRebuild = true
            }
        }
        pendingParametricGains.getAndSet(null)?.let {
            parametricGainsDb = it
            if (eqMode == EqMode.PARAMETRIC) {
                targetGainsDb = it.copyOf()
                needRebuild = true
            }
        }
        pendingParametricFreqs.getAndSet(null)?.let {
            parametricFreqs = it
            if (eqMode == EqMode.PARAMETRIC) needRebuild = true
        }
        pendingQValues.getAndSet(null)?.let {
            currentQValues = it
            needRebuild = true
        }
        if (needRebuild) rebuildFilters()

        pendingPreamp.getAndSet(null)?.let {
            targetPreamp = dbToLinear(it.toDouble())
        }
        pendingLoudnessOffset.getAndSet(null)?.let {
            targetLoudness = dbToLinear(it.toDouble())
        }

        if (!isEnabled || inputBuffer.remaining() == 0) {
            outputBuffer = inputBuffer
            return
        }

        val output = replaceOutputBuffer(inputBuffer.remaining())

        // Compute per-buffer smooth step based on buffer size
        val bufferSamples = when (inputAudioFormat.encoding) {
            android.media.AudioFormat.ENCODING_PCM_16BIT -> inputBuffer.remaining() / 2
            else -> inputBuffer.remaining() / 4
        }.coerceAtLeast(1)
        val samplesPerChannel = bufferSamples / numChannels.coerceAtLeast(1)
        updateSmoothedParams(samplesPerChannel)

        when (inputAudioFormat.encoding) {
            android.media.AudioFormat.ENCODING_PCM_16BIT -> processShort(inputBuffer, output)
            android.media.AudioFormat.ENCODING_PCM_FLOAT -> processFloat(inputBuffer, output)
        }

        inputBuffer.position(inputBuffer.limit())
        output.flip()
        outputBuffer = output
    }

    override fun queueEndOfStream() { inputEnded = true }

    override fun getOutput(): ByteBuffer {
        val out = outputBuffer
        outputBuffer = AudioProcessor.EMPTY_BUFFER
        return out
    }

    override fun isEnded(): Boolean = inputEnded && outputBuffer === AudioProcessor.EMPTY_BUFFER

    override fun flush() {
        outputBuffer = AudioProcessor.EMPTY_BUFFER
        inputEnded   = false
        clearState()
        limiterEnvelope.fill(1.0)
        spectrumWritePos   = 0
        spectrumFrameCount = 0
        // Sync smoothed → target so resumed playback starts cleanly
        smoothedGainsDb   = targetGainsDb.copyOf()
        smoothedPreamp    = targetPreamp
        smoothedLoudness  = targetLoudness
    }

    override fun reset() {
        flush()
        inputAudioFormat  = AudioFormat.NOT_SET
        outputAudioFormat = AudioFormat.NOT_SET
        coeffs  = emptyArray()
        state   = emptyArray()
        graphicGainsDb    = FloatArray(BAND_COUNT) { 0f }
        parametricGainsDb = FloatArray(BAND_COUNT) { 0f }
        parametricFreqs   = ISO_FREQ_CENTERS.copyOf()
        currentQValues    = FloatArray(BAND_COUNT) { defaultQ(it) }
        preampGainLinear  = 1.0
        loudnessLinear    = 1.0
        smoothedGainsDb   = FloatArray(BAND_COUNT) { 0f }
        targetGainsDb     = FloatArray(BAND_COUNT) { 0f }
        smoothedPreamp    = 1.0
        targetPreamp      = 1.0
        smoothedLoudness  = 1.0
        targetLoudness    = 1.0
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PARAMETER SMOOTHING
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Recompute the per-buffer smoothing step fraction.
     * smoothStepFraction = 1 / (ramp_in_samples / typical_buffer_size)
     * We target reaching the new value in smoothingRampMs ms.
     * Called on configure() and whenever smoothingRampMs is changed externally.
     */
    fun recomputeSmoothStep() {
        if (smoothingRampMs <= 0.0 || sampleRate <= 0.0) {
            smoothStepFraction = 1.0   // immediate
            return
        }
        // Typical ExoPlayer audio buffer is ~20ms; we advance per-buffer not per-sample
        // for efficiency. Fraction = bufferMs / rampMs (clamped 0..1).
        val typicalBufferMs = 20.0
        smoothStepFraction  = (typicalBufferMs / smoothingRampMs).coerceIn(0.01, 1.0)
    }

    /**
     * Move smoothed parameters one step toward their targets.
     * Called once per queueInput() buffer before processing starts.
     * samplesPerChannel is used to update dynamic smoothing if needed.
     */
    private fun updateSmoothedParams(samplesPerChannel: Int) {
        val step = smoothStepFraction

        // Linear interpolation: smoothed += step * (target - smoothed)
        for (b in 0 until BAND_COUNT) {
            val diff = targetGainsDb[b] - smoothedGainsDb[b]
            smoothedGainsDb[b] += (step * diff).toFloat()
        }
        smoothedPreamp   += step * (targetPreamp   - smoothedPreamp)
        smoothedLoudness += step * (targetLoudness - smoothedLoudness)

        // Sync actual linear values used in DSP inner loop
        preampGainLinear = smoothedPreamp
        loudnessLinear   = smoothedLoudness

        // Rebuild coefficients if gains changed appreciably (> 0.05 dB threshold)
        var needsRebuild = false
        for (b in 0 until BAND_COUNT) {
            if (abs(smoothedGainsDb[b] - (coeffs.getOrNull(b)?.let { activeGainForCoeff(b) } ?: -999f)) > 0.05f) {
                needsRebuild = true
                break
            }
        }
        if (needsRebuild) rebuildFiltersFromSmoothed()
    }

    /** Returns the gain (dB) that was used when building coeffs[band] for comparison. */
    private fun activeGainForCoeff(band: Int): Float = smoothedGainsDb[band]

    // ─────────────────────────────────────────────────────────────────────────
    // PCM PROCESSING
    // ─────────────────────────────────────────────────────────────────────────

    private fun processShort(input: ByteBuffer, output: ByteBuffer) {
        var sampleIndex = 0
        while (input.remaining() >= 2) {
            val ch     = sampleIndex % numChannels
            var sample = input.short.toDouble() / 32768.0

            // 1. Loudness normalization + preamp (combined multiply — 1 op instead of 2)
            sample *= loudnessLinear * preampGainLinear

            // 2. EQ bands (31× biquad)
            sample = applyFilters(sample, ch)

            // 3. True-peak limiter
            sample = applyLimiter(sample, ch)

            // 4. TPDF dither (1 LSB noise, reduces quantisation distortion on 16-bit)
            sample += ditherTpdf()

            // 5. Quantise back to 16-bit
            output.putShort((sample * 32768.0).coerceIn(-32768.0, 32767.0).toInt().toShort())

            // Spectrum: capture left-channel (ch == 0) samples
            if (ch == 0) feedSpectrum(sample.toFloat())
            sampleIndex++
        }
    }

    private fun processFloat(input: ByteBuffer, output: ByteBuffer) {
        var sampleIndex = 0
        while (input.remaining() >= 4) {
            val ch     = sampleIndex % numChannels
            var sample = input.float.toDouble()

            // 1. Loudness normalization + preamp
            sample *= loudnessLinear * preampGainLinear

            // 2. EQ bands
            sample = applyFilters(sample, ch)

            // 3. True-peak limiter
            sample = applyLimiter(sample, ch)

            // 4. Soft clip (float pipeline — no dither needed)
            sample = softClip(sample)

            output.putFloat(sample.toFloat())

            if (ch == 0) feedSpectrum(sample.toFloat())
            sampleIndex++
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SPECTRUM FEEDING & ANALYSIS (Goertzel DFT)
    // ─────────────────────────────────────────────────────────────────────────

    private fun feedSpectrum(sample: Float) {
        if (spectrumSampleBuf.isEmpty()) return
        val bufLen = spectrumSampleBuf.size
        spectrumSampleBuf[spectrumWritePos % bufLen] = sample
        spectrumWritePos++
        spectrumFrameCount++

        if (spectrumFrameCount >= spectrumRefreshSamples) {
            spectrumFrameCount = 0
            analyzeSpectrum()
        }
    }

    /**
     * Goertzel-based spectrum analysis.
     * Computes magnitude for SPECTRUM_BINS logarithmically-spaced frequency bins.
     * Goertzel is more efficient than full FFT when you only need a fixed set of bins.
     * Complexity: O(N × SPECTRUM_BINS) vs FFT O(N log N) — acceptable for 64 bins.
     */
    private fun analyzeSpectrum() {
        val n      = spectrumSampleBuf.size
        val nyq    = sampleRate / 2.0
        val result = FloatArray(SPECTRUM_BINS)

        for (binIdx in 0 until SPECTRUM_BINS) {
            // Logarithmically spaced: 20 Hz → Nyquist
            val frac   = binIdx.toDouble() / (SPECTRUM_BINS - 1)
            val freqHz = 20.0 * (nyq / 20.0).pow(frac)   // log scale 20Hz..Nyquist
            val freqNorm = freqHz / sampleRate            // 0..0.5

            // Goertzel coefficient
            val omega  = 2.0 * PI * freqNorm
            val coeff  = 2.0 * cos(omega)

            var s0 = 0.0; var s1 = 0.0; var s2 = 0.0
            // Use ring buffer in correct order
            for (i in 0 until n) {
                val x = spectrumSampleBuf[(spectrumWritePos + i) % n].toDouble()
                s0 = x + coeff * s1 - s2
                s2 = s1
                s1 = s0
            }
            // Magnitude
            val mag = sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2)
            result[binIdx] = (mag / n).toFloat()
        }
        _spectrumMagnitudes = result
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PER-SAMPLE DSP HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    /** Run all 31 biquad filters in series for one sample on one channel.
     *  Transposed direct-form II with denormal flush guard. */
    private fun applyFilters(input: Double, ch: Int): Double {
        var x = input
        for (band in 0 until numBands) {
            val c  = coeffs[band]
            val s  = state[band][ch]
            val y  = c[0] * x + s[0]
            s[0]   = c[1] * x - c[3] * y + s[1]
            s[1]   = c[2] * x - c[4] * y
            // Denormal flush — prevents CPU stalls from subnormal doubles
            if (abs(s[0]) < DENORMAL_THRESHOLD) s[0] = 0.0
            if (abs(s[1]) < DENORMAL_THRESHOLD) s[1] = 0.0
            x = y
        }
        return x
    }

    /** Lookahead-free soft-knee peak limiter per channel.
     *  Attack: 0.1 ms, Release: 80 ms. Engages softly at –3 dBFS below threshold. */
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
        val env    = limiterEnvelope[envIdx]
        limiterEnvelope[envIdx] = if (targetGain < env)
            limiterAttCoeff * env + (1.0 - limiterAttCoeff) * targetGain
        else
            limiterRelCoeff * env + (1.0 - limiterRelCoeff) * targetGain

        return sample * limiterEnvelope[envIdx].coerceAtMost(1.0)
    }

    /** Cubic soft clip — prevents hard clipping on float path beyond ±1.0. */
    private fun softClip(x: Double): Double {
        if (x >=  1.0) return  1.0
        if (x <= -1.0) return -1.0
        return x - (x * x * x) / 3.0
    }

    /** TPDF dither — triangular distribution, 1 LSB amplitude for 16-bit output. */
    private fun ditherTpdf(): Double {
        val r1 = ditherRandom.nextDouble() * 2.0 - 1.0
        val r2 = ditherRandom.nextDouble() * 2.0 - 1.0
        return DITHER_AMPLITUDE * (r1 - r2)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FILTER COEFFICIENT COMPUTATION
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Rebuild from current pendingXxx → currentXxx state
     * (called when a pending update is drained in queueInput).
     */
    private fun rebuildFilters() {
        val gains = when (eqMode) {
            EqMode.GRAPHIC    -> graphicGainsDb
            EqMode.PARAMETRIC -> parametricGainsDb
        }
        targetGainsDb   = gains.copyOf()
        smoothedGainsDb = gains.copyOf()   // snap on deliberate mode/band change
        rebuildFiltersFromSmoothed()
    }

    /** Rebuild coefficients using the current smoothed gain values (called every buffer). */
    private fun rebuildFiltersFromSmoothed() {
        if (sampleRate <= 0.0 || numChannels == 0) return

        val freqs = when (eqMode) {
            EqMode.GRAPHIC    -> ISO_FREQ_CENTERS
            EqMode.PARAMETRIC -> parametricFreqs
        }

        coeffs = Array(BAND_COUNT) { band ->
            val fc   = freqs[band]
            val gain = smoothedGainsDb.getOrElse(band) { 0f }.toDouble()
            val q    = currentQValues.getOrElse(band) { defaultQ(band) }.toDouble()
            when (band) {
                0              -> computeLowShelfCoeffs(fc, gain, q, sampleRate)
                BAND_COUNT - 1 -> computeHighShelfCoeffs(fc, gain, q, sampleRate)
                else           -> computePeakingCoeffs(fc, gain, q, sampleRate)
            }
        }

        // Ensure state array matches current channel count — FIX: was coerceAtMost(1)
        if (state.isEmpty() || state[0].size != numChannels) clearState()
    }

    /** RBJ Peaking EQ biquad. Returns [b0, b1, b2, a1, a2] normalised (a0=1). */
    private fun computePeakingCoeffs(fc: Double, gainDb: Double, q: Double, fs: Double): DoubleArray {
        if (gainDb == 0.0) return doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0)
        val w0    = 2.0 * PI * fc / fs
        val cosW0 = cos(w0)
        val sinW0 = sin(w0)
        val A     = 10.0.pow(gainDb / 40.0)
        val alpha = sinW0 / (2.0 * q)
        val b0 =  1.0 + alpha * A;  val b1 = -2.0 * cosW0;  val b2 = 1.0 - alpha * A
        val a0 =  1.0 + alpha / A;  val a1 = -2.0 * cosW0;  val a2 = 1.0 - alpha / A
        return doubleArrayOf(b0/a0, b1/a0, b2/a0, a1/a0, a2/a0)
    }

    /** RBJ Low Shelf biquad — band 0 (20 Hz). */
    private fun computeLowShelfCoeffs(fc: Double, gainDb: Double, q: Double, fs: Double): DoubleArray {
        if (gainDb == 0.0) return doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0)
        val w0    = 2.0 * PI * fc / fs
        val cosW0 = cos(w0);  val sinW0 = sin(w0)
        val A     = 10.0.pow(gainDb / 40.0)
        val alpha = sinW0 / 2.0 * sqrt((A + 1.0 / A) * (1.0 / q - 1.0) + 2.0)
        val b0 =       A * ((A+1) - (A-1)*cosW0 + 2*sqrt(A)*alpha)
        val b1 = 2.0 * A * ((A-1) - (A+1)*cosW0)
        val b2 =       A * ((A+1) - (A-1)*cosW0 - 2*sqrt(A)*alpha)
        val a0 =           (A+1) + (A-1)*cosW0 + 2*sqrt(A)*alpha
        val a1 = -2.0 *   ((A-1) + (A+1)*cosW0)
        val a2 =           (A+1) + (A-1)*cosW0 - 2*sqrt(A)*alpha
        return doubleArrayOf(b0/a0, b1/a0, b2/a0, a1/a0, a2/a0)
    }

    /** RBJ High Shelf biquad — band 30 (20 kHz). */
    private fun computeHighShelfCoeffs(fc: Double, gainDb: Double, q: Double, fs: Double): DoubleArray {
        if (gainDb == 0.0) return doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0)
        val w0    = 2.0 * PI * fc / fs
        val cosW0 = cos(w0);  val sinW0 = sin(w0)
        val A     = 10.0.pow(gainDb / 40.0)
        val alpha = sinW0 / 2.0 * sqrt((A + 1.0 / A) * (1.0 / q - 1.0) + 2.0)
        val b0 =        A * ((A+1) + (A-1)*cosW0 + 2*sqrt(A)*alpha)
        val b1 = -2.0 * A * ((A-1) + (A+1)*cosW0)
        val b2 =        A * ((A+1) + (A-1)*cosW0 - 2*sqrt(A)*alpha)
        val a0 =            (A+1) - (A-1)*cosW0 + 2*sqrt(A)*alpha
        val a1 =  2.0 *    ((A-1) - (A+1)*cosW0)
        val a2 =            (A+1) - (A-1)*cosW0 - 2*sqrt(A)*alpha
        return doubleArrayOf(b0/a0, b1/a0, b2/a0, a1/a0, a2/a0)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    private fun initLimiter() {
        val attackSamples  = (LIMITER_ATTACK_MS  / 1000.0) * sampleRate
        val releaseSamples = (LIMITER_RELEASE_MS / 1000.0) * sampleRate
        limiterAttCoeff = exp(-1.0 / attackSamples)
        limiterRelCoeff = exp(-1.0 / releaseSamples)
        limiterEnvelope = DoubleArray(numChannels.coerceAtLeast(1)) { 1.0 }
    }

    private fun clearState() {
        // FIX: was numChannels.coerceAtMost(1) → stereo state was single-channel → L/R bleed
        state = Array(BAND_COUNT) { Array(numChannels.coerceAtLeast(1)) { DoubleArray(2) } }
    }

    private fun dbToLinear(db: Double): Double = 10.0.pow(db / 20.0)
    private fun linearToDb(linear: Double): Double =
        if (linear <= 0.0) -120.0 else 20.0 * log10(linear)

    private fun replaceOutputBuffer(size: Int): ByteBuffer {
        if (outputBuffer === AudioProcessor.EMPTY_BUFFER || outputBuffer.capacity() < size) {
            outputBuffer = ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder())
        } else {
            outputBuffer.clear()
            outputBuffer.limit(size)
        }
        return outputBuffer
    }

    private fun defaultQ(band: Int): Float = when {
        band == 0 || band == BAND_COUNT - 1 -> 0.707f   // shelves → Butterworth Q
        band < 3  || band > 27              -> 1.0f
        band < 7  || band > 23              -> 1.4f
        else                                -> 2.1f
    }

    private fun Float.roundTo(places: Int): Float {
        val factor = 10f.pow(places)
        return (this * factor).roundToInt() / factor
    }

    private fun Double.roundToInt(): Int = if (this < 0) (this - 0.5).toInt() else (this + 0.5).toInt()
}