package com.doublesymmetry.trackplayer.dsp

/**
 * TrackData â€” Immutable data class representing a single playable track.
 *
 * Designed for RNTP v4/v5 parity:
 *  - `uri` / `url` are interchangeable (uri takes precedence)
 *  - `artwork` / `artworkUri` are interchangeable
 *  - `headers` are forwarded as HTTP request headers via RequestMetadata
 *  - `replayGainTags` are stored in MediaMetadata extras for offline-aware parsing
 *  - `rating`, `type`, `userAgent`, `contentType` added for RNTP v5 parity
 */
data class TrackData(
    /** Unique stable identifier for this track. Defaults to epoch ms if not provided. */
    val id: String,

    /** Playback URI â€” local file path, http/https stream, or content:// URI. */
    val uri: String,

    /** Display title shown in notification and lock screen. */
    val title: String? = null,

    /** Primary artist name. */
    val artist: String? = null,

    /** Album name. */
    val album: String? = null,

    /** Album/track artwork URI (http, https, or local file path). */
    val artworkUri: String? = null,

    /** Track duration in milliseconds. Used for progress display before buffering. */
    val duration: Long? = null,

    /** Additional HTTP headers to attach to the media request. */
    val headers: Map<String, String>? = null,

    /** ReplayGain tags (e.g. replaygain_track_gain, replaygain_album_gain). */
    val replayGainTags: Map<String, String>? = null,

    /** Genre string (ID3 / Vorbis). */
    val genre: String? = null,

    /** Description / comment field. */
    val description: String? = null,

    /** Release date string (ISO 8601 or free-form). */
    val date: String? = null,

    /** RNTP v5: Star or percentage rating (0.0â€“1.0 normalised). */
    val rating: Float? = null,

    /** RNTP v5: Track type â€” "default", "dash", "hls", "smoothstreaming". */
    val type: String? = null,

    /** RNTP v5: Custom User-Agent header override. */
    val userAgent: String? = null,

    /** RNTP v5: MIME / content type hint (e.g. "audio/mpeg"). */
    val contentType: String? = null,

    /** Whether this track is a live stream (disables duration and seeking). */
    val isLiveStream: Boolean = false,
)
