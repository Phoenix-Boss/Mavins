package expo.modules.autoeqengine

import android.util.Log
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max

/**
 * PeakMeterProcessor - VU / Peak Meter
 */
class PeakMeterProcessor : AudioProcessor {
    
    companion object {
        private const val TAG = "PeakMeterProcessor"
        private const val DENORMAL_THRESHOLD = 1e-30
        
        const val DEFAULT_PEAK_HOLD_MS = 300.0
        const val DEFAULT_RELEASE_MS = 100.0
        const val PEAK_HOLD_MIN_MS = 50.0
        const val PEAK_HOLD_MAX_MS = 2000.0
        const val RELEASE_MIN_MS = 10.0
        const val RELEASE_MAX_MS = 1000.0
        
        const val ENCODING_PCM_32BIT = 0x00000004
    }
    
    @Volatile
    private var peakHoldMs = DEFAULT_PEAK_HOLD_MS
    @Volatile
    private var releaseMs = DEFAULT_RELEASE_MS
    @Volatile
    private var isEnabled = true
    
    private var currentPeaks = FloatArray(8) { 0f }
    private var heldPeaks = FloatArray(8) { 0f }
    private var peakTimer = LongArray(8) { 0L }
    
    private var releaseCoeff = 0.0
    private var lastTimestamp = 0L
    
    private var peakCallback: ((FloatArray) -> Unit)? = null
    
    private var numChannels = 0
    private var sampleRate = 48000.0
    private var inputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var outputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var outputBuffer: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var inputEnded = false
    
    fun setEnabled(enabled: Boolean) { isEnabled = enabled }
    fun isEnabled(): Boolean = isEnabled
    
    fun setPeakHoldMs(ms: Double) {
        peakHoldMs = ms.coerceIn(PEAK_HOLD_MIN_MS, PEAK_HOLD_MAX_MS)
    }
    
    fun setReleaseMs(ms: Double) {
        releaseMs = ms.coerceIn(RELEASE_MIN_MS, RELEASE_MAX_MS)
        updateReleaseCoeff()
    }
    
    fun setPeakCallback(callback: ((FloatArray) -> Unit)?) {
        peakCallback = callback
    }
    
    fun getCurrentPeaks(): FloatArray = currentPeaks.copyOf()
    fun getHeldPeaks(): FloatArray = heldPeaks.copyOf()
    
    fun resetPeaks() {
        for (i in heldPeaks.indices) {
            heldPeaks[i] = 0f
            peakTimer[i] = 0L
        }
    }
    
    override fun configure(inputAudioFormat: AudioFormat): AudioFormat {
        val enc = inputAudioFormat.encoding
        val supported = enc == android.media.AudioFormat.ENCODING_PCM_16BIT ||
                        enc == android.media.AudioFormat.ENCODING_PCM_FLOAT ||
                        enc == ENCODING_PCM_32BIT
        
        if (!supported) {
            this.inputAudioFormat = AudioFormat.NOT_SET
            this.outputAudioFormat = AudioFormat.NOT_SET
            return AudioFormat.NOT_SET
        }
        
        this.inputAudioFormat = inputAudioFormat
        this.outputAudioFormat = inputAudioFormat
        sampleRate = inputAudioFormat.sampleRate.toDouble()
        numChannels = inputAudioFormat.channelCount
        
        updateReleaseCoeff()
        resetPeaks()
        lastTimestamp = System.nanoTime()
        
        return outputAudioFormat
    }
    
    override fun isActive(): Boolean = inputAudioFormat != AudioFormat.NOT_SET && isEnabled
    
    override fun queueInput(inputBuffer: ByteBuffer) {
        if (!isEnabled || inputBuffer.remaining() == 0) {
            outputBuffer = inputBuffer
            return
        }
        
        val output = replaceOutputBuffer(inputBuffer.remaining())
        
        when (inputAudioFormat.encoding) {
            android.media.AudioFormat.ENCODING_PCM_16BIT -> processShort(inputBuffer, output)
            android.media.AudioFormat.ENCODING_PCM_FLOAT -> processFloat(inputBuffer, output)
            ENCODING_PCM_32BIT -> processInt32(inputBuffer, output)
        }
        
        inputBuffer.position(inputBuffer.limit())
        output.flip()
        outputBuffer = output
        
        emitPeaks()
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
        inputEnded = false
        for (i in 0 until numChannels) {
            currentPeaks[i] = 0f
        }
    }
    
    override fun reset() {
        flush()
        inputAudioFormat = AudioFormat.NOT_SET
        outputAudioFormat = AudioFormat.NOT_SET
        resetPeaks()
    }
    
    private fun processShort(input: ByteBuffer, output: ByteBuffer) {
        var idx = 0
        while (input.remaining() >= 2) {
            val ch = idx % numChannels
            val sample = input.short.toDouble() / 32768.0
            val absSample = abs(sample).toFloat()
            
            if (absSample > currentPeaks[ch]) {
                currentPeaks[ch] = absSample
            }
            
            output.putShort((sample * 32768.0).coerceIn(-32768.0, 32767.0).toInt().toShort())
            idx++
        }
    }
    
    private fun processFloat(input: ByteBuffer, output: ByteBuffer) {
        var idx = 0
        while (input.remaining() >= 4) {
            val ch = idx % numChannels
            val sample = input.float.toDouble()
            val absSample = abs(sample).toFloat()
            
            if (absSample > currentPeaks[ch]) {
                currentPeaks[ch] = absSample
            }
            
            output.putFloat(sample.toFloat())
            idx++
        }
    }
    
    private fun processInt32(input: ByteBuffer, output: ByteBuffer) {
        var idx = 0
        while (input.remaining() >= 4) {
            val ch = idx % numChannels
            val sample = input.int.toDouble() / 2147483648.0
            val absSample = abs(sample).toFloat()
            
            if (absSample > currentPeaks[ch]) {
                currentPeaks[ch] = absSample
            }
            
            output.putInt((sample * 2147483648.0).coerceIn(-2147483648.0, 2147483647.0).toLong().toInt())
            idx++
        }
    }
    
    private fun emitPeaks() {
        val now = System.nanoTime()
        val elapsedSec = (now - lastTimestamp) / 1_000_000_000.0
        lastTimestamp = now
        
        if (releaseCoeff > 0) {
            for (ch in 0 until numChannels) {
                currentPeaks[ch] = (currentPeaks[ch] * (1.0 - releaseCoeff)).toFloat()
                if (currentPeaks[ch] < 1e-6f) currentPeaks[ch] = 0f
            }
        }
        
        val holdNs = (peakHoldMs / 1000.0) * 1_000_000_000.0
        for (ch in 0 until numChannels) {
            if (currentPeaks[ch] > heldPeaks[ch]) {
                heldPeaks[ch] = currentPeaks[ch]
                peakTimer[ch] = now
            } else if (now - peakTimer[ch] > holdNs) {
                val release = (releaseCoeff * 0.5).toFloat()
                heldPeaks[ch] = max(heldPeaks[ch] * (1.0f - release), currentPeaks[ch])
                if (heldPeaks[ch] < 1e-6f) heldPeaks[ch] = 0f
            }
        }
        
        peakCallback?.invoke(heldPeaks.copyOf())
    }
    
    private fun updateReleaseCoeff() {
        releaseCoeff = if (releaseMs <= 0 || sampleRate <= 0) 1.0
        else exp(-1.0 / (releaseMs / 1000.0 * sampleRate))
    }
    
    private fun replaceOutputBuffer(size: Int): ByteBuffer {
        return if (outputBuffer === AudioProcessor.EMPTY_BUFFER || outputBuffer.capacity() < size) {
            ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder()).also { outputBuffer = it }
        } else {
            outputBuffer.clear().limit(size); outputBuffer
        }
    }
}
