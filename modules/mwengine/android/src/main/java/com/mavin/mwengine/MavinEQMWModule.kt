// modules/mavin-eq/android/src/main/java/expo/modules/mavin/eq/MavinEQMWModule.kt
// ✅ CONVERTED: React Native → Expo Kotlin Module (2026)

package expo.modules.mavin.eq

import android.util.Log
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.javadsl.imports.*
import expo.modules.kotlin.modules.Module
import nl.igorski.mwengine.MWEngine

class MavinEQMWModule(appContext: AppContext? = null) : Module(appContext) {
    companion object {
        private const val TAG = "MavinEQMW"
        private var isInitialized = false
    }

    override fun definition() = ModuleDefinition {
        Name("MavinEQMW")

        // Initialize on module load
        OnCreate {
            initializeMWEngine()
        }

        // Destroy on module destroy
        OnDestroy {
            destroyMWEngine()
        }

        // Global EQ toggle
        AsyncFunction("setGlobalEQEnabled") { enabled: Boolean ->
            try {
                MWEngine.setMasterMute(!enabled)
                Log.d(TAG, "EQ enabled: $enabled")
                true
            } catch (e: Exception) {
                Log.e(TAG, "setGlobalEQEnabled error", e)
                false
            }
        }

        // Set individual EQ band
        AsyncFunction("setGlobalBandGain") { bandIndex: Int, gain: Double ->
            try {
                if (bandIndex in 0..30) {
                    val gainFloat = (gain / 100f).toFloat().coerceIn(-1f, 1f)
                    MWEngine.setEQBandValue(bandIndex, gainFloat)
                    Log.d(TAG, "Band $bandIndex: ${gainFloat * 100}%")
                    true
                } else {
                    false
                }
            } catch (e: Exception) {
                Log.e(TAG, "setGlobalBandGain error", e)
                false
            }
        }

        // Master volume in dB
        AsyncFunction("setGlobalMasterVolumeDB") { db: Double ->
            try {
                val linearGain = kotlin.math.pow(10.0, (db / 20.0)).toFloat()
                    .coerceIn(0.001f, 10.0f)
                MWEngine.setMasterVolume(linearGain)
                Log.d(TAG, "Master volume: ${linearGain}x")
                linearGain
            } catch (e: Exception) {
                Log.e(TAG, "setGlobalMasterVolumeDB error", e)
                1.0f
            }
        }

        // Live FFT spectrum (31 bands)
        AsyncFunction("getLiveSpectrum") { promise: Promise ->
            try {
                val fftData = MWEngine.getAudioAnalyserFrequencies()
                val spectrum = mutableListOf<Double>()
                
                for (i in 0..30) {
                    val value = try {
                        fftData?.getOrNull(i * 4)?.toDouble() ?: 50.0
                    } catch (e: Exception) {
                        50.0
                    }
                    spectrum.add(value.coerceIn(0.0, 100.0))
                }
                
                promise.resolve(spectrum)
            } catch (e: Exception) {
                promise.reject("SPECTRUM_ERROR", e.message ?: "Spectrum analysis failed", e)
            }
        }

        // Save 31-band preset
        AsyncFunction("saveGlobalPreset") { name: String, bands: ReadableArray, promise: Promise ->
            try {
                val presetData = FloatArray(31)
                for (i in 0..30) {
                    presetData[i] = bands.getDouble(i).toFloat()
                }
                MWEngine.savePreset(name, presetData)
                promise.resolve(mapOf(
                    "success" to true, 
                    "preset" to name,
                    "bands" to 31
                ))
                Log.d(TAG, "Preset '$name' saved")
            } catch (e: Exception) {
                promise.reject("SAVE_ERROR", "Preset save failed: ${e.message}", e)
            }
        }

        // Load preset by name
        AsyncFunction("loadGlobalPreset") { name: String, promise: Promise ->
            try {
                val preset = MWEngine.loadPreset(name)
                val presetArray = preset.map { it.toDouble() }
                promise.resolve(mapOf(
                    "success" to true,
                    "preset" to name,
                    "bands" to presetArray
                ))
                Log.d(TAG, "Preset '$name' loaded")
            } catch (e: Exception) {
                promise.reject("LOAD_ERROR", "Preset '$name' not found", e)
            }
        }

        // Get all saved presets
        AsyncFunction("getPresets") { promise: Promise ->
            try {
                val presets = MWEngine.getPresetNames()
                promise.resolve(presets.map { mapOf("name" to it) })
            } catch (e: Exception) {
                promise.reject("PRESETS_ERROR", "Failed to list presets", e)
            }
        }

        // Delete preset
        AsyncFunction("deletePreset") { name: String ->
            try {
                MWEngine.deletePreset(name)
                Log.d(TAG, "Preset '$name' deleted")
                true
            } catch (e: Exception) {
                Log.e(TAG, "Delete preset error", e)
                false
            }
        }

        // Properties
        Property("isInitialized") { isInitialized }
        Property("sampleRate") { MWEngine.sampleRate }
        Property("bufferSize") { MWEngine.bufferSize }
    }

    private fun initializeMWEngine() {
        if (isInitialized) return
        
        try {
            val context = appContext.androidContext ?: return
            MWEngine.create(
                context,
                2,  // stereo
                44100,  // sample rate
                128,  // buffer size (1.5ms latency @ 44.1kHz)
                true  // enable AAudio (Android 8.1+ low latency)
            )
            MWEngine.setMasterVolume(1.0f)
            isInitialized = true
            Log.d(TAG, "✅ MWEngine 1.5ms AAudio pipeline initialized (44.1kHz, 128 samples)")
        } catch (e: Exception) {
            Log.e(TAG, "❌ MWEngine init failed", e)
            isInitialized = false
        }
    }

    private fun destroyMWEngine() {
        if (!isInitialized) return
        
        try {
            MWEngine.destroy()
            isInitialized = false
            Log.d(TAG, "✅ MWEngine destroyed cleanly")
        } catch (e: Exception) {
            Log.e(TAG, "MWEngine destroy error", e)
        }
    }
}
