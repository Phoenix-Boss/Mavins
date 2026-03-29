package expo.modules.mavinplayer

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.mavinplayer.audio.MavinAudioPlayer
import expo.modules.mavinplayer.audio.TrackData

@UnstableApi
class MavinPlayerModule : Module() {

    companion object {
        private const val TAG = "MavinPlayerModule"
        private const val PROGRESS_INTERVAL_MS = 1000L
        @Volatile var playerInstance: MavinAudioPlayer? = null
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var progressRunnable: Runnable? = null

    override fun definition() = ModuleDefinition {
        Name("MavinPlayer")

        Events(
            "onPlaybackStateChanged",
            "onTrackChanged",
            "onError",
            "onProgress",
            "onSpectrum"          // new — emitted with spectrum data for visualizer
        )

        // ═════════════════════════════════════════════════════════════════════
        // PLAYER LIFECYCLE
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("initPlayer") { promise: Promise ->
            runOnMain {
                try {
                    if (playerInstance != null) { promise.resolve(null); return@runOnMain }
                    val ctx = appContext.reactContext
                        ?: return@runOnMain promise.reject("NO_CONTEXT", "ReactContext not available", null)

                    val player = MavinAudioPlayer(ctx)

                    player.onPlaybackStateChanged = { state ->
                        val name = when (state) {
                            Player.STATE_IDLE      -> "idle"
                            Player.STATE_BUFFERING -> "buffering"
                            Player.STATE_READY     -> "ready"
                            Player.STATE_ENDED     -> "ended"
                            else                   -> "unknown"
                        }
                        sendEvent("onPlaybackStateChanged", mapOf("state" to name))
                        if (state == Player.STATE_READY) startProgressTimer(player)
                        if (state == Player.STATE_IDLE || state == Player.STATE_ENDED) stopProgressTimer()
                    }
                    player.onTrackChanged = { index ->
                        sendEvent("onTrackChanged", mapOf("index" to index))
                    }
                    player.onError = { message, code ->
                        sendEvent("onError", mapOf("message" to message, "code" to code))
                    }

                    playerInstance = player

                    val serviceIntent = Intent().apply {
                        setClassName(ctx, "expo.modules.mavinplayer.service.MavinPlaybackService")
                    }
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                        ctx.startForegroundService(serviceIntent)
                    } else {
                        ctx.startService(serviceIntent)
                    }

                    Log.i(TAG, "✅ initPlayer complete")
                    promise.resolve(null)
                } catch (e: Exception) {
                    Log.e(TAG, "initPlayer failed", e)
                    promise.reject("INIT_ERROR", e.message ?: "initPlayer failed", e)
                }
            }
        }

        // ═════════════════════════════════════════════════════════════════════
        // PLAYBACK CONTROL
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("load") { trackMap: Map<String, Any?>, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                try { p.load(trackMap.toTrackData()); promise.resolve(null) }
                catch (e: Exception) { promise.reject("LOAD_ERROR", e.message, e) }
            }
        }

        AsyncFunction("setQueue") { tracksRaw: List<Map<String, Any?>>, startIndex: Int?, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                try { p.setQueue(tracksRaw.map { it.toTrackData() }, startIndex ?: 0); promise.resolve(null) }
                catch (e: Exception) { promise.reject("QUEUE_ERROR", e.message, e) }
            }
        }

        AsyncFunction("addToQueue") { trackMap: Map<String, Any?>, promise: Promise ->
            runOnMain {
                val p = requirePlayer(promise) ?: return@runOnMain
                try { p.addToQueue(trackMap.toTrackData()); promise.resolve(null) }
                catch (e: Exception) { promise.reject("QUEUE_ERROR", e.message, e) }
            }
        }

        AsyncFunction("play")           { promise: Promise -> runOnMain { requirePlayer(promise)?.play();            promise.resolve(null) } }
        AsyncFunction("pause")          { promise: Promise -> runOnMain { requirePlayer(promise)?.pause();           promise.resolve(null) } }
        AsyncFunction("stop")           { promise: Promise -> runOnMain { requirePlayer(promise)?.stop();            promise.resolve(null) } }
        AsyncFunction("skipToNext")     { promise: Promise -> runOnMain { requirePlayer(promise)?.skipToNext();      promise.resolve(null) } }
        AsyncFunction("skipToPrevious") { promise: Promise -> runOnMain { requirePlayer(promise)?.skipToPrevious();  promise.resolve(null) } }

        AsyncFunction("seekTo") { positionMs: Double, promise: Promise ->
            runOnMain { requirePlayer(promise)?.seekTo(positionMs.toLong()); promise.resolve(null) }
        }
        AsyncFunction("skipToIndex") { index: Int, promise: Promise ->
            runOnMain { requirePlayer(promise)?.skipToIndex(index); promise.resolve(null) }
        }
        AsyncFunction("setVolume") { volume: Double, promise: Promise ->
            runOnMain { requirePlayer(promise)?.setVolume(volume.toFloat()); promise.resolve(null) }
        }
        AsyncFunction("setRepeatMode") { mode: Int, promise: Promise ->
            runOnMain { requirePlayer(promise)?.setRepeatMode(mode); promise.resolve(null) }
        }
        AsyncFunction("setShuffleMode") { enabled: Boolean, promise: Promise ->
            runOnMain { requirePlayer(promise)?.setShuffleModeEnabled(enabled); promise.resolve(null) }
        }

        // ═════════════════════════════════════════════════════════════════════
        // STATE READS
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("getPosition")     { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getCurrentPosition()?.toDouble() ?: 0.0) } }
        AsyncFunction("getDuration")     { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getDuration()?.toDouble()          ?: 0.0) } }
        AsyncFunction("getCurrentTrack") { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getCurrentTrackInfo()) } }
        AsyncFunction("isPlaying")       { promise: Promise -> runOnMain { promise.resolve(playerInstance?.isPlaying() ?: false) } }
        AsyncFunction("getQueueSize")    { promise: Promise -> runOnMain { promise.resolve(playerInstance?.getQueueSize() ?: 0) } }

        // ═════════════════════════════════════════════════════════════════════
        // EQ API — GRAPHIC MODE
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("setEQEnabled") { enabled: Boolean, promise: Promise ->
            playerInstance?.setEQEnabled(enabled); promise.resolve(null)
        }
        AsyncFunction("setEQBand") { band: Int, gainDb: Double, promise: Promise ->
            playerInstance?.setEQBand(band, gainDb.toFloat()); promise.resolve(null)
        }
        AsyncFunction("applyEQBands") { gains: List<Double>, promise: Promise ->
            playerInstance?.applyEQBands(FloatArray(gains.size) { gains[it].toFloat() }); promise.resolve(null)
        }
        AsyncFunction("setEQPreamp") { gainDb: Double, promise: Promise ->
            playerInstance?.setEQPreamp(gainDb.toFloat()); promise.resolve(null)
        }
        AsyncFunction("setEQBandQ") { band: Int, q: Double, promise: Promise ->
            playerInstance?.setEQBandQ(band, q.toFloat()); promise.resolve(null)
        }
        AsyncFunction("resetEQ") { promise: Promise ->
            playerInstance?.resetEQ(); promise.resolve(null)
        }

        // ═════════════════════════════════════════════════════════════════════
        // EQ API — PARAMETRIC MODE
        // ═════════════════════════════════════════════════════════════════════

        /**
         * Set gain for a single parametric band.
         * Parametric bands are independent of graphic bands.
         * Switch to parametric mode with setEQMode("PARAMETRIC").
         */
        AsyncFunction("setParametricBandGain") { band: Int, gainDb: Double, promise: Promise ->
            playerInstance?.setParametricBandGain(band, gainDb.toFloat()); promise.resolve(null)
        }

        /** Apply all parametric gains at once. List of 31 dB values. */
        AsyncFunction("applyParametricBands") { gains: List<Double>, promise: Promise ->
            playerInstance?.applyParametricBands(FloatArray(gains.size) { gains[it].toFloat() })
            promise.resolve(null)
        }

        /**
         * Set centre frequency for a parametric band (Hz).
         * Valid range: 20 Hz – Nyquist. Clamped automatically.
         * Only active when mode == PARAMETRIC.
         */
        AsyncFunction("setParametricBandFreq") { band: Int, freqHz: Double, promise: Promise ->
            playerInstance?.setParametricBandFreq(band, freqHz); promise.resolve(null)
        }

        /** Reset parametric EQ to flat, ISO centre frequencies, default Q. */
        AsyncFunction("resetParametric") { promise: Promise ->
            playerInstance?.resetParametric(); promise.resolve(null)
        }

        /**
         * Switch EQ mode.
         * mode: "GRAPHIC" (default 31-band graphic) or "PARAMETRIC" (custom centre frequencies).
         * Graphic and parametric states are maintained independently — switching is non-destructive.
         */
        AsyncFunction("setEQMode") { mode: String, promise: Promise ->
            playerInstance?.setEQMode(mode); promise.resolve(null)
        }

        // ═════════════════════════════════════════════════════════════════════
        // EQ API — LOUDNESS NORMALIZATION
        // ═════════════════════════════════════════════════════════════════════

        /**
         * Apply loudness normalization / ReplayGain offset in dB.
         * Pass your ReplayGain track or album gain value:
         *   e.g. setLoudnessOffset(-6.0) → attenuates by 6 dB to prevent clipping
         * Range: –30 dB to +30 dB. Applied before preamp, covered by the limiter.
         */
        AsyncFunction("setLoudnessOffset") { gainDb: Double, promise: Promise ->
            playerInstance?.setLoudnessOffset(gainDb.toFloat()); promise.resolve(null)
        }

        AsyncFunction("getLoudnessOffset") { promise: Promise ->
            promise.resolve(playerInstance?.getLoudnessOffset()?.toDouble() ?: 0.0)
        }

        // ═════════════════════════════════════════════════════════════════════
        // EQ API — PARAMETER SMOOTHING
        // ═════════════════════════════════════════════════════════════════════

        /**
         * Set the parameter smoothing ramp time in milliseconds (default: 10 ms).
         * Smoothing linearly interpolates gain changes over the ramp duration,
         * eliminating zipper noise when sliders move.
         * Set to 0 for immediate (may produce audible clicks on fast moves).
         * Recommended range: 5–20 ms.
         */
        AsyncFunction("setSmoothingRamp") { ms: Double, promise: Promise ->
            playerInstance?.setSmoothingRamp(ms); promise.resolve(null)
        }

        // ═════════════════════════════════════════════════════════════════════
        // EQ STATE GETTERS
        // ═════════════════════════════════════════════════════════════════════

        /** Current graphic EQ gains. Returns [{band, gain}, ...] for all 31 bands. */
        AsyncFunction("getEQGains") { promise: Promise ->
            val gains = playerInstance?.getEQGains()?.mapIndexed { i, g ->
                mapOf("band" to i, "gain" to g.toDouble())
            } ?: emptyList<Map<String, Any>>()
            promise.resolve(gains)
        }

        /** Current preamp in dB. */
        AsyncFunction("getEQPreamp") { promise: Promise ->
            promise.resolve(playerInstance?.getEQPreamp()?.toDouble() ?: 0.0)
        }

        /** Is EQ processing enabled? */
        AsyncFunction("isEQEnabled") { promise: Promise ->
            promise.resolve(playerInstance?.isEQEnabled() ?: false)
        }

        /** Current Q values for all 31 bands. Returns [{band, q}, ...]. */
        AsyncFunction("getEQQValues") { promise: Promise ->
            val qv = playerInstance?.getEQQValues()?.mapIndexed { i, q ->
                mapOf("band" to i, "q" to q.toDouble())
            } ?: emptyList<Map<String, Any>>()
            promise.resolve(qv)
        }

        /** Current parametric EQ gains. Returns [{band, gain}, ...]. */
        AsyncFunction("getParametricGains") { promise: Promise ->
            val gains = playerInstance?.getParametricGains()?.mapIndexed { i, g ->
                mapOf("band" to i, "gain" to g.toDouble())
            } ?: emptyList<Map<String, Any>>()
            promise.resolve(gains)
        }

        /**
         * Current parametric centre frequencies.
         * Returns [{band, freqHz}, ...] for all 31 bands.
         */
        AsyncFunction("getParametricFreqs") { promise: Promise ->
            val freqs = playerInstance?.getParametricFreqs()?.mapIndexed { i, f ->
                mapOf("band" to i, "freqHz" to f)
            } ?: emptyList<Map<String, Any>>()
            promise.resolve(freqs)
        }

        /** Current EQ mode — "GRAPHIC" or "PARAMETRIC". */
        AsyncFunction("getEQMode") { promise: Promise ->
            promise.resolve(playerInstance?.getEQMode() ?: "GRAPHIC")
        }

        // ═════════════════════════════════════════════════════════════════════
        // SPECTRUM ANALYSIS & AUTO-EQ
        // ═════════════════════════════════════════════════════════════════════

        /**
         * Get latest real-time spectrum magnitudes.
         * Returns list of 64 values [{bin, magnitude}, ...], linear 0..1 scale,
         * log-spaced from 20 Hz to Nyquist. Updated every ~100 ms during playback.
         * Use for visualizer rendering on the JS side.
         */
        AsyncFunction("getSpectrumMagnitudes") { promise: Promise ->
            val mags = playerInstance?.getSpectrumMagnitudes()?.mapIndexed { i, m ->
                mapOf("bin" to i, "magnitude" to m.toDouble())
            } ?: emptyList<Map<String, Any>>()
            promise.resolve(mags)
        }

        /**
         * Compute and return an Auto-EQ correction suggestion.
         *
         * Analyzes the current spectrum and computes per-band gain corrections
         * that would flatten the measured response.
         *
         * Returns [{band, gain, freqHz}, ...] — the suggested EQ curve.
         * Does NOT apply the EQ automatically; call applyEQBands(gains) to apply.
         *
         * Typical usage:
         *   const suggestion = await MavinPlayer.computeAutoEQ();
         *   // Show UI, let user confirm
         *   await MavinPlayer.applyEQBands(suggestion.map(b => b.gain));
         */
        AsyncFunction("computeAutoEQ") { promise: Promise ->
            val suggestion = playerInstance?.computeAutoEQ()
            val result = suggestion?.mapIndexed { i, g ->
                mapOf(
                    "band"   to i,
                    "gain"   to g.toDouble(),
                    "freqHz" to expo.modules.autoeqengine.EqualizerProcessor.ISO_FREQ_CENTERS[i]
                )
            } ?: emptyList<Map<String, Any>>()
            promise.resolve(result)
        }

        // ═════════════════════════════════════════════════════════════════════
        // CLEANUP
        // ═════════════════════════════════════════════════════════════════════

        AsyncFunction("release") { promise: Promise ->
            runOnMain {
                stopProgressTimer()
                playerInstance?.release()
                playerInstance = null
                val ctx = appContext.reactContext
                ctx?.stopService(Intent().apply {
                    setClassName(ctx, "expo.modules.mavinplayer.service.MavinPlaybackService")
                })
                promise.resolve(null)
            }
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PROGRESS TIMER (includes spectrum polling)
    // ═════════════════════════════════════════════════════════════════════════

    private fun startProgressTimer(player: MavinAudioPlayer) {
        stopProgressTimer()
        progressRunnable = object : Runnable {
            override fun run() {
                if (player.isPlaying()) {
                    sendEvent("onProgress", mapOf(
                        "position" to player.getCurrentPosition().toDouble(),
                        "duration" to player.getDuration().toDouble(),
                        "buffered" to player.getBufferedPosition().toDouble(),
                    ))
                    // Emit spectrum data for real-time visualizer (every 1s poll matches progress)
                    sendEvent("onSpectrum", mapOf(
                        "magnitudes" to player.getSpectrumMagnitudes().map { it.toDouble() }
                    ))
                }
                mainHandler.postDelayed(this, PROGRESS_INTERVAL_MS)
            }
        }
        mainHandler.postDelayed(progressRunnable!!, PROGRESS_INTERVAL_MS)
    }

    private fun stopProgressTimer() {
        progressRunnable?.let { mainHandler.removeCallbacks(it) }
        progressRunnable = null
    }

    // ═════════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═════════════════════════════════════════════════════════════════════════

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block()
        else mainHandler.post(block)
    }

    private fun requirePlayer(promise: Promise): MavinAudioPlayer? {
        val p = playerInstance
        if (p == null) promise.reject("PLAYER_NOT_READY", "Call initPlayer() first", null)
        return p
    }

    private fun Map<String, Any?>.toTrackData(): TrackData = TrackData(
        id         = (get("id") as? String) ?: System.currentTimeMillis().toString(),
        uri        = get("uri") as? String ?: get("url") as? String
                     ?: throw IllegalArgumentException("track must have 'uri' or 'url'"),
        title      = get("title")     as? String,
        artist     = get("artist")    as? String,
        album      = get("album")     as? String,
        artworkUri = get("artwork")   as? String ?: get("artworkUri") as? String,
        duration   = (get("duration") as? Number)?.toLong(),
        headers    = @Suppress("UNCHECKED_CAST") (get("headers") as? Map<String, String>),
    )
}