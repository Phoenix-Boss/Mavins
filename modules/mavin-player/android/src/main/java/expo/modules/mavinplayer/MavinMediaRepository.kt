package expo.modules.mavinplayer

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
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper
import java.util.concurrent.TimeUnit

/**
 * MavinMediaRepository — implements NewPlayer's MediaRepository interface.
 *
 * The "item" string is always a YouTube video ID (11 characters).
 *
 * NewPlayer calls:
 *   getStreams(videoId)          → we call MavinEngine extractor, return DASH/HLS/audio streams
 *   getHttpDataSourceFactory()   → we return OkHttp factory with YouTube headers (fixes 403)
 *   getMetaInfo(videoId)         → title, artist, thumbnail
 *   getChapters(videoId)         → YouTube chapters as Chapter list
 *   getSubtitles(videoId)        → subtitle tracks
 *   getPreviewThumbnail()        → null (not implemented yet)
 */
class MavinMediaRepository(private val okHttpClient: OkHttpClient) : MediaRepository {

    companion object {
        private const val TAG = "MavinMediaRepository"
        private const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    // ── RepoMetaInfo ───────────────────────────────────────────────────────────

    override fun getRepoInfo() = MediaRepository.RepoMetaInfo(
        canHandleTimestampedLinks = true,
        pullsDataFromNetwork = true
    )

    // ── HTTP DataSource Factory — THIS IS WHAT FIXES 403s ─────────────────────
    //
    // NewPlayer calls getHttpDataSourceFactory(item) when building the
    // ExoPlayer MediaSource for every stream. By returning an OkHttpDataSource
    // with YouTube cookies and headers, every single HTTP request ExoPlayer
    // makes — DASH segments, HLS segments, progressive chunks — carries the
    // correct authentication. expo-video had no way to do this.

    override fun getHttpDataSourceFactory(item: String): HttpDataSource.Factory {
        val cookieHeaders = try {
            YoutubeParsingHelper.getCookieHeader()
        } catch (e: Exception) {
            Log.w(TAG, "getCookieHeader failed: ${e.message}")
            emptyMap<String, List<String>>()
        }

        val defaultHeaders = buildMap<String, String> {
            put("Origin", "https://www.youtube.com")
            put("Referer", "https://www.youtube.com/")
            put("Accept-Language", "en-US,en;q=0.9")
            put("X-YouTube-Client-Name", "3")
            // Inject the SOCS consent cookie from YoutubeParsingHelper
            // This is the official NewPipe pattern — no Cookie.Builder needed
            cookieHeaders["Cookie"]?.firstOrNull()?.let { put("Cookie", it) }
        }

        return OkHttpDataSource.Factory(okHttpClient)
            .setUserAgent(USER_AGENT)
            .setDefaultRequestProperties(defaultHeaders)
    }

    // ── Streams — called by NewPlayer when it needs to play an item ────────────

    override suspend fun getStreams(item: String): List<Stream> {
        Log.i(TAG, "getStreams: extracting videoId=$item")

        return try {
            val service = NewPipe.getService(0) // YouTube
            val extractor = service.getStreamExtractor(
                service.streamLHFactory.fromId(item)
            )
            val info = StreamInfo.getInfo(extractor)

            val streams = mutableListOf<Stream>()

            // 1. DASH manifest — best option, adaptive quality
            if (info.dashMpdUrl?.isNotEmpty() == true) {
                streams.add(
                    Stream(
                        item = item,
                        streamUri = Uri.parse(info.dashMpdUrl),
                        streamTracks = listOf(
                            AudioStreamTrack(bitrate = 128000, fileFormat = "webm"),
                            VideoStreamTrack(width = 1920, height = 1080, frameRate = 30, fileFormat = "webm")
                        ),
                        isDashOrHls = true
                    )
                )
                Log.i(TAG, "getStreams: DASH manifest found for $item")
            }

            // 2. HLS manifest — fallback
            if (info.hlsUrl?.isNotEmpty() == true) {
                streams.add(
                    Stream(
                        item = item,
                        streamUri = Uri.parse(info.hlsUrl),
                        streamTracks = listOf(
                            AudioStreamTrack(bitrate = 128000, fileFormat = "mp4")
                        ),
                        isDashOrHls = true
                    )
                )
                Log.i(TAG, "getStreams: HLS manifest found for $item")
            }

            // 3. Best progressive audio stream — last resort
            // Headers are injected via getHttpDataSourceFactory() so 403 won't occur
            if (streams.isEmpty()) {
                val bestAudio = info.audioStreams
                    .filter { it.content?.isNotEmpty() == true }
                    .maxByOrNull { it.getBitrate() }

                if (bestAudio?.content != null) {
                    streams.add(
                        Stream(
                            item = item,
                            streamUri = Uri.parse(bestAudio.content),
                            streamTracks = listOf(
                                AudioStreamTrack(
                                    bitrate = bestAudio.getBitrate(),
                                    fileFormat = bestAudio.format?.suffix ?: "webm"
                                )
                            ),
                            isDashOrHls = false
                        )
                    )
                    Log.i(TAG, "getStreams: progressive audio fallback for $item")
                }
            }

            if (streams.isEmpty()) {
                throw Exception("No playable streams found for videoId=$item")
            }

            Log.i(TAG, "getStreams: returning ${streams.size} streams for $item")
            streams

        } catch (e: Exception) {
            Log.e(TAG, "getStreams failed for $item: ${e.message}", e)
            throw e
        }
    }

    // ── Metadata ───────────────────────────────────────────────────────────────

    override suspend fun getMetaInfo(item: String): MediaMetadata {
        return try {
            val service = NewPipe.getService(0)
            val extractor = service.getStreamExtractor(
                service.streamLHFactory.fromId(item)
            )
            val info = StreamInfo.getInfo(extractor)

            val thumbnailUrl = info.thumbnails
                .maxByOrNull { it.width }
                ?.url

            MediaMetadata.Builder()
                .setTitle(info.name)
                .setArtist(info.uploaderName)
                .setArtworkUri(thumbnailUrl?.let { Uri.parse(it) })
                .build()
        } catch (e: Exception) {
            Log.w(TAG, "getMetaInfo failed for $item: ${e.message}")
            MediaMetadata.Builder().setTitle(item).build()
        }
    }

    // ── Chapters ───────────────────────────────────────────────────────────────

    override suspend fun getChapters(item: String): List<Chapter> {
        return try {
            val service = NewPipe.getService(0)
            val extractor = service.getStreamExtractor(
                service.streamLHFactory.fromId(item)
            )
            val info = StreamInfo.getInfo(extractor)

            info.streamSegments.map { segment ->
                Chapter(
                    chapterStartInMs = segment.startTimeSeconds * 1000L,
                    chapterTitle = segment.title,
                    thumbnail = segment.previewUrl?.let { Uri.parse(it) }
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "getChapters failed for $item: ${e.message}")
            emptyList()
        }
    }

    // ── Subtitles ──────────────────────────────────────────────────────────────

    override suspend fun getSubtitles(item: String): List<Subtitle> {
        return try {
            val service = NewPipe.getService(0)
            val extractor = service.getStreamExtractor(
                service.streamLHFactory.fromId(item)
            )
            val info = StreamInfo.getInfo(extractor)

            info.subtitles.mapNotNull { sub ->
                val url = sub.content ?: return@mapNotNull null
                Subtitle(
                    uri = Uri.parse(url),
                    identifier = sub.getLanguageTag() ?: "und"
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "getSubtitles failed for $item: ${e.message}")
            emptyList()
        }
    }

    // ── Preview thumbnails — not implemented ───────────────────────────────────

    override suspend fun getPreviewThumbnail(item: String, timestampInMs: Long): Bitmap? = null

    override suspend fun getPreviewThumbnailsInfo(item: String) =
        MediaRepository.PreviewThumbnailsInfo(count = 0L, distanceInMS = 0L)

    // ── Timestamp links ────────────────────────────────────────────────────────

    override suspend fun getTimestampLink(item: String, timestampInSeconds: Long): String =
        "https://www.youtube.com/watch?v=$item&t=${timestampInSeconds}s"
}