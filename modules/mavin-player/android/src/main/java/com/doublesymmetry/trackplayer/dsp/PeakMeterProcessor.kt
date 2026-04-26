package com.doublesymmetry.trackplayer.dsp

import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.exp

/**
 * PeakMeterProcessor - Audio peak level metering with hold and release.
 *
 * Measures per-channel peak levels from the audio stream in real-time.
 * Supports:
 *  - Current peaks (instantaneous envelope)
 *  - Held peaks (held for [peakHoldMs] ms before releasing)
 *  - Configurable release time
 *  - Callback for UI updates
 */
@androidx.media3.common.util.UnstableApi
class PeakMeterProcessor : AudioProcessor {

    companion object {
        private const val DEFAULT_PEAK_HOLD_MS = 1500.0
        private const val DEFAULT_RELEASE_MS   = 300.0
        private const val MAX_CHANNELS = 8
        const val ENCODING_PCM_32BIT = 0x00000004
    }

    // â”€â”€ Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Volatile private var peakHoldMs  = DEFAULT_PEAK_HOLD_MS
    @Volatile private var releaseMs   = DEFAULT_RELEASE_MS

    // â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private var sampleRate   = 48000
    private var numChannels  = 2
    private var inputAudioFormat:  AudioFormat = AudioFormat.NOT_SET
    private var outputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var outputBuffer: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var inputEnded = false

    /** Instantaneous peak envelope per channel (0..1). */
    private var currentPeaks = FloatArray(MAX_CHANNELS)

    /** Held peak values per channel (0..1). */
    private var heldPeaks = FloatArray(MAX_CHANNELS)

    /** Remaining hold time in samples per channel. */
    private var holdSamplesRemaining = LongArray(MAX_CHANNELS)

    /** Per-sample release coefficient (computed from releaseMs). */
    private var releaseCoeff = 0f

    /** Samples per channel to hold peak before releasing. */
    private var holdSamples = 0L

    /** Optional callback invoked (from audio thread) with current peaks after each buffer. */
    private var peakCallback: ((FloatArray) -> Unit)? = null

    private val _isEnabled = AtomicBoolean(true)
    var isEnabled: Boolean
        get() = _isEnabled.get()
        set(value) = _isEnabled.set(value)

    // â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /** Set callback invoked on the audio thread after each buffer with current peak values. */
    fun setPeakCallback(cb: (FloatArray) -> Unit) {
        peakCallback = cb
    }

    fun setPeakHoldMs(ms: Double) {
        peakHoldMs = ms.coerceAtLeast(0.0)
        updateCoefficients()
    }

    fun setReleaseMs(ms: Double) {
        releaseMs = ms.coerceAtLeast(1.0)
        updateCoefficients()
    }

    /** Returns a snapshot of the current (instantaneous) peak per channel. */
    fun getCurrentPeaks(): FloatArray = currentPeaks.copyOf(numChannels)

    /** Returns a snapshot of the held peak per channel. */
    fun getHeldPeaks(): FloatArray = heldPeaks.copyOf(numChannels)

    /** Reset all peak meters to zero. */
    fun resetPeaks() {
        currentPeaks.fill(0f)
        heldPeaks.fill(0f)
        holdSamplesRemaining.fill(0L)
    }

    // â”€â”€ AudioProcessor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        sampleRate   = inputAudioFormat.sampleRate
        numChannels  = inputAudioFormat.channelCount.coerceIn(1, MAX_CHANNELS)

        updateCoefficients()
        resetPeaks()

        return outputAudioFormat
    }

    override fun isActive(): Boolean =
        inputAudioFormat != AudioFormat.NOT_SET && _isEnabled.get()

    override fun queueInput(inputBuffer: ByteBuffer) {
        if (inputBuffer.remaining() == 0) {
            outputBuffer = inputBuffer
            return
        }

        // Pass audio through unchanged; we only observe it.
        val output = replaceOutputBuffer(inputBuffer.remaining())

        val startPos = inputBuffer.position()
        measurePeaks(inputBuffer)

        // Reset position and copy to output.
        inputBuffer.position(startPos)
        output.put(inputBuffer)
        output.flip()
        outputBuffer = output

        peakCallback?.invoke(getCurrentPeaks())
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
        inputEnded = false
        outputBuffer = AudioProcessor.EMPTY_BUFFER
    }

    override fun reset() {
        flush()
        inputAudioFormat  = AudioFormat.NOT_SET
        outputAudioFormat = AudioFormat.NOT_SET
        resetPeaks()
    }

    // â”€â”€ Internal helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private fun updateCoefficients() {
        val sr = sampleRate.toDouble()
        holdSamples = ((peakHoldMs / 1000.0) * sr).toLong().coerceAtLeast(0L)
        releaseCoeff = if (releaseMs > 0) {
            exp(-1.0 / (releaseMs / 1000.0 * sr)).toFloat()
        } else {
            0f
        }
    }

    /** Read through the buffer measuring peaks without consuming it permanently. */
    private fun measurePeaks(buf: ByteBuffer) {
        val enc = inputAudioFormat.encoding
        val bytesPerSample = when (enc) {
            android.media.AudioFormat.ENCODING_PCM_16BIT -> 2
            else -> 4 // float or int32
        }
        val bytesPerFrame = bytesPerSample * numChannels
        val frameCount    = buf.remaining() / bytesPerFrame

        repeat(frameCount) {
            for (ch in 0 until numChannels) {
                val sample = when (enc) {
                    android.media.AudioFormat.ENCODING_PCM_16BIT ->
                        abs(buf.short.toFloat() / 32768f)
                    android.media.AudioFormat.ENCODING_PCM_FLOAT ->
                        abs(buf.float)
                    else -> // PCM_32BIT
                        abs(buf.int.toFloat() / 2147483648f)
                }

                // Attack: instant, Release: exponential decay
                if (sample >= currentPeaks[ch]) {
                    currentPeaks[ch] = sample
                } else {
                    currentPeaks[ch] = currentPeaks[ch] * releaseCoeff
                }

                // Held peak
                if (sample >= heldPeaks[ch]) {
                    heldPeaks[ch] = sample
                    holdSamplesRemaining[ch] = holdSamples
                } else if (holdSamplesRemaining[ch] > 0) {
                    holdSamplesRemaining[ch]--
                } else {
                    heldPeaks[ch] = heldPeaks[ch] * releaseCoeff
                }
            }
        }
    }

    private fun replaceOutputBuffer(size: Int): ByteBuffer {
        return if (outputBuffer === AudioProcessor.EMPTY_BUFFER || outputBuffer.capacity() < size) {
            ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder()).also { outputBuffer = it }
        } else {
            outputBuffer.clear()
            outputBuffer
        }
    }
}
