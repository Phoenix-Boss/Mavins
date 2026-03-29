package expo.modules.mavinplayer.audio

import android.util.Log
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.*

/**
 * EqualizerProcessor — 31-band RBJ biquad IIR EQ
 *
 * Implements ExoPlayer's AudioProcessor interface so it runs INSIDE the
 * audio pipeline between the decoder and AudioTrack. This is the correct
 * DSP injection point — no session ID hacks, no DynamicsProcessing bridge,
 * no reflection. Pure PCM processing on the audio thread.
 *
 * Thread safety:
 *   - Band gains are updated from JS (main thread) via pendingGains AtomicReference
 *   - Applied on the next queueInput() call (audio thread) with getAndSet(null)
 *   - No locks on the hot path — lock-free via AtomicReference swap
 *
 * Supported formats: PCM_16BIT and PCM_FLOAT (both stereo and mono)
 */
@androidx.media3.common.util.UnstableApi
class EqualizerProcessor : AudioProcessor {

    companion object {
        private const val TAG = "EqualizerProcessor"

        // ISO 1/3-octave center frequencies
        val ISO_FREQ_CENTERS = doubleArrayOf(
            20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0,
            200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0,
            2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0, 12500.0, 16000.0, 20000.0
        )

        const val BAND_COUNT = 31
        const val GAIN_MIN_DB = -15.0
        const val GAIN_MAX_DB = 15.0
    }

    // ── Public state ──────────────────────────────────────────────────────────
    @Volatile var isEnabled: Boolean = true

    // ── Pending update — lock-free swap on audio thread ───────────────────────
    // FloatArray(BAND_COUNT) in dB; null means no update pending
    private val pendingGains = AtomicReference<FloatArray?>(null)

    // ── Current biquad coefficients, one filter per band per channel ──────────
    // Each filter: [b0, b1, b2, a1, a2] (a0 normalised to 1.0)
    // State:       [x1, x2, y1, y2]  (direct form II transposed)
    private var numBands: Int = 0
    private var numChannels: Int = 0
    private var sampleRate: Double = 48000.0

    // coeffs[band][0..4]: b0 b1 b2 a1 a2
    private var coeffs: Array<DoubleArray> = emptyArray()
    // state[band][ch][0..3]: x1 x2 y1 y2
    private var state: Array<Array<DoubleArray>> = emptyArray()
    // gains[band] in dB
    private var currentGainsDb = FloatArray(BAND_COUNT) { 0f }

    // ── AudioProcessor format negotiation ────────────────────────────────────
    private var inputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var outputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var outputBuffer: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var inputEnded: Boolean = false

    // ── Public API (called from MavinPlayerModule, any thread) ───────────────

    /** Update a single band gain in dB. Thread-safe via pendingGains swap. */
    fun setBandGain(band: Int, gainDb: Float) {
        if (band !in 0 until BAND_COUNT) return
        val clamped = gainDb.coerceIn(GAIN_MIN_DB.toFloat(), GAIN_MAX_DB.toFloat())
        val next = pendingGains.get()?.copyOf() ?: currentGainsDb.copyOf()
        next[band] = clamped
        pendingGains.set(next)
    }

    /** Apply all 31 band gains at once. Thread-safe. */
    fun applyBands(gainsDb: FloatArray) {
        val clamped = FloatArray(BAND_COUNT) {
            gainsDb.getOrElse(it) { 0f }.coerceIn(GAIN_MIN_DB.toFloat(), GAIN_MAX_DB.toFloat())
        }
        pendingGains.set(clamped)
    }

    /** Reset all bands to 0 dB. Thread-safe. */
    fun reset() {
        pendingGains.set(FloatArray(BAND_COUNT) { 0f })
    }

    // ── AudioProcessor interface ──────────────────────────────────────────────

    override fun configure(inputAudioFormat: AudioFormat): AudioFormat {
        // We only handle PCM_16BIT and PCM_FLOAT — pass anything else through unchanged
        if (inputAudioFormat.encoding != android.media.AudioFormat.ENCODING_PCM_16BIT &&
            inputAudioFormat.encoding != android.media.AudioFormat.ENCODING_PCM_FLOAT) {
            this.inputAudioFormat = AudioFormat.NOT_SET
            this.outputAudioFormat = AudioFormat.NOT_SET
            return AudioFormat.NOT_SET
        }

        this.inputAudioFormat = inputAudioFormat
        this.outputAudioFormat = inputAudioFormat // passthrough format

        sampleRate = inputAudioFormat.sampleRate.toDouble()
        numChannels = inputAudioFormat.channelCount
        numBands = BAND_COUNT

        rebuildFilters(currentGainsDb)
        Log.i(TAG, "configure: ${inputAudioFormat.sampleRate}Hz ${inputAudioFormat.channelCount}ch enc=${inputAudioFormat.encoding}")

        return outputAudioFormat
    }

    override fun isActive(): Boolean = inputAudioFormat != AudioFormat.NOT_SET

    override fun queueInput(inputBuffer: ByteBuffer) {
        // Apply any pending gain update from JS thread
        pendingGains.getAndSet(null)?.let { newGains ->
            rebuildFilters(newGains)
            currentGainsDb = newGains
        }

        if (!isEnabled || inputBuffer.remaining() == 0) {
            outputBuffer = inputBuffer
            return
        }

        val output = replaceOutputBuffer(inputBuffer.remaining())

        when (inputAudioFormat.encoding) {
            android.media.AudioFormat.ENCODING_PCM_16BIT -> processShort(inputBuffer, output)
            android.media.AudioFormat.ENCODING_PCM_FLOAT -> processFloat(inputBuffer, output)
        }

        inputBuffer.position(inputBuffer.limit())
        output.flip()
        outputBuffer = output
    }

    override fun queueEndOfStream() {
        inputEnded = true
    }

    override fun getOutput(): ByteBuffer {
        val out = outputBuffer
        outputBuffer = AudioProcessor.EMPTY_BUFFER
        return out
    }

    override fun isEnded(): Boolean = inputEnded && outputBuffer === AudioProcessor.EMPTY_BUFFER

    override fun flush() {
        outputBuffer = AudioProcessor.EMPTY_BUFFER
        inputEnded = false
        clearState()
    }

    override fun reset() {
        flush()
        inputAudioFormat = AudioFormat.NOT_SET
        outputAudioFormat = AudioFormat.NOT_SET
        coeffs = emptyArray()
        state = emptyArray()
        currentGainsDb = FloatArray(BAND_COUNT) { 0f }
    }

    // ── PCM processing ────────────────────────────────────────────────────────

    private fun processShort(input: ByteBuffer, output: ByteBuffer) {
        while (input.remaining() >= 2) {
            val ch = ((input.position() / 2) % numChannels)
            val sample = input.short.toDouble() / 32768.0
            val processed = applyFilters(sample, ch)
            val clamped = (processed * 32768.0).coerceIn(-32768.0, 32767.0).toInt().toShort()
            output.putShort(clamped)
        }
    }

    private fun processFloat(input: ByteBuffer, output: ByteBuffer) {
        val floatIn = input.asFloatBuffer()
        val floatOut = output.asFloatBuffer()
        var sampleIndex = 0
        while (floatIn.hasRemaining()) {
            val ch = sampleIndex % numChannels
            val sample = floatIn.get().toDouble()
            val processed = applyFilters(sample, ch)
            floatOut.put(processed.toFloat())
            sampleIndex++
        }
        output.limit(output.capacity())
    }

    /** Apply all 31 biquad filters in series for one sample on one channel */
    private fun applyFilters(input: Double, ch: Int): Double {
        var x = input
        for (band in 0 until numBands) {
            val c = coeffs[band]
            val s = state[band][ch]
            // Direct form II transposed
            val y = c[0] * x + s[0]
            s[0] = c[1] * x - c[3] * y + s[1]
            s[1] = c[2] * x - c[4] * y
            x = y
        }
        return x
    }

    // ── Filter coefficient computation (RBJ peaking EQ) ──────────────────────

    private fun rebuildFilters(gainsDb: FloatArray) {
        if (sampleRate <= 0.0 || numChannels == 0) return

        coeffs = Array(BAND_COUNT) { band ->
            computePeakingCoeffs(
                fc     = ISO_FREQ_CENTERS[band],
                gainDb = gainsDb.getOrElse(band) { 0f }.toDouble(),
                q      = getBandQ(band),
                fs     = sampleRate
            )
        }

        // Keep state arrays sized correctly; clear if channels changed
        if (state.isEmpty() || state[0].size != numChannels) {
            clearState()
        }
        Log.v(TAG, "rebuildFilters: ${BAND_COUNT} bands @ ${sampleRate}Hz")
    }

    private fun clearState() {
        state = Array(BAND_COUNT) { Array(numChannels.coerceAtLeast(1)) { DoubleArray(2) } }
    }

    /**
     * RBJ Peaking EQ biquad coefficients (normalised, a0=1).
     * Returns [b0, b1, b2, a1, a2]
     */
    private fun computePeakingCoeffs(fc: Double, gainDb: Double, q: Double, fs: Double): DoubleArray {
        if (gainDb == 0.0) {
            // Identity filter — faster than computing unity-gain coefficients
            return doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0)
        }

        val w0    = 2.0 * PI * fc / fs
        val cosW0 = cos(w0)
        val sinW0 = sin(w0)
        val A     = 10.0.pow(gainDb / 40.0)
        val alpha = sinW0 / (2.0 * q)

        val b0 = 1.0 + alpha * A
        val b1 = -2.0 * cosW0
        val b2 = 1.0 - alpha * A
        val a0 = 1.0 + alpha / A
        val a1 = -2.0 * cosW0
        val a2 = 1.0 - alpha / A

        return doubleArrayOf(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /**
     * Q factor per band — wider Q in low/high extremes where bands overlap more,
     * tighter in the midrange. Matches typical 31-band hardware EQ behaviour.
     */
    private fun getBandQ(band: Int): Double = when {
        band < 3 || band > 27 -> 1.0   // extreme lows/highs — wider
        band < 7 || band > 23 -> 1.4   // sub-bass / high treble
        else                  -> 2.1   // midrange — tight Q
    }

    private fun replaceOutputBuffer(size: Int): ByteBuffer {
        val buf = ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder())
        outputBuffer = buf
        return buf
    }
}