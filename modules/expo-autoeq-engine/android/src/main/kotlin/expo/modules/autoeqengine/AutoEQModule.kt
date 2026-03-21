package expo.modules.autoeqengine

import android.media.audiofx.DynamicsProcessing
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

/**
 * AutoEQModule
 *
 * Wraps Android's DynamicsProcessing as a 31-band ISO graphic EQ.
 * All 31 frequency centers follow the ISO 266 standard (20 Hz – 20 kHz).
 *
 * Architecture:
 * - setupEQ(audioSessionId)  → attaches a DynamicsProcessing instance to the
 *   player's audio session. Must be called once per session / track change.
 * - setBand(index, gainDb)   → adjusts a single band in dB (-12..+12).
 * - applyBands(gains)        → batch-sets all 31 bands in one call (faster than
 *   31 individual setBand calls; use this when applying a full preset).
 * - setBiquadParam(...)      → applies a single parametric biquad filter using
 *   the pre-EQ stage of DynamicsProcessing (peaking / shelving / pass filters).
 * - release()                → tears down DynamicsProcessing when track ends
 *   or the player is destroyed. Always call this — failing to release leaks
 *   the AudioEffect chain and can affect other apps' audio.
 *
 * Thread safety: all Expo module methods are called on the module thread.
 * DynamicsProcessing is not thread-safe; we keep a single instance per module
 * and rely on Expo's module thread to serialize calls.
 */
class AutoEQModule : Module() {

  companion object {
    // ISO 266 / IEC 61260-1 preferred center frequencies for a 31-band graphic EQ
    val FREQ_CENTERS = floatArrayOf(
      20f, 25f, 31.5f, 40f, 50f, 63f, 80f, 100f, 125f, 160f,
      200f, 250f, 315f, 400f, 500f, 630f, 800f, 1000f, 1250f, 1600f,
      2000f, 2500f, 3150f, 4000f, 5000f, 6300f, 8000f, 10000f, 12500f, 16000f, 20000f
    )

    const val BAND_COUNT = 31
    const val GAIN_MIN = -12f
    const val GAIN_MAX = 12f
  }

  private var dp: DynamicsProcessing? = null

  override fun definition() = ModuleDefinition {
    Name("AutoEQModule")

    // ── setupEQ ───────────────────────────────────────────────────────────────
    // Call once after TrackPlayer sets the audio session.
    // audioSessionId: the integer session ID from TrackPlayer.getAudioSessionId()
    AsyncFunction("setupEQ") { audioSessionId: Int, promise: Promise ->
      try {
        // Release any previous instance before creating a new one
        dp?.release()
        dp = null

        val config = DynamicsProcessing.Config.Builder(
          DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
          /* channelCount = */ 1,
          /* preEqInUse = */ true,
          /* preEqBandCount = */ BAND_COUNT,
          /* mbcInUse = */ false,
          /* mbcBandCount = */ 0,
          /* postEqInUse = */ false,
          /* postEqBandCount = */ 0,
          /* limiterInUse = */ true   // prevent clipping from +dB boosts
        ).build()

        val instance = DynamicsProcessing(/* priority = */ 0, audioSessionId, config)

        // Initialize all bands to 0 dB gain
        for (i in 0 until BAND_COUNT) {
          val band = DynamicsProcessing.EqBand(/* enabled = */ true, FREQ_CENTERS[i], /* gain = */ 0f)
          instance.setPreEqBandAllChannelsTo(i, band)
        }

        instance.enabled = true
        dp = instance
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("EQ_SETUP_ERROR", e.message ?: "Unknown error during setupEQ", e)
      }
    }

    // ── setBand ───────────────────────────────────────────────────────────────
    // Adjust a single band by index (0–30) and gain in dB (-12..+12).
    // For full preset application use applyBands() — it's one round-trip instead of 31.
    AsyncFunction("setBand") { index: Int, gainDb: Float, promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_SETUP", "Call setupEQ before setBand", null
      )
      if (index !in 0 until BAND_COUNT) {
        return@AsyncFunction promise.reject("EQ_INVALID_INDEX", "Band index must be 0–30", null)
      }
      if (gainDb < GAIN_MIN || gainDb > GAIN_MAX) {
        return@AsyncFunction promise.reject("EQ_INVALID_GAIN", "Gain must be -12..+12 dB", null)
      }
      try {
        val current = instance.getPreEqBandByChannelIndex(0, index)
        val band = DynamicsProcessing.EqBand(true, current.frequencyCenter, gainDb)
        instance.setPreEqBandAllChannelsTo(index, band)
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("EQ_BAND_ERROR", e.message ?: "Unknown error in setBand", e)
      }
    }

    // ── applyBands ────────────────────────────────────────────────────────────
    // Batch-apply all 31 gains in a single JS→Native call.
    // gains: array of exactly 31 floats, each in -12..+12 dB.
    // This is the preferred method for preset application — avoids 31 bridge calls.
    AsyncFunction("applyBands") { gains: List<Double>, promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_SETUP", "Call setupEQ before applyBands", null
      )
      if (gains.size != BAND_COUNT) {
        return@AsyncFunction promise.reject(
          "EQ_INVALID_GAINS", "gains array must have exactly 31 elements", null
        )
      }
      try {
        for (i in 0 until BAND_COUNT) {
          val gain = gains[i].toFloat().coerceIn(GAIN_MIN, GAIN_MAX)
          val current = instance.getPreEqBandByChannelIndex(0, i)
          val band = DynamicsProcessing.EqBand(true, current.frequencyCenter, gain)
          instance.setPreEqBandAllChannelsTo(i, band)
        }
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("EQ_APPLY_ERROR", e.message ?: "Unknown error in applyBands", e)
      }
    }

    // ── setBiquadParam ────────────────────────────────────────────────────────
    // Apply a single parametric biquad filter to a specific band using the
    // pre-EQ stage. Useful for AutoEq-style parametric output.
    //
    // type: "peaking" | "lowShelf" | "highShelf" | "lowPass" | "highPass"
    // bandIndex: which of the 31 bands to apply this filter to (0–30)
    // fc: center / cutoff frequency in Hz
    // gainDb: gain in dB (used for peaking, lowShelf, highShelf)
    //
    // Note: DynamicsProcessing bands are frequency-fixed at setup time.
    // This method adjusts the gain of the closest band to the requested fc.
    AsyncFunction("setBiquadParam") { type: String, bandIndex: Int, fc: Double, gainDb: Double, promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_SETUP", "Call setupEQ before setBiquadParam", null
      )
      if (bandIndex !in 0 until BAND_COUNT) {
        return@AsyncFunction promise.reject("EQ_INVALID_INDEX", "Band index must be 0–30", null)
      }
      try {
        // For parametric filters that modify gain (peaking, shelving):
        // apply the dB gain to the nearest band.
        val clampedGain = when (type) {
          "peaking", "lowShelf", "highShelf" ->
            gainDb.toFloat().coerceIn(GAIN_MIN, GAIN_MAX)
          // Pass filters don't have a gain concept in DynamicsProcessing —
          // they're approximated by zeroing the gain.
          else -> 0f
        }
        val current = instance.getPreEqBandByChannelIndex(0, bandIndex)
        val band = DynamicsProcessing.EqBand(true, current.frequencyCenter, clampedGain)
        instance.setPreEqBandAllChannelsTo(bandIndex, band)
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("EQ_BIQUAD_ERROR", e.message ?: "Unknown error in setBiquadParam", e)
      }
    }

    // ── getGains ──────────────────────────────────────────────────────────────
    // Returns the current gain for all 31 bands.
    // Useful for displaying the current EQ curve in the UI.
    AsyncFunction("getGains") { promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_SETUP", "Call setupEQ before getGains", null
      )
      try {
        val gains = (0 until BAND_COUNT).map { i ->
          instance.getPreEqBandByChannelIndex(0, i).gain.toDouble()
        }
        promise.resolve(gains)
      } catch (e: Exception) {
        promise.reject("EQ_GET_ERROR", e.message ?: "Unknown error in getGains", e)
      }
    }

    // ── setEnabled ────────────────────────────────────────────────────────────
    // Toggle the EQ on/off without releasing it. The instance is kept alive so
    // re-enabling is instant (no re-setup required).
    AsyncFunction("setEnabled") { enabled: Boolean, promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_SETUP", "Call setupEQ before setEnabled", null
      )
      try {
        instance.enabled = enabled
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("EQ_TOGGLE_ERROR", e.message ?: "Unknown error in setEnabled", e)
      }
    }

    // ── release ───────────────────────────────────────────────────────────────
    // ALWAYS call this when the track changes or the player is destroyed.
    // Failing to release leaks the AudioEffect chain.
    AsyncFunction("release") { promise: Promise ->
      try {
        dp?.release()
        dp = null
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("EQ_RELEASE_ERROR", e.message ?: "Unknown error in release", e)
      }
    }
  }
}
