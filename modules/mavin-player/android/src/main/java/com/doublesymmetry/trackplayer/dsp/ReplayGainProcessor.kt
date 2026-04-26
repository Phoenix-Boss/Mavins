package com.doublesymmetry.trackplayer.dsp

import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.nio.FloatBuffer

/**
 * ReplayGainProcessor â€” pre-gain normalization before EQ.
 * Position 0 in the DSP chain. Applies track/album gain offset.
 */
@UnstableApi
class ReplayGainProcessor : AudioProcessor {
    private var gainDb: Float = 0f
    private var enabled: Boolean = false
    private var inputAudioFormat: AudioProcessor.AudioFormat = AudioProcessor.AudioFormat.NOT_SET
    private var outputAudioFormat: AudioProcessor.AudioFormat = AudioProcessor.AudioFormat.NOT_SET
    private var active: Boolean = false
    private var buffer: ByteBuffer = EMPTY_BUFFER
    private var pendingOutput: ByteBuffer = EMPTY_BUFFER

    fun setGain(gainDb: Float) {
        this.gainDb = gainDb
        this.enabled = gainDb != 0f
    }

    override fun configure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != androidx.media3.common.C.ENCODING_PCM_FLOAT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        this.inputAudioFormat = inputAudioFormat
        outputAudioFormat = inputAudioFormat
        active = enabled
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
        val gainLinear = kotlin.math.pow(10f, gainDb / 20f)
        while (floatBuffer.hasRemaining()) {
            outFloat.put(floatBuffer.get() * gainLinear)
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
    }

    override fun reset() {
        flush()
        active = false
    }

    companion object {
        private val EMPTY_BUFFER: ByteBuffer = ByteBuffer.allocateDirect(0).order(java.nio.ByteOrder.nativeOrder())
    }
}