package expo.modules.autoeqengine

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * EqPresetManager
 */
class EqPresetManager(context: Context) {

    companion object {
        private const val TAG = "EqPresetManager"
        private const val PREFS_NAME  = "mavin_eq_presets"
        private const val PREFS_TRACKS = "mavin_eq_track_map"
        private const val KEY_PREFIX  = "preset_"
        private const val SCHEMA_VERSION = 1

        val FACTORY_PRESETS: Map<String, FloatArray> = mapOf(
            "Flat"        to FloatArray(31) { 0f },
            "Bass Boost"  to FloatArray(31) { band ->
                when {
                    band <= 3  -> 6f
                    band <= 5  -> 4f
                    band <= 7  -> 2f
                    else       -> 0f
                }
            },
            "Treble Boost" to FloatArray(31) { band ->
                when {
                    band >= 27 -> 5f
                    band >= 24 -> 3f
                    band >= 21 -> 1.5f
                    else       -> 0f
                }
            },
            "Vocal" to FloatArray(31) { band ->
                when {
                    band in 2..4   -> -2f
                    band in 8..12  ->  3f
                    band in 13..17 ->  2f
                    band in 22..26 ->  1f
                    else           ->  0f
                }
            },
            "Classical" to FloatArray(31) { band ->
                when {
                    band <= 1      ->  3f
                    band in 7..10  ->  1f
                    band in 20..23 ->  2f
                    band >= 28     ->  3f
                    else           ->  0f
                }
            },
            "Electronic" to FloatArray(31) { band ->
                when {
                    band <= 2      ->  5f
                    band in 3..5   ->  3f
                    band in 10..14 -> -1f
                    band in 20..24 ->  2f
                    band >= 27     ->  4f
                    else           ->  0f
                }
            },
            "Rock" to FloatArray(31) { band ->
                when {
                    band <= 3      ->  4f
                    band in 4..7   ->  2f
                    band in 10..14 -> -1f
                    band in 18..22 ->  1f
                    band >= 26     ->  3f
                    else           ->  0f
                }
            },
            "Jazz" to FloatArray(31) { band ->
                when {
                    band <= 2      ->  2f
                    band in 8..12  ->  1f
                    band in 13..16 -> -1f
                    band in 20..23 ->  2f
                    else           ->  0f
                }
            },
            "Podcast" to FloatArray(31) { band ->
                when {
                    band <= 3      -> -3f
                    band in 8..14  ->  4f
                    band in 15..18 ->  2f
                    band >= 25     -> -2f
                    else           ->  0f
                }
            },
            "Hip-hop" to FloatArray(31) { band ->
                when {
                    band <= 2      ->  6f
                    band in 3..5   ->  4f
                    band in 6..9   ->  1f
                    band in 14..17 -> -1f
                    band in 21..24 ->  2f
                    band >= 27     ->  1f
                    else           ->  0f
                }
            },
            "Late Night" to FloatArray(31) { band ->
                when {
                    band <= 1      ->  2f
                    band in 7..10  ->  3f
                    band in 11..15 ->  4f
                    band in 16..19 ->  3f
                    band >= 25     ->  1f
                    else           ->  0f
                }
            }
        )
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val trackPrefs: SharedPreferences =
        context.getSharedPreferences(PREFS_TRACKS, Context.MODE_PRIVATE)

    data class EqPreset(
        val name: String,
        val graphicGains: FloatArray    = FloatArray(31) { 0f },
        val parametricGains: FloatArray = FloatArray(31) { 0f },
        val parametricFreqs: DoubleArray = EqualizerProcessor.ISO_FREQ_CENTERS.copyOf(),
        val qValues: FloatArray         = FloatArray(31) { 1.4f },
        val preampDb: Float             = 0f,
        val eqMode: String              = "GRAPHIC",
        val loudnessMode: String        = "TRACK",
        val smoothingRampMs: Double     = 10.0
    )

    fun savePreset(preset: EqPreset) {
        val json = presetToJson(preset)
        prefs.edit().putString(KEY_PREFIX + preset.name, json.toString()).apply()
        Log.i(TAG, "Saved preset: ${preset.name}")
    }

    fun loadPreset(name: String): EqPreset? {
        val json = prefs.getString(KEY_PREFIX + name, null)
        if (json != null) {
            return try { jsonToPreset(JSONObject(json)) }
            catch (e: Exception) { Log.w(TAG, "Failed to parse preset $name: ${e.message}"); null }
        }
        val gains = FACTORY_PRESETS[name] ?: return null
        return EqPreset(name = name, graphicGains = gains)
    }

    fun deletePreset(name: String): Boolean {
        if (FACTORY_PRESETS.containsKey(name)) {
            Log.w(TAG, "Cannot delete factory preset: $name")
            return false
        }
        prefs.edit().remove(KEY_PREFIX + name).apply()
        Log.i(TAG, "Deleted preset: $name")
        return true
    }

    fun listPresets(): List<String> {
        val factory = FACTORY_PRESETS.keys.toList()
        val user = prefs.all.keys
            .filter { it.startsWith(KEY_PREFIX) }
            .map { it.removePrefix(KEY_PREFIX) }
            .filter { !FACTORY_PRESETS.containsKey(it) }
            .sorted()
        return factory + user
    }

    fun isFactoryPreset(name: String): Boolean = FACTORY_PRESETS.containsKey(name)

    fun exportPreset(name: String): String? {
        val preset = loadPreset(name) ?: return null
        return presetToJson(preset).toString(2)
    }

    fun importPreset(jsonString: String): EqPreset? {
        return try {
            val preset = jsonToPreset(JSONObject(jsonString))
            savePreset(preset)
            Log.i(TAG, "Imported preset: ${preset.name}")
            preset
        } catch (e: Exception) {
            Log.w(TAG, "Import failed: ${e.message}")
            null
        }
    }

    fun assignTrackPreset(mediaId: String, presetName: String?) {
        trackPrefs.edit().apply {
            if (presetName != null) putString(mediaId, presetName)
            else remove(mediaId)
        }.apply()
        Log.d(TAG, "Track $mediaId → preset: $presetName")
    }

    fun getTrackPreset(mediaId: String): String? = trackPrefs.getString(mediaId, null)

    fun getAllTrackAssignments(): Map<String, String> {
        @Suppress("UNCHECKED_CAST")
        return (trackPrefs.all as Map<String, String>).toMap()
    }

    fun clearTrackAssignment(mediaId: String) {
        trackPrefs.edit().remove(mediaId).apply()
    }

    private fun presetToJson(p: EqPreset): JSONObject = JSONObject().apply {
        put("name",            p.name)
        put("version",         SCHEMA_VERSION)
        put("graphicGains",    JSONArray(p.graphicGains.map { it.toDouble() }))
        put("parametricGains", JSONArray(p.parametricGains.map { it.toDouble() }))
        put("parametricFreqs", JSONArray(p.parametricFreqs.toTypedArray()))
        put("qValues",         JSONArray(p.qValues.map { it.toDouble() }))
        put("preampDb",        p.preampDb.toDouble())
        put("eqMode",          p.eqMode)
        put("loudnessMode",    p.loudnessMode)
        put("smoothingRampMs", p.smoothingRampMs)
    }

    private fun jsonToPreset(j: JSONObject): EqPreset {
        fun JSONArray.toFloatArray() = FloatArray(length()) { getDouble(it).toFloat() }
        fun JSONArray.toDoubleArray() = DoubleArray(length()) { getDouble(it) }

        return EqPreset(
            name            = j.getString("name"),
            graphicGains    = j.optJSONArray("graphicGains")?.toFloatArray()    ?: FloatArray(31),
            parametricGains = j.optJSONArray("parametricGains")?.toFloatArray() ?: FloatArray(31),
            parametricFreqs = j.optJSONArray("parametricFreqs")?.toDoubleArray()
                              ?: EqualizerProcessor.ISO_FREQ_CENTERS.copyOf(),
            qValues         = j.optJSONArray("qValues")?.toFloatArray()
                              ?: FloatArray(31) { 1.4f },
            preampDb        = j.optDouble("preampDb", 0.0).toFloat(),
            eqMode          = j.optString("eqMode", "GRAPHIC"),
            loudnessMode    = j.optString("loudnessMode", "TRACK"),
            smoothingRampMs = j.optDouble("smoothingRampMs", 10.0)
        )
    }
}