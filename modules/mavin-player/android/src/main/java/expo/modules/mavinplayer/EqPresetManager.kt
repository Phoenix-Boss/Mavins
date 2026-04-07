package expo.modules.mavinplayer.audio

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException

/**
 * EqPresetManager — Save, load, export, import, and assign EQ presets.
 *
 * Preset storage: JSON files in app-private files/eq_presets/
 * Track → preset assignment: JSON file in files/eq_presets/track_assignments.json
 *
 * EqPreset fields:
 *   name            — display name (used as file key)
 *   graphicGains    — FloatArray[31] graphic EQ band gains in dB
 *   parametricGains — FloatArray[31] parametric EQ band gains in dB
 *   parametricFreqs — DoubleArray[31] parametric EQ band center frequencies in Hz
 *   qValues         — DoubleArray[31] per-band Q factor
 *   preampDb        — Float global preamp gain in dB
 *   eqMode          — String "GRAPHIC" | "PARAMETRIC" | "PARALLEL"
 *   smoothingRampMs — Double gain smoothing ramp time in ms
 */
class EqPresetManager(private val context: Context) {

    companion object {
        private const val TAG = "EqPresetManager"
        private const val PRESETS_DIR = "eq_presets"
        private const val ASSIGNMENTS_FILE = "track_assignments.json"
        private const val PRESET_EXT = ".json"
    }

    data class EqPreset(
        val name: String,
        val graphicGains: FloatArray,
        val parametricGains: FloatArray,
        val parametricFreqs: DoubleArray,
        val qValues: DoubleArray,
        val preampDb: Float,
        val eqMode: String = "GRAPHIC",
        val smoothingRampMs: Double = 10.0
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is EqPreset) return false
            return name == other.name &&
                    graphicGains.contentEquals(other.graphicGains) &&
                    parametricGains.contentEquals(other.parametricGains) &&
                    parametricFreqs.contentEquals(other.parametricFreqs) &&
                    qValues.contentEquals(other.qValues) &&
                    preampDb == other.preampDb &&
                    eqMode == other.eqMode &&
                    smoothingRampMs == other.smoothingRampMs
        }

        override fun hashCode(): Int {
            var result = name.hashCode()
            result = 31 * result + graphicGains.contentHashCode()
            result = 31 * result + parametricGains.contentHashCode()
            result = 31 * result + parametricFreqs.contentHashCode()
            result = 31 * result + qValues.contentHashCode()
            result = 31 * result + preampDb.hashCode()
            result = 31 * result + eqMode.hashCode()
            result = 31 * result + smoothingRampMs.hashCode()
            return result
        }
    }

    private val presetsDir: File by lazy {
        File(context.filesDir, PRESETS_DIR).also { it.mkdirs() }
    }

    private val assignmentsFile: File by lazy {
        File(presetsDir, ASSIGNMENTS_FILE)
    }

    // ── Preset CRUD ───────────────────────────────────────────────────────────

    fun savePreset(preset: EqPreset): Boolean {
        return try {
            val json = presetToJson(preset)
            val sanitizedName = sanitizeFileName(preset.name)
            val file = File(presetsDir, "$sanitizedName$PRESET_EXT")
            file.writeText(json.toString(2))
            Log.d(TAG, "Saved preset: ${preset.name} → ${file.name}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save preset '${preset.name}'", e)
            false
        }
    }

    fun loadPreset(name: String): EqPreset? {
        return try {
            val sanitizedName = sanitizeFileName(name)
            val file = File(presetsDir, "$sanitizedName$PRESET_EXT")
            if (!file.exists()) {
                Log.w(TAG, "Preset not found: $name")
                return null
            }
            val json = JSONObject(file.readText())
            jsonToPreset(json)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load preset '$name'", e)
            null
        }
    }

    fun listPresets(): List<String> {
        return try {
            presetsDir.listFiles { f -> f.isFile && f.name.endsWith(PRESET_EXT) && f.name != ASSIGNMENTS_FILE }
                ?.map { it.nameWithoutExtension }
                ?.sorted()
                ?: emptyList()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to list presets", e)
            emptyList()
        }
    }

    fun deletePreset(name: String): Boolean {
        return try {
            val sanitizedName = sanitizeFileName(name)
            val file = File(presetsDir, "$sanitizedName$PRESET_EXT")
            if (file.exists()) {
                file.delete().also { Log.d(TAG, "Deleted preset: $name") }
            } else {
                Log.w(TAG, "Cannot delete — preset not found: $name")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to delete preset '$name'", e)
            false
        }
    }

    // ── Export / import ───────────────────────────────────────────────────────

    /** Returns the preset JSON string, or null if not found. */
    fun exportPreset(name: String): String? {
        return try {
            val preset = loadPreset(name) ?: return null
            presetToJson(preset).toString(2)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to export preset '$name'", e)
            null
        }
    }

    /** Parses and saves a preset from a JSON string. Returns the preset on success. */
    fun importPreset(json: String): EqPreset? {
        return try {
            val obj = JSONObject(json)
            val preset = jsonToPreset(obj) ?: return null
            if (savePreset(preset)) preset else null
        } catch (e: Exception) {
            Log.e(TAG, "Failed to import preset", e)
            null
        }
    }

    // ── Track–preset assignment ───────────────────────────────────────────────

    /** Associates a media ID with a preset name (null removes the assignment). */
    fun assignTrackPreset(mediaId: String, presetName: String?) {
        try {
            val assignments = loadAssignments().toMutableMap()
            if (presetName == null) {
                assignments.remove(mediaId)
            } else {
                assignments[mediaId] = presetName
            }
            saveAssignments(assignments)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to assign track preset", e)
        }
    }

    /** Returns the preset name assigned to a media ID, or null if none. */
    fun getTrackPreset(mediaId: String): String? {
        return try {
            loadAssignments()[mediaId]
        } catch (e: Exception) {
            null
        }
    }

    // ── JSON serialization ────────────────────────────────────────────────────

    private fun presetToJson(preset: EqPreset): JSONObject {
        val json = JSONObject()
        json.put("name", preset.name)
        json.put("eqMode", preset.eqMode)
        json.put("preampDb", preset.preampDb.toDouble())
        json.put("smoothingRampMs", preset.smoothingRampMs)

        val graphicArr = JSONArray()
        preset.graphicGains.forEach { graphicArr.put(it.toDouble()) }
        json.put("graphicGains", graphicArr)

        val paramGainsArr = JSONArray()
        preset.parametricGains.forEach { paramGainsArr.put(it.toDouble()) }
        json.put("parametricGains", paramGainsArr)

        val paramFreqsArr = JSONArray()
        preset.parametricFreqs.forEach { paramFreqsArr.put(it) }
        json.put("parametricFreqs", paramFreqsArr)

        val qArr = JSONArray()
        preset.qValues.forEach { qArr.put(it) }
        json.put("qValues", qArr)

        return json
    }

    private fun jsonToPreset(json: JSONObject): EqPreset? {
        return try {
            val bandCount = EqualizerProcessor.BAND_COUNT
            val name = json.getString("name")

            val graphicGains = FloatArray(bandCount)
            val graphicArr   = json.optJSONArray("graphicGains")
            if (graphicArr != null) {
                for (i in 0 until minOf(graphicArr.length(), bandCount)) {
                    graphicGains[i] = graphicArr.getDouble(i).toFloat()
                }
            }

            val parametricGains = FloatArray(bandCount)
            val paramGainsArr   = json.optJSONArray("parametricGains")
            if (paramGainsArr != null) {
                for (i in 0 until minOf(paramGainsArr.length(), bandCount)) {
                    parametricGains[i] = paramGainsArr.getDouble(i).toFloat()
                }
            }

            val parametricFreqs = EqualizerProcessor.ISO_FREQ_CENTERS.copyOf()
            val paramFreqsArr   = json.optJSONArray("parametricFreqs")
            if (paramFreqsArr != null) {
                for (i in 0 until minOf(paramFreqsArr.length(), bandCount)) {
                    parametricFreqs[i] = paramFreqsArr.getDouble(i)
                }
            }

            val qValues  = DoubleArray(bandCount) { 1.0 }
            val qArr     = json.optJSONArray("qValues")
            if (qArr != null) {
                for (i in 0 until minOf(qArr.length(), bandCount)) {
                    qValues[i] = qArr.getDouble(i)
                }
            }

            EqPreset(
                name            = name,
                graphicGains    = graphicGains,
                parametricGains = parametricGains,
                parametricFreqs = parametricFreqs,
                qValues         = qValues,
                preampDb        = json.optDouble("preampDb", 0.0).toFloat(),
                eqMode          = json.optString("eqMode", "GRAPHIC"),
                smoothingRampMs = json.optDouble("smoothingRampMs", 10.0)
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse preset JSON", e)
            null
        }
    }

    // ── Assignments file ──────────────────────────────────────────────────────

    private fun loadAssignments(): Map<String, String> {
        return try {
            if (!assignmentsFile.exists()) return emptyMap()
            val json = JSONObject(assignmentsFile.readText())
            val result = mutableMapOf<String, String>()
            json.keys().forEach { key -> result[key] = json.getString(key) }
            result
        } catch (e: Exception) {
            emptyMap()
        }
    }

    private fun saveAssignments(assignments: Map<String, String>) {
        try {
            val json = JSONObject()
            assignments.forEach { (k, v) -> json.put(k, v) }
            assignmentsFile.writeText(json.toString(2))
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save track assignments", e)
        }
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    private fun sanitizeFileName(name: String): String {
        return name.replace(Regex("[/\\\\:*?\"<>|]"), "_")
                   .take(120)
    }
}