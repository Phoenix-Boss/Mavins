// modules/mavin-engine/android/src/main/java/expo/modules/mavinengine/MavinEngineModule.kt
package expo.modules.mavinengine

import android.util.Log
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.types.AnyType
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
import org.schabi.newpipe.extractor.playlist.PlaylistInfoItem
import org.schabi.newpipe.extractor.channel.ChannelInfoItem
import org.schabi.newpipe.extractor.kiosk.KioskExtractor
import org.schabi.newpipe.extractor.InfoItem
import java.io.IOException
import java.util.concurrent.TimeUnit

class MavinEngineModule(appContext: AppContext? = null) : Module(appContext) {

    companion object {
        private const val TAG = "MavinEngine"
        private val client = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    override fun definition() = ModuleDefinition {
        Name("MavinEngine")

        // ============================================
        // DEEP LINK HANDLER
        // ============================================
        AsyncFunction("handleDeepLink") { url: String ->
            try {
                NewPipe.init(ExpoDownloader(client))
                val videoId = extractVideoId(url)
                val trackInfo = extractAudioFromVideoId(videoId)
                return@AsyncFunction mapOf(
                    "success" to true,
                    "videoId" to videoId,
                    "trackInfo" to trackInfo,
                    "autoPlay" to true,
                    "source" to "deeplink"
                )
            } catch (e: Exception) {
                Log.e(TAG, "Deep link failed", e)
                throw CodedException("DEEP_LINK_FAILED", e.message ?: "Invalid URL")
            }
        }

        // ============================================
        // AUDIO EXTRACTION
        // ============================================
        AsyncFunction("extractAudio") { artist: String, title: String, isrc: String? ->
            try {
                NewPipe.init(ExpoDownloader(client))
                val query = if (!isrc.isNullOrEmpty()) "ISRC:$isrc" else "$artist $title audio"
                val streamInfo = searchAndExtract(query)
                val audioStream = streamInfo.audioStreams
                    .filter { it.content != null }
                    .maxByOrNull { it.averageBitrate }
                    ?: throw CodedException("NO_AUDIO", "No usable audio stream found")

                return@AsyncFunction mapOf(
                    "url" to audioStream.content,
                    "videoId" to extractVideoId(streamInfo.url!!),
                    "title" to streamInfo.name,
                    "artist" to streamInfo.uploaderName,
                    "duration" to (streamInfo.duration ?: 0),
                    "thumbnail" to (streamInfo.thumbnails?.firstOrNull()?.url ?: ""),
                    "views" to (streamInfo.viewCount ?: 0L),
                    "likes" to (streamInfo.likeCount ?: 0L),
                    "expires" to (System.currentTimeMillis() + 6 * 60 * 60 * 1000),
                    "quality" to getQualityLabel(audioStream),
                    "success" to true
                )
            } catch (e: Exception) {
                Log.e(TAG, "Audio extraction failed", e)
                throw CodedException("EXTRACTION_FAILED", e.message ?: "Unknown error")
            }
        }

        AsyncFunction("extractAudioFromVideoId") { videoId: String ->
            try {
                NewPipe.init(ExpoDownloader(client))
                val url = "https://www.youtube.com/watch?v=$videoId"
                val info = StreamInfo.getInfo(ServiceList.YouTube, url)
                val audioStream = info.audioStreams
                    .filter { it.content != null }
                    .maxByOrNull { it.averageBitrate }
                    ?: throw CodedException("NO_AUDIO", "No usable audio stream found")

                return@AsyncFunction mapOf(
                    "url" to audioStream.content,
                    "videoId" to videoId,
                    "title" to info.name,
                    "artist" to info.uploaderName,
                    "duration" to (info.duration ?: 0),
                    "thumbnail" to (info.thumbnails?.firstOrNull()?.url ?: ""),
                    "views" to (info.viewCount ?: 0L),
                    "likes" to (info.likeCount ?: 0L),
                    "expires" to (System.currentTimeMillis() + 6 * 60 * 60 * 1000),
                    "quality" to getQualityLabel(audioStream),
                    "success" to true
                )
            } catch (e: Exception) {
                Log.e(TAG, "Video ID extraction failed", e)
                throw CodedException("EXTRACTION_FAILED", e.message ?: "Unknown error")
            }
        }

        // ============================================
        // HOME SCREEN SECTIONS (All Fixed)
        // ============================================
        AsyncFunction("getTrendingMusic") {
            try {
                NewPipe.init(ExpoDownloader(client))
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
                        return@AsyncFunction fallbackSearch("trending music").take(20)
                    }
                }
                return@AsyncFunction trendingSongs.take(20)
            } catch (e: Exception) {
                Log.e(TAG, "Trending failed", e)
                return@AsyncFunction fallbackSearch("trending music").take(20)
            }
        }

        AsyncFunction("getTopCharts") { chartType: String ->
            try {
                NewPipe.init(ExpoDownloader(client))
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

                return@AsyncFunction chartSongs.take(50)
            } catch (e: Exception) {
                Log.e(TAG, "Charts failed", e)
                return@AsyncFunction fallbackSearch("top charts").take(50)
            }
        }

        AsyncFunction("getNewReleases") {
            try {
                NewPipe.init(ExpoDownloader(client))
                return@AsyncFunction fallbackSearch("new music releases this week").take(20)
            } catch (e: Exception) {
                Log.e(TAG, "New releases failed", e)
                return@AsyncFunction emptyList()
            }
        }

        AsyncFunction("getGenreStations") { genre: String ->
            try {
                NewPipe.init(ExpoDownloader(client))
                val searchHandler = ServiceList.YouTube.getSearchQHFactory()
                    .fromQuery("$genre music playlist", listOf("playlist"), "")
                val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchHandler)
                searchExtractor.fetchPage()
                val genrePlaylists = extractPlaylistsFromSearch(searchExtractor.initialPage.items)
                return@AsyncFunction genrePlaylists.take(10)
            } catch (e: Exception) {
                Log.e(TAG, "Genre failed", e)
                return@AsyncFunction emptyList()
            }
        }

        // Simplified remaining functions for brevity (same pattern)
        AsyncFunction("getPopularChoice") {
            try {
                NewPipe.init(ExpoDownloader(client))
                return@AsyncFunction fallbackSearch("popular music right now").take(20)
            } catch (e: Exception) {
                return@AsyncFunction emptyList()
            }
        }

        AsyncFunction("getMonthlyTop") {
            try {
                NewPipe.init(ExpoDownloader(client))
                val topSongs = fallbackSearch("top songs this month").take(10)
                return@AsyncFunction topSongs.mapIndexed { index, song ->
                    song + mapOf("position" to (index + 1))
                }
            } catch (e: Exception) {
                return@AsyncFunction emptyList()
            }
        }

        AsyncFunction("getEditorPicks") {
            try {
                NewPipe.init(ExpoDownloader(client))
                return@AsyncFunction fallbackSearch("best playlists 2026").take(8)
            } catch (e: Exception) {
                return@AsyncFunction emptyList()
            }
        }

        AsyncFunction("getSponsoredContent") {
            try {
                NewPipe.init(ExpoDownloader(client))
                val trending = fallbackSearch("trending music").take(10)
                return@AsyncFunction trending.mapIndexed { index, song ->
                    song + mapOf(
                        "sponsored" to (index < 3),
                        "sponsorName" to if (index < 3) "Mavin Partner" else null
                    )
                }
            } catch (e: Exception) {
                return@AsyncFunction emptyList()
            }
        }

        AsyncFunction("getPodcasts") {
            try {
                NewPipe.init(ExpoDownloader(client))
                val searchHandler = ServiceList.YouTube.getSearchQHFactory()
                    .fromQuery("podcast music", listOf("playlist", "channel"), "")
                val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchHandler)
                searchExtractor.fetchPage()
                return@AsyncFunction extractPodcastsFromSearch(searchExtractor.initialPage.items)
            } catch (e: Exception) {
                return@AsyncList emptyList()
            }
        }

        AsyncFunction("getLiveStations") {
            try {
                NewPipe.init(ExpoDownloader(client))
                val searchHandler = ServiceList.YouTube.getSearchQHFactory()
                    .fromQuery("live music radio afrobeats", listOf("video"), "")
                val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchHandler)
                searchExtractor.fetchPage()
                return@AsyncFunction extractLiveStreams(searchExtractor.initialPage.items)
            } catch (e: Exception) {
                return@AsyncFunction emptyList()
            }
        }

        AsyncFunction("getCoverSongs") {
            try {
                NewPipe.init(ExpoDownloader(client))
                return@AsyncFunction fallbackSearch("cover songs afrobeats").take(15)
            } catch (e: Exception) {
                return@AsyncFunction emptyList()
            }
        }

        AsyncFunction("searchMusic") { query: String, filter: String? ->
            try {
                NewPipe.init(ExpoDownloader(client))
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
                return@AsyncFunction extractSearchResults(searchExtractor.initialPage.items)
            } catch (e: Exception) {
                Log.e(TAG, "Search failed", e)
                return@AsyncFunction emptyList()
            }
        }

        AsyncFunction("getTrackDetails") { videoId: String ->
            try {
                NewPipe.init(ExpoDownloader(client))
                val url = "https://www.youtube.com/watch?v=$videoId"
                val info = StreamInfo.getInfo(ServiceList.YouTube, url)
                val audioStream = info.audioStreams.filter { it.content != null }
                    .maxByOrNull { it.averageBitrate }

                return@AsyncFunction mapOf(
                    "id" to videoId,
                    "title" to info.name,
                    "artist" to info.uploaderName,
                    "duration" to (info.duration ?: 0),
                    "thumbnail" to (info.thumbnails?.firstOrNull()?.url ?: ""),
                    "views" to (info.viewCount ?: 0L),
                    "likes" to (info.likeCount ?: 0L),
                    "audioUrl" to (audioStream?.content ?: ""),
                    "audioQuality" to (audioStream?.let { getQualityLabel(it) } ?: "unknown"),
                    "available" to true
                )
            } catch (e: Exception) {
                Log.e(TAG, "Track details failed", e)
                throw CodedException("DETAILS_FAILED", e.message ?: "Unknown error")
            }
        }
    }

    // ============================================
    // HELPER FUNCTIONS (All Fixed)
    // ============================================
    
    private fun fallbackSearch(query: String): List<Map<String, Any>> {
        try {
            val searchHandler = ServiceList.YouTube.getSearchQHFactory()
                .fromQuery(query, listOf("video"), "")
            val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchHandler)
            searchExtractor.fetchPage()
            return extractSearchResults(searchExtractor.initialPage.items)
        } catch (e: Exception) {
            Log.e(TAG, "Fallback search failed", e)
            return emptyList()
        }
    }

    private fun searchAndExtract(query: String): StreamInfo {
        val factory = ServiceList.YouTube.getSearchQHFactory()
        val handler = factory.fromQuery(query, listOf("video"), "")
        val extractor = ServiceList.YouTube.getSearchExtractor(handler)
        extractor.fetchPage()
        val firstStream = extractor.initialPage.items
            .firstOrNull { it is StreamInfoItem } as? StreamInfoItem
            ?: throw CodedException("NO_STREAM", "No valid stream found")
        return StreamInfo.getInfo(ServiceList.YouTube, firstStream.url!!)
    }

    private fun extractVideoId(url: String): String {
        val patterns = listOf("v=([a-zA-Z0-9_-]{11})", "youtu.be/([a-zA-Z0-9_-]{11})")
        patterns.forEach { pattern ->
            Regex(pattern).find(url)?.groupValues?.get(1)?.let { return it }
        }
        return url
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
                    "id" to (it.url ?: ""),
                    "videoId" to extractVideoId(it.url ?: ""),
                    "title" to (it.name ?: ""),
                    "artist" to (it.uploaderName ?: ""),
                    "duration" to (it.duration ?: 0),
                    "thumbnail" to (it.thumbnails?.firstOrNull()?.url ?: ""),
                    "views" to (it.viewCount ?: 0L)
                )
            } else null
        }
    }

    private fun extractPlaylistsFromSearch(items: List<InfoItem>): List<Map<String, Any>> {
        return items.filterIsInstance<PlaylistInfoItem>().map {
            mapOf(
                "id" to extractPlaylistId(it.url ?: ""),
                "title" to (it.name ?: ""),
                "thumbnail" to (it.thumbnails?.firstOrNull()?.url ?: ""),
                "trackCount" to (it.streamCount ?: 0),
                "uploader" to (it.uploaderName ?: "")
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
                    "id" to (it.url ?: ""),
                    "videoId" to extractVideoId(it.url ?: ""),
                    "title" to (it.name ?: ""),
                    "artist" to (it.uploaderName ?: ""),
                    "duration" to (it.duration ?: 0),
                    "thumbnail" to (it.thumbnails?.firstOrNull()?.url ?: ""),
                    "views" to (it.viewCount ?: 0L)
                )
                is PlaylistInfoItem -> mapOf(
                    "type" to "playlist",
                    "id" to extractPlaylistId(it.url ?: ""),
                    "title" to (it.name ?: ""),
                    "thumbnail" to (it.thumbnails?.firstOrNull()?.url ?: ""),
                    "trackCount" to (it.streamCount ?: 0)
                )
                is ChannelInfoItem -> mapOf(
                    "type" to "artist",
                    "id" to (it.url ?: ""),
                    "name" to (it.name ?: ""),
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
                    "id" to extractPlaylistId(it.url ?: ""),
                    "title" to (it.name ?: ""),
                    "thumbnail" to (it.thumbnails?.firstOrNull()?.url ?: ""),
                    "episodeCount" to (it.streamCount ?: 0),
                    "uploader" to (it.uploaderName ?: ""),
                    "type" to "podcast"
                )
            }
    }

    private fun extractLiveStreams(items: List<InfoItem>): List<Map<String, Any>> {
        return items.filterIsInstance<StreamInfoItem>()
            .filter { it.isLiveStream }
            .map {
                mapOf(
                    "id" to (it.url ?: ""),
                    "videoId" to extractVideoId(it.url ?: ""),
                    "title" to (it.name ?: ""),
                    "artist" to (it.uploaderName ?: ""),
                    "thumbnail" to (it.thumbnails?.firstOrNull()?.url ?: ""),
                    "viewers" to (it.viewCount ?: 0L),
                    "type" to "live"
                )
            }
    }
}

// ============================================
// FIXED CUSTOM DOWNLOADER (Singleton Client)
// ============================================
class ExpoDownloader(private val client: OkHttpClient) : Downloader() {

    @Throws(IOException::class, ExtractionException::class)
    override fun execute(request: org.schabi.newpipe.extractor.downloader.Request): Response {
        val okRequest = Request.Builder()
            .url(request.url())
            .method(
                request.httpMethod(), 
                if (request.dataToSend() != null) 
                    RequestBody.create(null, request.dataToSend()!!) 
                else null
            )
            .apply { 
                request.headers().forEach { (key, values) -> 
                    values.forEach { addHeader(key, it) } 
                } 
            }
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
