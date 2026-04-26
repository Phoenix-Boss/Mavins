package com.doublesymmetry.trackplayer.dsp

import android.util.Log
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * ReplayGainParser
 *
 * Reads ReplayGain metadata from audio files without loading the full stream.
 * Supports:
 *   âœ… ID3v2.3 / ID3v2.4  â€” TXXX frames (MP3, AAC-in-MP3 container)
 *   âœ… Vorbis Comment       â€” FLAC, OGG
 *   âœ… MP4 / M4A iTunes    â€” ----:com.apple.iTunes:replaygain_* free-form atoms
 *
 * Returns a [ReplayGainInfo] with track gain, album gain, and peak values.
 * All gain values are in dB. Missing values are null.
 *
 * ReplayGain application modes:
 *   TRACK  â€” use track gain (best for shuffle / random playback)
 *   ALBUM  â€” use album gain (best for listening to full albums, preserves relative loudness)
 *   RADIO  â€” alias for TRACK (legacy name from original ReplayGain spec)
 *   OFF    â€” do not apply any gain (raw file level)
 *
 * Target loudness: â€“14 LUFS (EBU R128 streaming standard).
 * Pre-amp offset: additional fine-tune added on top (default 0 dB).
 */
object ReplayGainParser {

    private const val TAG = "ReplayGainParser"

    enum class Mode { TRACK, ALBUM, RADIO, OFF }

    data class ReplayGainInfo(
        val trackGain: Float?,   // dB, e.g. -6.54
        val albumGain: Float?,   // dB, e.g. -5.20
        val trackPeak: Float?,   // linear 0..1+, e.g. 0.998
        val albumPeak: Float?,
        val source: String       // "id3", "vorbis", "mp4", "none"
    ) {
        /**
         * Resolve final gain to apply given mode and optional preamp.
         * Returns null if no gain metadata found (caller should leave loudness at 0 dB).
         */
        fun resolveGain(mode: Mode, preampDb: Float = 0f): Float? {
            val base = when (mode) {
                Mode.TRACK, Mode.RADIO -> trackGain ?: albumGain
                Mode.ALBUM             -> albumGain ?: trackGain
                Mode.OFF               -> return null
            } ?: return null
            return base + preampDb
        }

        val hasData: Boolean get() = trackGain != null || albumGain != null
    }

    val EMPTY = ReplayGainInfo(null, null, null, null, "none")

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // PUBLIC ENTRY POINT
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * Parse ReplayGain info from a local file path.
     * Returns EMPTY if path is null, file doesn't exist, or no RG tags found.
     * This must NOT be called on the audio thread â€” call from a coroutine/background thread.
     */
    fun parse(path: String?): ReplayGainInfo {
        if (path == null) return EMPTY
        val file = File(path)
        if (!file.exists() || !file.isFile) return EMPTY

        return try {
            when {
                path.endsWith(".mp3", ignoreCase = true) ||
                path.endsWith(".aac", ignoreCase = true) -> parseId3v2(file) ?: EMPTY
                path.endsWith(".flac", ignoreCase = true) -> parseVorbisComment(file) ?: EMPTY
                path.endsWith(".ogg", ignoreCase = true)  -> parseVorbisComment(file) ?: EMPTY
                path.endsWith(".m4a", ignoreCase = true)  ||
                path.endsWith(".mp4", ignoreCase = true)  ||
                path.endsWith(".aac", ignoreCase = true)  -> parseMp4(file) ?: EMPTY
                else -> parseId3v2(file) ?: parseVorbisComment(file) ?: EMPTY
            }
        } catch (e: Exception) {
            Log.w(TAG, "parse failed for $path: ${e.message}")
            EMPTY
        }
    }

    /**
     * Parse ReplayGain from a streaming URI using pre-supplied tag map.
     * Use this when your track metadata is already available as key-value pairs
     * (e.g. from ExoPlayer MediaMetadata extras or your own track database).
     *
     * Expected keys (case-insensitive):
     *   replaygain_track_gain, replaygain_album_gain,
     *   replaygain_track_peak, replaygain_album_peak
     */
    fun parseFromMap(tags: Map<String, String>): ReplayGainInfo {
        val norm = tags.mapKeys { it.key.lowercase().trim() }
        return ReplayGainInfo(
            trackGain = norm["replaygain_track_gain"]?.parseGainDb(),
            albumGain = norm["replaygain_album_gain"]?.parseGainDb(),
            trackPeak = norm["replaygain_track_peak"]?.parsePeak(),
            albumPeak = norm["replaygain_album_peak"]?.parsePeak(),
            source    = "map"
        )
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // ID3v2 PARSER
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private fun parseId3v2(file: File): ReplayGainInfo? {
        RandomAccessFile(file, "r").use { raf ->
            val header = ByteArray(10)
            if (raf.read(header) < 10) return null
            if (header[0] != 'I'.code.toByte() ||
                header[1] != 'D'.code.toByte() ||
                header[2] != '3'.code.toByte()) return null

            val version = header[3].toInt() and 0xFF  // 3 or 4
            val flags   = header[5].toInt() and 0xFF
            val hasExtHeader = (flags and 0x40) != 0

            // Sync-safe size decode
            val tagSize = (
                ((header[6].toInt() and 0x7F) shl 21) or
                ((header[7].toInt() and 0x7F) shl 14) or
                ((header[8].toInt() and 0x7F) shl  7) or
                 (header[9].toInt() and 0x7F)
            )

            var pos = 10
            if (hasExtHeader) {
                val extBuf = ByteArray(4)
                raf.read(extBuf)
                val extSize = ByteBuffer.wrap(extBuf).order(ByteOrder.BIG_ENDIAN).int
                pos += extSize
                raf.seek(pos.toLong())
            }

            val tags = mutableMapOf<String, String>()
            val end = 10 + tagSize

            while (pos + 10 <= end) {
                raf.seek(pos.toLong())
                val frameId = ByteArray(4).also { raf.read(it) }
                val frameIdStr = String(frameId, Charsets.ISO_8859_1)
                if (frameIdStr[0] == '\u0000') break

                val sizeBuf = ByteArray(4).also { raf.read(it) }
                val frameSize = if (version >= 4) {
                    // ID3v2.4: sync-safe
                    ((sizeBuf[0].toInt() and 0x7F) shl 21) or
                    ((sizeBuf[1].toInt() and 0x7F) shl 14) or
                    ((sizeBuf[2].toInt() and 0x7F) shl  7) or
                     (sizeBuf[3].toInt() and 0x7F)
                } else {
                    ByteBuffer.wrap(sizeBuf).order(ByteOrder.BIG_ENDIAN).int
                }

                raf.skipBytes(2) // flags
                pos += 10 + frameSize

                if (frameSize <= 0 || frameSize > 1024) continue

                if (frameIdStr == "TXXX") {
                    val content = ByteArray(frameSize).also { raf.read(it) }
                    val encoding = content[0].toInt() and 0xFF
                    val text = decodeId3Text(content, 1, encoding)
                    // TXXX: description\0value
                    val nul = text.indexOf('\u0000')
                    if (nul > 0) {
                        val desc  = text.substring(0, nul).lowercase().trim()
                        val value = text.substring(nul + 1).trim()
                        tags[desc] = value
                    }
                }
            }

            val tg = tags["replaygain_track_gain"]?.parseGainDb()
            val ag = tags["replaygain_album_gain"]?.parseGainDb()
            val tp = tags["replaygain_track_peak"]?.parsePeak()
            val ap = tags["replaygain_album_peak"]?.parsePeak()

            return if (tg != null || ag != null)
                ReplayGainInfo(tg, ag, tp, ap, "id3")
            else null
        }
    }

    private fun decodeId3Text(data: ByteArray, offset: Int, encoding: Int): String {
        val bytes = data.copyOfRange(offset, data.size)
        return when (encoding) {
            0    -> String(bytes, Charsets.ISO_8859_1)
            1, 2 -> String(bytes, Charsets.UTF_16)
            3    -> String(bytes, Charsets.UTF_8)
            else -> String(bytes, Charsets.ISO_8859_1)
        }
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // VORBIS COMMENT PARSER (FLAC / OGG)
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private fun parseVorbisComment(file: File): ReplayGainInfo? {
        RandomAccessFile(file, "r").use { raf ->
            val magic = ByteArray(4).also { raf.read(it) }
            val isFlac = magic[0] == 'f'.code.toByte() &&
                         magic[1] == 'L'.code.toByte() &&
                         magic[2] == 'a'.code.toByte() &&
                         magic[3] == 'C'.code.toByte()

            if (!isFlac) {
                // OGG: scan for "vorbis" comment header (packet type 0x03)
                return parseOggVorbisComment(raf)
            }

            // FLAC metadata blocks
            var isLast = false
            while (!isLast) {
                val blockHeader = ByteArray(4).also { raf.read(it) }
                isLast = (blockHeader[0].toInt() and 0x80) != 0
                val blockType = blockHeader[0].toInt() and 0x7F
                val blockSize = ((blockHeader[1].toInt() and 0xFF) shl 16) or
                                ((blockHeader[2].toInt() and 0xFF) shl  8) or
                                 (blockHeader[3].toInt() and 0xFF)

                if (blockType == 4) { // VORBIS_COMMENT
                    val data = ByteArray(blockSize).also { raf.read(it) }
                    return parseVorbisCommentBlock(data, "vorbis")
                } else {
                    raf.skipBytes(blockSize)
                }
            }
            return null
        }
    }

    private fun parseOggVorbisComment(raf: RandomAccessFile): ReplayGainInfo? {
        val buf = ByteArray(minOf(65536, raf.length().toInt()))
        raf.seek(0)
        raf.read(buf)
        val data = String(buf, Charsets.ISO_8859_1)
        val vcIdx = data.indexOf("\u0003vorbis")
        if (vcIdx < 0) return null
        return parseVorbisCommentBlock(buf.copyOfRange(vcIdx + 7, buf.size), "vorbis")
    }

    private fun parseVorbisCommentBlock(data: ByteArray, source: String): ReplayGainInfo? {
        val buf = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
        if (buf.remaining() < 4) return null

        // Skip vendor string
        val vendorLen = buf.int
        if (vendorLen < 0 || vendorLen > buf.remaining()) return null
        buf.position(buf.position() + vendorLen)
        if (buf.remaining() < 4) return null

        val commentCount = buf.int
        val tags = mutableMapOf<String, String>()

        repeat(commentCount) {
            if (buf.remaining() < 4) return@repeat
            val len = buf.int
            if (len <= 0 || len > buf.remaining()) return@repeat
            val comment = ByteArray(len).also { buf.get(it) }
            val str = String(comment, Charsets.UTF_8)
            val eq = str.indexOf('=')
            if (eq > 0) {
                tags[str.substring(0, eq).lowercase().trim()] = str.substring(eq + 1).trim()
            }
        }

        val tg = tags["replaygain_track_gain"]?.parseGainDb()
        val ag = tags["replaygain_album_gain"]?.parseGainDb()
        val tp = tags["replaygain_track_peak"]?.parsePeak()
        val ap = tags["replaygain_album_peak"]?.parsePeak()

        return if (tg != null || ag != null)
            ReplayGainInfo(tg, ag, tp, ap, source)
        else null
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // MP4 / M4A ATOM PARSER
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private fun parseMp4(file: File): ReplayGainInfo? {
        // Read first 512 KB â€” enough to contain all metadata atoms
        val readSize = minOf(524288L, file.length()).toInt()
        val buf = ByteArray(readSize)
        RandomAccessFile(file, "r").use { it.read(buf) }

        val tags = mutableMapOf<String, String>()
        scanMp4Atoms(buf, 0, buf.size, tags)

        val tg = tags["replaygain_track_gain"]?.parseGainDb()
        val ag = tags["replaygain_album_gain"]?.parseGainDb()
        val tp = tags["replaygain_track_peak"]?.parsePeak()
        val ap = tags["replaygain_album_peak"]?.parsePeak()

        return if (tg != null || ag != null)
            ReplayGainInfo(tg, ag, tp, ap, "mp4")
        else null
    }

    private fun scanMp4Atoms(data: ByteArray, start: Int, end: Int, out: MutableMap<String, String>) {
        var pos = start
        while (pos + 8 <= end) {
            val sizeBuf = ByteBuffer.wrap(data, pos, 4).order(ByteOrder.BIG_ENDIAN)
            val atomSize = sizeBuf.int
            if (atomSize < 8 || pos + atomSize > end) break
            val atomName = String(data, pos + 4, 4, Charsets.ISO_8859_1)

            when (atomName) {
                "moov", "udta", "meta", "ilst" ->
                    scanMp4Atoms(data, pos + 8, pos + atomSize, out)
                "----" -> parseFreeFormAtom(data, pos + 8, pos + atomSize, out)
            }
            pos += atomSize
        }
    }

    private fun parseFreeFormAtom(data: ByteArray, start: Int, end: Int, out: MutableMap<String, String>) {
        // ---- atom: mean + name + data sub-atoms
        var pos = start
        var meanStr = ""
        var nameStr = ""
        var valueStr = ""

        while (pos + 8 <= end) {
            val size = ByteBuffer.wrap(data, pos, 4).order(ByteOrder.BIG_ENDIAN).int
            if (size < 8 || pos + size > end) break
            val type = String(data, pos + 4, 4, Charsets.ISO_8859_1)
            val content = data.copyOfRange(pos + 8, pos + size)
            when (type) {
                "mean" -> meanStr = String(content.drop(4).toByteArray(), Charsets.UTF_8).trim()
                "name" -> nameStr = String(content.drop(4).toByteArray(), Charsets.UTF_8).lowercase().trim()
                "data" -> if (content.size > 8) {
                    valueStr = String(content.copyOfRange(8, content.size), Charsets.UTF_8).trim()
                }
            }
            pos += size
        }

        if (meanStr.contains("apple.iTunes", ignoreCase = true) && nameStr.isNotEmpty()) {
            out[nameStr] = valueStr
        }
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // VALUE PARSERS
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /** Parse "+3.21 dB" or "-6.54 dB" â†’ Float. Returns null on parse failure. */
    private fun String.parseGainDb(): Float? {
        return try {
            val cleaned = this.replace("dB", "", ignoreCase = true)
                             .replace("LU", "", ignoreCase = true)
                             .trim()
            cleaned.toFloat()
        } catch (e: NumberFormatException) { null }
    }

    /** Parse "0.998245" â†’ Float. Returns null on parse failure. */
    private fun String.parsePeak(): Float? {
        return try { this.trim().toFloat() } catch (e: NumberFormatException) { null }
    }
}
