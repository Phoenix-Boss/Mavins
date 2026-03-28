package expo.modules.autoeqengine

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.audiofx.DynamicsProcessing
import android.os.Build
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.*

/**
 * AutoEQModule — Mixer-First Architecture
 *
 * ROOT CAUSE OF OLD APPROACH:
 *   DynamicsProcessing(sessionId) only binds to a real AudioFlinger stream.
 *   ExoPlayer's sessionId exists in Java immediately, but AudioFlinger doesn't
 *   register it until the first PCM frame is rendered (~300-1500ms after play()).
 *   Attaching DynamicsProcessing before that frame = silent no-op. Every retry
 *   loop, every delay, every patch was just masking this one fundamental issue.
 *
 * NEW APPROACH — Permanent Mixer AudioTrack:
 *   1. On module load, create a silent AudioTrack ("mixer") in STREAM mode.
 *   2. AudioTrack.audioSessionId is assigned by AudioFlinger at construction
 *      time — it's > 0 INSTANTLY, before any audio is played.
 *   3. Attach DynamicsProcessing to the mixer's sessionId. This always works
 *      because the AudioTrack is a real, registered AudioFlinger stream.
 *   4. Tell RNTP/ExoPlayer to join the same audio session via
 *      setAudioSessionId(mixerSessionId) BEFORE calling play(). ExoPlayer
 *      will then render into the same AudioFlinger session, so the EQ
 *      processes its audio automatically.
 *   5. Keep the mixer's AudioTrack alive for the app lifetime. It writes
 *      silence continuously (via a tiny background thread) so AudioFlinger
 *      doesn't garbage-collect the session.
 *
 * Result: Zero frame-wait, zero retries, zero patching of RNTP source.
 *
 * Pipeline:
 *   RNTP ExoPlayer ──(same AudioFlinger session)──> DynamicsProcessing EQ ──> Speakers
 *   Mixer AudioTrack ──(silence, keeps session alive)──────────────────────────^
 *
 * Platform: Android 10+ (API 29+) for DynamicsProcessing.
 *           AudioTrack itself works on all Android versions.
 */
class AutoEQModule : Module() {

    companion object {
        private const val TAG = "AutoEQModule"

        val ISO_FREQ_CENTERS = floatArrayOf(
            20f, 25f, 31.5f, 40f, 50f, 63f, 80f, 100f, 125f, 160f,
            200f, 250f, 315f, 400f, 500f, 630f, 800f, 1000f, 1250f, 1600f,
            2000f, 2500f, 3150f, 4000f, 5000f, 6300f, 8000f, 10000f, 12500f, 16000f, 20000f
        )

        const val BAND_COUNT    = 31
        const val GAIN_MIN_DB   = -15f
        const val GAIN_MAX_DB   = 15f
        const val PREAMP_MIN_DB = -12f
        const val PREAMP_MAX_DB = 6f

        // Mixer AudioTrack config — stereo 48kHz PCM16 matches most device HW paths.
        const val MIXER_SAMPLE_RATE   = 48_000
        const val MIXER_CHANNEL_MASK  = AudioFormat.CHANNEL_OUT_STEREO
        const val MIXER_ENCODING      = AudioFormat.ENCODING_PCM_16BIT

        // Silence buffer: 20ms of stereo PCM16 at 48kHz = 48000*0.02*2*2 bytes
        const val SILENCE_FRAMES      = 960  // 20ms @ 48kHz
        const val SILENCE_BUFFER_SIZE = SILENCE_FRAMES * 2 * 2 // stereo * 2 bytes/sample

        /**
         * Singleton mixer AudioTrack — lives for the entire app session.
         * Stored here so it survives React reloads (JS bundle hot-reload).
         */
        @Volatile var mixerTrack: AudioTrack? = null
        @Volatile var mixerSessionId: Int = -1
        @Volatile var silenceThread: Thread? = null
        @Volatile var silenceRunning: Boolean = false
    }

    // DynamicsProcessing attached to mixer's sessionId
    private var dp: DynamicsProcessing? = null
    private var isEnabled: Boolean = false
    private val gainsCache = FloatArray(BAND_COUNT) { 0f }
    private var preampDb: Float = 0f

    override fun definition() = ModuleDefinition {
        Name("AutoEQModule")

        Constants(
            "version"     to "1.0.0",
            "bandCount"   to BAND_COUNT,
            "isSupported" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
        )

        Function("getSampleRate") { MIXER_SAMPLE_RATE }
        Function("getIsActive")   { dp != null && isEnabled }
        Function("getPreamp")     { preampDb }

        // ── initMixer ────────────────────────────────────────────────────────
        /**
         * Call this ONCE at app startup (or when your MusicPlayerContext mounts).
         * Creates the permanent AudioTrack, attaches DynamicsProcessing immediately,
         * and returns the sessionId you must pass to ExoPlayer/RNTP before play().
         *
         * JS usage:
         *   const sessionId = await AutoEQNative.initMixer();
         *   // Pass sessionId to RNTP before playing:
         *   await TrackPlayer.updateOptions({ androidAudioSessionId: sessionId });
         *   await TrackPlayer.play();
         */
        AsyncFunction("initMixer") { promise: Promise ->
            try {
                // Reuse existing mixer if alive (survives JS reload)
                if (mixerTrack != null && mixerSessionId > 0) {
                    Log.i(TAG, "initMixer: reusing existing mixer sessionId=$mixerSessionId")
                    // Re-attach DynamicsProcessing if it was released
                    if (dp == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        attachDynamicsProcessing(mixerSessionId)
                    }
                    promise.resolve(mixerSessionId)
                    return@AsyncFunction
                }

                // Build permanent AudioTrack
                val minBufSize = AudioTrack.getMinBufferSize(
                    MIXER_SAMPLE_RATE,
                    MIXER_CHANNEL_MASK,
                    MIXER_ENCODING
                ).coerceAtLeast(SILENCE_BUFFER_SIZE * 2)

                val track = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build()
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(MIXER_ENCODING)
                            .setSampleRate(MIXER_SAMPLE_RATE)
                            .setChannelMask(MIXER_CHANNEL_MASK)
                            .build()
                    )
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .setBufferSizeInBytes(minBufSize)
                    // Do NOT setSessionId here — let AudioManager assign one;
                    // that's what gives us the guaranteed > 0 sessionId.
                    .build()

                // sessionId is > 0 IMMEDIATELY after build() — AudioFlinger
                // registers the stream synchronously during AudioTrack construction.
                val sessionId = track.audioSessionId
                if (sessionId <= 0) {
                    track.release()
                    return@AsyncFunction promise.reject(
                        "MIXER_SESSION_INVALID",
                        "AudioTrack returned sessionId=$sessionId — this should never happen on a real device.",
                        null
                    )
                }

                mixerTrack   = track
                mixerSessionId = sessionId

                // Start the track and feed it silence so AudioFlinger keeps
                // the session registered. Without this, some OEMs garbage-collect
                // an idle AudioTrack session after ~5s.
                track.play()
                startSilenceThread(track)

                // Attach DynamicsProcessing while the session is hot
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    attachDynamicsProcessing(sessionId)
                } else {
                    Log.w(TAG, "DynamicsProcessing unavailable below API 29; EQ bands disabled but sessionId still valid")
                }

                Log.i(TAG, "✅ initMixer complete: sessionId=$sessionId")
                promise.resolve(sessionId)

            } catch (e: Exception) {
                Log.e(TAG, "initMixer failed", e)
                promise.reject("MIXER_INIT_ERROR", e.message ?: "initMixer failed", e)
            }
        }

        // ── getMixerSessionId ─────────────────────────────────────────────────
        /**
         * Synchronous read of the mixer sessionId.
         * Returns -1 if initMixer hasn't been called yet.
         */
        AsyncFunction("getMixerSessionId") { promise: Promise ->
            promise.resolve(mixerSessionId)
        }

        // ── setupEQ (legacy compat) ───────────────────────────────────────────
        /**
         * @deprecated Use initMixer() instead.
         *
         * Left here so existing JS callers don't break immediately.
         * If mixerSessionId is already set, ignores the passed sessionId and
         * re-attaches DynamicsProcessing to the mixer session.
         * If mixer hasn't been initialised yet, behaves like old approach
         * (will still have the frame-wait problem — use initMixer!).
         */
        AsyncFunction("setupEQ") { audioSessionId: Int, _sampleRateHz: Int?, promise: Promise ->
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                return@AsyncFunction promise.reject(
                    "UNSUPPORTED_API",
                    "DynamicsProcessing requires Android 10+ (API 29+)",
                    null
                )
            }

            val targetSession = if (mixerSessionId > 0) mixerSessionId else audioSessionId
            if (targetSession <= 0) {
                return@AsyncFunction promise.reject(
                    "INVALID_SESSION",
                    "No valid session. Call initMixer() before play().",
                    null
                )
            }

            try {
                if (dp == null || (mixerSessionId <= 0)) {
                    attachDynamicsProcessing(targetSession)
                }
                promise.resolve(
                    mapOf(
                        "sessionId"  to targetSession,
                        "bands"      to BAND_COUNT,
                        "sampleRate" to MIXER_SAMPLE_RATE,
                        "note"       to if (mixerSessionId > 0)
                            "Using mixer session — instant attach"
                        else
                            "Using RNTP session — may have frame-wait delay"
                    )
                )
            } catch (e: Exception) {
                Log.e(TAG, "setupEQ failed", e)
                promise.reject("EQ_SETUP_ERROR", e.message ?: "setupEQ failed", e)
            }
        }

        // ── getAudioSessionId ─────────────────────────────────────────────────
        AsyncFunction("getAudioSessionId") { promise: Promise ->
            // Returns mixer session preferentially — this is the session RNTP must join
            promise.resolve(if (mixerSessionId > 0) mixerSessionId else -1)
        }

        // ── setBand ───────────────────────────────────────────────────────────
        AsyncFunction("setBand") { index: Int, gainDb: Double, promise: Promise ->
            val instance = dp ?: return@AsyncFunction promise.reject(
                "EQ_NOT_READY", "Call initMixer() first", null
            )
            if (index !in 0 until BAND_COUNT) {
                return@AsyncFunction promise.reject(
                    "INVALID_INDEX", "Band index must be 0..${BAND_COUNT - 1}", null
                )
            }
            val clamped = gainDb.toFloat().coerceIn(GAIN_MIN_DB, GAIN_MAX_DB)
            try {
                instance.setPreEqBandAllChannelsTo(
                    index,
                    DynamicsProcessing.EqBand(true, ISO_FREQ_CENTERS[index], clamped)
                )
                gainsCache[index] = clamped
                promise.resolve(mapOf("band" to index, "frequency" to ISO_FREQ_CENTERS[index], "gain" to clamped))
            } catch (e: Exception) {
                promise.reject("BAND_ERROR", e.message ?: "setBand failed", e)
            }
        }

        // ── applyBands ────────────────────────────────────────────────────────
        AsyncFunction("applyBands") { gains: List<Double>, promise: Promise ->
            val instance = dp ?: return@AsyncFunction promise.reject(
                "EQ_NOT_READY", "Call initMixer() first", null
            )
            if (gains.size != BAND_COUNT) {
                return@AsyncFunction promise.reject(
                    "INVALID_GAINS", "Expected exactly $BAND_COUNT values", null
                )
            }
            try {
                for (i in 0 until BAND_COUNT) {
                    val g = gains[i].toFloat().coerceIn(GAIN_MIN_DB, GAIN_MAX_DB)
                    instance.setPreEqBandAllChannelsTo(
                        i, DynamicsProcessing.EqBand(true, ISO_FREQ_CENTERS[i], g)
                    )
                    gainsCache[i] = g
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("APPLY_ERROR", e.message ?: "applyBands failed", e)
            }
        }

        // ── setParametricFilters ──────────────────────────────────────────────
        AsyncFunction("setParametricFilters") {
                filters: List<Map<String, Any>>,
                preampDbInput: Double,
                promise: Promise ->
            val instance = dp ?: return@AsyncFunction promise.reject(
                "EQ_NOT_READY", "Call initMixer() first", null
            )
            val preamp = preampDbInput.toFloat().coerceIn(PREAMP_MIN_DB, PREAMP_MAX_DB)
            preampDb = preamp
            try {
                val bandGains = FloatArray(BAND_COUNT) { preamp }
                for (f in filters) {
                    val type  = (f["filter_type"] as? String ?: f["type"] as? String ?: "PK").uppercase()
                    val fc    = toDouble(f["fc"]) ?: 1000.0
                    val gain  = toDouble(f["gain_db"]) ?: toDouble(f["gain"]) ?: 0.0
                    val q     = toDouble(f["q"]) ?: 1.0
                    for (i in 0 until BAND_COUNT) {
                        bandGains[i] += computeFilterGainAtFreq(
                            type, fc, gain, q,
                            ISO_FREQ_CENTERS[i].toDouble(),
                            MIXER_SAMPLE_RATE.toDouble()
                        ).toFloat()
                    }
                }
                for (i in 0 until BAND_COUNT) {
                    val g = bandGains[i].coerceIn(GAIN_MIN_DB, GAIN_MAX_DB)
                    instance.setPreEqBandAllChannelsTo(
                        i, DynamicsProcessing.EqBand(true, ISO_FREQ_CENTERS[i], g)
                    )
                    gainsCache[i] = g
                }
                promise.resolve(mapOf("filtersApplied" to filters.size, "preamp" to preamp, "bandsUpdated" to BAND_COUNT))
            } catch (e: Exception) {
                promise.reject("PARAMETRIC_ERROR", e.message ?: "setParametricFilters failed", e)
            }
        }

        // ── setPreamp ─────────────────────────────────────────────────────────
        AsyncFunction("setPreamp") { db: Double, promise: Promise ->
            val clamped = db.toFloat().coerceIn(PREAMP_MIN_DB, PREAMP_MAX_DB)
            preampDb = clamped
            promise.resolve(mapOf("preamp" to clamped))
        }

        // ── getGains ──────────────────────────────────────────────────────────
        AsyncFunction("getGains") { promise: Promise ->
            promise.resolve(gainsCache.mapIndexed { i, g ->
                mapOf("band" to i, "frequency" to ISO_FREQ_CENTERS[i], "gain" to g.toDouble())
            })
        }

        // ── setEnabled ────────────────────────────────────────────────────────
        AsyncFunction("setEnabled") { enabled: Boolean, promise: Promise ->
            val instance = dp ?: return@AsyncFunction promise.reject(
                "EQ_NOT_READY", "Call initMixer() first", null
            )
            try {
                instance.enabled = enabled
                isEnabled = enabled
                Log.i(TAG, "EQ ${if (enabled) "ENABLED" else "DISABLED"}")
                promise.resolve(mapOf("enabled" to enabled))
            } catch (e: Exception) {
                promise.reject("TOGGLE_ERROR", e.message ?: "setEnabled failed", e)
            }
        }

        // ── reset ─────────────────────────────────────────────────────────────
        AsyncFunction("reset") { promise: Promise ->
            try {
                preampDb = 0f
                setAllBandsInternal(0f)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("RESET_ERROR", e.message ?: "reset failed", e)
            }
        }

        // ── release ───────────────────────────────────────────────────────────
        /**
         * Releases DynamicsProcessing but KEEPS the mixer AudioTrack alive.
         * The mixer must survive track changes so RNTP always has a session to join.
         * Call releaseMixer() only when the entire app is closing.
         */
        AsyncFunction("release") { promise: Promise ->
            try {
                releaseDPInternal()
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("RELEASE_ERROR", e.message ?: "release failed", e)
            }
        }

        // ── releaseMixer ──────────────────────────────────────────────────────
        /**
         * Full teardown — only call on app destroy. Stops the silence thread,
         * releases the AudioTrack, and clears the mixer session.
         */
        AsyncFunction("releaseMixer") { promise: Promise ->
            try {
                releaseDPInternal()
                silenceRunning = false
                silenceThread?.interrupt()
                silenceThread = null
                mixerTrack?.let {
                    try { it.stop() } catch (_: Exception) {}
                    try { it.release() } catch (_: Exception) {}
                }
                mixerTrack = null
                mixerSessionId = -1
                Log.i(TAG, "Mixer fully released")
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("MIXER_RELEASE_ERROR", e.message ?: "releaseMixer failed", e)
            }
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun attachDynamicsProcessing(sessionId: Int) {
        // Release any previous instance first
        releaseDPInternal()

        val config = DynamicsProcessing.Config.Builder(
            DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
            /* channelCount   */ 2,
            /* preEqInUse     */ true,
            /* preEqBandCount */ BAND_COUNT,
            /* mbcInUse       */ false,
            /* mbcBandCount   */ 0,
            /* postEqInUse    */ false,
            /* postEqBandCount*/ 0,
            /* limiterInUse   */ true
        ).build()

        val instance = DynamicsProcessing(0, sessionId, config)
        dp = instance

        // ✅ FIX: start ENABLED — the mixer approach means the session is real
        //    immediately, so we can enable the EQ right away. Old code started
        //    disabled because the session might not be ready yet; that's no
        //    longer a concern.
        instance.enabled = true
        isEnabled = true

        preampDb = 0f
        setAllBandsInternal(0f)

        Log.i(TAG, "DynamicsProcessing attached to sessionId=$sessionId, enabled=true")
    }

    private fun releaseDPInternal() {
        dp?.let {
            try { it.enabled = false } catch (_: Exception) {}
            try { it.release() } catch (_: Exception) {}
        }
        dp = null
        isEnabled = false
        preampDb = 0f
        gainsCache.fill(0f)
    }

    private fun setAllBandsInternal(gainDb: Float) {
        val instance = dp ?: return
        for (i in 0 until BAND_COUNT) {
            instance.setPreEqBandAllChannelsTo(
                i, DynamicsProcessing.EqBand(true, ISO_FREQ_CENTERS[i], gainDb)
            )
            gainsCache[i] = gainDb
        }
    }

    /**
     * Writes silence to the mixer AudioTrack on a background thread.
     * This keeps AudioFlinger from destroying the session on idle OEMs.
     * Buffer is 20ms of zeros at 48kHz stereo PCM16.
     */
    private fun startSilenceThread(track: AudioTrack) {
        silenceRunning = false
        silenceThread?.interrupt()

        val silence = ByteArray(SILENCE_BUFFER_SIZE) // all zeros = silence
        silenceRunning = true

        silenceThread = Thread({
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO)
            Log.i(TAG, "Silence thread started for mixer sessionId=$mixerSessionId")
            while (silenceRunning) {
                try {
                    val written = track.write(silence, 0, silence.size)
                    if (written < 0) {
                        Log.w(TAG, "Silence write returned $written — stopping thread")
                        break
                    }
                    // 20ms per buffer → sleep briefly to avoid busy-loop
                    // (AudioTrack.write blocks when buffer full, so this sleep
                    //  is just a safety valve)
                    Thread.sleep(10)
                } catch (ie: InterruptedException) {
                    break
                } catch (e: Exception) {
                    Log.w(TAG, "Silence thread error: ${e.message}")
                    break
                }
            }
            Log.i(TAG, "Silence thread stopped")
        }, "AutoEQ-SilenceThread")

        silenceThread!!.isDaemon = true
        silenceThread!!.start()
    }

    // RBJ biquad magnitude response — unchanged from original
    private fun computeFilterGainAtFreq(
        type: String, fc: Double, gainDb: Double, q: Double, f: Double, fs: Double
    ): Double {
        if (f <= 0.0 || fc <= 0.0 || q <= 0.0) return 0.0
        val w0     = 2 * PI * fc / fs
        val wf     = 2 * PI * f  / fs
        val A      = 10.0.pow(gainDb / 40.0)
        val alpha  = sin(w0) / (2.0 * q)
        val cosW0  = cos(w0)
        val b0: Double; val b1: Double; val b2: Double
        val a0: Double; val a1: Double; val a2: Double
        when (type.uppercase()) {
            "PK", "PEAK", "PEAKING" -> {
                b0 = 1 + alpha * A;  b1 = -2 * cosW0;  b2 = 1 - alpha * A
                a0 = 1 + alpha / A;  a1 = -2 * cosW0;  a2 = 1 - alpha / A
            }
            "LS", "LOWSHELF", "LOW_SHELF" -> {
                val sqA = sqrt(A);  val ts = 2 * sqA * alpha
                b0 = A * ((A+1) - (A-1)*cosW0 + ts);  b1 = 2*A*((A-1) - (A+1)*cosW0);  b2 = A*((A+1) - (A-1)*cosW0 - ts)
                a0 = (A+1) + (A-1)*cosW0 + ts;        a1 = -2*((A-1) + (A+1)*cosW0);   a2 = (A+1) + (A-1)*cosW0 - ts
            }
            "HS", "HIGHSHELF", "HIGH_SHELF" -> {
                val sqA = sqrt(A);  val ts = 2 * sqA * alpha
                b0 = A*((A+1) + (A-1)*cosW0 + ts);  b1 = -2*A*((A-1) + (A+1)*cosW0);  b2 = A*((A+1) + (A-1)*cosW0 - ts)
                a0 = (A+1) - (A-1)*cosW0 + ts;       a1 = 2*((A-1) - (A+1)*cosW0);     a2 = (A+1) - (A-1)*cosW0 - ts
            }
            else -> return 0.0
        }
        val cosWf = cos(wf);  val sinWf = sin(wf)
        val cos2  = cos(2*wf); val sin2  = sin(2*wf)
        val numR = b0 + b1*cosWf + b2*cos2;  val numI = -(b1*sinWf + b2*sin2)
        val denR = a0 + a1*cosWf + a2*cos2;  val denI = -(a1*sinWf + a2*sin2)
        val denMag2 = denR*denR + denI*denI
        if (denMag2 < 1e-30) return 0.0
        return 10.0 * log10((numR*numR + numI*numI) / denMag2)
    }

    private fun toDouble(v: Any?): Double? = when (v) {
        is Number -> v.toDouble()
        is String -> v.toDoubleOrNull()
        else      -> null
    }
}