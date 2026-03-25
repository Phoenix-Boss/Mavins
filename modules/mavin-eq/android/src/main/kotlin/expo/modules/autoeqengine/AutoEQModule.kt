package expo.modules.autoeqengine

import android.media.audiofx.DynamicsProcessing
import android.os.Build
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.*

/**
 * AutoEQModule
 *
 * 31‑band ISO graphic EQ powered by Android DynamicsProcessing (IIR).
 * Poweramp‑inspired feature set within Android’s actual constraints:
 *
 * - 31‑band ISO centers 20 Hz – 20 kHz
 * - ±15 dB per band, preamp with safe limits
 * - Stereo (2‑channel) processing
 * - Limiter always enabled
 * - Parametric (RBJ) → graphic mapping for AutoEQ curves
 *
 * NOTE:
 * - This is IIR only (DynamicsProcessing); no true FIR or block size control.
 * - RNTP (React Native Track Player) is used only on JS side to get audioSessionId.
 */
class AutoEQModule : Module() {

  companion object {
    private const val TAG = "AutoEQModule"

    // ISO 1/3‑octave centers commonly used in 31‑band pro EQ units. [web:21][web:23]
    val ISO_FREQ_CENTERS = floatArrayOf(
      20f, 25f, 31.5f, 40f, 50f, 63f, 80f, 100f, 125f, 160f,
      200f, 250f, 315f, 400f, 500f, 630f, 800f, 1000f, 1250f, 1600f,
      2000f, 2500f, 3150f, 4000f, 5000f, 6300f, 8000f, 10000f, 12500f, 16000f, 20000f
    )

    const val BAND_COUNT = 31

    // Poweramp‑style range (±15 dB) for bands; preamp is narrower to keep headroom. [web:26]
    const val GAIN_MIN_DB = -15f
    const val GAIN_MAX_DB = 15f

    const val PREAMP_MIN_DB = -12f
    const val PREAMP_MAX_DB = 6f

    const val DEFAULT_SAMPLE_RATE = 48_000
  }

  private var dp: DynamicsProcessing? = null
  private var lastSessionId: Int = -1
  private var sampleRate: Int = DEFAULT_SAMPLE_RATE
  private var isEnabled: Boolean = false

  // Current per‑band gains (single value applied to all channels)
  private val gainsCache = FloatArray(BAND_COUNT) { 0f }

  // Preamp stored separately so JS can read it
  private var preampDb: Float = 0f

  override fun definition() = ModuleDefinition {
    Name("AutoEQModule")

    // Read-only metadata.
    // NOTE: `Prop` is only valid inside ViewManager definitions, not Module.
    // Static values go in Constants; instance-state values use Function (synchronous).
    Constants(
      "version"     to "1.0.0",
      "bandCount"   to BAND_COUNT,
      "isSupported" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
    )

    // Dynamic state: readable synchronously from JS via NativeModules.AutoEQModule.getSampleRate() etc.
    Function("getSampleRate") { sampleRate }
    Function("getIsActive")   { dp != null && isEnabled }
    Function("getPreamp")     { preampDb }

    /**
     * setupEQ(audioSessionId: int, sampleRateHz?: int)
     *
     * Must be called AFTER RNTP has started playback and you have a valid
     * ExoPlayer audioSessionId from JS.
     */
    AsyncFunction("setupEQ") { audioSessionId: Int, sampleRateHz: Int?, promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        return@AsyncFunction promise.reject(
          "UNSUPPORTED_API",
          "DynamicsProcessing requires Android 10+ (API 29+)",
          null
        )
      }

      if (audioSessionId <= 0) {
        return@AsyncFunction promise.reject(
          "INVALID_SESSION",
          "audioSessionId must be > 0 (get it from TrackPlayer on JS).",
          null
        )
      }

      try {
        releaseInternal()

        sampleRate = sampleRateHz ?: DEFAULT_SAMPLE_RATE

        // 2‑channel (stereo), pre‑EQ + limiter only. Limiter helps avoid clipping. [web:2][web:19]
        val config = DynamicsProcessing.Config.Builder(
          DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
          /* channelCount      = */ 2,
          /* preEqInUse        = */ true,
          /* preEqBandCount    = */ BAND_COUNT,
          /* mbcInUse          = */ false,
          /* mbcBandCount      = */ 0,
          /* postEqInUse       = */ false,
          /* postEqBandCount   = */ 0,
          /* limiterInUse      = */ true
        ).build()

        val instance = DynamicsProcessing(0, audioSessionId, config)
        dp = instance

        // Start disabled; user explicitly enables when ready.
        instance.enabled = false
        isEnabled = false

        // Flat initial state
        preampDb = 0f
        setAllBandsInternal(0f)

        lastSessionId = audioSessionId

        Log.i(TAG, "EQ setup for session=$audioSessionId, bands=$BAND_COUNT, fs=$sampleRate")

        promise.resolve(
          mapOf(
            "sessionId" to audioSessionId,
            "bands" to BAND_COUNT,
            "sampleRate" to sampleRate
          )
        )
      } catch (e: Exception) {
        Log.e(TAG, "setupEQ failed", e)
        promise.reject("EQ_SETUP_ERROR", e.message ?: "setupEQ failed", e)
      }
    }

    /**
     * getAudioSessionId()
     * Returns cached sessionId or -1 if EQ not attached.
     */
    AsyncFunction("getAudioSessionId") { promise: Promise ->
      promise.resolve(if (lastSessionId > 0) lastSessionId else -1)
    }

    /**
     * setPreamp(db: number)
     * Poweramp‑style preamp within safe range.
     */
    AsyncFunction("setPreamp") { db: Double, promise: Promise ->
      if (!hasInstance()) {
        return@AsyncFunction promise.reject("EQ_NOT_READY", "Call setupEQ first", null)
      }

      val clamped = db.toFloat().coerceIn(PREAMP_MIN_DB, PREAMP_MAX_DB)
      preampDb = clamped
      // We don’t have a separate preamp stage in DynamicsProcessing,
      // but we can incorporate preamp into band gains when using AutoEQ
      // (e.g., see setParametricFilters).
      promise.resolve(mapOf("preamp" to clamped))
    }

    /**
     * setBand(index: int, gainDb: number)
     * Single‑band gain, applied to all channels.
     */
    AsyncFunction("setBand") { index: Int, gainDb: Double, promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_READY", "Call setupEQ before setBand", null
      )

      if (index !in 0 until BAND_COUNT) {
        return@AsyncFunction promise.reject(
          "INVALID_INDEX", "Band index must be in 0..${BAND_COUNT - 1}", null
        )
      }

      val clamped = gainDb.toFloat().coerceIn(GAIN_MIN_DB, GAIN_MAX_DB)
      try {
        instance.setPreEqBandAllChannelsTo(
          index,
          DynamicsProcessing.EqBand(
            /* enabled */ true,
            /* frequency */ ISO_FREQ_CENTERS[index],
            /* gain */ clamped
          )
        )
        gainsCache[index] = clamped
        promise.resolve(
          mapOf(
            "band" to index,
            "frequency" to ISO_FREQ_CENTERS[index],
            "gain" to clamped
          )
        )
      } catch (e: Exception) {
        promise.reject("BAND_ERROR", e.message ?: "setBand failed", e)
      }
    }

    /**
     * applyBands(gains: number[31])
     * Batch apply ISO 31‑band gains.
     */
    AsyncFunction("applyBands") { gains: List<Double>, promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_READY", "Call setupEQ before applyBands", null
      )

      if (gains.size != BAND_COUNT) {
        return@AsyncFunction promise.reject(
          "INVALID_GAINS",
          "Expected exactly $BAND_COUNT gain values.",
          null
        )
      }

      try {
        for (i in 0 until BAND_COUNT) {
          val g = gains[i].toFloat().coerceIn(GAIN_MIN_DB, GAIN_MAX_DB)
          instance.setPreEqBandAllChannelsTo(
            i,
            DynamicsProcessing.EqBand(true, ISO_FREQ_CENTERS[i], g)
          )
          gainsCache[i] = g
        }
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("APPLY_ERROR", e.message ?: "applyBands failed", e)
      }
    }

    /**
     * setParametricFilters(filters: Filter[], preampDb: number)
     *
     * filters: { type: "PK" | "LS" | "HS", fc: number, gain: number, q: number }[]
     * Maps parametric AutoEQ filters onto ISO bands via RBJ magnitude evaluation. [web:5][web:7]
     */
    AsyncFunction("setParametricFilters") {
        filters: List<Map<String, Any>>,
        preampDbInput: Double,
        promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_READY", "Call setupEQ before setParametricFilters", null
      )

      val preamp = preampDbInput.toFloat().coerceIn(PREAMP_MIN_DB, PREAMP_MAX_DB)
      preampDb = preamp

      try {
        val bandGains = FloatArray(BAND_COUNT) { preamp }

        for (f in filters) {
          val type = (f["filter_type"] as? String
            ?: f["type"] as? String
            ?: "PK").uppercase()
          val fc = toDouble(f["fc"]) ?: 1000.0
          val gain = toDouble(f["gain_db"]) ?: toDouble(f["gain"]) ?: 0.0
          val q = toDouble(f["q"]) ?: 1.0

          for (i in 0 until BAND_COUNT) {
            val fBand = ISO_FREQ_CENTERS[i].toDouble()
            val contrib = computeFilterGainAtFreq(
              type,
              fc,
              gain,
              q,
              fBand,
              sampleRate.toDouble()
            )
            bandGains[i] += contrib.toFloat()
          }
        }

        // Clamp & apply
        for (i in 0 until BAND_COUNT) {
          val g = bandGains[i].coerceIn(GAIN_MIN_DB, GAIN_MAX_DB)
          instance.setPreEqBandAllChannelsTo(
            i,
            DynamicsProcessing.EqBand(true, ISO_FREQ_CENTERS[i], g)
          )
          gainsCache[i] = g
        }

        promise.resolve(
          mapOf(
            "filtersApplied" to filters.size,
            "preamp" to preamp,
            "bandsUpdated" to BAND_COUNT
          )
        )
      } catch (e: Exception) {
        promise.reject("PARAMETRIC_ERROR", e.message ?: "setParametricFilters failed", e)
      }
    }

    /**
     * getGains()
     * Returns current band gains from cache.
     */
    AsyncFunction("getGains") { promise: Promise ->
      val list = gainsCache.mapIndexed { index, gain ->
        mapOf(
          "band" to index,
          "frequency" to ISO_FREQ_CENTERS[index],
          "gain" to gain.toDouble()
        )
      }
      promise.resolve(list)
    }

    /**
     * setEnabled(enabled: boolean)
     */
    AsyncFunction("setEnabled") { enabled: Boolean, promise: Promise ->
      val instance = dp ?: return@AsyncFunction promise.reject(
        "EQ_NOT_READY", "Call setupEQ before setEnabled", null
      )
      try {
        instance.enabled = enabled
        isEnabled = enabled
        Log.i(TAG, "EQ ${if (enabled) "enabled" else "disabled"}")
        promise.resolve(mapOf("enabled" to enabled))
      } catch (e: Exception) {
        promise.reject("TOGGLE_ERROR", e.message ?: "setEnabled failed", e)
      }
    }

    /**
     * reset()
     * Flat 0 dB across all bands, preamp 0 dB.
     */
    AsyncFunction("reset") { promise: Promise ->
      if (!hasInstance()) {
        return@AsyncFunction promise.reject("EQ_NOT_READY", "Call setupEQ first", null)
      }
      try {
        preampDb = 0f
        setAllBandsInternal(0f)
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("RESET_ERROR", e.message ?: "reset failed", e)
      }
    }

    /**
     * release()
     * Detach from session and free resources.
     */
    AsyncFunction("release") { promise: Promise ->
      try {
        releaseInternal()
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("RELEASE_ERROR", e.message ?: "release failed", e)
      }
    }
  }

  // Internal helpers

  private fun hasInstance(): Boolean = dp != null && lastSessionId > 0

  private fun setAllBandsInternal(gainDb: Float) {
    val instance = dp ?: return
    for (i in 0 until BAND_COUNT) {
      instance.setPreEqBandAllChannelsTo(
        i,
        DynamicsProcessing.EqBand(true, ISO_FREQ_CENTERS[i], gainDb)
      )
      gainsCache[i] = gainDb
    }
  }

  private fun releaseInternal() {
    dp?.let {
      try {
        it.enabled = false
        it.release()
      } catch (_: Exception) {
        // ignore
      }
    }
    dp = null
    lastSessionId = -1
    isEnabled = false
    preampDb = 0f
    gainsCache.fill(0f)
    Log.i(TAG, "EQ released")
  }

  /**
   * RBJ biquad magnitude response at frequency f (in Hz).
   * Returns gain contribution in dB. [web:5][web:7]
   */
  private fun computeFilterGainAtFreq(
    type: String,
    fc: Double,
    gainDb: Double,
    q: Double,
    f: Double,
    fs: Double
  ): Double {
    if (f <= 0.0 || fc <= 0.0 || q <= 0.0) return 0.0

    val w0 = 2 * PI * fc / fs
    val wf = 2 * PI * f / fs
    val A = 10.0.pow(gainDb / 40.0)
    val alpha = sin(w0) / (2.0 * q)

    val cosW0 = cos(w0)
    val b0: Double; val b1: Double; val b2: Double
    val a0: Double; val a1: Double; val a2: Double

    when (type.uppercase()) {
      "PK", "PEAK", "PEAKING" -> {
        b0 = 1 + alpha * A
        b1 = -2 * cosW0
        b2 = 1 - alpha * A
        a0 = 1 + alpha / A
        a1 = -2 * cosW0
        a2 = 1 - alpha / A
      }
      "LS", "LOWSHELF", "LOW_SHELF" -> {
        val sqrtA = sqrt(A)
        val twoSqrtAAlpha = 2 * sqrtA * alpha
        b0 = A * ((A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha)
        b1 = 2 * A * ((A - 1) - (A + 1) * cosW0)
        b2 = A * ((A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha)
        a0 = (A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha
        a1 = -2 * ((A - 1) + (A + 1) * cosW0)
        a2 = (A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha
      }
      "HS", "HIGHSHELF", "HIGH_SHELF" -> {
        val sqrtA = sqrt(A)
        val twoSqrtAAlpha = 2 * sqrtA * alpha
        b0 = A * ((A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha)
        b1 = -2 * A * ((A - 1) + (A + 1) * cosW0)
        b2 = A * ((A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha)
        a0 = (A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha
        a1 = 2 * ((A - 1) - (A + 1) * cosW0)
        a2 = (A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha
      }
      else -> return 0.0
    }

    val cosWf = cos(wf)
    val sinWf = sin(wf)
    val cos2Wf = cos(2 * wf)
    val sin2Wf = sin(2 * wf)

    val numR = b0 + b1 * cosWf + b2 * cos2Wf
    val numI = -(b1 * sinWf + b2 * sin2Wf)
    val denR = a0 + a1 * cosWf + a2 * cos2Wf
    val denI = -(a1 * sinWf + a2 * sin2Wf)

    val numMag2 = numR * numR + numI * numI
    val denMag2 = denR * denR + denI * denI
    if (denMag2 < 1e-30) return 0.0

    return 10.0 * log10(numMag2 / denMag2)
  }

  private fun toDouble(v: Any?): Double? =
    when (v) {
      is Number -> v.toDouble()
      is String -> v.toDoubleOrNull()
      else -> null
    }
}