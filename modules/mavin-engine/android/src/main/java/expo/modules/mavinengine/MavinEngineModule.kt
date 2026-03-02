// modules/mavin-engine/android/src/main/java/expo/modules/mavinengine/MavinEngineModule.kt
// ✅ FIXED - Complete 2026 NewPipe + Expo Module Pattern

package expo.modules.mavinengine

import expo.modules.kotlin.AppContext
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.javadsl.imports.*
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ExtractionException
import org.schabi.newpipe.extractor.linkhandler.SearchQueryHandler
import org.schabi.newpipe.extractor.search.SearchExtractor
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.playlist.PlaylistInfo
import org.schabi.newpipe.extractor.playlist.PlaylistInfoItem
import org.schabi.newpipe.extractor.channel.ChannelInfoItem
import org.schabi.newpipe.extractor.kiosk.KioskExtractor
import org.schabi.newpipe.extractor.InfoItem
import java.io.IOException
import java.util.concurrent.TimeUnit

class MavinEngineModule(appContext: AppContext? = null) : Module(appContext) {

    override fun definition() = ModuleDefinition {
        Name("MavinEngine")

        // ============================================
        // DEEP LINK HANDLER (NEW - Website Integration)
        // ============================================
        AsyncFunction("handleDeepLink") { 
            url: String, 
            promise: Promise 
        -> 
            try {
                NewPipe.init(ExpoDownloader())
                val videoId = extractVideoId(url)
                val trackInfo = extractAudioFromVideoId(videoId)
                promise.resolve(trackInfo + mapOf("autoPlay" to true, "source" to "deeplink"))
            } catch (e: Exception) {
                promise.reject("DEEP_LINK_FAILED", e.message ?: "Invalid URL", e)
            }
        }

        // ============================================
        // AUDIO EXTRACTION (PERFECT - Unchanged)
        // ============================================
        AsyncFunction("extractAudio") { artist: String, title: String, isrc: String?, promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val query = if (!isrc.isNullOrEmpty()) "ISRC:$isrc" else "$artist $title audio"
                val streamInfo = searchAndExtract(query)
                val audioStream = streamInfo.audioStreams
                    .filter { it.content != null }
                    .maxByOrNull { it.averageBitrate }
                    ?: throw CodedException("No usable audio stream found")

                promise.resolve(
                    mapOf(
                        "url" to audioStream.content,
                        "videoId" to extractVideoId(streamInfo.url!!),
                        "title" to streamInfo.name,
                        "artist" to streamInfo.uploaderName,
                        "duration" to streamInfo.duration,
                        "thumbnail" to (streamInfo.thumbnails?.firstOrNull()?.url ?: ""),
                        "views" to (streamInfo.viewCount ?: 0L),
                        "likes" to (streamInfo.likeCount ?: 0L),
                        "expires" to (System.currentTimeMillis() + 6 * 60 * 60 * 1000).toString(),
                        "quality" to getQualityLabel(audioStream),
                        "success" to true
                    )
                )
            } catch (e: Exception) {
                promise.reject("EXTRACTION_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("extractAudioFromVideoId") { videoId: String, promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val url = "https://www.youtube.com/watch?v=$videoId"
                val info = StreamInfo.getInfo(ServiceList.YouTube, url)
                val audioStream = info.audioStreams
                    .filter { it.content != null }
                    .maxByOrNull { it.averageBitrate }
                    ?: throw CodedException("No usable audio stream found")

                promise.resolve(
                    mapOf(
                        "url" to audioStream.content,
                        "videoId" to videoId,
                        "title" to info.name,
                        "artist" to info.uploaderName,
                        "duration" to info.duration,
                        "thumbnail" to (info.thumbnails?.firstOrNull()?.url ?: ""),
                        "views" to (info.viewCount ?: 0L),
                        "likes" to (info.likeCount ?: 0L),
                        "expires" to (System.currentTimeMillis() + 6 * 60 * 60 * 1000).toString(),
                        "quality" to getQualityLabel(audioStream),
                        "success" to true
                    )
                )
            } catch (e: Exception) {
                promise.reject("EXTRACTION_FAILED", e.message ?: "Unknown error", e)
            }
        }

        // ============================================
        // HOME SCREEN SECTIONS - ALL FIXED
        // ============================================

        AsyncFunction("getTrendingMusic") { promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val kioskList = ServiceList.YouTube.kioskList
                
                val trendingSongs = try {
                    val kioskExtractor = kioskList.getExtractorById("Trending", null) as? KioskExtractor<*> 
                        ?: throw Exception("Trending kiosk unavailable")
                    kioskExtractor.fetchPage()
                    extractStreamItems(kioskExtractor.initialPage.items)
                } catch (e1: Exception) {
                    try {
                        val kioskExtractor = kioskList.getExtractorById("MusicTrending", null) as? KioskExtractor<*> 
                            ?: throw Exception("MusicTrending kiosk unavailable")
                        kioskExtractor.fetchPage()
                        extractStreamItems(kioskExtractor.initialPage.items)
                    } catch (e2: Exception) {
                        val fallback = fallbackSearch("trending music")
                        promise.resolve(fallback.take(20))
                        return@AsyncFunction
                    }
                }
                promise.resolve(trendingSongs.take(20))
            } catch (e: Exception) {
                promise.reject("TRENDING_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("getTopCharts") { chartType: String, promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val kioskList = ServiceList.YouTube.kioskList
                
                val chartIds = when (chartType) {
                    "top50" -> listOf("Top50", "Charts")
                    "viral50" -> listOf("Viral50", "Trending")
                    else -> listOf("Top50", "Charts", "Trending")
                }
                
                val chartSongs = chartIds.mapNotNull { chartId ->
                    try {
                        val kioskExtractor = kioskList.getExtractorById(chartId, null) as? KioskExtractor<*>
                        kioskExtractor?.fetchPage()
                        kioskExtractor?.initialPage?.items?.let { extractStreamItems(it) }
                    } catch (e: Exception) { null }
                }.firstOrNull { it.isNotEmpty() } ?: fallbackSearch("top $chartType")

                promise.resolve(chartSongs.take(50))
            } catch (e: Exception) {
                promise.reject("CHARTS_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("getNewReleases") { promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val newSongs = fallbackSearch("new music releases this week")
                promise.resolve(newSongs.take(20))
            } catch (e: Exception) {
                promise.reject("NEW_RELEASES_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("getGenreStations") { genre: String, promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val searchHandler = ServiceList.YouTube.getSearchQHFactory()
                    .fromQuery("$genre music playlist", listOf("playlist"), "")
                val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchHandler)
                searchExtractor.fetchPage()
                val genrePlaylists = extractPlaylistsFromSearch(searchExtractor.initialPage.items)
                promise.resolve(genrePlaylists.take(10))
            } catch (e: Exception) {
                promise.reject("GENRE_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("getPopularChoice") { promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val popularSongs = fallbackSearch("popular music right now")
                promise.resolve(popularSongs.take(20))
            } catch (e: Exception) {
                promise.reject("POPULAR_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("getMonthlyTop") { promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val topSongs = fallbackSearch("top songs this month")
                val monthlyWithPosition = topSongs.take(10).mapIndexed { index, song ->
                    song + mapOf("position" to (index + 1))
                }
                promise.resolve(monthlyWithPosition)
            } catch (e: Exception) {
                promise.reject("MONTHLY_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("getEditorPicks") { promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val curated = fallbackSearch("best playlists 2026")
                promise.resolve(curated.take(8))
            } catch (e: Exception) {
                promise.reject("EDITOR_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("getSponsoredContent") { promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val trending = fallbackSearch("trending music")
                val sponsored = trending.take(10).mapIndexed { index, song ->
                    song + mapOf(
                        "sponsored" to (index < 3),
                        "sponsorName" to if (index < 3) "Mavin Partner" else null
                    )
                }
                promise.resolve(sponsored)
            } catch (e: Exception) {
                promise.reject("SPONSORED_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("getPodcasts") { promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val searchHandler = ServiceList.YouTube.getSearchQHFactory()
                    .fromQuery("podcast music", listOf("playlist", "channel"), "")
                val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchHandler)
                searchExtractor.fetchPage()
                val podcasts = extractPodcastsFromSearch(searchExtractor.initialPage.items)
                promise.resolve(podcasts)
            } catch (e: Exception) {
                promise.reject("PODCAST_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("getLiveStations") { promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val searchHandler = ServiceList.YouTube.getSearchQHFactory()
                    .fromQuery("live music radio afrobeats", listOf("video"), "")
                val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchHandler)
                searchExtractor.fetchPage()
                val liveStations = extractLiveStreams(searchExtractor.initialPage.items)
                promise.resolve(liveStations)
            } catch (e: Exception) {
                promise.reject("LIVE_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("getCoverSongs") { promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val covers = fallbackSearch("cover songs afrobeats")
                promise.resolve(covers.take(15))
            } catch (e: Exception) {
                promise.reject("COVERS_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("searchMusic") { query: String, filter: String?, promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val contentFilter = when (filter) {
                    "song" -> listOf("video")
                    "playlist" -> listOf("playlist")
                    "artist" -> listOf("channel")
                    else -> listOf("video", "playlist", "channel")
                }
                val searchHandler = ServiceList.YouTube.getSearchQHFactory()
                    .fromQuery(query, contentFilter, "")
                val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchHandler)
                searchExtractor.fetchPage()
                val results = extractSearchResults(searchExtractor.initialPage.items)
                promise.resolve(results)
            } catch (e: Exception) {
                promise.reject("SEARCH_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("getTrackDetails") { videoId: String, promise: Promise ->
            try {
                NewPipe.init(ExpoDownloader())
                val url = "https://www.youtube.com/watch?v=$videoId"
                val info = StreamInfo.getInfo(ServiceList.YouTube, url)
                val audioStream = info.audioStreams.filter { it.content != null }
                    .maxByOrNull { it.averageBitrate }

                promise.resolve(
                    mapOf(
                        "id" to videoId,
                        "title" to info.name,
                        "artist" to info.uploaderName,
                        "duration" to info.duration,
                        "thumbnail" to (info.thumbnails?.firstOrNull()?.url ?: ""),
                        "views" to (info.viewCount ?: 0L),
                        "likes" to (info.likeCount ?: 0L),
                        "audioUrl" to (audioStream?.content ?: ""),
                        "audioQuality" to (audioStream?.let { getQualityLabel(it) } ?: "unknown"),
                        "available" to true
                    )
                )
            } catch (e: Exception) {
                promise.reject("DETAILS_FAILED", e.message ?: "Unknown error", e)
            }
        }
    }

    // ============================================
    // FIXED HELPER FUNCTIONS
    // ============================================

    private fun fallbackSearch(query: String): List<Map<String, Any>> {
        val searchHandler = ServiceList.YouTube.getSearchQHFactory()
            .fromQuery(query, listOf("video"), "")
        val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchHandler)
        searchExtractor.fetchPage()
        return extractSearchResults(searchExtractor.initialPage.items)
    }

    private fun searchAndExtract(query: String): StreamInfo {
        val factory = ServiceList.YouTube.getSearchQHFactory()
        val handler = factory.fromQuery(query, listOf("video"), "")
        val extractor = ServiceList.YouTube.getSearchExtractor(handler)
        extractor.fetchPage()
        val firstStream = extractor.initialPage.items
            .firstOrNull { it is StreamInfoItem } as? StreamInfoItem
            ?: throw CodedException("No valid stream found")
        return StreamInfo.getInfo(ServiceList.YouTube, firstStream.url!!)
    }

    private fun extractVideoId(url: String): String {
        val patterns = listOf("v=([a-zA-Z0-9_-]{11})", "youtu.be/([a-zA-Z0-9_-]{11})")
        patterns.forEach { pattern ->
            Regex(pattern).find(url)?.groupValues?.get(1)?.let { return it }
        }
        return url
    }

    private fun extractAudioFromVideoId(videoId: String): Map<String, Any> {
        try {
            val url = "https://www.youtube.com/watch?v=$videoId"
            NewPipe.init(ExpoDownloader())
            val info = StreamInfo.getInfo(ServiceList.YouTube, url)
            val audioStream = info.audioStreams
                .filter { it.content != null }
                .maxByOrNull { it.averageBitrate }
                ?: return mapOf("error" to "No audio available")

            return mapOf(
                "url" to audioStream.content,
                "videoId" to videoId,
                "title" to info.name,
                "artist" to info.uploaderName,
                "duration" to info.duration,
                "thumbnail" to (info.thumbnails?.firstOrNull()?.url ?: ""),
                "quality" to getQualityLabel(audioStream)
            )
        } catch (e: Exception) {
            return mapOf("error" to e.message)
        }
    }

    private fun getQualityLabel(stream: AudioStream): String = when {
        stream.averageBitrate > 256_000 -> "high"
        stream.averageBitrate > 128_000 -> "medium"
        else -> "low"
    }

    private fun extractStreamItems(items: List<InfoItem>): List<Map<String, Any>> {
        return items.mapNotNull {
            if (it is StreamInfoItem) {
                mapOf(
                    "id" to it.url,
                    "videoId" to extractVideoId(it.url),
                    "title" to it.name,
                    "artist" to it.uploaderName,
                    "duration" to it.duration,
                    "thumbnail" to (it.thumbnails?.firstOrNull()?.url ?: ""),
                    "views" to (it.viewCount ?: 0L)
                )
            } else null
        }
    }

    private fun extractPlaylistsFromSearch(items: List<InfoItem>): List<Map<String, Any>> {
        return items.filterIsInstance<PlaylistInfoItem>().map {
            mapOf(
                "id" to extractPlaylistId(it.url),
                "title" to it.name,
                "thumbnail" to (it.thumbnails?.firstOrNull()?.url ?: ""),
                "trackCount" to it.streamCount,
                "uploader" to it.uploaderName
            )
        }
    }

    private fun extractPlaylistId(url: String): String {
        val pattern = "list=([a-zA-Z0-9_-]+)".toRegex()
        return pattern.find(url)?.groupValues?.get(1) ?: url
    }

    private fun extractSearchResults(items: List<InfoItem>): List<Map<String, Any>> {
        return items.mapNotNull {
            when (it) {
                is StreamInfoItem -> mapOf(
                    "type" to "song",
                    "id" to it.url,
                    "videoId" to extractVideoId(it.url),
                    "title" to it.name,
                    "artist" to it.uploaderName,
                    "duration" to it.duration,
                    "thumbnail" to (it.thumbnails?.firstOrNull()?.url ?: ""),
                    "views" to (it.viewCount ?: 0L)
                )
                is PlaylistInfoItem -> mapOf(
                    "type" to "playlist",
                    "id" to extractPlaylistId(it.url),
                    "title" to it.name,
                    "thumbnail" to (it.thumbnails?.firstOrNull()?.url ?: ""),
                    "trackCount" to it.streamCount
                )
                is ChannelInfoItem -> mapOf(
                    "type" to "artist",
                    "id" to it.url,
                    "name" to it.name,
                    "thumbnail" to (it.thumbnails?.firstOrNull()?.url ?: ""),
                    "subscribers" to (it.subscriberCount ?: 0L),
                    "verified" to it.isVerified
                )
                else -> null
            }
        }
    }

    private fun extractPodcastsFromSearch(items: List<InfoItem>): List<Map<String, Any>> {
        return items.filterIsInstance<PlaylistInfoItem>()
            .filter { 
                it.name.lowercase().contains("podcast") || 
                it.uploaderName?.lowercase()?.contains("podcast") == true 
            }
            .map {
                mapOf(
                    "id" to extractPlaylistId(it.url),
                    "title" to it.name,
                    "thumbnail" to (it.thumbnails?.firstOrNull()?.url ?: ""),
                    "episodeCount" to it.streamCount,
                    "uploader" to it.uploaderName,
                    "type" to "podcast"
                )
            }
    }

    private fun extractLiveStreams(items: List<InfoItem>): List<Map<String, Any>> {
        return items.filterIsInstance<StreamInfoItem>()
            .filter { it.isLiveStream }
            .map {
                mapOf(
                    "id" to it.url,
                    "videoId" to extractVideoId(it.url),
                    "title" to it.name,
                    "artist" to it.uploaderName,
                    "thumbnail" to (it.thumbnails?.firstOrNull()?.url ?: ""),
                    "viewers" to (it.viewCount ?: 0L),
                    "type" to "live"
                )
            }
    }
}

// ============================================
// CUSTOM DOWNLOADER (PERFECT - NO CHANGES)
// ============================================
class ExpoDownloader : Downloader() {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    @Throws(IOException::class, ExtractionException::class)
    override fun execute(request: org.schabi.newpipe.extractor.downloader.Request): Response {
        val okRequest = Request.Builder()
            .url(request.url())
            .method(request.httpMethod(), 
                if (request.dataToSend() != null) RequestBody.create(null, request.dataToSend()!!) else null)
            .apply { request.headers().forEach { (key, values) -> values.forEach { addHeader(key, it) } }}
            .build()

        val response = client.newCall(okRequest).execute()
        return Response(
            response.code,
            response.message,
            response.headers.toMultimap(),
            response.body?.string() ?: "",
            request.url()
        )
    }
}
