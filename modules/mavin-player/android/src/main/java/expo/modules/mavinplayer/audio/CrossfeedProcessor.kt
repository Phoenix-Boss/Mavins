package expo.modules.autoeqengine

import android.util.Log
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.PI

/**
 * CrossfeedProcessor - Bauer stereophonic-to-binaural crossfeed
 *
 * Reduces ear fatigue from headphone listening by mixing a low-passed,
 * time-delayed copy of each channel into the opposite channel — simulating
 * the natural crosstalk of loudspeaker listening.
 *
 * Algorithm: classic BS2B (Bauer Stereophonic-to-Binaural) biquad shelf + delay.
 * - Low-shelf filter on the cross-feed path (~700 Hz cutoff, -6 dB shelf gain)
 * - Short inter-aural delay (default ~0.3 ms)
 * - Configurable feed level (FEED_MIN_DB..FEED_MAX_DB on cross path)
 * - Stereo only; non-stereo formats are passed through unchanged
 */
class CrossfeedProcessor : AudioProcessor {

    companion object {
        private const val TAG = "CrossfeedProcessor"
        private const val DENORMAL_THRESHOLD = 1e-30

        // Default BS2B "High" preset
        const val DEFAULT_FEED_DB   = -6.0   // attenuation of cross-feed path
        const val DEFAULT_CUTOFF_HZ = 700.0  // low-shelf cutoff frequency
        const val DEFAULT_DELAY_MS  = 0.3    // inter-aural time delay

        const val FEED_MIN_DB   = -20.0
        const val FEED_MAX_DB   =   0.0
        const val CUTOFF_MIN_HZ =  300.0
        const val CUTOFF_MAX_HZ = 2000.0
        const val DELAY_MIN_MS  =   0.1
        const val DELAY_MAX_MS  =   1.0

        private const val ENCODING_PCM_32BIT = 0x00000004
    }

    // ── Parameters ─────────────────────────────────────────────────────────────
    @Volatile private var feedDb    = DEFAULT_FEED_DB
    @Volatile private var cutoffHz  = DEFAULT_CUTOFF_HZ
    @Volatile private var delayMs   = DEFAULT_DELAY_MS
    @Volatile private var isEnabled = true

    // ── Derived coefficients (rebuilt on configure / param change) ─────────────
    private var feedLinear   = 0.0        // linear gain of cross path
    private var delaySamples = 0          // delay line length in samples

    // Low-shelf biquad coefficients [b0, b1, b2, a1, a2] for the cross path
    private var shelfCoeffs = DoubleArray(5) { if (it == 0) 1.0 else 0.0 }

    // Biquad state per channel: shelfState[ch] = [s0, s1]
    private var shelfState = Array(2) { DoubleArray(2) }

    // Circular delay lines, one per channel
    private var delayBufL    = DoubleArray(1)
    private var delayBufR    = DoubleArray(1)
    private var delayWritePos = 0

    // ── AudioProcessor state ───────────────────────────────────────────────────
    private var numChannels   = 0
    private var sampleRate    = 48000.0
    private var inputAudioFormat:  AudioFormat = AudioFormat.NOT_SET
    private var outputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var outputBuffer: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var inputEnded = false

    // ── Public API ─────────────────────────────────────────────────────────────

    fun setEnabled(enabled: Boolean) { isEnabled = enabled }
    fun isEnabled(): Boolean = isEnabled

    fun setFeedDb(db: Double) {
        feedDb     = db.coerceIn(FEED_MIN_DB, FEED_MAX_DB)
        feedLinear = dbToLinear(feedDb)
    }

    fun setCutoffHz(hz: Double) {
        cutoffHz = hz.coerceIn(CUTOFF_MIN_HZ, CUTOFF_MAX_HZ)
        if (sampleRate > 0.0) rebuildCoeffs()
    }

    fun setDelayMs(ms: Double) {
        delayMs = ms.coerceIn(DELAY_MIN_MS, DELAY_MAX_MS)
        if (sampleRate > 0.0) rebuildDelay()
    }

    fun getFeedDb():   Double = feedDb
    fun getCutoffHz(): Double = cutoffHz
    fun getDelayMs():  Double = delayMs

    // ── AudioProcessor interface ───────────────────────────────────────────────

    override fun configure(inputAudioFormat: AudioFormat): AudioFormat {
        val enc       = inputAudioFormat.encoding
        val supported = enc == android.media.AudioFormat.ENCODING_PCM_16BIT ||
                        enc == android.media.AudioFormat.ENCODING_PCM_FLOAT ||
                        enc == ENCODING_PCM_32BIT

        if (!supported || inputAudioFormat.channelCount != 2) {
            // Only process stereo; pass everything else through unchanged
            this.inputAudioFormat  = AudioFormat.NOT_SET
            this.outputAudioFormat = AudioFormat.NOT_SET
            return AudioFormat.NOT_SET
        }

        this.inputAudioFormat  = inputAudioFormat
        this.outputAudioFormat = inputAudioFormat
        sampleRate  = inputAudioFormat.sampleRate.toDouble()
        numChannels = inputAudioFormat.channelCount

        feedLinear = dbToLinear(feedDb)
        rebuildCoeffs()
        rebuildDelay()
        clearState()

        Log.d(TAG, "configure: ${inputAudioFormat.sampleRate}Hz stereo " +
                "feed=${feedDb}dB cutoff=${cutoffHz}Hz delay=${delayMs}ms")
        return outputAudioFormat
    }

    override fun isActive(): Boolean =
        inputAudioFormat != AudioFormat.NOT_SET && isEnabled && numChannels == 2

    override fun queueInput(inputBuffer: ByteBuffer) {
        if (!isEnabled || inputBuffer.remaining() == 0) {
            outputBuffer = inputBuffer
            return
        }

        val output = replaceOutputBuffer(inputBuffer.remaining())

        when (inputAudioFormat.encoding) {
            android.media.AudioFormat.ENCODING_PCM_16BIT -> processShort(inputBuffer, output)
            android.media.AudioFormat.ENCODING_PCM_FLOAT -> processFloat(inputBuffer, output)
            ENCODING_PCM_32BIT                           -> processInt32(inputBuffer, output)
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
    }

    override fun reset() {
        flush()
        inputAudioFormat  = AudioFormat.NOT_SET
        outputAudioFormat = AudioFormat.NOT_SET
        feedDb    = DEFAULT_FEED_DB
        cutoffHz  = DEFAULT_CUTOFF_HZ
        delayMs   = DEFAULT_DELAY_MS
        feedLinear = dbToLinear(feedDb)
    }

    // ── PCM processing ─────────────────────────────────────────────────────────

    private fun processShort(input: ByteBuffer, output: ByteBuffer) {
        while (input.remaining() >= 4) {         // 2 ch × 2 bytes
            val l = input.short.toDouble() / 32768.0
            val r = input.short.toDouble() / 32768.0
            val (ol, or_) = processStereoSample(l, r)
            output.putShort((ol * 32768.0).coerceIn(-32768.0, 32767.0).toInt().toShort())
            output.putShort((or_ * 32768.0).coerceIn(-32768.0, 32767.0).toInt().toShort())
        }
    }

    private fun processFloat(input: ByteBuffer, output: ByteBuffer) {
        while (input.remaining() >= 8) {         // 2 ch × 4 bytes
            val l = input.float.toDouble()
            val r = input.float.toDouble()
            val (ol, or_) = processStereoSample(l, r)
            output.putFloat(ol.toFloat())
            output.putFloat(or_.toFloat())
        }
    }

    private fun processInt32(input: ByteBuffer, output: ByteBuffer) {
        while (input.remaining() >= 8) {         // 2 ch × 4 bytes
            val l = input.int.toDouble() / 2147483648.0
            val r = input.int.toDouble() / 2147483648.0
            val (ol, or_) = processStereoSample(l, r)
            output.putInt((ol * 2147483648.0).coerceIn(-2147483648.0, 2147483647.0).toLong().toInt())
            output.putInt((or_ * 2147483648.0).coerceIn(-2147483648.0, 2147483647.0).toLong().toInt())
        }
    }

    // ── Core crossfeed DSP ─────────────────────────────────────────────────────

    /**
     * For each stereo pair:
     *   1. Run each channel through the low-shelf biquad (shapes the cross path)
     *   2. Write shaped signal into circular delay lines
     *   3. Read delayed signal from [delaySamples] behind the write head
     *   4. Mix feedLinear × delayed_opposite into each output channel
     */
    private fun processStereoSample(l: Double, r: Double): Pair<Double, Double> {
        // Low-shelf filter on both channels (cross path shaping)
        val filtL = applyShelf(l, 0)
        val filtR = applyShelf(r, 1)

        // Write into delay lines
        val delayLen = delayBufL.size
        delayBufL[delayWritePos] = filtL
        delayBufR[delayWritePos] = filtR

        // Read delayed signal
        val readPos = (delayWritePos - delaySamples + delayLen) % delayLen
        val delayedL = delayBufL[readPos]
        val delayedR = delayBufR[readPos]

        delayWritePos = (delayWritePos + 1) % delayLen

        // Mix: direct signal + attenuated filtered/delayed opposite channel
        val outL = l + feedLinear * delayedR
        val outR = r + feedLinear * delayedL

        return Pair(outL, outR)
    }

    private fun applyShelf(x: Double, ch: Int): Double {
        val s = shelfState[ch]
        val c = shelfCoeffs
        val y = c[0] * x + s[0]
        s[0] = c[1] * x - c[3] * y + s[1]
        s[1] = c[2] * x - c[4] * y
        if (abs(s[0]) < DENORMAL_THRESHOLD) s[0] = 0.0
        if (abs(s[1]) < DENORMAL_THRESHOLD) s[1] = 0.0
        return y
    }

    // ── Coefficient builders ───────────────────────────────────────────────────

    /**
     * Low-shelf at [cutoffHz] with –6 dB shelf gain (RBJ Audio EQ Cookbook formula).
     * This shapes the cross-feed path so only low frequencies cross over, which
     * matches how sound naturally wraps around the head at low frequencies.
     */
    private fun rebuildCoeffs() {
        val gainDb = -6.0
        val A      = 10.0.pow(gainDb / 40.0)
        val w0     = 2.0 * PI * cutoffHz / sampleRate
        val cosW0  = kotlin.math.cos(w0)
        val sinW0  = kotlin.math.sin(w0)
        val S      = 1.0   // shelf slope = 1 (maximally steep)
        val al     = sinW0 / 2.0 * kotlin.math.sqrt((A + 1.0 / A) * (1.0 / S - 1.0) + 2.0)
        val sqrtA  = kotlin.math.sqrt(A)

        val b0 =      A * ((A + 1) - (A - 1) * cosW0 + 2 * sqrtA * al)
        val b1 =  2 * A * ((A - 1) - (A + 1) * cosW0)
        val b2 =      A * ((A + 1) - (A - 1) * cosW0 - 2 * sqrtA * al)
        val a0 =           (A + 1) + (A - 1) * cosW0 + 2 * sqrtA * al
        val a1 =     -2 * ((A - 1) + (A + 1) * cosW0)
        val a2 =           (A + 1) + (A - 1) * cosW0 - 2 * sqrtA * al

        shelfCoeffs = doubleArrayOf(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    private fun rebuildDelay() {
        delaySamples  = ((delayMs / 1000.0) * sampleRate).toInt().coerceAtLeast(1)
        val bufLen    = (delaySamples + 2).coerceAtLeast(8)
        delayBufL     = DoubleArray(bufLen)
        delayBufR     = DoubleArray(bufLen)
        delayWritePos = 0
    }

    private fun clearState() {
        shelfState    = Array(2) { DoubleArray(2) }
        delayBufL.fill(0.0)
        delayBufR.fill(0.0)
        delayWritePos = 0
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private fun dbToLinear(db: Double): Double = 10.0.pow(db / 20.0)

    private fun replaceOutputBuffer(size: Int): ByteBuffer {
        return if (outputBuffer === AudioProcessor.EMPTY_BUFFER || outputBuffer.capacity() < size) {
            ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder()).also { outputBuffer = it }
        } else {
            outputBuffer.clear().limit(size); outputBuffer
        }
    }
}