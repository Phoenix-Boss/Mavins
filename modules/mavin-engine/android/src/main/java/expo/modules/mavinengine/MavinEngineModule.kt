package expo.modules.mavinengine

import android.content.Context
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request as NPRequest
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ExtractionException
import org.schabi.newpipe.extractor.search.SearchExtractor
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.StreamType
import org.schabi.newpipe.extractor.playlist.PlaylistInfoItem
import org.schabi.newpipe.extractor.channel.ChannelInfoItem
import org.schabi.newpipe.extractor.kiosk.KioskExtractor
import org.schabi.newpipe.extractor.InfoItem
import org.schabi.newpipe.extractor.ListExtractor
import java.io.IOException
import java.util.concurrent.TimeUnit

class MavinEngineModule : Module() {
    
    // ✅ FIXED: Use appContext.reactContext for Expo Modules Core 3.x
    private val context: Context
        get() = requireNotNull(appContext.reactContext) {
            "React context is not available"
        }

    companion object {
        private const val TAG = "MavinEngine"
        private val client = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
        
        // ✅ FIXED: Initialize NewPipe once in companion to avoid re-initialization
        private var isNewPipeInitialized = false
    }

    override fun definition() = ModuleDefinition {
        Name("MavinEngine")

        // ✅ FIXED: Property syntax with explicit generic types for Expo Modules Core 3.x
        Property("engineVersion")
            .get<String> { "2.0.0" }

        Property("isInitialized")
            .get<Boolean> { isNewPipeInitialized }

        Property("newPipeVersion")
            .get<String> { "v0.25.2" }

        OnCreate {
            initializeNewPipe()
        }

        AsyncFunction("handleDeepLink") { url: String ->
            ensureNewPipeInitialized()
            try {
                val videoId = extractVideoId(url)
                val trackInfo = getTrackInfoFromVideoId(videoId)
                mapOf(
                    "success" to true,
                    "videoId" to videoId,
                    "trackInfo" to trackInfo,
                    "autoPlay" to true,
                    "source" to "deeplink"
                )
            } catch (e: Exception) {
                Log.e(TAG, "Deep link failed", e)
                throw CodedException("DEEP_LINK_FAILED", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("extractAudio") { artist: String, title: String, isrc: String? ->
            ensureNewPipeInitialized()
            try {
                val query = if (!isrc.isNullOrEmpty()) "ISRC:$isrc" else "$artist $title audio"
                val streamInfo = searchAndExtract(query)
                val audioStream = streamInfo.audioStreams
                    .filterNotNull()
                    .filter { !it.content.isNullOrEmpty() }
                    .maxByOrNull { it.averageBitrate }
                    ?: throw CodedException("NO_AUDIO", "No usable audio stream found", null)

                mapOf(
                    "url" to audioStream.content!!,
                    "videoId" to extractVideoId(streamInfo.url ?: ""),
                    "title" to (streamInfo.name ?: "Unknown"),
                    "artist" to (streamInfo.uploaderName ?: "Unknown"),
                    "duration" to (streamInfo.duration),
                    "thumbnail" to (streamInfo.thumbnails?.firstOrNull()?.url ?: ""),
                    "views" to (streamInfo.viewCount),
                    "likes" to (streamInfo.likeCount),
                    "expires" to (System.currentTimeMillis() + 6 * 60 * 60 * 1000),
                    "quality" to getQualityLabel(audioStream),
                    "success" to true
                )
            } catch (e: Exception) {
                Log.e(TAG, "Audio extraction failed", e)
                throw CodedException("EXTRACTION_FAILED", e.message ?: "Extraction failed", e)
            }
        }

        AsyncFunction("extractAudioFromVideoId") { videoId: String ->
            ensureNewPipeInitialized()
            try {
                getTrackInfoFromVideoId(videoId)
            } catch (e: Exception) {
                Log.e(TAG, "Video ID extraction failed", e)
                throw CodedException("EXTRACTION_FAILED", e.message ?: "Extraction failed", e)
            }
        }

        // ✅ FIXED: Updated kiosk usage for NewPipe Extractor v0.25.x
        // Note: "Trending" kiosk was changed in v0.24.8 - using "Live" as default now
        AsyncFunction("getTrendingMusic") {
            ensureNewPipeInitialized()
            try {
                val kioskList = ServiceList.YouTube.kioskList
                
                // ✅ FIXED: Try multiple kiosk IDs as fallback (v0.24.8+ changes)
                val trendingSongs = try {
                    val kioskExtractor = kioskList.getExtractorById("Trending", null)
                        ?: kioskList.getExtractorById("Live", null)
                        ?: throw Exception("No trending kiosk available")
                    
                    kioskExtractor.fetchPage()
                    extractStreamItems(kioskExtractor.initialPage.items)
                } catch (e: Exception) {
                    Log.w(TAG, "Kiosk failed, using fallback search", e)
                    fallbackSearch("trending music 2026")
                }
                trendingSongs.take(20)
            } catch (e: Exception) {
                Log.e(TAG, "Trending failed", e)
                fallbackSearch("trending music").take(20)
            }
        }

        AsyncFunction("getTopCharts") { chartType: String ->
            ensureNewPipeInitialized()
            try {
                val kioskList = ServiceList.YouTube.kioskList
                val chartIds = when (chartType) {
                    "top50" -> listOf("Top50Songs", "GlobalTop50", "Charts", "Live")
                    "viral50" -> listOf("Viral50", "Trending", "Live")
                    else -> listOf("Top50Songs", "GlobalTop50", "Charts", "Live")
                }
                
                val chartSongs = chartIds.mapNotNull { chartId ->
                    try {
                        val kioskExtractor = kioskList.getExtractorById(chartId, null)
                        kioskExtractor?.fetchPage()
                        kioskExtractor?.initialPage?.items?.let { extractStreamItems(it) }
                    } catch (e: Exception) { 
                        Log.w(TAG, "Chart $chartId failed", e)
                        null 
                    }
                }.firstOrNull { it.isNotEmpty() } ?: fallbackSearch("top $chartType")

                chartSongs.take(50)
            } catch (e: Exception) {
                Log.e(TAG, "Charts failed", e)
                fallbackSearch("top charts").take(50)
            }
        }

        AsyncFunction("getNewReleases") {
            ensureNewPipeInitialized()
            try {
                fallbackSearch("new music releases 2026").take(20)
            } catch (e: Exception) {
                Log.e(TAG, "New releases failed", e)
                emptyList<Map<String, Any>>()
            }
        }

        AsyncFunction("getGenreStations") { genre: String ->
            ensureNewPipeInitialized()
            try {
                val searchQueryHandler = ServiceList.YouTube.searchQHFactory
                    .fromQuery("$genre music playlist", listOf("playlist"), "")
                val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchQueryHandler)
                searchExtractor.fetchPage()
                val genrePlaylists = extractPlaylistsFromSearch(searchExtractor.initialPage.items)
                genrePlaylists.take(10)
            } catch (e: Exception) {
                Log.e(TAG, "Genre failed", e)
                emptyList<Map<String, Any>>()
            }
        }

        AsyncFunction("getPopularChoice") {
            ensureNewPipeInitialized()
            try {
                fallbackSearch("popular afrobeats 2026").take(20)
            } catch (e: Exception) {
                emptyList<Map<String, Any>>()
            }
        }

        AsyncFunction("getMonthlyTop") {
            ensureNewPipeInitialized()
            try {
                val topSongs = fallbackSearch("top songs 2026").take(10)
                topSongs.mapIndexed { index, song ->
                    song + ("position" to (index + 1))
                }
            } catch (e: Exception) {
                emptyList<Map<String, Any>>()
            }
        }

        AsyncFunction("getEditorPicks") {
            ensureNewPipeInitialized()
            try {
                fallbackSearch("best afrobeats playlists 2026").take(8)
            } catch (e: Exception) {
                emptyList<Map<String, Any>>()
            }
        }

        AsyncFunction("getSponsoredContent") {
            ensureNewPipeInitialized()
            try {
                val trending = fallbackSearch("trending afrobeats").take(10)
                trending.mapIndexed { index, song ->
                    song + mapOf(
                        "sponsored" to (index < 3),
                        "sponsorName" to if (index < 3) "Mavin Partner" else null
                    )
                }
            } catch (e: Exception) {
                emptyList<Map<String, Any>>()
            }
        }

        AsyncFunction("getPodcasts") {
            ensureNewPipeInitialized()
            try {
                val searchQueryHandler = ServiceList.YouTube.searchQHFactory
                    .fromQuery("afrobeats podcast", listOf("playlist", "channel"), "")
                val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchQueryHandler)
                searchExtractor.fetchPage()
                extractPodcastsFromSearch(searchExtractor.initialPage.items)
            } catch (e: Exception) {
                emptyList<Map<String, Any>>()
            }
        }

        AsyncFunction("getLiveStations") {
            ensureNewPipeInitialized()
            try {
                val searchQueryHandler = ServiceList.YouTube.searchQHFactory
                    .fromQuery("live afrobeats radio", listOf("live"), "")
                val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchQueryHandler)
                searchExtractor.fetchPage()
                extractLiveStreams(searchExtractor.initialPage.items)
            } catch (e: Exception) {
                emptyList<Map<String, Any>>()
            }
        }

        AsyncFunction("getCoverSongs") {
            ensureNewPipeInitialized()
            try {
                fallbackSearch("afrobeats cover songs").take(15)
            } catch (e: Exception) {
                emptyList<Map<String, Any>>()
            }
        }

        AsyncFunction("searchMusic") { query: String, filter: String? ->
            ensureNewPipeInitialized()
            try {
                val contentFilter = when (filter) {
                    "song" -> listOf("video")
                    "playlist" -> listOf("playlist")
                    "artist" -> listOf("channel")
                    else -> listOf("video", "playlist", "channel")
                }
                val searchQueryHandler = ServiceList.YouTube.searchQHFactory
                    .fromQuery(query, contentFilter, "")
                val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchQueryHandler)
                searchExtractor.fetchPage()
                extractSearchResults(searchExtractor.initialPage.items)
            } catch (e: Exception) {
                Log.e(TAG, "Search failed", e)
                emptyList<Map<String, Any>>()
            }
        }

        AsyncFunction("getTrackDetails") { videoId: String ->
            ensureNewPipeInitialized()
            try {
                val url = "https://www.youtube.com/watch?v=$videoId"
                // ✅ FIXED: Use StreamInfo.getInfo with proper error handling
                val info = StreamInfo.getInfo(ServiceList.YouTube, url)
                val audioStream = info.audioStreams
                    .filterNotNull()
                    .filter { !it.content.isNullOrEmpty() }
                    .maxByOrNull { it.averageBitrate }

                mapOf(
                    "id" to videoId,
                    "title" to (info.name ?: "Unknown"),
                    "artist" to (info.uploaderName ?: "Unknown"),
                    "duration" to info.duration,
                    "thumbnail" to (info.thumbnails?.firstOrNull()?.url ?: ""),
                    "views" to info.viewCount,
                    "likes" to info.likeCount,
                    "audioUrl" to (audioStream?.content ?: ""),
                    "audioQuality" to (audioStream?.let { getQualityLabel(it) } ?: "unknown"),
                    "available" to true
                )
            } catch (e: Exception) {
                Log.e(TAG, "Track details failed", e)
                throw CodedException("DETAILS_FAILED", e.message ?: "Failed to get details", e)
            }
        }
    }

    // ✅ FIXED: Proper initialization with singleton pattern
    private fun initializeNewPipe() {
        if (!isNewPipeInitialized) {
            synchronized(this) {
                if (!isNewPipeInitialized) {
                    NewPipe.init(ExpoDownloader(client))
                    isNewPipeInitialized = true
                    Log.d(TAG, "✅ NewPipe Extractor initialized")
                }
            }
        }
    }

    private fun ensureNewPipeInitialized() {
        if (!isNewPipeInitialized) {
            initializeNewPipe()
        }
    }

    private fun getTrackInfoFromVideoId(videoId: String): Map<String, Any> {
        val url = "https://www.youtube.com/watch?v=$videoId"
        // ✅ FIXED: StreamInfo.getInfo is still the correct method in v0.25.x
        val info = StreamInfo.getInfo(ServiceList.YouTube, url)
        val audioStream = info.audioStreams
            .filterNotNull()
            .filter { !it.content.isNullOrEmpty() }
            .maxByOrNull { it.averageBitrate }
            ?: throw CodedException("NO_AUDIO", "No usable audio stream found", null)

        return mapOf(
            "url" to audioStream.content!!,
            "videoId" to videoId,
            "title" to (info.name ?: "Unknown"),
            "artist" to (info.uploaderName ?: "Unknown"),
            "duration" to info.duration,
            "thumbnail" to (info.thumbnails?.firstOrNull()?.url ?: ""),
            "views" to info.viewCount,
            "likes" to info.likeCount,
            "expires" to (System.currentTimeMillis() + 6 * 60 * 60 * 1000),
            "quality" to getQualityLabel(audioStream),
            "success" to true
        )
    }
    
    private fun fallbackSearch(query: String): List<Map<String, Any>> {
        return try {
            val searchQueryHandler = ServiceList.YouTube.searchQHFactory
                .fromQuery(query, listOf("video"), "")
            val searchExtractor = ServiceList.YouTube.getSearchExtractor(searchQueryHandler)
            searchExtractor.fetchPage()
            extractSearchResults(searchExtractor.initialPage.items)
        } catch (e: Exception) {
            Log.e(TAG, "Fallback search failed: $query", e)
            emptyList()
        }
    }

    private fun searchAndExtract(query: String): StreamInfo {
        val factory = ServiceList.YouTube.searchQHFactory
        val handler = factory.fromQuery(query, listOf("video"), "")
        val extractor = ServiceList.YouTube.getSearchExtractor(handler)
        extractor.fetchPage()
        
        val firstStream = extractor.initialPage.items
            .filterIsInstance<StreamInfoItem>()
            .firstOrNull() 
            ?: throw CodedException("NO_STREAM", "No valid stream found", null)
            
        // ✅ FIXED: Use StreamInfo.getInfo with service and URL
        return StreamInfo.getInfo(ServiceList.YouTube, firstStream.url ?: "")
    }

    // ✅ FIXED: Safe regex group access using groupValues (index-based)
    private fun extractVideoId(url: String): String {
        val patterns = listOf(
            "v=([a-zA-Z0-9_-]{11})",
            "youtu\\.be/([a-zA-Z0-9_-]{11})",
            "shorts/([a-zA-Z0-9_-]{11})",
            "live/([a-zA-Z0-9_-]{11})"
        )
        for (pattern in patterns) {
            val matchResult = Regex(pattern).find(url)
            if (matchResult != null && matchResult.groupValues.size > 1) {
                return matchResult.groupValues[1]
            }
        }
        // Return original if no match (might already be an ID)
        return url.takeIf { it.matches(Regex("[a-zA-Z0-9_-]{11}")) } ?: url
    }

    private fun getQualityLabel(stream: AudioStream): String {
        val bitrate = stream.averageBitrate
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
                "duration" to item.duration,
                "thumbnail" to (item.thumbnails?.firstOrNull()?.url ?: ""),
                "views" to item.viewCount
            )
        }
    }

    private fun extractPlaylistsFromSearch(items: List<InfoItem>): List<Map<String, Any>> {
        return items.filterIsInstance<PlaylistInfoItem>().map { item ->
            mapOf(
                "id" to extractPlaylistId(item.url ?: ""),
                "title" to (item.name ?: ""),
                "thumbnail" to (item.thumbnails?.firstOrNull()?.url ?: ""),
                "trackCount" to (item.streamCount),
                "uploader" to (item.uploaderName ?: "")
            )
        }
    }

    private fun extractPlaylistId(url: String): String {
        val pattern = "list=([a-zA-Z0-9_-]+)".toRegex()
        val matchResult = pattern.find(url)
        return if (matchResult != null && matchResult.groupValues.size > 1) {
            matchResult.groupValues[1]
        } else {
            url
        }
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
                    "duration" to item.duration,
                    "thumbnail" to (item.thumbnails?.firstOrNull()?.url ?: ""),
                    "views" to item.viewCount
                )
                is PlaylistInfoItem -> mapOf(
                    "type" to "playlist",
                    "id" to extractPlaylistId(item.url ?: ""),
                    "title" to (item.name ?: ""),
                    "thumbnail" to (item.thumbnails?.firstOrNull()?.url ?: ""),
                    "trackCount" to item.streamCount
                )
                is ChannelInfoItem -> mapOf(
                    "type" to "artist",
                    "id" to (item.url ?: ""),
                    "name" to (item.name ?: ""),
                    "thumbnail" to (item.thumbnails?.firstOrNull()?.url ?: ""),
                    "subscribers" to item.subscriberCount,
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
                    "episodeCount" to item.streamCount,
                    "uploader" to (item.uploaderName ?: ""),
                    "type" to "podcast"
                )
            }
    }

    private fun extractLiveStreams(items: List<InfoItem>): List<Map<String, Any>> {
        return items.filterIsInstance<StreamInfoItem>()
            .filter { item -> 
                try {
                    item.streamType == StreamType.LIVE_STREAM
                } catch (e: Exception) {
                    false
                }
            }
            .map { item ->
                mapOf(
                    "id" to (item.url ?: ""),
                    "videoId" to extractVideoId(item.url ?: ""),
                    "title" to (item.name ?: ""),
                    "artist" to (item.uploaderName ?: ""),
                    "thumbnail" to (item.thumbnails?.firstOrNull()?.url ?: ""),
                    "viewers" to item.viewCount,
                    "type" to "live"
                )
            }
    }
}

// ✅ FIXED: Updated Downloader implementation for NewPipe Extractor v0.25.x
class ExpoDownloader(private val client: OkHttpClient) : Downloader() {

    @Throws(IOException::class, ExtractionException::class)
    override fun execute(request: NPRequest): Response {
        val okRequest = Request.Builder()
            .url(request.url())
            .method(
                request.httpMethod(),
                request.dataToSend()?.let { 
                    RequestBody.create("application/json".toMediaTypeOrNull(), it)
                }
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
            response.message,
            response.headers.toMultimap(),
            responseBody,
            request.url()
        )
    }
}