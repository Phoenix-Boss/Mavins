package expo.modules.autoeqengine

import androidx.media3.common.audio.AudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * CrossfeedProcessor - Bauer Stereophonic-to-Binaural (BS2B)
 * 
 * Simulates speaker listening experience on headphones by mixing some
 * of the left channel into the right (and vice versa) with frequency-dependent
 * filtering that mimics natural head-related transfer function (HRTF).
 * 
 * Reduces ear fatigue and improves stereo imaging for long listening sessions.
 * 
 * Parameters:
 * - crossfeedStrength: 0.0 to 1.0 (default 0.5) - how much crossfeed to apply
 * - cutoffFrequency: 400-2000 Hz (default 700 Hz) - low-pass filter cutoff for crossfeed path
 */
class CrossfeedProcessor : AudioProcessor {
    
    companion object {
        private const val TAG = "CrossfeedProcessor"
        private const val DENORMAL_THRESHOLD = 1e-30
        
        const val DEFAULT_STRENGTH = 0.5f
        const val DEFAULT_CUTOFF_HZ = 700.0
        const val STRENGTH_MIN = 0.0f
        const val STRENGTH_MAX = 1.0f
        const val CUTOFF_MIN_HZ = 400.0
        const val CUTOFF_MAX_HZ = 2000.0
    }
    
    // Lock-free parameters
    @Volatile
    private var crossfeedStrength = DEFAULT_STRENGTH
    @Volatile
    private var cutoffHz = DEFAULT_CUTOFF_HZ
    @Volatile
    private var isEnabled = true
    
    // Filter state per channel
    private data class BiquadState(var x1: Double = 0.0, var x2: Double = 0.0, 
                                   var y1: Double = 0.0, var y2: Double = 0.0)
    
    private val leftState = BiquadState()
    private val rightState = BiquadState()
    
    // Biquad coefficients
    private var b0 = 1.0
    private var b1 = 0.0
    private var b2 = 0.0
    private var a1 = 0.0
    private var a2 = 0.0
    
    // State
    private var numChannels = 0
    private var sampleRate = 48000.0
    private var inputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var outputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var outputBuffer: ByteBuffer = EMPTY_BUFFER
    private var inputEnded = false
    
    init {
        updateFilter()
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────
    
    fun setEnabled(enabled: Boolean) { isEnabled = enabled }
    fun isEnabled(): Boolean = isEnabled
    
    fun setStrength(strength: Float) {
        crossfeedStrength = strength.coerceIn(STRENGTH_MIN, STRENGTH_MAX)
    }
    
    fun setCutoffFrequency(hz: Double) {
        cutoffHz = hz.coerceIn(CUTOFF_MIN_HZ, CUTOFF_MAX_HZ)
        updateFilter()
    }
    
    fun getStrength(): Float = crossfeedStrength
    fun getCutoffFrequency(): Double = cutoffHz
    
    // ─────────────────────────────────────────────────────────────────────────
    // AudioProcessor INTERFACE
    // ─────────────────────────────────────────────────────────────────────────
    
    override fun configure(inputAudioFormat: AudioFormat): AudioFormat {
        val enc = inputAudioFormat.encoding
        val supported = enc == android.media.AudioFormat.ENCODING_PCM_16BIT ||
                        enc == android.media.AudioFormat.ENCODING_PCM_FLOAT ||
                        enc == ENCODING_PCM_32BIT
        
        if (!supported || inputAudioFormat.channelCount != 2) {
            this.inputAudioFormat = AudioFormat.NOT_SET
            this.outputAudioFormat = AudioFormat.NOT_SET
            return AudioFormat.NOT_SET
        }
        
        this.inputAudioFormat = inputAudioFormat
        this.outputAudioFormat = inputAudioFormat
        sampleRate = inputAudioFormat.sampleRate.toDouble()
        numChannels = inputAudioFormat.channelCount
        
        updateFilter()
        resetState()
        
        Log.d(TAG, "configure: ${sampleRate}Hz strength=${crossfeedStrength} cutoff=${cutoffHz}Hz")
        return outputAudioFormat
    }
    
    override fun isActive(): Boolean = inputAudioFormat != AudioFormat.NOT_SET && isEnabled && numChannels == 2
    
    override fun queueInput(inputBuffer: ByteBuffer) {
        if (!isEnabled || inputBuffer.remaining() == 0 || numChannels != 2) {
            outputBuffer = inputBuffer
            return
        }
        
        val output = replaceOutputBuffer(inputBuffer.remaining())
        
        when (inputAudioFormat.encoding) {
            android.media.AudioFormat.ENCODING_PCM_16BIT -> processShortStereo(inputBuffer, output)
            android.media.AudioFormat.ENCODING_PCM_FLOAT -> processFloatStereo(inputBuffer, output)
            ENCODING_PCM_32BIT -> processInt32Stereo(inputBuffer, output)
        }
        
        inputBuffer.position(inputBuffer.limit())
        output.flip()
        outputBuffer = output
    }
    
    override fun queueEndOfStream() { inputEnded = true }
    override fun getOutput(): ByteBuffer {
        val out = outputBuffer
        outputBuffer = EMPTY_BUFFER
        return out
    }
    override fun isEnded(): Boolean = inputEnded && outputBuffer === EMPTY_BUFFER
    
    override fun flush() {
        outputBuffer = EMPTY_BUFFER
        inputEnded = false
        resetState()
    }
    
    override fun reset() {
        flush()
        inputAudioFormat = AudioFormat.NOT_SET
        outputAudioFormat = AudioFormat.NOT_SET
        crossfeedStrength = DEFAULT_STRENGTH
        cutoffHz = DEFAULT_CUTOFF_HZ
        updateFilter()
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEREO CROSSFEED PROCESSING
    // ─────────────────────────────────────────────────────────────────────────
    
    private fun processShortStereo(input: ByteBuffer, output: ByteBuffer) {
        while (input.remaining() >= 4) {
            val leftIn = input.short.toDouble() / 32768.0
            val rightIn = input.short.toDouble() / 32768.0
            
            val (leftOut, rightOut) = processStereo(leftIn, rightIn)
            
            output.putShort((leftOut * 32768.0).coerceIn(-32768.0, 32767.0).toInt().toShort())
            output.putShort((rightOut * 32768.0).coerceIn(-32768.0, 32767.0).toInt().toShort())
        }
    }
    
    private fun processFloatStereo(input: ByteBuffer, output: ByteBuffer) {
        while (input.remaining() >= 8) {
            val leftIn = input.float.toDouble()
            val rightIn = input.float.toDouble()
            
            val (leftOut, rightOut) = processStereo(leftIn, rightIn)
            
            output.putFloat(leftOut.toFloat())
            output.putFloat(rightOut.toFloat())
        }
    }
    
    private fun processInt32Stereo(input: ByteBuffer, output: ByteBuffer) {
        while (input.remaining() >= 8) {
            val leftIn = input.int.toDouble() / 2147483648.0
            val rightIn = input.int.toDouble() / 2147483648.0
            
            val (leftOut, rightOut) = processStereo(leftIn, rightIn)
            
            output.putInt((leftOut * 2147483648.0).coerceIn(-2147483648.0, 2147483647.0).toLong().toInt())
            output.putInt((rightOut * 2147483648.0).coerceIn(-2147483648.0, 2147483647.0).toLong().toInt())
        }
    }
    
    private fun processStereo(leftIn: Double, rightIn: Double): Pair<Double, Double> {
        val strength = crossfeedStrength.toDouble()
        
        // Direct signal paths (slightly attenuated to maintain overall level)
        val leftDirect = leftIn * (1.0 - strength * 0.3)
        val rightDirect = rightIn * (1.0 - strength * 0.3)
        
        // Crossfeed paths: filtered and attenuated
        val leftCross = processLowpass(leftIn, leftState) * strength * 0.7
        val rightCross = processLowpass(rightIn, rightState) * strength * 0.7
        
        // Sum direct + crossfeed from opposite channel
        val leftOut = leftDirect + rightCross
        val rightOut = rightDirect + leftCross
        
        return Pair(leftOut, rightOut)
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // LOW-PASS FILTER (1st order)
    // ─────────────────────────────────────────────────────────────────────────
    
    private fun updateFilter() {
        val w0 = 2.0 * Math.PI * cutoffHz / sampleRate
        val cosW0 = cos(w0)
        val sinW0 = sin(w0)
        
        val alpha = sinW0 / (sqrt(2.0))
        
        b0 = (1.0 - cosW0) / 2.0
        b1 = 1.0 - cosW0
        b2 = (1.0 - cosW0) / 2.0
        a1 = -2.0 * cosW0
        a2 = 1.0 - alpha
    }
    
    private fun processLowpass(input: Double, state: BiquadState): Double {
        val output = b0 * input + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2
        
        state.x2 = state.x1
        state.x1 = input
        state.y2 = state.y1
        state.y1 = output
        
        if (abs(state.x1) < DENORMAL_THRESHOLD) state.x1 = 0.0
        if (abs(state.x2) < DENORMAL_THRESHOLD) state.x2 = 0.0
        if (abs(state.y1) < DENORMAL_THRESHOLD) state.y1 = 0.0
        if (abs(state.y2) < DENORMAL_THRESHOLD) state.y2 = 0.0
        
        return output
    }
    
    private fun resetState() {
        leftState.x1 = 0.0; leftState.x2 = 0.0; leftState.y1 = 0.0; leftState.y2 = 0.0
        rightState.x1 = 0.0; rightState.x2 = 0.0; rightState.y1 = 0.0; rightState.y2 = 0.0
    }
    
    private fun replaceOutputBuffer(size: Int): ByteBuffer {
        return if (outputBuffer === EMPTY_BUFFER || outputBuffer.capacity() < size) {
            ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder()).also { outputBuffer = it }
        } else {
            outputBuffer.clear().limit(size); outputBuffer
        }
    }
    
    private val ENCODING_PCM_32BIT = 0x00000004
}