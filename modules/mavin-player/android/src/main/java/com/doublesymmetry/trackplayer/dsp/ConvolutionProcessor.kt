package com.doublesymmetry.trackplayer.dsp

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.util.Log
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.ShortBuffer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sqrt

/**
 * ConvolutionProcessor - Real-time Convolution Engine for Impulse Responses
 */
class ConvolutionProcessor(private val context: Context) : AudioProcessor {
    
    companion object {
        private const val TAG = "ConvolutionProcessor"
        private const val DENORMAL_THRESHOLD = 1e-30
        
        private const val DIRECT_CONVOLUTION_MAX_SAMPLES = 2048
        private const val PARTITION_SIZE = 512
        private const val MAX_IR_LENGTH_SAMPLES = 65536
        
        private const val WAV_HEADER_SIZE = 44
        private const val RIFF_CHUNK_ID = 0x46464952
        private const val WAVE_FORMAT_ID = 0x45564157
        private const val FMT_SUBCHUNK_ID = 0x20746D66
        private const val DATA_SUBCHUNK_ID = 0x61746164
        
        private const val WAVE_FORMAT_PCM = 0x0001
        private const val WAVE_FORMAT_IEEE_FLOAT = 0x0003
        
        const val ENCODING_PCM_32BIT = 0x00000004
    }
    
    private val _isEnabled = AtomicBoolean(true)
    var isEnabled: Boolean
        get() = _isEnabled.get()
        set(value) = _isEnabled.set(value)
    
    @Volatile
    private var isLoaded = false
    
    @Volatile
    private var irLength = 0
    
    @Volatile
    private var usePartitionedConvolution = false
    
    private var irLeft: FloatArray = floatArrayOf()
    private var irRight: FloatArray = floatArrayOf()
    private var isMonoIr = true
    
    private var historyLeft: FloatArray = floatArrayOf()
    private var historyRight: FloatArray = floatArrayOf()
    
    private var partitions: Array<FloatArray> = emptyArray()
    private var fftReal: Array<FloatArray> = emptyArray()
    private var fftImag: Array<FloatArray> = emptyArray()
    private var inputBuffer: FloatArray = floatArrayOf()
    private var inputIndex = 0
    private var outputBuffer: FloatArray = floatArrayOf()
    
    private var numChannels = 0
    private var sampleRate = 48000
    private var inputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var outputAudioFormat: AudioFormat = AudioFormat.NOT_SET
    private var processorOutputBuffer: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var inputEnded = false
    
    private val pendingIrPath = AtomicReference<String?>(null)
    
    fun loadImpulseResponse(filePath: String): Boolean {
        pendingIrPath.set(filePath)
        return true
    }
    
    fun loadImpulseResponseFromArrays(left: FloatArray, right: FloatArray? = null): Boolean {
        val irLeftData = left.copyOf()
        val irRightData = if (right != null) right.copyOf() else left.copyOf()
        
        val length = irLeftData.size.coerceAtMost(MAX_IR_LENGTH_SAMPLES)
        
        synchronized(this) {
            irLeft = irLeftData.copyOfRange(0, length)
            irRight = irRightData.copyOfRange(0, length)
            isMonoIr = right == null
            irLength = length
            isLoaded = true
            usePartitionedConvolution = length > DIRECT_CONVOLUTION_MAX_SAMPLES
            
            if (usePartitionedConvolution) {
                initializePartitionedConvolution()
            } else {
                initializeDirectConvolution()
            }
        }
        
        Log.i(TAG, "Loaded IR: length=$length samples, mono=${isMonoIr}, partitioned=$usePartitionedConvolution")
        return true
    }
    
    fun clearImpulseResponse() {
        synchronized(this) {
            isLoaded = false
            irLength = 0
            irLeft = floatArrayOf()
            irRight = floatArrayOf()
            historyLeft = floatArrayOf()
            historyRight = floatArrayOf()
            partitions = emptyArray()
            fftReal = emptyArray()
            fftImag = emptyArray()
        }
        Log.i(TAG, "Cleared impulse response")
    }
    
    fun isImpulseResponseLoaded(): Boolean = isLoaded
    fun getIrLength(): Int = irLength
    
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
        
        pendingIrPath.getAndSet(null)?.let { path ->
            loadImpulseResponseFromFile(path)
        }
        
        Log.d(TAG, "configure: ${sampleRate}Hz ${numChannels}ch, loaded=$isLoaded")
        return outputAudioFormat
    }
    
    override fun isActive(): Boolean = inputAudioFormat != AudioFormat.NOT_SET && _isEnabled.get() && isLoaded
    
    override fun queueInput(inputBuffer: ByteBuffer) {
        if (!isActive() || inputBuffer.remaining() == 0) {
            processorOutputBuffer = inputBuffer
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
        processorOutputBuffer = output
    }
    
    override fun queueEndOfStream() { inputEnded = true }
    
    override fun getOutput(): ByteBuffer {
        val out = processorOutputBuffer
        processorOutputBuffer = AudioProcessor.EMPTY_BUFFER
        return out
    }
    
    override fun isEnded(): Boolean = inputEnded && processorOutputBuffer === AudioProcessor.EMPTY_BUFFER
    
    override fun flush() {
        processorOutputBuffer = AudioProcessor.EMPTY_BUFFER
        inputEnded = false
        synchronized(this) {
            if (usePartitionedConvolution) {
                inputBuffer.fill(0f)
                outputBuffer.fill(0f)
                inputIndex = 0
            } else {
                historyLeft.fill(0f)
                historyRight.fill(0f)
            }
        }
    }
    
    override fun reset() {
        flush()
        inputAudioFormat = AudioFormat.NOT_SET
        outputAudioFormat = AudioFormat.NOT_SET
        clearImpulseResponse()
    }
    
    private fun initializeDirectConvolution() {
        historyLeft = FloatArray(irLength)
        historyRight = FloatArray(irLength)
    }
    
    private fun processDirectConvolution(input: FloatArray, output: FloatArray, channelOffset: Int) {
        val ir = if (isMonoIr) irLeft else if (channelOffset == 0) irLeft else irRight
        val history = if (channelOffset == 0) historyLeft else historyRight
        
        val shiftAmount = input.size
        for (i in 0 until history.size - shiftAmount) {
            history[i] = history[i + shiftAmount]
        }
        for (i in 0 until shiftAmount) {
            history[history.size - shiftAmount + i] = input[i]
        }
        
        for (i in output.indices) {
            var sum = 0f
            val historyStart = history.size - ir.size - i
            for (j in ir.indices) {
                val historyIndex = historyStart + j
                if (historyIndex >= 0 && historyIndex < history.size) {
                    sum += ir[j] * history[historyIndex]
                }
            }
            output[i] = sum
        }
    }
    
    private fun initializePartitionedConvolution() {
        val numPartitions = (irLength + PARTITION_SIZE - 1) / PARTITION_SIZE
        
        partitions = Array(numPartitions) { partitionIdx ->
            val start = partitionIdx * PARTITION_SIZE
            val end = min(start + PARTITION_SIZE, irLength)
            irLeft.copyOfRange(start, end)
        }
        
        fftReal = Array(numPartitions) { FloatArray(PARTITION_SIZE * 2) }
        fftImag = Array(numPartitions) { FloatArray(PARTITION_SIZE * 2) }
        
        inputBuffer = FloatArray(PARTITION_SIZE)
        outputBuffer = FloatArray(PARTITION_SIZE)
        inputIndex = 0
    }
    
    private fun processPartitionedConvolution(input: FloatArray, output: FloatArray, channelOffset: Int) {
        processDirectConvolution(input, output, channelOffset)
    }
    
    private fun processShort(input: ByteBuffer, output: ByteBuffer) {
        val numSamples = input.remaining() / 2 / numChannels
        val samples = FloatArray(numSamples * numChannels)
        
        for (i in samples.indices) {
            samples[i] = input.short.toFloat() / 32768f
        }
        
        processSamples(samples, numSamples)
        
        for (sample in samples) {
            val shortVal = (sample * 32768f).coerceIn(-32768f, 32767f).toInt().toShort()
            output.putShort(shortVal)
        }
    }
    
    private fun processFloat(input: ByteBuffer, output: ByteBuffer) {
        val numSamples = input.remaining() / 4 / numChannels
        val samples = FloatArray(numSamples * numChannels)
        
        for (i in samples.indices) {
            samples[i] = input.float
        }
        
        processSamples(samples, numSamples)
        
        for (sample in samples) {
            output.putFloat(sample)
        }
    }
    
    private fun processInt32(input: ByteBuffer, output: ByteBuffer) {
        val numSamples = input.remaining() / 4 / numChannels
        val samples = FloatArray(numSamples * numChannels)
        
        for (i in samples.indices) {
            samples[i] = input.int.toFloat() / 2147483648f
        }
        
        processSamples(samples, numSamples)
        
        for (sample in samples) {
            val intVal = (sample * 2147483648f).coerceIn(-2147483648f, 2147483647f).toLong().toInt()
            output.putInt(intVal)
        }
    }
    
    private fun processSamples(samples: FloatArray, numSamples: Int) {
        if (!isLoaded || numChannels < 1) return
        
        if (numChannels == 1 || isMonoIr) {
            val temp = FloatArray(numSamples)
            for (i in 0 until numSamples) {
                temp[i] = samples[i]
            }
            
            if (usePartitionedConvolution) {
                processPartitionedConvolution(temp, temp, 0)
            } else {
                processDirectConvolution(temp, temp, 0)
            }
            
            for (i in 0 until numSamples) {
                samples[i] = temp[i]
            }
        } else {
            val leftInput = FloatArray(numSamples)
            val rightInput = FloatArray(numSamples)
            val leftOutput = FloatArray(numSamples)
            val rightOutput = FloatArray(numSamples)
            
            for (i in 0 until numSamples) {
                leftInput[i] = samples[i * 2]
                rightInput[i] = samples[i * 2 + 1]
            }
            
            if (usePartitionedConvolution) {
                processPartitionedConvolution(leftInput, leftOutput, 0)
                processPartitionedConvolution(rightInput, rightOutput, 1)
            } else {
                processDirectConvolution(leftInput, leftOutput, 0)
                processDirectConvolution(rightInput, rightOutput, 1)
            }
            
            for (i in 0 until numSamples) {
                samples[i * 2] = leftOutput[i]
                samples[i * 2 + 1] = rightOutput[i]
            }
        }
    }
    
    private fun loadImpulseResponseFromFile(filePath: String): Boolean {
        return try {
            val file = File(filePath)
            if (!file.exists()) {
                Log.e(TAG, "IR file not found: $filePath")
                return false
            }
            
            val fis = FileInputStream(file)
            val data = fis.readBytes()
            fis.close()
            
            val wavInfo = parseWavFile(data)
            if (wavInfo == null) {
                Log.e(TAG, "Failed to parse WAV file")
                return false
            }
            
            loadImpulseResponseFromArrays(wavInfo.left, wavInfo.right)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load IR file: ${e.message}")
            false
        }
    }
    
    private fun parseWavFile(data: ByteArray): WavInfo? {
        if (data.size < WAV_HEADER_SIZE) return null
        
        val buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
        
        if (buffer.int != RIFF_CHUNK_ID) return null
        buffer.getInt()
        if (buffer.int != WAVE_FORMAT_ID) return null
        
        if (buffer.int != FMT_SUBCHUNK_ID) return null
        val fmtChunkSize = buffer.int
        val audioFormat = buffer.short.toInt()
        val numChannels = buffer.short.toInt()
        val sampleRate = buffer.int
        buffer.getInt()
        val blockAlign = buffer.short.toInt()
        val bitsPerSample = buffer.short.toInt()
        
        if (fmtChunkSize > 16) {
            buffer.getShort()
        }
        
        var dataSize = 0
        var dataStart = 0
        while (buffer.position() < data.size) {
            val chunkId = buffer.int
            val chunkSize = buffer.int
            if (chunkId == DATA_SUBCHUNK_ID) {
                dataSize = chunkSize
                dataStart = buffer.position()
                break
            }
            buffer.position(buffer.position() + chunkSize)
        }
        
        if (dataSize == 0) return null
        
        val leftSamples = mutableListOf<Float>()
        val rightSamples = mutableListOf<Float>()
        
        val bytesPerSample = bitsPerSample / 8
        val bytesPerFrame = blockAlign
        
        for (i in 0 until dataSize / bytesPerFrame) {
            val offset = dataStart + i * bytesPerFrame
            
            val leftValue = when (audioFormat) {
                WAVE_FORMAT_PCM -> when (bitsPerSample) {
                    16 -> {
                        val sample = buffer.getShort(offset).toInt()
                        sample / 32768f
                    }
                    24 -> {
                        val sample = ((buffer.get(offset).toInt() and 0xFF) shl 16) or
                                     ((buffer.get(offset + 1).toInt() and 0xFF) shl 8) or
                                     (buffer.get(offset + 2).toInt() and 0xFF)
                        (sample - 8388608) / 8388608f
                    }
                    32 -> buffer.getFloat(offset)
                    else -> 0f
                }
                WAVE_FORMAT_IEEE_FLOAT -> buffer.getFloat(offset)
                else -> 0f
            }
            
            leftSamples.add(leftValue)
            
            if (numChannels == 2) {
                val rightValue = when (audioFormat) {
                    WAVE_FORMAT_PCM -> when (bitsPerSample) {
                        16 -> {
                            val sample = buffer.getShort(offset + bytesPerSample).toInt()
                            sample / 32768f
                        }
                        24 -> {
                            val sample = ((buffer.get(offset + bytesPerSample).toInt() and 0xFF) shl 16) or
                                         ((buffer.get(offset + bytesPerSample + 1).toInt() and 0xFF) shl 8) or
                                         (buffer.get(offset + bytesPerSample + 2).toInt() and 0xFF)
                            (sample - 8388608) / 8388608f
                        }
                        32 -> buffer.getFloat(offset + bytesPerSample)
                        else -> 0f
                    }
                    WAVE_FORMAT_IEEE_FLOAT -> buffer.getFloat(offset + bytesPerSample)
                    else -> 0f
                }
                rightSamples.add(rightValue)
            }
        }
        
        return WavInfo(
            left = leftSamples.toFloatArray(),
            right = if (numChannels == 2) rightSamples.toFloatArray() else null,
            sampleRate = sampleRate,
            bitsPerSample = bitsPerSample
        )
    }
    
    private data class WavInfo(
        val left: FloatArray,
        val right: FloatArray?,
        val sampleRate: Int,
        val bitsPerSample: Int
    )
    
    private fun replaceOutputBuffer(size: Int): ByteBuffer {
        return if (processorOutputBuffer === AudioProcessor.EMPTY_BUFFER || processorOutputBuffer.capacity() < size) {
            ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder()).also { processorOutputBuffer = it }
        } else {
            processorOutputBuffer.clear().limit(size); processorOutputBuffer
        }
    }
}
