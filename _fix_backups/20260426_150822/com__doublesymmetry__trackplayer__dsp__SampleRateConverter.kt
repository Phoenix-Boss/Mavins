package com.doublesymmetry.trackplayer.dsp

import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.nio.FloatBuffer

/**
 * SampleRateConverter - high-quality SRC (Sample Rate Conversion).
 * Poweramp/Neutron pattern: resamples source audio to DAC native rate
 * before DSP chain to prevent Android's poor-quality SRC from running
 * after DSP processing.
 *
 * Uses simple linear interpolation for MVP. Production should use
 * polyphase FIR filter (Soxr or similar).
 */
@UnstableApi
class SampleRateConverter : AudioProcessor {
    private var inputAudioFormat: AudioProcessor.AudioFormat = AudioProcessor.AudioFormat.NOT_SET
    private var outputAudioFormat: AudioProcessor.AudioFormat = AudioProcessor.AudioFormat.NOT_SET
    private var active: Boolean = false
    private var buffer: ByteBuffer = EMPTY_BUFFER
    private var pendingOutput: ByteBuffer = EMPTY_BUFFER

    private var sourceSampleRate: Int = 44100
    private var targetSampleRate: Int = 48000
    private var ratio: Double = 1.0
    private var lastSample: Float = 0f

    fun setTargetSampleRate(sampleRate: Int) {
        targetSampleRate = sampleRate
        updateRatio()
    }

    private fun updateRatio() {
        ratio = if (sourceSampleRate != targetSampleRate) {
            sourceSampleRate.toDouble() / targetSampleRate.toDouble()
        } else {
            1.0
        }
        active = ratio != 1.0
    }

    override fun configure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != androidx.media3.common.C.ENCODING_PCM_FLOAT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        this.inputAudioFormat = inputAudioFormat
        sourceSampleRate = inputAudioFormat.sampleRate
        updateRatio()

        outputAudioFormat = AudioProcessor.AudioFormat(
            inputAudioFormat.sampleRate,
            inputAudioFormat.channelCount,
            androidx.media3.common.C.ENCODING_PCM_FLOAT
        )
        buffer = EMPTY_BUFFER
        pendingOutput = EMPTY_BUFFER
        return outputAudioFormat
    }

    override fun isActive(): Boolean = active

    override fun queueInput(inputBuffer: ByteBuffer) {
        if (!active || !inputBuffer.hasRemaining()) {
            pendingOutput = inputBuffer
            return
        }

        val inputFloats = inputBuffer.asFloatBuffer()
        val inputFrames = inputFloats.remaining() / inputAudioFormat.channelCount
        val outputFrames = (inputFrames / ratio).toInt() + 1
        val outputSamples = outputFrames * inputAudioFormat.channelCount
        val outputBytes = outputSamples * 4

        if (buffer.capacity() < outputBytes) {
            buffer = ByteBuffer.allocateDirect(outputBytes).order(java.nio.ByteOrder.nativeOrder())
        }
        buffer.clear()
        val outFloat = buffer.asFloatBuffer()

        var inputIndex = 0.0
        val channels = inputAudioFormat.channelCount

        while (inputIndex < inputFrames) {
            val baseIndex = inputIndex.toInt() * channels
            val frac = (inputIndex - inputIndex.toInt()).toFloat()

            for (ch in 0 until channels) {
                val s1 = if (baseIndex + ch < inputFloats.remaining()) {
                    inputFloats.get(baseIndex + ch)
                } else {
                    lastSample
                }
                val s2 = if (baseIndex + channels + ch < inputFloats.remaining()) {
                    inputFloats.get(baseIndex + channels + ch)
                } else {
                    s1
                }
                outFloat.put(s1 + (s2 - s1) * frac)
            }
            inputIndex += ratio
        }

        lastSample = if (inputFloats.remaining() > 0) {
            inputFloats.get(inputFloats.remaining() - 1)
        } else {
            0f
        }

        buffer.limit(outFloat.position() * 4)
        buffer.rewind()
        pendingOutput = buffer
    }

    override fun getOutput(): ByteBuffer = pendingOutput

    override fun queueEndOfStream() {
        pendingOutput = EMPTY_BUFFER
    }

    override fun flush() {
        buffer = EMPTY_BUFFER
        pendingOutput = EMPTY_BUFFER
        lastSample = 0f
    }

    override fun reset() {
        flush()
        active = false
    }

    companion object {
        private val EMPTY_BUFFER: ByteBuffer = ByteBuffer.allocateDirect(0).order(java.nio.ByteOrder.nativeOrder())
    }
}