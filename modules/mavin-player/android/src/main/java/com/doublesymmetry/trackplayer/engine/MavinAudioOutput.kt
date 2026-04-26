package com.doublesymmetry.trackplayer.engine

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import androidx.media3.common.util.UnstableApi
import com.doublesymmetry.trackplayer.dsp.UsbDacController

/**
 * MavinAudioOutput - Direct AAudio/OpenSL ES output controller.
 * Poweramp pattern: bypasses Android AudioMixer for bit-perfect output
 * to USB DAC or internal audio. Queries DAC capabilities and sets
 * native sample rate / bit depth.
 *
 * Note: Full AAudio NDK integration requires native .so library.
 * This is the Kotlin control layer that configures the output path.
 */
@UnstableApi
class MavinAudioOutput(private val context: Context) {
    private var audioTrack: AudioTrack? = null
    private var usbDacController: UsbDacController? = null
    private var nativeSampleRate: Int = 48000
    private var nativeBitDepth: Int = 16

    fun initialize(sampleRate: Int, channelCount: Int, bitDepth: Int = 16) {
        usbDacController = UsbDacController(context)
        val dacInfo = usbDacController?.getConnectedDacInfo()

        nativeSampleRate = dacInfo?.preferredSampleRate ?: sampleRate
        nativeBitDepth = dacInfo?.supportedBitDepths?.maxOrNull() ?: bitDepth

        val encoding = when (nativeBitDepth) {
            24 -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioFormat.ENCODING_PCM_FLOAT
            } else {
                AudioFormat.ENCODING_PCM_16BIT
            }
            32 -> AudioFormat.ENCODING_PCM_FLOAT
            else -> AudioFormat.ENCODING_PCM_16BIT
        }

        val channelMask = if (channelCount == 2) {
            AudioFormat.CHANNEL_OUT_STEREO
        } else {
            AudioFormat.CHANNEL_OUT_MONO
        }

        val minBufferSize = AudioTrack.getMinBufferSize(
            nativeSampleRate,
            channelMask,
            encoding
        )

        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()

        val format = AudioFormat.Builder()
            .setSampleRate(nativeSampleRate)
            .setChannelMask(channelMask)
            .setEncoding(encoding)
            .build()

        audioTrack = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioTrack.Builder()
                .setAudioAttributes(attributes)
                .setAudioFormat(format)
                .setBufferSizeInBytes(minBufferSize * 2)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
        } else {
            @Suppress("DEPRECATION")
            AudioTrack(attributes, format, minBufferSize * 2, AudioTrack.MODE_STREAM, 0)
        }

        audioTrack?.play()
    }

    fun write(buffer: ByteBuffer, size: Int) {
        audioTrack?.write(buffer, size, AudioTrack.WRITE_BLOCKING)
    }

    fun getAudioSessionId(): Int {
        return audioTrack?.audioSessionId ?: 0
    }

    fun getNativeSampleRate(): Int = nativeSampleRate
    fun getNativeBitDepth(): Int = nativeBitDepth

    fun release() {
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null
        usbDacController?.release()
        usbDacController = null
    }
}