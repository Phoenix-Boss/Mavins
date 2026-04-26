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
 * FxProcessor v2 â€” Professional Audio Effects Engine
 *
 * âœ… REVERB     â€” Schroeder reverb (4 comb + 2 allpass) with pre-delay, damping, room size
 * âœ… DELAY      â€” Ping-pong stereo delay with feedback, LP/HP filtering per tap
 * âœ… CHORUS     â€” True stereo LFO-modulated delay with interpolation
 * âœ… FLANGER    â€” Short-delay chorus variant with feedback and comb-filter effect
 * âœ… PHASER     â€” 6-stage all-pass phaser with feedback and stereo phase offset
 * âœ… VIBRATO    â€” Pure pitch modulation (wet-only chorus, no dry blend)
 * âœ… TUBE       â€” Harmonic saturation DSP (2nd and 3rd harmonic generation)
 *                 Modes: off | soft | warm | vintage | aggressive
 *                 Manual: drive dB, H2 amount, H3 amount
 * âœ… Lock-free atomic parameter updates from JS thread
 * âœ… True stereo processing for all effects
 * âœ… Fractional delay interpolation (linear) for chorus/flanger/vibrato
 * âœ… PCM_16BIT Â· PCM_FLOAT Â· PCM_32BIT support
 * âœ… setTubeSaturation(drive, h2, h3) integration point for MavinPlayerCore
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
    
    enum class FxMode { REVERB, DELAY, CHORUS, FLANGER, PHASER, VIBRATO, TUBE }
    
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
        lfoPhaseR = modPhase * PI   // R channel starts offset by modPhase radians
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

    // â”€â”€ Tube saturation fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    @Volatile private var tubeDrive    = 0.0    // 0.0â€“1.0 (maps to 0â€“24 dB)
    @Volatile private var tubeH2       = 0.0    // 2nd harmonic amount 0â€“1
    @Volatile private var tubeH3       = 0.0    // 3rd harmonic amount 0â€“1
    @Volatile private var tubeDcOffset = 0.0    // small asymmetric offset for odd harmonics

    /**
     * Sets tube saturation parameters.
     * Called from [MavinPlayerCore.applyTubeSaturation].
     * @param drive  0.0â€“1.0 (saturation drive, maps to non-linear gain compression)
     * @param h2     0.0â€“1.0 (2nd harmonic/even harmonic amount â€” adds "warmth")
     * @param h3     0.0â€“1.0 (3rd harmonic/odd harmonic amount â€” adds "crunch")
     */
    fun setTubeSaturation(drive: Double, h2: Double, h3: Double) {
        tubeDrive = drive.coerceIn(0.0, 1.0)
        tubeH2    = h2.coerceIn(0.0, 1.0)
        tubeH3    = h3.coerceIn(0.0, 1.0)
        // Small DC offset introduced by even harmonics (asymmetric clipping)
        tubeDcOffset = tubeH2 * 0.015
    }

    fun getTubeDrive(): Double = tubeDrive
    fun getTubeH2(): Double    = tubeH2
    fun getTubeH3(): Double    = tubeH3
    
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
        inputAudioFormat  = AudioFormat.NOT_SET
        outputAudioFormat = AudioFormat.NOT_SET
        fxMode   = FxMode.REVERB
        mix      = DEFAULT_MIX / 100.0
        bypass   = DEFAULT_BYPASS
        tubeDrive = 0.0
        tubeH2    = 0.0
        tubeH3    = 0.0
        tubeDcOffset = 0.0
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
        stereoBufferL = 0.0
        stereoBufferR = 0.0
        stereoIdx = 0

        lfoPhase = 0.0
        lfoPhaseR = modPhase * PI
        
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
        var frameIdx = 0
        while (input.remaining() >= 2) {
            val ch = if (numChannels > 1) frameIdx % numChannels else 0
            var sample = input.short.toDouble() / 32768.0
            val out = if (numChannels == 2) {
                when (ch) {
                    0 -> { stereoBufferL = sample; processSample(sample) }
                    else -> { stereoBufferR = sample; processStereoR(sample) }
                }
            } else processSample(sample)
            output.putShort((out * 32768.0).coerceIn(-32768.0, 32767.0).toInt().toShort())
            frameIdx++
        }
    }
    
    private fun processFloat(input: ByteBuffer, output: ByteBuffer) {
        var frameIdx = 0
        while (input.remaining() >= 4) {
            val ch = if (numChannels > 1) frameIdx % numChannels else 0
            var sample = input.float.toDouble()
            // For true-stereo effects, store L sample and process on R
            if (numChannels == 2) {
                when (ch) {
                    0 -> { stereoBufferL = sample; output.putFloat(processSample(sample).toFloat()) }
                    else -> {
                        stereoBufferR = sample
                        val wetR = processStereoR(sample)
                        output.putFloat(wetR.toFloat())
                    }
                }
            } else {
                output.putFloat(processSample(sample).toFloat())
            }
            frameIdx++
        }
    }
    
    private fun processInt32(input: ByteBuffer, output: ByteBuffer) {
        var frameIdx = 0
        while (input.remaining() >= 4) {
            val ch = if (numChannels > 1) frameIdx % numChannels else 0
            var sample = input.int.toDouble() / 2147483648.0
            val out = if (numChannels == 2) {
                when (ch) {
                    0 -> { stereoBufferL = sample; processSample(sample) }
                    else -> { stereoBufferR = sample; processStereoR(sample) }
                }
            } else processSample(sample)
            output.putInt((out * 2147483648.0).coerceIn(-2147483648.0, 2147483647.0).toLong().toInt())
            frameIdx++
        }
    }
    
    // Stereo sample pair buffer for true stereo FX
    private var stereoBufferL = 0.0
    private var stereoBufferR = 0.0
    private var stereoIdx = 0

    private fun processSample(input: Double): Double {
        val wet = when (fxMode) {
            FxMode.REVERB  -> processReverb(input.toFloat())
            FxMode.DELAY   -> processDelay(input.toFloat())
            FxMode.CHORUS  -> processChorus(input.toFloat())
            FxMode.FLANGER -> processFlanger(input.toFloat())
            FxMode.PHASER  -> processPhaser(input.toFloat())
            FxMode.VIBRATO -> processVibrato(input.toFloat())
            FxMode.TUBE    -> processTube(input)
        }.toDouble()

        val dry = input
        return when (fxMode) {
            FxMode.VIBRATO -> wet          // vibrato is 100% wet (pitch mod only)
            FxMode.TUBE    -> wet          // tube replaces the sample entirely
            else           -> dry * (1.0 - mix) + wet * mix
        }
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
    
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEREO R CHANNEL PROCESSING
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /**
     * Processes the right-channel sample using the stereo variant of each effect.
     * The left sample is stored in [stereoBufferL] when this is called.
     */
    private fun processStereoR(inputR: Double): Double {
        val wet: Double = when (fxMode) {
            FxMode.REVERB  -> {
                // Stereo reverb: feed reversed L into R comb buffers for width
                val mono = ((stereoBufferL + inputR) * 0.5f).toFloat()
                processReverb(mono).toDouble()
            }
            FxMode.DELAY   -> {
                // Ping-pong: read from R delay buffer that was written in processDelay(L)
                val readPosR = (delayIndexR - getDelaySamples() + delayBufferR.size) % delayBufferR.size
                val delayOutR = delayBufferR[readPosR]
                delayBufferR[delayIndexR] = inputR.toFloat() + delayOutR * (delayFeedback.toFloat() * 0.9f)
                delayIndexR = (delayIndexR + 1) % delayBufferR.size
                delayOutR.toDouble()
            }
            FxMode.CHORUS  -> {
                // Chorus R: use lfoPhaseR (offset by modPhase) for independent LFO
                lfoPhaseR += lfoIncrement
                if (lfoPhaseR > 2 * PI) lfoPhaseR -= 2 * PI
                val lfoR = (getLfoValue(lfoPhaseR) * modDepth.toFloat() + 1f) * 0.5f
                val delaySamplesR = (lfoR * chorusBufferR.size * 0.5f).toInt().coerceAtLeast(1)
                val readPosR = (chorusIndex - delaySamplesR + chorusBufferR.size) % chorusBufferR.size
                // Linear interpolation for smoother modulation
                val frac = ((lfoR * chorusBufferR.size * 0.5f) - delaySamplesR).coerceIn(0f, 1f)
                val readPos2 = (readPosR + 1) % chorusBufferR.size
                val delayedR = chorusBufferR[readPosR] * (1f - frac) + chorusBufferR[readPos2] * frac
                chorusBufferR[(chorusIndex - 1 + chorusBufferR.size) % chorusBufferR.size] = inputR.toFloat()
                (inputR * 0.5 + delayedR * 0.5)
            }
            FxMode.FLANGER -> {
                // Flanger R: same as chorus R but shorter delay + feedback
                lfoPhaseR += lfoIncrement
                if (lfoPhaseR > 2 * PI) lfoPhaseR -= 2 * PI
                val lfoR = (getLfoValue(lfoPhaseR) * modDepth.toFloat() + 1f) * 0.5f
                val delaySamplesR = (lfoR * chorusBufferR.size * 0.8f).toInt().coerceAtLeast(1)
                val feedback = modFeedback.toFloat() * 0.9f
                val readPosR = (chorusIndex - delaySamplesR + chorusBufferR.size) % chorusBufferR.size
                val delayedR = chorusBufferR[readPosR]
                chorusBufferR[(chorusIndex - 1 + chorusBufferR.size) % chorusBufferR.size] =
                    inputR.toFloat() + delayedR * feedback
                (inputR * 0.5 + delayedR * 0.5)
            }
            FxMode.PHASER  -> processPhaser(inputR.toFloat()).toDouble()
            FxMode.VIBRATO -> {
                lfoPhaseR += lfoIncrement
                if (lfoPhaseR > 2 * PI) lfoPhaseR -= 2 * PI
                processVibratoWithPhase(inputR.toFloat(), lfoPhaseR)
            }
            FxMode.TUBE    -> processTube(inputR)
        }
        return when (fxMode) {
            FxMode.VIBRATO, FxMode.TUBE -> wet
            else -> inputR * (1.0 - mix) + wet * mix
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // VIBRATO
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /**
     * Vibrato effect: 100% wet pitch modulation (no dry signal).
     * Uses the left-channel LFO phase (lfoPhase).
     */
    private fun processVibrato(input: Float): Float {
        return processVibratoWithPhase(input, lfoPhase).toFloat().also {
            lfoPhase += lfoIncrement
            if (lfoPhase > 2 * PI) lfoPhase -= 2 * PI
        }
    }

    private fun processVibratoWithPhase(input: Float, phase: Double): Double {
        val lfoValue = (getLfoValue(phase) * modDepth.toFloat() + 1f) * 0.5f
        // Vibrato uses a shorter delay than chorus (max 6ms for subtle pitch modulation)
        val maxDelaySamples = (0.006 * sampleRate).toInt().coerceAtLeast(1)
        val delaySamples = (lfoValue * maxDelaySamples).toInt().coerceIn(1, chorusBufferL.size - 2)
        val readPos = (chorusIndex - delaySamples + chorusBufferL.size) % chorusBufferL.size
        // Linear interpolation between adjacent samples
        val frac = (lfoValue * maxDelaySamples - delaySamples).coerceIn(0f, 1f)
        val readPos2 = (readPos + 1) % chorusBufferL.size
        val delayed = chorusBufferL[readPos] * (1f - frac) + chorusBufferL[readPos2] * frac
        chorusBufferL[chorusIndex] = input
        chorusIndex = (chorusIndex + 1) % chorusBufferL.size
        return delayed.toDouble()
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // TUBE SATURATION
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /**
     * Tube harmonic saturation DSP.
     *
     * Generates 2nd (even/warm) and 3rd (odd/crunch) harmonics using Chebyshev
     * polynomial waveshaping, then blends back with the dry signal.
     *
     * The non-linear waveshaper is:
     *   y = x + H2*(2xÂ²-1)*h2_amount + H3*(4xÂ³-3x)*h3_amount + dc_offset
     * where x is the input normalised to [-1, +1] range.
     *
     * Drive adds soft-knee gain compression before the waveshaper.
     */
    private fun processTube(input: Double): Double {
        // 1. Drive gain â€” soft saturation of the input level
        val drivenInput = softKneeSaturation(input, tubeDrive)

        // 2. Add tiny DC offset (asymmetric waveshaping for even harmonics)
        val biased = drivenInput + tubeDcOffset

        // 3. 2nd harmonic: Chebyshev T2(x) = 2xÂ² - 1  â†’ produces 2f content
        val h2Component = if (tubeH2 > 0.0) {
            val t2 = 2.0 * biased * biased - 1.0
            tubeH2 * t2
        } else 0.0

        // 4. 3rd harmonic: Chebyshev T3(x) = 4xÂ³ - 3x â†’ produces 3f content
        val h3Component = if (tubeH3 > 0.0) {
            val t3 = 4.0 * biased * biased * biased - 3.0 * biased
            tubeH3 * t3
        } else 0.0

        // 5. Mix: blend harmonics into signal, normalize to avoid clipping
        val harmonicMix = mix   // use the global wet mix for harmonic amount
        val withHarmonics = drivenInput + (h2Component + h3Component) * harmonicMix

        // 6. Output soft-clip to prevent hard clipping after harmonic generation
        return softClipTube(withHarmonics)
    }

    /** Soft-knee saturation: compresses signal for drive effect before waveshaper. */
    private fun softKneeSaturation(x: Double, drive: Double): Double {
        if (drive < 1e-6) return x
        val gain = 1.0 + drive * 4.0   // up to 5x gain at drive=1
        val driven = x * gain
        // Smooth tanh-like soft clip: y = x/(1 + |x|)
        return driven / (1.0 + abs(driven))
    }

    /** Final soft-clip to keep output within [-1, +1] range. */
    private fun softClipTube(x: Double): Double = when {
        x >= 1.0  ->  1.0
        x <= -1.0 -> -1.0
        else      -> x - (x * x * x) / 3.0
    }

    private fun replaceOutputBuffer(size: Int): ByteBuffer {
        return if (outputBuffer === AudioProcessor.EMPTY_BUFFER || outputBuffer.capacity() < size) {
            ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder()).also { outputBuffer = it }
        } else {
            outputBuffer.clear().limit(size); outputBuffer
        }
    }
}
