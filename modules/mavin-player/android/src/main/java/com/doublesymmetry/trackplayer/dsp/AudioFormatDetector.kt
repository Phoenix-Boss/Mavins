package com.doublesymmetry.trackplayer.dsp

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.MediaCodecList
import android.os.Build
import android.util.Log
import androidx.media3.common.MimeTypes
import java.util.concurrent.atomic.AtomicReference

/**
 * AudioFormatDetector â€” Hi-resolution audio capability detection.
 *
 * Detects the actual PCM encoding and sample rate capabilities of the current
 * audio output device (built-in DAC or USB DAC). Results are cached and
 * invalidated automatically when a USB device is connected / disconnected.
 */
class AudioFormatDetector(private val context: Context) {

    companion object {
        private const val TAG = "AudioFormatDetector"

        val STANDARD_RATES    = intArrayOf(44100, 48000)
        val HIGH_RES_RATES    = intArrayOf(88200, 96000, 176400, 192000)
        val ULTRA_HIGH_RATES  = intArrayOf(352800, 384000, 705600, 768000)
        val ALL_RATES         = STANDARD_RATES + HIGH_RES_RATES + ULTRA_HIGH_RATES

        const val BIT_DEPTH_16    = 16
        const val BIT_DEPTH_24    = 24
        const val BIT_DEPTH_32    = 32
        const val BIT_DEPTH_FLOAT = 32

        // AudioFormat.ENCODING_PCM_24BIT_PACKED = API 31
        private const val ENCODING_PCM_24BIT_PACKED = 0x80000004.toInt()
    }

    data class AudioCapabilities(
        val maxSampleRate: Int,
        val maxBitDepth: Int,
        val supportsFloat: Boolean,
        val supportsHdAudio: Boolean,
        val supportsUltraHdAudio: Boolean,
        val supportedSampleRates: List<Int>,
        val supportedBitDepths: List<Int>,
        val nativeOutputFormat: Int,
        val isHiResCapable: Boolean
    )

    data class OptimalFormat(
        val sampleRate: Int,
        val bitDepth: Int,
        val encoding: Int,
        val isFloat: Boolean,
        val isHiRes: Boolean,
        val channelCount: Int
    )

    private val cachedCapabilities = AtomicReference<AudioCapabilities?>(null)
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // PUBLIC API
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    fun getAudioCapabilities(): AudioCapabilities {
        cachedCapabilities.get()?.let { return it }
        val caps = detectAudioCapabilities()
        cachedCapabilities.set(caps)
        Log.i(TAG, "Audio capabilities: maxRate=${caps.maxSampleRate}Hz, maxDepth=${caps.maxBitDepth}-bit, float=${caps.supportsFloat}, hiRes=${caps.supportsHdAudio}")
        return caps
    }

    fun getOptimalFormat(preferredRate: Int = 48000, preferredDepth: Int = 24): OptimalFormat {
        val caps = getAudioCapabilities()

        val sampleRate = when {
            caps.supportedSampleRates.contains(preferredRate) -> preferredRate
            caps.supportedSampleRates.contains(192000)        -> 192000
            caps.supportedSampleRates.contains(96000)         -> 96000
            caps.supportedSampleRates.contains(48000)         -> 48000
            else -> caps.supportedSampleRates.maxOrNull() ?: 48000
        }

        val bitDepth = when {
            caps.supportedBitDepths.contains(preferredDepth) -> preferredDepth
            caps.supportedBitDepths.contains(32)             -> 32
            caps.supportedBitDepths.contains(24)             -> 24
            else                                             -> 16
        }

        val (encoding, isFloat) = when {
            caps.supportsFloat && bitDepth == 32 ->
                Pair(AudioFormat.ENCODING_PCM_FLOAT, true)
            bitDepth == 32 ->
                Pair(AudioFormat.ENCODING_PCM_32BIT, false)
            bitDepth == 24 ->
                Pair(if (Build.VERSION.SDK_INT >= 31) ENCODING_PCM_24BIT_PACKED else AudioFormat.ENCODING_PCM_16BIT, false)
            else ->
                Pair(AudioFormat.ENCODING_PCM_16BIT, false)
        }

        return OptimalFormat(
            sampleRate   = sampleRate,
            bitDepth     = bitDepth,
            encoding     = encoding,
            isFloat      = isFloat,
            isHiRes      = sampleRate >= 96000 || bitDepth >= 24,
            channelCount = 2
        )
    }

    fun isSampleRateSupported(rate: Int): Boolean = getAudioCapabilities().supportedSampleRates.contains(rate)
    fun isBitDepthSupported(depth: Int): Boolean  = getAudioCapabilities().supportedBitDepths.contains(depth)
    fun isHdAudioCapable(): Boolean               = getAudioCapabilities().supportsHdAudio
    fun isUltraHdAudioCapable(): Boolean          = getAudioCapabilities().supportsUltraHdAudio
    fun getMaxSampleRate(): Int                   = getAudioCapabilities().maxSampleRate
    fun getMaxBitDepth(): Int                     = getAudioCapabilities().maxBitDepth

    /** Call after a USB DAC connect/disconnect event to invalidate cached values. */
    fun clearCache() {
        cachedCapabilities.set(null)
        Log.d(TAG, "Audio capabilities cache cleared")
    }

    fun canOutputNativeRate(rate: Int): Boolean = getAudioCapabilities().supportedSampleRates.contains(rate)

    fun getRecommendedFormatForSource(sourceSampleRate: Int, sourceBitDepth: Int): OptimalFormat {
        val caps = getAudioCapabilities()
        val outputRate = if (caps.supportedSampleRates.contains(sourceSampleRate)) sourceSampleRate
            else caps.supportedSampleRates.minByOrNull { Math.abs(it - sourceSampleRate) } ?: 48000
        val outputDepth = when {
            caps.supportedBitDepths.contains(sourceBitDepth) -> sourceBitDepth
            caps.supportedBitDepths.contains(24)             -> 24
            else                                             -> 16
        }
        return OptimalFormat(
            sampleRate   = outputRate,
            bitDepth     = outputDepth,
            encoding     = if (outputDepth == 32 && caps.supportsFloat) AudioFormat.ENCODING_PCM_FLOAT else AudioFormat.ENCODING_PCM_16BIT,
            isFloat      = outputDepth == 32 && caps.supportsFloat,
            isHiRes      = outputRate >= 96000 || outputDepth >= 24,
            channelCount = 2
        )
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // DETECTION
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private fun detectAudioCapabilities(): AudioCapabilities {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) detectViaAudioManager()
        else detectViaCodecList()
    }

    private fun detectViaAudioManager(): AudioCapabilities {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return detectViaCodecList()

        val supportedRates = mutableSetOf<Int>()
        var maxRate = 48000
        var supportsFloat = false

        val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)

        for (device in devices) {
            // Sample rates
            val deviceRates = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) device.sampleRates else intArrayOf()
            if (deviceRates.isNotEmpty()) {
                for (rate in deviceRates) {
                    if (rate in ALL_RATES) {
                        supportedRates.add(rate)
                        if (rate > maxRate) maxRate = rate
                    }
                }
            } else {
                // Fallback â€” probe all rates
                for (rate in ALL_RATES) {
                    supportedRates.add(rate)
                    if (rate > maxRate) maxRate = rate
                }
            }

            // Float encoding
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val encodings = device.encodings
                if (encodings != null && AudioFormat.ENCODING_PCM_FLOAT in encodings) {
                    supportsFloat = true
                }
            }
        }

        if (supportedRates.isEmpty()) {
            supportedRates.addAll(STANDARD_RATES.toList())
            maxRate = 48000
        }

        val sortedRates = supportedRates.sorted()
        val hasHiRes    = sortedRates.any { it >= 96000 }
        val hasUltraHiRes = sortedRates.any { it >= 352800 }

        return AudioCapabilities(
            maxSampleRate      = maxRate,
            maxBitDepth        = detectMaxBitDepth(devices),
            supportsFloat      = supportsFloat,
            supportsHdAudio    = hasHiRes,
            supportsUltraHdAudio = hasUltraHiRes,
            supportedSampleRates = sortedRates,
            supportedBitDepths   = detectSupportedBitDepths(devices),
            nativeOutputFormat   = AudioFormat.ENCODING_PCM_16BIT,
            isHiResCapable       = hasHiRes
        )
    }

    private fun detectViaCodecList(): AudioCapabilities {
        // API < 23 â€” safe defaults only
        return AudioCapabilities(
            maxSampleRate        = 48000,
            maxBitDepth          = 16,
            supportsFloat        = false,
            supportsHdAudio      = false,
            supportsUltraHdAudio = false,
            supportedSampleRates = STANDARD_RATES.toList(),
            supportedBitDepths   = listOf(16),
            nativeOutputFormat   = AudioFormat.ENCODING_PCM_16BIT,
            isHiResCapable       = false
        )
    }

    private fun detectMaxBitDepth(devices: Array<AudioDeviceInfo>): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            for (device in devices) {
                val encodings = device.encodings ?: continue
                if (AudioFormat.ENCODING_PCM_32BIT in encodings) return 32
                if (Build.VERSION.SDK_INT >= 31 && ENCODING_PCM_24BIT_PACKED in encodings) return 24
            }
        }
        return 16
    }

    private fun detectSupportedBitDepths(devices: Array<AudioDeviceInfo>): List<Int> {
        val depths = mutableSetOf(16)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            for (device in devices) {
                val encodings = device.encodings ?: continue
                if (Build.VERSION.SDK_INT >= 31 && ENCODING_PCM_24BIT_PACKED in encodings) depths.add(24)
                if (AudioFormat.ENCODING_PCM_32BIT in encodings) depths.add(32)
            }
        }
        return depths.sorted()
    }
}
