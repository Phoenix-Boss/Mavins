package com.doublesymmetry.trackplayer.dsp
import android.util.Log
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.log10

/**
 * CompressorProcessor - Dynamic Range Compression
 */
class CompressorProcessor : AudioProcessor {
    
    companion object {
        private const val TAG = "CompressorProcessor"
        private const val DENORMAL_THRESHOLD = 1e-30
        
        const val DEFAULT_THRESHOLD_DB = -24.0
        const val DEFAULT_RATIO = 4.0
        const val DEFAULT_ATTACK_MS = 5.0
        const val DEFAULT_RELEASE_MS = 100.0
        const val DEFAULT_KNEE_WIDTH_DB = 6.0
        const val DEFAULT_MAKEUP_GAIN_DB = 0.0
        
        const val THRESHOLD_MIN_DB = -60.0
        const val THRESHOLD_MAX_DB = 0.0
        const val RATIO_MIN = 1.0
        const val RATIO_MAX = 20.0
        const val ATTACK_MS_MIN = 1.0
        const val ATTACK_MS_MAX = 100.0
        const val RELEASE_MS_MIN = 10.0
        const val RELEASE_MS_MAX = 1000.0
        const val KNEE_WIDTH_MIN = 0.0
        const val KNEE_WIDTH_MAX = 12.0
        const val MAKEUP_GAIN_MIN_DB = -12.0
        const val MAKEUP_GAIN_MAX_DB = 12.0
        
        const val ENCODING_PCM_32BIT = 0x00000004
    }
    
    @Volatile
    private var thresholdDb = DEFAULT_THRESHOLD_DB
    @Volatile
    private var ratio = DEFAULT_RATIO
    @Volatile
    private var attackMs = DEFAULT_ATTACK_MS
    @Volatile
    private var releaseMs = DEFAULT_RELEASE_MS
    @Volatile
    private var kneeWidthDb = DEFAULT_KNEE_WIDTH_DB
    @Volatile
    private var makeupGainDb = DEFAULT_MAKEUP_GAIN_DB
    
    @Volatile
    private var isEnabled = true
    
    @Volatile
    private var linearThreshold = 0.0
    @Volatile
    private var linearKneeStart = 0.0
    @Volatile
    private var linearKneeEnd = 0.0
    @Volatile
    private var slope = 0.0
    @Volatile
    private var slopeInv = 0.0
    @Volatile
    private var makeupGainLinear = 1.0
    
    private var envelopeGain = DoubleArray(8) { 1.0 }
    private var attackCoeff = 0.0
    private var releaseCoeff = 0.0
    
    private var numChannels = 0
    private var sampleRate = 48000.0
    private var inputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var outputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var outputBuffer: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var inputEnded = false
    
    init {
        updateCompressionCurve()
    }
    
    fun setEnabled(enabled: Boolean) { isEnabled = enabled }
    fun isEnabled(): Boolean = isEnabled
    
    fun setThreshold(db: Double) {
        thresholdDb = db.coerceIn(THRESHOLD_MIN_DB, THRESHOLD_MAX_DB)
        updateCompressionCurve()
    }
    
    fun setRatio(r: Double) {
        ratio = r.coerceIn(RATIO_MIN, RATIO_MAX)
        updateCompressionCurve()
    }
    
    fun setAttackMs(ms: Double) {
        attackMs = ms.coerceIn(ATTACK_MS_MIN, ATTACK_MS_MAX)
        updateTimeConstants()
    }
    
    fun setReleaseMs(ms: Double) {
        releaseMs = ms.coerceIn(RELEASE_MS_MIN, RELEASE_MS_MAX)
        updateTimeConstants()
    }
    
    fun setKneeWidth(db: Double) {
        kneeWidthDb = db.coerceIn(KNEE_WIDTH_MIN, KNEE_WIDTH_MAX)
        updateCompressionCurve()
    }
    
    fun setMakeupGain(db: Double) {
        makeupGainDb = db.coerceIn(MAKEUP_GAIN_MIN_DB, MAKEUP_GAIN_MAX_DB)
        makeupGainLinear = dbToLinear(db)
    }
    
    fun getThreshold(): Double = thresholdDb
    fun getRatio(): Double = ratio
    fun getAttackMs(): Double = attackMs
    fun getReleaseMs(): Double = releaseMs
    fun getKneeWidth(): Double = kneeWidthDb
    fun getMakeupGain(): Double = makeupGainDb
    fun getReductionDb(): Float {
        val currentGain = envelopeGain[0]
        return if (currentGain < 1.0) linearToDb(currentGain).toFloat() else 0f
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
        
        updateTimeConstants()
        resetEnvelopes()
        
        Log.d(TAG, "configure: ${inputAudioFormat.sampleRate}Hz ${numChannels}ch " +
                "thresh=${thresholdDb}dB ratio=${ratio}:1 attack=${attackMs}ms release=${releaseMs}ms")
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
        resetEnvelopes()
    }
    
    override fun reset() {
        flush()
        inputAudioFormat = AudioFormat.NOT_SET
        outputAudioFormat = AudioFormat.NOT_SET
        thresholdDb = DEFAULT_THRESHOLD_DB
        ratio = DEFAULT_RATIO
        attackMs = DEFAULT_ATTACK_MS
        releaseMs = DEFAULT_RELEASE_MS
        kneeWidthDb = DEFAULT_KNEE_WIDTH_DB
        makeupGainDb = DEFAULT_MAKEUP_GAIN_DB
        updateCompressionCurve()
        updateTimeConstants()
    }
    
    private fun processShort(input: ByteBuffer, output: ByteBuffer) {
        var idx = 0
        while (input.remaining() >= 2) {
            val ch = idx % numChannels
            var sample = input.short.toDouble() / 32768.0
            sample = processSample(sample, ch)
            output.putShort((sample * 32768.0).coerceIn(-32768.0, 32767.0).toInt().toShort())
            idx++
        }
    }
    
    private fun processFloat(input: ByteBuffer, output: ByteBuffer) {
        var idx = 0
        while (input.remaining() >= 4) {
            val ch = idx % numChannels
            var sample = input.float.toDouble()
            sample = processSample(sample, ch)
            output.putFloat(sample.toFloat())
            idx++
        }
    }
    
    private fun processInt32(input: ByteBuffer, output: ByteBuffer) {
        var idx = 0
        while (input.remaining() >= 4) {
            val ch = idx % numChannels
            var sample = input.int.toDouble() / 2147483648.0
            sample = processSample(sample, ch)
            output.putInt((sample * 2147483648.0).coerceIn(-2147483648.0, 2147483647.0).toLong().toInt())
            idx++
        }
    }
    
    private fun processSample(input: Double, ch: Int): Double {
        val absInput = abs(input)
        var targetGain = 1.0
        
        if (absInput > 1e-8) {
            val db = linearToDb(absInput)
            targetGain = calculateGainReduction(db)
        }
        
        val envIdx = ch.coerceAtMost(envelopeGain.size - 1)
        val currentEnv = envelopeGain[envIdx]
        val coeff = if (targetGain < currentEnv) attackCoeff else releaseCoeff
        envelopeGain[envIdx] = currentEnv + coeff * (targetGain - currentEnv)
        
        if (abs(envelopeGain[envIdx]) < DENORMAL_THRESHOLD) envelopeGain[envIdx] = 0.0
        
        return input * envelopeGain[envIdx] * makeupGainLinear
    }
    
    private fun updateCompressionCurve() {
        linearThreshold = dbToLinear(thresholdDb)
        linearKneeStart = dbToLinear(thresholdDb - kneeWidthDb / 2.0)
        linearKneeEnd = dbToLinear(thresholdDb + kneeWidthDb / 2.0)
        
        slope = 1.0 / ratio
        slopeInv = 1.0 - slope
        makeupGainLinear = dbToLinear(makeupGainDb)
    }
    
    private fun calculateGainReduction(inputDb: Double): Double {
        if (inputDb <= thresholdDb - kneeWidthDb / 2.0) {
            return 1.0
        }
        
        if (inputDb >= thresholdDb + kneeWidthDb / 2.0) {
            val compressedDb = thresholdDb + (inputDb - thresholdDb) * slope
            return dbToLinear(compressedDb - inputDb)
        }
        
        val kneeStartDb = thresholdDb - kneeWidthDb / 2.0
        val kneeEndDb = thresholdDb + kneeWidthDb / 2.0
        val t = (inputDb - kneeStartDb) / kneeWidthDb
        val tSquared = t * t
        
        val compressedDb = when {
            t < 0.5 -> {
                val t2 = t * 2.0
                kneeStartDb + (thresholdDb - kneeStartDb) * (t2 * t2)
            }
            else -> {
                val t2 = (t - 0.5) * 2.0
                thresholdDb + (kneeEndDb - thresholdDb) * (1.0 - (1.0 - t2) * (1.0 - t2))
            }
        } + (inputDb - (kneeStartDb + t * kneeWidthDb)) * slope
        
        return dbToLinear(compressedDb - inputDb)
    }
    
    private fun updateTimeConstants() {
        attackCoeff = exp(-1.0 / (attackMs / 1000.0 * sampleRate))
        releaseCoeff = exp(-1.0 / (releaseMs / 1000.0 * sampleRate))
    }
    
    private fun resetEnvelopes() {
        envelopeGain = DoubleArray(numChannels.coerceAtLeast(1)) { 1.0 }
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
}
