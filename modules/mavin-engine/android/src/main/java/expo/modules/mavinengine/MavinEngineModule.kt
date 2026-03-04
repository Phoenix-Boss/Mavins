// modules/mavin-engine/android/src/main/java/expo/modules/mavinengine/MavinEngineModule.kt
package expo.modules.mavinengine

import android.util.Log
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
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
import org.schabi.newpipe.extractor.stream.StreamType
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
        // AUDIO EXTRACTION (FIXED)
        // ============================================
        AsyncFunction("extractAudio") { artist: String, title: String, isrc: String? ->
            try {
                NewPipe.init(ExpoDownloader(client))
                val query = if (!isrc.isNullOrEmpty()) "ISRC:$isrc" else "$artist $title audio"
                val streamInfo = searchAndExtract(query)
                val audioStream = streamInfo.audioStreams
                    .filterNotNull()
                    .filter { it.content != null }
                    .maxByOrNull { it.averageBitrate ?: 0 }
                    ?: throw CodedException("NO_AUDIO", "No usable audio stream found")

                return@AsyncFunction mapOf(
                    "url" to audioStream.content!!,
                    "videoId" to extractVideoId(streamInfo.url!!),
                    "title" to (streamInfo.name ?: "Unknown"),
                    "artist" to (streamInfo.uploaderName ?: "Unknown"),
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
                    .filterNotNull()
                    .filter { it.content != null }
                    .maxByOrNull { it.averageBitrate ?: 0 }
                    ?: throw CodedException("NO_AUDIO", "No usable audio stream found")

                return@AsyncFunction mapOf(
                    "url" to audioStream.content!!,
                    "videoId" to videoId,
                    "title" to (info.name ?: "Unknown"),
                    "artist" to (info.uploaderName ?: "Unknown"),
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
        // HOME SCREEN SECTIONS (All FIXED)
        // ============================================
        AsyncFunction("getTrendingMusic") {
            try {
                NewPipe.init(ExpoDownloader(client))
                val kioskList = ServiceList.YouTube.kioskList
                
                val trendingSongs = try {
                    val kioskExtractor = kioskList["Trending"] as? KioskExtractor<*>
                        ?: kioskList["MusicTrending"] as? KioskExtractor<*>
                        ?: throw Exception("No trending kiosk available")
                    kioskExtractor.fetchPage()
                    extractStreamItems(kioskExtractor.initialPage.items)
                } catch (e: Exception) {
                    fallbackSearch("trending music 2026")
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
                    "top50" -> listOf("Top50Songs", "GlobalTop50", "Charts")
                    "viral50" -> listOf("Viral50", "Trending")
                    else -> listOf("Top50Songs", "GlobalTop50", "Charts")
                }
                
                val chartSongs = chartIds.mapNotNull { chartId ->
                    try {
                        val kioskExtractor = kioskList[chartId] as? KioskExtractor<*>
                        kioskExtractor?.fetchPage()
                        kioskExtractor?.initialPage?.items?.let { extractStreamItems(it) }
                    } catch (e: Exception) { null }
                }.firstOrNull { it?.isNotEmpty() == true } ?: fallbackSearch("top $chartType")

                return@AsyncFunction chartSongs.take(50)
            } catch (e: Exception) {
                Log.e(TAG, "Charts failed", e)
                return@AsyncFunction fallbackSearch("top charts").take(50)
            }
        }

        AsyncFunction("getNewReleases") {
            try {
                NewPipe.init(ExpoDownloader(client))
                return@AsyncFunction fallbackSearch("new music releases March 2026").take(20)
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

        AsyncFunction("getPopularChoice") {
            try {
                NewPipe.init(ExpoDownloader(client))
                return@AsyncFunction fallbackSearch("popular afrobeats 2026").take(20)
            } catch (e: Exception) {
                return@AsyncFunction emptyList()
            }
        }

        AsyncFunction("getMonthlyTop") {
            try {
                NewPipe.init(ExpoDownloader(client))
                val topSongs = fallbackSearch("top songs March 2026").take(10)
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
                return@AsyncFunction fallbackSearch("best afrobeats playlists 2026").take(8)
            } catch (e: Exception) {
                return@AsyncFunction emptyList()
            }
        }

        AsyncFunction("getSponsoredContent") {
            try {
                NewPipe.init(ExpoDownloader(client))
                val trending = fallbackSearch("trending afrobeats").take(10)
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
                    .fromQuery("afrobeats podcast", listOf("playlist", "channel"), "")
                val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchHandler)
                searchExtractor.fetchPage()
                return@AsyncFunction extractPodcastsFromSearch(searchExtractor.initialPage.items)
            } catch (e: Exception) {
                return@AsyncFunction emptyList()
            }
        }

        AsyncFunction("getLiveStations") {
            try {
                NewPipe.init(ExpoDownloader(client))
                val searchHandler = ServiceList.YouTube.getSearchQHFactory()
                    .fromQuery("live afrobeats radio", listOf("live"), "")
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
                return@AsyncFunction fallbackSearch("afrobeats cover songs").take(15)
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
                val audioStream = info.audioStreams
                    .filterNotNull()
                    .filter { it.content != null }
                    .maxByOrNull { it.averageBitrate ?: 0 }

                return@AsyncFunction mapOf(
                    "id" to videoId,
                    "title" to (info.name ?: "Unknown"),
                    "artist" to (info.uploaderName ?: "Unknown"),
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
    // ✅ FIXED HELPER FUNCTIONS (2026 READY)
    // ============================================
    
    private fun fallbackSearch(query: String): List<Map<String, Any>> {
        return try {
            val searchHandler = ServiceList.YouTube.getSearchQHFactory()
                .fromQuery(query, listOf("video"), "")
            val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchHandler)
            searchExtractor.fetchPage()
            extractSearchResults(searchExtractor.initialPage.items)
        } catch (e: Exception) {
            Log.e(TAG, "Fallback search failed: $query", e)
            emptyList()
        }
    }

    private fun searchAndExtract(query: String): StreamInfo {
        val factory = ServiceList.YouTube.getSearchQHFactory()
        val handler = factory.fromQuery(query, listOf("video"), "")
        val extractor = ServiceList.YouTube.getSearchExtractor(handler)
        extractor.fetchPage()
        
        val firstStream = extractor.initialPage.items
            .filterIsInstance<StreamInfoItem>()
            .firstOrNull() 
            ?: throw CodedException("NO_STREAM", "No valid stream found")
            
        return StreamInfo.getInfo(ServiceList.YouTube, firstStream.url!!)
    }

    private fun extractVideoId(url: String): String {
        val patterns = listOf("v=([a-zA-Z0-9_-]{11})", "youtu\\\\.be/([a-zA-Z0-9_-]{11})")
        patterns.forEach { pattern ->
            Regex(pattern).find(url)?.groupValues?.get(1)?.let { return it }
        }
        return url
    }

    private fun getQualityLabel(stream: AudioStream): String {
        val bitrate = stream.averageBitrate ?: 128000
        return when {
            bitrate >= 256000 -> "Premium (256kbps+)"
            bitrate >= 160000 -> "High (160kbps)"
            bitrate >= 128000 -> "Medium (128kbps)"
            else -> "Low (${bitrate/1000}kbps)"
        }
    }

    private fun extractStreamItems(items: List<InfoItem>): List<Map<String, Any>> {
        return items.filterIsInstance<StreamInfoItem>().map { item ->
            mapOf(
                "id" to (item.url ?: ""),
                "videoId" to extractVideoId(item.url ?: ""),
                "title" to (item.name ?: "Unknown"),
                "artist" to (item.uploaderName ?: "Unknown"),
                "duration" to (item.duration ?: 0),
                "thumbnail" to (item.thumbnails?.firstOrNull()?.url ?: ""),
                "views" to (item.viewCount ?: 0L)
            )
        }
    }

    private fun extractPlaylistsFromSearch(items: List<InfoItem>): List<Map<String, Any>> {
        return items.filterIsInstance<PlaylistInfoItem>().map { item ->
            mapOf(
                "id" to extractPlaylistId(item.url ?: ""),
                "title" to (item.name ?: ""),
                "thumbnail" to (item.thumbnails?.firstOrNull()?.url ?: ""),
                "trackCount" to (item.streamCount ?: 0),
                "uploader" to (item.uploaderName ?: "")
            )
        }
    }

    private fun extractPlaylistId(url: String): String {
        val pattern = "list=([a-zA-Z0-9_-]+)".toRegex()
        return pattern.find(url)?.groupValues?.get(1) ?: url
    }

    private fun extractSearchResults(items: List<InfoItem>): List<Map<String, Any>> {
        return items.mapNotNull { item ->
            when (item) {
                is StreamInfoItem -> mapOf(
                    "type" to "song",
                    "id" to (item.url ?: ""),
                    "videoId" to extractVideoId(item.url ?: ""),
                    "title" to (item.name ?: ""),
                    "artist" to (item.uploaderName ?: ""),
                    "duration" to (item.duration ?: 0),
                    "thumbnail" to (item.thumbnails?.firstOrNull()?.url ?: ""),
                    "views" to (item.viewCount ?: 0L)
                )
                is PlaylistInfoItem -> mapOf(
                    "type" to "playlist",
                    "id" to extractPlaylistId(item.url ?: ""),
                    "title" to (item.name ?: ""),
                    "thumbnail" to (item.thumbnails?.firstOrNull()?.url ?: ""),
                    "trackCount" to (item.streamCount ?: 0)
                )
                is ChannelInfoItem -> mapOf(
                    "type" to "artist",
                    "id" to (item.url ?: ""),
                    "name" to (item.name ?: ""),
                    "thumbnail" to (item.thumbnails?.firstOrNull()?.url ?: ""),
                    "subscribers" to (item.subscriberCount ?: 0L),
                    "verified" to item.isVerified
                )
                else -> null
            }
        }
    }

    private fun extractPodcastsFromSearch(items: List<InfoItem>): List<Map<String, Any>> {
        return items.filterIsInstance<PlaylistInfoItem>()
            .filter { 
                item -> 
                item.name.lowercase().contains("podcast") || 
                item.uploaderName?.lowercase()?.contains("podcast") == true 
            }
            .map { item ->
                mapOf(
                    "id" to extractPlaylistId(item.url ?: ""),
                    "title" to (item.name ?: ""),
                    "thumbnail" to (item.thumbnails?.firstOrNull()?.url ?: ""),
                    "episodeCount" to (item.streamCount ?: 0),
                    "uploader" to (item.uploaderName ?: ""),
                    "type" to "podcast"
                )
            }
    }

    // ✅ FIXED: 2026 NewPipe Live Stream Detection
    private fun extractLiveStreams(items: List<InfoItem>): List<Map<String, Any>> {
        return items.filterIsInstance<StreamInfoItem>()
            .filter { item -> 
                try {
                    val streamType = item.getStreamType()
                    streamType == StreamType.LIVE_STREAM || streamType == StreamType.LIVE_STITCH
                } catch (e: Exception) {
                    false // Safe fallback if stream type can't be determined
                }
            }
            .map { item ->
                mapOf(
                    "id" to (item.url ?: ""),
                    "videoId" to extractVideoId(item.url ?: ""),
                    "title" to (item.name ?: ""),
                    "artist" to (item.uploaderName ?: ""),
                    "thumbnail" to (item.thumbnails?.firstOrNull()?.url ?: ""),
                    "viewers" to (item.viewCount ?: 0L),
                    "type" to "live"
                )
            }
    }
}

// ============================================
// FIXED CUSTOM DOWNLOADER (2026 Compatible)
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
                    values.forEach { value -> addHeader(key, value) } 
                } 
            }
            .build()

        val response = client.newCall(okRequest).execute()
        val responseBody = try {
            response.body?.string() ?: ""
        } catch (e: Exception) {
            ""
        }
        
        return Response(
            response.code,
            response.message ?: "OK",
            response.headers.toMultimap(),
            responseBody,
            request.url()
        )
    }
}
