package expo.modules.mavinplayer.audio

import android.util.Log
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.*

/**
 * FxProcessor - Professional Audio Effects Engine
 */
@androidx.media3.common.util.UnstableApi
class FxProcessor : AudioProcessor {

    companion object {
        private const val TAG = "FxProcessor"
        private const val DENORMAL_THRESHOLD = 1e-30
        
        const val DEFAULT_MIX = 30.0
        const val DEFAULT_BYPASS = false
        
        const val REVERB_ROOM_SIZE_DEF = 50.0
        const val REVERB_DECAY_DEF = 50.0
        const val REVERB_PRE_DELAY_DEF = 10.0
        const val REVERB_DAMPING_DEF = 50.0
        
        const val DELAY_TIME_DEF = 40.0
        const val DELAY_FEEDBACK_DEF = 40.0
        const val DELAY_LOW_CUT_DEF = 20.0
        const val DELAY_HIGH_CUT_DEF = 80.0
        
        const val MOD_RATE_DEF = 30.0
        const val MOD_DEPTH_DEF = 40.0
        const val MOD_PHASE_DEF = 50.0
        const val MOD_FEEDBACK_DEF = 30.0
        
        private const val LFO_MIN_HZ = 0.1
        private const val LFO_MAX_HZ = 10.0
        
        private const val DELAY_MIN_MS = 10.0
        private const val DELAY_MAX_MS = 500.0
        
        const val ENCODING_PCM_32BIT = 0x00000004
    }
    
    enum class FxMode { REVERB, DELAY, CHORUS, FLANGER, PHASER }
    
    private val _isEnabled = AtomicBoolean(true)
    var isEnabled: Boolean
        get() = _isEnabled.get()
        set(value) = _isEnabled.set(value)
    
    @Volatile
    private var fxMode: FxMode = FxMode.REVERB
    
    @Volatile
    private var mix = DEFAULT_MIX / 100.0
    
    @Volatile
    private var bypass = DEFAULT_BYPASS
    
    @Volatile
    private var reverbRoomSize = REVERB_ROOM_SIZE_DEF / 100.0
    @Volatile
    private var reverbDecay = REVERB_DECAY_DEF / 100.0
    @Volatile
    private var reverbPreDelay = REVERB_PRE_DELAY_DEF / 100.0
    @Volatile
    private var reverbDamping = REVERB_DAMPING_DEF / 100.0
    
    @Volatile
    private var delayTime = DELAY_TIME_DEF / 100.0
    @Volatile
    private var delayFeedback = DELAY_FEEDBACK_DEF / 100.0
    @Volatile
    private var delayLowCut = DELAY_LOW_CUT_DEF / 100.0
    @Volatile
    private var delayHighCut = DELAY_HIGH_CUT_DEF / 100.0
    
    @Volatile
    private var modRate = MOD_RATE_DEF / 100.0
    @Volatile
    private var modDepth = MOD_DEPTH_DEF / 100.0
    @Volatile
    private var modPhase = MOD_PHASE_DEF / 100.0
    @Volatile
    private var modFeedback = MOD_FEEDBACK_DEF / 100.0
    
    private val pendingFxMode = AtomicReference<FxMode?>(null)
    private val pendingMix = AtomicReference<Double?>(null)
    private val pendingBypass = AtomicReference<Boolean?>(null)
    
    private var sampleRate = 48000
    private var numChannels = 0
    private var inputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var outputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var outputBuffer: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var inputEnded = false
    
    private var reverbCombBuffers = Array(4) { FloatArray(0) }
    private var reverbAllpassBuffers = Array(2) { FloatArray(0) }
    private var reverbCombIndex = IntArray(4)
    private var reverbAllpassIndex = IntArray(2)
    private var reverbPreDelayBuffer = FloatArray(0)
    private var reverbPreDelayIndex = 0
    
    private var delayBufferL = FloatArray(0)
    private var delayBufferR = FloatArray(0)
    private var delayIndexL = 0
    private var delayIndexR = 0
    private var delayPrevOutputL = 0.0f
    private var delayPrevOutputR = 0.0f
    
    private var lfoPhase = 0.0
    private var lfoPhaseR = 0.0
    private var lfoIncrement = 0.0
    
    private var chorusBufferL = FloatArray(0)
    private var chorusBufferR = FloatArray(0)
    private var chorusIndex = 0
    
    private var phaserStages = arrayOf(
        PhaserStage(), PhaserStage(), PhaserStage(), PhaserStage(),
        PhaserStage(), PhaserStage()
    )
    
    private data class PhaserStage(var x1: Float = 0f, var x2: Float = 0f, 
                                   var y1: Float = 0f, var y2: Float = 0f)
    
    init {
        updateLfoIncrement()
    }
    
    fun setFxMode(mode: FxMode) { pendingFxMode.set(mode) }
    fun setMix(value: Double) { pendingMix.set(value.coerceIn(0.0, 1.0)) }
    fun setBypass(value: Boolean) { pendingBypass.set(value) }
    
    fun setReverbRoomSize(value: Double) { reverbRoomSize = value.coerceIn(0.0, 1.0) }
    fun setReverbDecay(value: Double) { reverbDecay = value.coerceIn(0.0, 1.0) }
    fun setReverbPreDelay(value: Double) { reverbPreDelay = value.coerceIn(0.0, 1.0) }
    fun setReverbDamping(value: Double) { reverbDamping = value.coerceIn(0.0, 1.0) }
    
    fun setDelayTime(value: Double) { delayTime = value.coerceIn(0.0, 1.0) }
    fun setDelayFeedback(value: Double) { delayFeedback = value.coerceIn(0.0, 1.0) }
    fun setDelayLowCut(value: Double) { delayLowCut = value.coerceIn(0.0, 1.0) }
    fun setDelayHighCut(value: Double) { delayHighCut = value.coerceIn(0.0, 1.0) }
    
    fun setModRate(value: Double) { modRate = value.coerceIn(0.0, 1.0); updateLfoIncrement() }
    fun setModDepth(value: Double) { modDepth = value.coerceIn(0.0, 1.0) }
    fun setModPhase(value: Double) { modPhase = value.coerceIn(0.0, 1.0) }
    fun setModFeedback(value: Double) { modFeedback = value.coerceIn(0.0, 1.0) }
    
    fun getMix(): Double = mix
    fun isBypassed(): Boolean = bypass
    fun getFxMode(): FxMode = fxMode
    
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
        sampleRate = inputAudioFormat.sampleRate
        numChannels = inputAudioFormat.channelCount
        
        initializeBuffers()
        
        Log.i(TAG, "configure: ${sampleRate}Hz ${numChannels}ch mode=$fxMode")
        return outputAudioFormat
    }
    
    override fun isActive(): Boolean = inputAudioFormat != AudioFormat.NOT_SET && _isEnabled.get() && !bypass
    
    override fun queueInput(inputBuffer: ByteBuffer) {
        pendingFxMode.getAndSet(null)?.let { fxMode = it }
        pendingMix.getAndSet(null)?.let { mix = it }
        pendingBypass.getAndSet(null)?.let { bypass = it }
        
        if (!_isEnabled.get() || bypass || inputBuffer.remaining() == 0) {
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
        resetState()
    }
    
    override fun reset() {
        flush()
        inputAudioFormat = AudioFormat.NOT_SET
        outputAudioFormat = AudioFormat.NOT_SET
        fxMode = FxMode.REVERB
        mix = DEFAULT_MIX / 100.0
        bypass = DEFAULT_BYPASS
    }
    
    private fun initializeBuffers() {
        val combLengths = intArrayOf(
            (0.0297 * sampleRate).toInt(),
            (0.0371 * sampleRate).toInt(),
            (0.0411 * sampleRate).toInt(),
            (0.0437 * sampleRate).toInt()
        )
        reverbCombBuffers = Array(4) { FloatArray(combLengths[it]) }
        reverbCombIndex = IntArray(4)
        
        val allpassLengths = intArrayOf(
            (0.005 * sampleRate).toInt(),
            (0.0017 * sampleRate).toInt()
        )
        reverbAllpassBuffers = Array(2) { FloatArray(allpassLengths[it]) }
        reverbAllpassIndex = IntArray(2)
        
        val preDelaySamples = (0.05 * sampleRate).toInt()
        reverbPreDelayBuffer = FloatArray(preDelaySamples)
        reverbPreDelayIndex = 0
        
        val maxDelaySamples = (DELAY_MAX_MS / 1000.0 * sampleRate).toInt()
        delayBufferL = FloatArray(maxDelaySamples)
        delayBufferR = FloatArray(maxDelaySamples)
        
        val chorusMaxDelay = (0.02 * sampleRate).toInt()
        chorusBufferL = FloatArray(chorusMaxDelay)
        chorusBufferR = FloatArray(chorusMaxDelay)
    }
    
    private fun resetState() {
        reverbCombBuffers.forEach { it.fill(0f) }
        reverbAllpassBuffers.forEach { it.fill(0f) }
        reverbPreDelayBuffer.fill(0f)
        reverbCombIndex.fill(0)
        reverbAllpassIndex.fill(0)
        reverbPreDelayIndex = 0
        
        delayBufferL.fill(0f)
        delayBufferR.fill(0f)
        delayIndexL = 0
        delayIndexR = 0
        delayPrevOutputL = 0f
        delayPrevOutputR = 0f
        
        chorusBufferL.fill(0f)
        chorusBufferR.fill(0f)
        chorusIndex = 0
        
        lfoPhase = 0.0
        lfoPhaseR = modPhase * 360.0
        
        phaserStages.forEach { 
            it.x1 = 0f; it.x2 = 0f; it.y1 = 0f; it.y2 = 0f 
        }
    }
    
    private fun updateLfoIncrement() {
        val freq = LFO_MIN_HZ + modRate * (LFO_MAX_HZ - LFO_MIN_HZ)
        lfoIncrement = (2.0 * PI * freq / sampleRate)
    }
    
    private fun getLfoValue(phase: Double): Float {
        return sin(phase).toFloat()
    }
    
    private fun getDelaySamples(): Int {
        val ms = DELAY_MIN_MS + delayTime * (DELAY_MAX_MS - DELAY_MIN_MS)
        return (ms / 1000.0 * sampleRate).toInt().coerceIn(1, delayBufferL.size - 1)
    }
    
    private fun processShort(input: ByteBuffer, output: ByteBuffer) {
        while (input.remaining() >= 2) {
            var sample = input.short.toDouble() / 32768.0
            sample = processSample(sample)
            output.putShort((sample * 32768.0).coerceIn(-32768.0, 32767.0).toInt().toShort())
        }
    }
    
    private fun processFloat(input: ByteBuffer, output: ByteBuffer) {
        while (input.remaining() >= 4) {
            var sample = input.float.toDouble()
            sample = processSample(sample)
            output.putFloat(sample.toFloat())
        }
    }
    
    private fun processInt32(input: ByteBuffer, output: ByteBuffer) {
        while (input.remaining() >= 4) {
            var sample = input.int.toDouble() / 2147483648.0
            sample = processSample(sample)
            output.putInt((sample * 2147483648.0).coerceIn(-2147483648.0, 2147483647.0).toLong().toInt())
        }
    }
    
    private fun processSample(input: Double): Double {
        val wet = when (fxMode) {
            FxMode.REVERB -> processReverb(input.toFloat())
            FxMode.DELAY -> processDelay(input.toFloat())
            FxMode.CHORUS -> processChorus(input.toFloat())
            FxMode.FLANGER -> processFlanger(input.toFloat())
            FxMode.PHASER -> processPhaser(input.toFloat())
        }.toDouble()
        
        val dry = input
        return dry * (1.0 - mix) + wet * mix
    }
    
    private fun processReverb(input: Float): Float {
        var signal = input
        
        reverbPreDelayBuffer[reverbPreDelayIndex] = signal
        reverbPreDelayIndex = (reverbPreDelayIndex + 1) % reverbPreDelayBuffer.size
        val preDelayIndex = (reverbPreDelayIndex + reverbPreDelayBuffer.size - 
            (reverbPreDelay * reverbPreDelayBuffer.size).toInt()) % reverbPreDelayBuffer.size
        signal = reverbPreDelayBuffer[preDelayIndex]
        
        var wet = 0f
        for (i in 0..3) {
            val comb = reverbCombBuffers[i]
            val idx = reverbCombIndex[i]
            val out = comb[idx]
            comb[idx] = signal + out * (0.7f + reverbDecay.toFloat() * 0.3f)
            reverbCombIndex[i] = (idx + 1) % comb.size
            wet += out
        }
        wet *= 0.25f
        
        for (i in 0..1) {
            val allpass = reverbAllpassBuffers[i]
            val idx = reverbAllpassIndex[i]
            val out = allpass[idx]
            allpass[idx] = wet + out * -0.5f
            reverbAllpassIndex[i] = (idx + 1) % allpass.size
            wet = out
        }
        
        val damping = 0.5f + reverbDamping.toFloat() * 0.5f
        wet = wet * damping
        
        wet *= (0.5f + reverbRoomSize.toFloat() * 0.5f)
        
        return wet
    }
    
    private fun processDelay(input: Float): Float {
        val delaySamples = getDelaySamples()
        val feedback = delayFeedback.toFloat() * 0.9f
        
        val lowCutFreq = 20.0 + delayLowCut * 180.0
        val lowCutCoeff = exp(-2.0 * PI * lowCutFreq / sampleRate).toFloat()
        
        val highCutFreq = 2000.0 + delayHighCut * 18000.0
        val highCutCoeff = exp(-2.0 * PI * highCutFreq / sampleRate).toFloat()
        
        val readPosL = (delayIndexL - delaySamples + delayBufferL.size) % delayBufferL.size
        val readPosR = (delayIndexR - delaySamples + delayBufferR.size) % delayBufferR.size
        val delayOutL = delayBufferL[readPosL]
        val delayOutR = delayBufferR[readPosR]
        
        delayBufferL[delayIndexL] = input + delayOutR * feedback
        delayBufferR[delayIndexR] = input + delayOutL * feedback
        
        val filteredL = delayOutL * (1 - lowCutCoeff) + delayPrevOutputL * lowCutCoeff
        val filteredR = delayOutR * (1 - lowCutCoeff) + delayPrevOutputR * lowCutCoeff
        delayPrevOutputL = filteredL
        delayPrevOutputR = filteredR
        
        delayIndexL = (delayIndexL + 1) % delayBufferL.size
        delayIndexR = (delayIndexR + 1) % delayBufferR.size
        
        return (filteredL + filteredR) * 0.5f
    }
    
    private fun processChorus(input: Float): Float {
        lfoPhase += lfoIncrement
        if (lfoPhase > 2 * PI) lfoPhase -= 2 * PI
        
        val lfoValue = (getLfoValue(lfoPhase) * modDepth.toFloat() + 1f) * 0.5f
        val delaySamples = (lfoValue * chorusBufferL.size * 0.5f).toInt() + 1
        
        val readPos = (chorusIndex - delaySamples + chorusBufferL.size) % chorusBufferL.size
        val delayed = chorusBufferL[readPos]
        
        chorusBufferL[chorusIndex] = input
        chorusIndex = (chorusIndex + 1) % chorusBufferL.size
        
        return input * 0.5f + delayed * 0.5f
    }
    
    private fun processFlanger(input: Float): Float {
        lfoPhase += lfoIncrement
        if (lfoPhase > 2 * PI) lfoPhase -= 2 * PI
        
        val lfoValue = (getLfoValue(lfoPhase) * modDepth.toFloat() + 1f) * 0.5f
        var delaySamples = (lfoValue * chorusBufferL.size * 0.8f).toInt() + 1
        
        val feedback = modFeedback.toFloat() * 0.9f
        
        val readPos = (chorusIndex - delaySamples + chorusBufferL.size) % chorusBufferL.size
        val delayed = chorusBufferL[readPos]
        
        chorusBufferL[chorusIndex] = input + delayed * feedback
        chorusIndex = (chorusIndex + 1) % chorusBufferL.size
        
        return input * 0.5f + delayed * 0.5f
    }
    
    private fun processPhaser(input: Float): Float {
        lfoPhase += lfoIncrement
        if (lfoPhase > 2 * PI) lfoPhase -= 2 * PI
        
        val lfoValue = (getLfoValue(lfoPhase) * modDepth.toFloat() + 1f) * 0.5f
        val freq = 200.0 + lfoValue * 8000.0
        val feedback = modFeedback.toFloat() * 0.8f
        
        val w0 = 2.0 * PI * freq / sampleRate
        val cosW0 = cos(w0).toFloat()
        val alpha = sin(w0).toFloat() / 2f
        
        val b0 = 1f - alpha
        val b1 = -2f * cosW0
        val b2 = 1f + alpha
        val a0 = 1f + alpha
        val a1 = -2f * cosW0
        val a2 = 1f - alpha
        
        var signal = input + phaserStages.last().y1 * feedback
        
        for (stage in phaserStages) {
            val output = (b0 * signal + b1 * stage.x1 + b2 * stage.x2 - a1 * stage.y1 - a2 * stage.y2) / a0
            stage.x2 = stage.x1
            stage.x1 = signal
            stage.y2 = stage.y1
            stage.y1 = output
            signal = output
        }
        
        return input * 0.5f + signal * 0.5f
    }
    
    private fun replaceOutputBuffer(size: Int): ByteBuffer {
        return if (outputBuffer === AudioProcessor.EMPTY_BUFFER || outputBuffer.capacity() < size) {
            ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder()).also { outputBuffer = it }
        } else {
            outputBuffer.clear().limit(size); outputBuffer
        }
    }
}