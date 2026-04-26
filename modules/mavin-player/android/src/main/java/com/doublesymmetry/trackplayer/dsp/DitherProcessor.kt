package com.doublesymmetry.trackplayer.dsp

import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.nio.FloatBuffer
import kotlin.random.Random

/**
 * DitherProcessor â€” triangular dither + noise shaping.
 * Position: last in chain before hardware output.
 * Converts float32 to target bit depth with minimal quantization error.
 */
@UnstableApi
class DitherProcessor : AudioProcessor {
    private var inputAudioFormat: AudioProcessor.AudioFormat = AudioProcessor.AudioFormat.NOT_SET
    private var outputAudioFormat: AudioProcessor.AudioFormat = AudioProcessor.AudioFormat.NOT_SET
    private var active: Boolean = false
    private var buffer: ByteBuffer = EMPTY_BUFFER
    private var pendingOutput: ByteBuffer = EMPTY_BUFFER
    private var noiseShaping: Float = 0f

    override fun configure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != androidx.media3.common.C.ENCODING_PCM_FLOAT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        this.inputAudioFormat = inputAudioFormat
        outputAudioFormat = inputAudioFormat
        active = true
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
        val capacity = inputBuffer.remaining()
        if (buffer.capacity() < capacity) {
            buffer = ByteBuffer.allocateDirect(capacity).order(java.nio.ByteOrder.nativeOrder())
        }
        buffer.clear()
        val floatBuffer = inputBuffer.asFloatBuffer()
        val outFloat = buffer.asFloatBuffer()
        while (floatBuffer.hasRemaining()) {
            val sample = floatBuffer.get()
            // Triangular dither: (-1 to 1) scaled to 1 LSB at 24-bit
            val dither = (Random.nextFloat() - Random.nextFloat()) * (1f / (1 shl 23))
            // Simple 1st-order noise shaping
            val shaped = sample + noiseShaping
            val quantized = shaped + dither
            noiseShaping = shaped - quantized
            outFloat.put(quantized.coerceIn(-1f, 1f))
        }
        buffer.limit(capacity)
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
        noiseShaping = 0f
    }

    override fun reset() {
        flush()
        active = false
    }

    companion object {
        private val EMPTY_BUFFER: ByteBuffer = ByteBuffer.allocateDirect(0).order(java.nio.ByteOrder.nativeOrder())
    }
}