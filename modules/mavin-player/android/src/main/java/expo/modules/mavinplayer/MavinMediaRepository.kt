package expo.modules.mavinplayer

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.util.Log
import androidx.media3.common.MediaMetadata
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import net.newpipe.newplayer.data.AudioStreamTrack
import net.newpipe.newplayer.data.Chapter
import net.newpipe.newplayer.data.Stream
import net.newpipe.newplayer.data.StreamTrack
import net.newpipe.newplayer.data.Subtitle
import net.newpipe.newplayer.data.VideoStreamTrack
import net.newpipe.newplayer.repository.MediaRepository
import okhttp3.OkHttpClient

/**
 * MavinMediaRepository — pure adapter. Zero YouTube calls.
 *
 * The complete resolution contract:
 *   JS (MavinEngine) extracts once → produces ResolvedBundle (URLs + HTTP context)
 *   JS passes bundle to MavinPlayerModule.loadBundle()
 *   MavinPlayerModule stores it here via storeBundle()
 *   NewPlayer calls getStreams()               → returns URLs from bundle
 *   NewPlayer calls getHttpDataSourceFactory() → returns OkHttp built from bundle's HTTP context
 *   ExoPlayer fetches CDN segments with the exact same session that extracted the video
 *
 * This repository never calls NewPipe, never calls YouTube, never generates headers.
 * It is a pure translator: bundle → NewPlayer API types.
 *
 * Session affinity guarantee:
 *   The OkHttpClient passed in here has NO cookie jar (null). All cookies are
 *   injected as raw header values from the bundle. This prevents OkHttp from
 *   silently overriding bundle cookies with stale values from a built-in cookie store.
 *   The same OkHttpClient instance is reused across tracks so HTTP/2 connections
 *   are multiplexed correctly and YouTube CDN does not see a new connection per segment.
 */
class MavinMediaRepository(
    private val context: Context,
    // This client must have NO cookie jar. Constructed in MavinPlayerModule companion.
    private val okHttpClient: OkHttpClient
) : MediaRepository {

    companion object {
        private const val TAG = "MavinMediaRepository"
    }

    /**
     * The complete resolved bundle for the current track.
     * Replaced atomically on each new track cycle.
     * Cleared when playback ends.
     *
     * All four NewPlayer repository calls (getStreams, getHttpDataSourceFactory,
     * getMetaInfo, getChapters) read from this same snapshot so they are always
     * consistent with each other — no race between a bundle swap and a partial read.
     */
    @Volatile
    private var currentBundle: ResolvedBundle? = null

    /**
     * Store a resolved bundle for the given videoId.
     * Called by MavinPlayerModule immediately before triggering playStream().
     * This is the handoff point from the JS extraction phase to the Kotlin play phase.
     */
    fun storeBundle(bundle: ResolvedBundle) {
        currentBundle = bundle
        Log.i(TAG, "Bundle stored for videoId=${bundle.videoId} " +
            "hasDash=${bundle.dashManifestUrl != null} " +
            "hasHls=${bundle.hlsManifestUrl != null} " +
            "hasProgressive=${bundle.progressiveAudioUrl != null} " +
            "cookiePresent=${bundle.httpContext.cookie.isNotEmpty()}")
    }

    /**
     * Clear the bundle when playback ends or a new cycle begins.
     */
    fun clearBundle() {
        currentBundle = null
        Log.d(TAG, "Bundle cleared")
    }

    // ── RepoMetaInfo ──────────────────────────────────────────────────────────

    override fun getRepoInfo() = MediaRepository.RepoMetaInfo(
        canHandleTimestampedLinks = true,
        pullsDataFromNetwork = true
    )

    // ── HTTP DataSource Factory ───────────────────────────────────────────────
    //
    // Returns an OkHttpDataSource factory built from the engine's HTTP context.
    // This is what ensures CDN segment requests carry the exact same session
    // identity (cookies, Origin, Referer, visitor data) that was used during
    // extraction by MavinEngine.
    //
    // Industry standard: Referer and Origin on segment requests must match
    // the values used during resolution. YouTube CDN validates this.
    //
    // OkHttp cookie jar is intentionally absent from okHttpClient. We inject
    // cookies as a raw "Cookie" header so OkHttp cannot override or merge them.

    override fun getHttpDataSourceFactory(item: String): HttpDataSource.Factory {
        val bundle = currentBundle

        if (bundle == null || bundle.videoId != item) {
            Log.w(TAG, "getHttpDataSourceFactory called for item=$item but bundle is " +
                if (bundle == null) "null" else "for ${bundle.videoId} — using minimal headers")
        }

        val ctx = bundle?.httpContext

        val headers = buildMap<String, String> {
            // These three are mandatory for YouTube CDN session affinity.
            // They must match exactly what the engine sent during extraction.
            put("Origin",         ctx?.origin   ?: "https://www.youtube.com")
            put("Referer",        ctx?.referer  ?: "https://www.youtube.com/")
            put("Accept-Language", ctx?.acceptLanguage ?: "en-US,en;q=0.9")

            // YouTube client identification headers — same values used by engine.
            if (!ctx?.xYoutubeClientName.isNullOrEmpty()) {
                put("X-YouTube-Client-Name", ctx!!.xYoutubeClientName)
            }
            if (!ctx?.xYoutubeClientVersion.isNullOrEmpty()) {
                put("X-YouTube-Client-Version", ctx!!.xYoutubeClientVersion)
            }

            // Cookie — injected as raw header, not via cookie jar.
            // This is the SOCS consent cookie plus any session cookies
            // that were active when the engine extracted this video.
            // Only set if non-empty to avoid sending a blank Cookie header.
            if (!ctx?.cookie.isNullOrEmpty()) {
                put("Cookie", ctx!!.cookie)
            }
        }

        val userAgent = ctx?.userAgent?.takeIf { it.isNotEmpty() }
            ?: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
               "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

        Log.d(TAG, "getHttpDataSourceFactory: item=$item headers=${headers.keys}")

        return OkHttpDataSource.Factory(okHttpClient)
            .setUserAgent(userAgent)
            .setDefaultRequestProperties(headers)
    }

    // ── Streams ───────────────────────────────────────────────────────────────
    //
    // Returns the pre-resolved streams from the bundle.
    // Priority: DASH > HLS > progressive (matching industry standard).
    // No network call. No NewPipe extraction.

    override suspend fun getStreams(item: String): List<Stream> {
        val bundle = currentBundle

        if (bundle == null) {
            Log.e(TAG, "getStreams called with no bundle stored — videoId=$item")
            throw IllegalStateException("No resolved bundle available for item=$item. " +
                "storeBundle() must be called before playStream().")
        }

        if (bundle.videoId != item) {
            Log.w(TAG, "getStreams: bundle videoId=${bundle.videoId} != requested item=$item")
            // Still proceed — NewPlayer may call this with a slightly different form of the ID.
        }

        val streams = mutableListOf<Stream>()

        // 1. DASH manifest — best option. Adaptive quality. Session-bound via manifest token.
        bundle.dashManifestUrl?.takeIf { it.isNotEmpty() }?.let { dashUrl ->
            streams.add(
                Stream(
                    item = item,
                    streamUri = Uri.parse(dashUrl),
                    streamTracks = listOf(
                        AudioStreamTrack(bitrate = 128000, fileFormat = "webm"),
                        VideoStreamTrack(
                            width = 1920, height = 1080, frameRate = 30,
                            fileFormat = "webm"
                        )
                    ),
                    isDashOrHls = true
                )
            )
            Log.i(TAG, "getStreams: DASH manifest → $item")
        }

        // 2. HLS manifest — second preference.
        bundle.hlsManifestUrl?.takeIf { it.isNotEmpty() }?.let { hlsUrl ->
            streams.add(
                Stream(
                    item = item,
                    streamUri = Uri.parse(hlsUrl),
                    streamTracks = listOf(
                        AudioStreamTrack(bitrate = 128000, fileFormat = "mp4")
                    ),
                    isDashOrHls = true
                )
            )
            Log.i(TAG, "getStreams: HLS manifest → $item")
        }

        // 3. Progressive audio — last resort only when no manifests available.
        // Progressive URLs expire faster than manifests and have no CDN session binding.
        if (streams.isEmpty()) {
            bundle.progressiveAudioUrl?.takeIf { it.isNotEmpty() }?.let { audioUrl ->
                streams.add(
                    Stream(
                        item = item,
                        streamUri = Uri.parse(audioUrl),
                        streamTracks = listOf(
                            AudioStreamTrack(
                                bitrate = bundle.progressiveAudioBitrate,
                                fileFormat = bundle.progressiveAudioFormat
                            )
                        ),
                        isDashOrHls = false
                    )
                )
                Log.i(TAG, "getStreams: progressive audio fallback → $item")
            }
        }

        if (streams.isEmpty()) {
            Log.e(TAG, "getStreams: no playable streams in bundle for $item")
            throw IllegalStateException("No playable streams in resolved bundle for item=$item")
        }

        Log.i(TAG, "getStreams: returning ${streams.size} streams for $item")
        return streams
    }

    // ── Metadata ──────────────────────────────────────────────────────────────
    // Returns metadata from the bundle. No network call.

    override suspend fun getMetaInfo(item: String): MediaMetadata {
        val bundle = currentBundle
        return MediaMetadata.Builder()
            .setTitle(bundle?.title ?: item)
            .setArtist(bundle?.artist)
            .setArtworkUri(bundle?.thumbnailUrl?.let { Uri.parse(it) })
            .build()
    }

    // ── Chapters ──────────────────────────────────────────────────────────────
    // Returns chapters from the bundle. No network call.

    override suspend fun getChapters(item: String): List<Chapter> {
        return currentBundle?.chapters?.map { c ->
            Chapter(
                chapterStartInMs = c.startMs,
                chapterTitle = c.title,
                thumbnail = c.thumbnailUrl?.let { Uri.parse(it) }
            )
        } ?: emptyList()
    }

    // ── Subtitles ─────────────────────────────────────────────────────────────
    // Returns subtitles from the bundle. No network call.

    override suspend fun getSubtitles(item: String): List<Subtitle> {
        return currentBundle?.subtitles?.mapNotNull { s ->
            val uri = s.url.takeIf { it.isNotEmpty() }?.let { Uri.parse(it) }
                ?: return@mapNotNull null
            Subtitle(uri = uri, identifier = s.languageTag.ifEmpty { "und" })
        } ?: emptyList()
    }

    // ── Preview thumbnails — not implemented ──────────────────────────────────

    override suspend fun getPreviewThumbnail(item: String, timestampInMs: Long): Bitmap? = null

    override suspend fun getPreviewThumbnailsInfo(item: String) =
        MediaRepository.PreviewThumbnailsInfo(count = 0L, distanceInMS = 0L)

    // ── Timestamp links ───────────────────────────────────────────────────────

    override suspend fun getTimestampLink(item: String, timestampInSeconds: Long): String =
        "https://www.youtube.com/watch?v=$item&t=${timestampInSeconds}s"
}

// ── Bundle data structures ────────────────────────────────────────────────────

/**
 * The complete resolved package that travels from MavinEngine (JS) to the repository (Kotlin).
 * Contains both the resolved content (URLs, metadata) and the HTTP context
 * (the exact session credentials used during extraction).
 *
 * These two parts are inseparable. The URLs are only valid in the context
 * of the session that produced them.
 */
data class ResolvedBundle(
    val videoId: String,
    val extractedAtMs: Long = System.currentTimeMillis(),

    // ── Resolved content ──
    val dashManifestUrl: String?,
    val hlsManifestUrl: String?,
    val progressiveAudioUrl: String?,
    val progressiveAudioBitrate: Int = 128000,
    val progressiveAudioFormat: String = "webm",

    // ── Metadata ──
    val title: String,
    val artist: String?,
    val thumbnailUrl: String?,
    val durationSeconds: Long = 0L,

    // ── Chapters and subtitles ──
    val chapters: List<BundleChapter> = emptyList(),
    val subtitles: List<BundleSubtitle> = emptyList(),

    // ── HTTP context — the session that extracted this video ──
    // These values are captured atomically at extraction time.
    // They travel to OkHttpDataSource.Factory unchanged.
    val httpContext: BundleHttpContext
)

/**
 * The HTTP session context captured by MavinEngine at extraction time.
 * Every field here was present on the actual YouTube request that produced the stream URLs.
 */
data class BundleHttpContext(
    // The SOCS consent cookie + any session cookies active during extraction.
    // Injected as raw "Cookie" header — not via OkHttp cookie jar.
    val cookie: String = "",

    // Must match extraction values exactly. YouTube CDN validates these.
    val origin: String = "https://www.youtube.com",
    val referer: String = "https://www.youtube.com/",
    val acceptLanguage: String = "en-US,en;q=0.9",

    // YouTube client identification. Same values sent by engine during extraction.
    val xYoutubeClientName: String = "3",
    val xYoutubeClientVersion: String = "",

    // User agent used by the engine during extraction.
    val userAgent: String = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

data class BundleChapter(
    val startMs: Long,
    val title: String,
    val thumbnailUrl: String? = null
)

data class BundleSubtitle(
    val url: String,
    val languageTag: String
)