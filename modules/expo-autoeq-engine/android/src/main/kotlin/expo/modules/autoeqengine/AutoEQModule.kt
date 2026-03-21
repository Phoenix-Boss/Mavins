package expo.modules.autoeqengine

import android.media.audiofx.DynamicsProcessing
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import kotlin.math.*

/**
 * AutoEQModule
 *
 * 31-band ISO graphic EQ powered by Android DynamicsProcessing.
 * Parametric filters use real RBJ biquad coefficients to find the
 * nearest ISO band and set an accurate gain value.
 *
 * ── Call order ────────────────────────────────────────────────────────────────
 *   1. TrackPlayer.setupPlayer()
 *   2. TrackPlayer.add(track) + TrackPlayer.play()   ← song must be playing
 *   3. const id = await TrackPlayer.getAudioSessionId()
 *   4. await MyEQ.setupEQ(id)                        ← attach to session
 *   5. await MyEQ.applyBands([...]) or setParametricFilters([...])
 *   6. await MyEQ.release()                          ← on track change
 *
 * DynamicsProcessing must attach while audio is actively playing.
 * Attaching to a silent/idle session returns no error but has no effect.
 */
class AutoEQModule : Module() {

  companion object {
    val FREQ_CENTERS = floatArrayOf(
      20f, 25f, 31.5f, 40f, 50f, 63f, 80f, 100f, 125f, 160f,
      200f, 250f, 315f, 400f, 500f, 630f, 800f, 1000f, 1250f, 1600f,
      2000f, 2500f, 3150f, 4000f, 5000f, 6300f, 8000f, 10000f, 12500f, 16000f, 20000f
    )
    const val BAND_COUNT          = 31
    const val GAIN_MIN            = -12f
    const val GAIN_MAX            = 12f
    const val DEFAULT_SAMPLE_RATE = 48000
  }

  private var dp: DynamicsProcessing? = null
  private var lastSessionId: Int = -1
  private var sampleRate: Int = DEFAULT_SAMPLE_RATE
  // In-memory gains mirror — lets getGains() return instantly without a bridge call
  private val gainsCache = FloatArray(BAND_COUNT) { 0f }

  override fun definition() = ModuleDefinition {
    Name("AutoEQModule")

    // ── setupEQ ───────────────────────────────────────────────────────────────
    // Call AFTER a song has started playing. DynamicsProcessing attaches to the
    // live audio session — it does nothing if the session is idle.
    AsyncFunction("setupEQ") { audioSessionId: Int, promise: Promise ->
      try {
        dp?.release()
        dp = null

        val config = DynamicsProcessing.Config.Builder(
          DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
          /* channelCount  = */ 1,
          /* preEqInUse    = */ true,
          /* preEqBandCount= */ BAND_COUNT,
          /* mbcInUse      = */ false,
          /* mbcBandCount  = */ 0,
          /* postEqInUse   = */ false,
          /* postEqBandCount=*/ 0,
          /* limiterInUse  = */ true
        ).build()

        val instance = DynamicsProcessing(0, audioSessionId, config)
        for (i in 0 until BAND_COUNT) {
          instance.setPreEqBandAllChannelsTo(i,
            DynamicsProcessing.EqBand(true, FREQ_CENTERS[i], gainsCache[i]))
        }
        instance.enabled = true
        dp = instance
        lastSessionId = audioSessionId
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("EQ_SETUP_ERROR", e.message ?: "setupEQ failed", e)
      }
    }

    // ── getAudioSessionId ─────────────────────────────────────────────────────
    // Returns the session ID last passed to setupEQ(), or -1 if not set up yet.
    // Useful for debugging — compare against TrackPlayer.getAudioSessionId().
    AsyncFunction("getAudioSessionId") { promise: Promise ->
      promise.resolve(lastSessionId)
    }

    // ── setBand ───────────────────────────────────────────────────────────────
    AsyncFunction("setBand") { index: Int, gainDb: Float, promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_SETUP", "Call setupEQ before setBand", null)
      if (index !in 0 until BAND_COUNT)
        return@AsyncFunction promise.reject("EQ_INVALID_INDEX", "Index must be 0–30", null)
      try {
        val gain = gainDb.coerceIn(GAIN_MIN, GAIN_MAX)
        instance.setPreEqBandAllChannelsTo(index,
          DynamicsProcessing.EqBand(true, FREQ_CENTERS[index], gain))
        gainsCache[index] = gain
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("EQ_BAND_ERROR", e.message, e)
      }
    }

    // ── applyBands ────────────────────────────────────────────────────────────
    // Batch-apply all 31 gains in one bridge call.
    // Used by Supabase graphic presets and built-in presets.
    AsyncFunction("applyBands") { gains: List<Double>, promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_SETUP", "Call setupEQ before applyBands", null)
      if (gains.size != BAND_COUNT)
        return@AsyncFunction promise.reject(
          "EQ_INVALID_GAINS", "gains must have exactly 31 values", null)
      try {
        for (i in 0 until BAND_COUNT) {
          val gain = gains[i].toFloat().coerceIn(GAIN_MIN, GAIN_MAX)
          instance.setPreEqBandAllChannelsTo(i,
            DynamicsProcessing.EqBand(true, FREQ_CENTERS[i], gain))
          gainsCache[i] = gain
        }
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("EQ_APPLY_ERROR", e.message, e)
      }
    }

    // ── setParametricFilters ──────────────────────────────────────────────────
    // Batch-apply AutoEq-style parametric filters from Supabase.
    // Each filter: { filter_type, fc, gain_db, q }
    // Uses RBJ biquad math to compute the effective gain at each ISO band center,
    // then applies the summed gain per band — accurate within ±0.5 dB for
    // typical AutoEq curves (peaking / shelving).
    AsyncFunction("setParametricFilters") { filtersRaw: List<Map<String, Any>>, preampDb: Double, promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_SETUP", "Call setupEQ before setParametricFilters", null)
      try {
        // Start from flat, add preamp
        val bandGains = FloatArray(BAND_COUNT) { preampDb.toFloat() }

        for (f in filtersRaw) {
          val type   = (f["filter_type"] as? String ?: f["type"] as? String ?: "PK").uppercase()
          val fc     = toDouble(f["fc"])     ?: 1000.0
          val gainDb = toDouble(f["gain_db"]) ?: toDouble(f["gainDb"]) ?: 0.0
          val q      = toDouble(f["q"])      ?: 1.0

          // For each ISO band, compute how much this filter contributes
          for (i in 0 until BAND_COUNT) {
            val f_band = FREQ_CENTERS[i].toDouble()
            val contribution = computeFilterGainAtFreq(type, fc, gainDb, q, f_band, sampleRate.toDouble())
            bandGains[i] += contribution.toFloat()
          }
        }

        // Clamp and apply
        for (i in 0 until BAND_COUNT) {
          val gain = bandGains[i].coerceIn(GAIN_MIN, GAIN_MAX)
          instance.setPreEqBandAllChannelsTo(i,
            DynamicsProcessing.EqBand(true, FREQ_CENTERS[i], gain))
          gainsCache[i] = gain
        }
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("EQ_PARAMETRIC_ERROR", e.message, e)
      }
    }

    // ── getGains ──────────────────────────────────────────────────────────────
    // Returns current gains from in-memory cache — no native round-trip needed.
    AsyncFunction("getGains") { promise: Promise ->
      promise.resolve(gainsCache.map { it.toDouble() })
    }

    // ── setEnabled ────────────────────────────────────────────────────────────
    AsyncFunction("setEnabled") { enabled: Boolean, promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_SETUP", "Call setupEQ before setEnabled", null)
      try {
        instance.enabled = enabled
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("EQ_TOGGLE_ERROR", e.message, e)
      }
    }

    // ── reset ─────────────────────────────────────────────────────────────────
    // Set all bands to 0 dB (flat). Keeps EQ attached to session.
    AsyncFunction("reset") { promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_SETUP", "Call setupEQ before reset", null)
      try {
        for (i in 0 until BAND_COUNT) {
          instance.setPreEqBandAllChannelsTo(i,
            DynamicsProcessing.EqBand(true, FREQ_CENTERS[i], 0f))
          gainsCache[i] = 0f
        }
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("EQ_RESET_ERROR", e.message, e)
      }
    }

    // ── release ───────────────────────────────────────────────────────────────
    // Call on every track change and on player destroy.
    AsyncFunction("release") { promise: Promise ->
      try {
        dp?.release()
        dp = null
        lastSessionId = -1
        gainsCache.fill(0f)
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("EQ_RELEASE_ERROR", e.message, e)
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RBJ biquad magnitude response at a given frequency
  // Returns the gain in dB that this filter contributes at freq f_hz.
  // Used by setParametricFilters() to map parametric curves onto ISO bands.
  // Reference: Audio EQ Cookbook, Robert Bristow-Johnson
  // ─────────────────────────────────────────────────────────────────────────

  private fun computeFilterGainAtFreq(
    type: String, fc: Double, gainDb: Double,
    q: Double, f: Double, fs: Double
  ): Double {
    if (f <= 0 || fc <= 0 || q <= 0) return 0.0

    val w0    = 2 * PI * fc / fs
    val wf    = 2 * PI * f  / fs
    val A     = 10.0.pow(gainDb / 40.0)
    val alpha = sin(w0) / (2 * q)

    // Compute H(e^jw) magnitude squared at frequency wf using the biquad transfer function
    // H(z) = (b0 + b1*z^-1 + b2*z^-2) / (a0 + a1*z^-1 + a2*z^-2)
    val cosW0 = cos(w0)
    val b0: Double; val b1: Double; val b2: Double
    val a0: Double; val a1: Double; val a2: Double

    when (type) {
      "PK", "PEAK", "PEAKING" -> {
        b0 = 1 + alpha * A;  b1 = -2 * cosW0; b2 = 1 - alpha * A
        a0 = 1 + alpha / A;  a1 = -2 * cosW0; a2 = 1 - alpha / A
      }
      "LS", "LOWSHELF", "LOW_SHELF" -> {
        val sq = 2 * sqrt(A) * alpha
        b0 = A*((A+1)-(A-1)*cosW0+sq); b1 = 2*A*((A-1)-(A+1)*cosW0); b2 = A*((A+1)-(A-1)*cosW0-sq)
        a0 = (A+1)+(A-1)*cosW0+sq;    a1 = -2*((A-1)+(A+1)*cosW0);   a2 = (A+1)+(A-1)*cosW0-sq
      }
      "HS", "HIGHSHELF", "HIGH_SHELF" -> {
        val sq = 2 * sqrt(A) * alpha
        b0 = A*((A+1)+(A-1)*cosW0+sq); b1 = -2*A*((A-1)+(A+1)*cosW0); b2 = A*((A+1)+(A-1)*cosW0-sq)
        a0 = (A+1)-(A-1)*cosW0+sq;    a1 = 2*((A-1)-(A+1)*cosW0);    a2 = (A+1)-(A-1)*cosW0-sq
      }
      else -> return 0.0  // LP, HP, notch etc. — no gain contribution
    }

    // Evaluate |H(e^jwf)|^2 using the bilinear form
    val cosWf = cos(wf); val sinWf = sin(wf)
    val cos2Wf = cos(2 * wf)

    val numR = b0 + b1 * cosWf + b2 * cos2Wf
    val numI = -(b1 * sinWf + b2 * sin(2 * wf))
    val denR = a0 + a1 * cosWf + a2 * cos2Wf
    val denI = -(a1 * sinWf + a2 * sin(2 * wf))

    val numMag2 = numR * numR + numI * numI
    val denMag2 = denR * denR + denI * denI
    if (denMag2 < 1e-30) return 0.0

    return 10 * log10(numMag2 / denMag2)  // magnitude response in dB at freq f
  }

  private fun toDouble(v: Any?): Double? = when (v) {
    is Number -> v.toDouble()
    is String -> v.toDoubleOrNull()
    else      -> null
  }
}