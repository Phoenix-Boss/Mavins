@file:Suppress("unused", "MemberVisibilityCanBePrivate")

package expo.modules.mavinengine

import android.content.Context
import android.util.Log
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import org.schabi.newpipe.extractor.*
import org.schabi.newpipe.extractor.channel.ChannelInfo
import org.schabi.newpipe.extractor.channel.ChannelInfoItem
import org.schabi.newpipe.extractor.channel.tabs.ChannelTabInfo
import org.schabi.newpipe.extractor.comments.CommentsInfo
import org.schabi.newpipe.extractor.comments.CommentsInfoItem
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.*
import org.schabi.newpipe.extractor.feed.FeedInfo
import org.schabi.newpipe.extractor.kiosk.KioskInfo
import org.schabi.newpipe.extractor.linkhandler.LinkHandler
import org.schabi.newpipe.extractor.linkhandler.ListLinkHandler
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.playlist.PlaylistInfo
import org.schabi.newpipe.extractor.playlist.PlaylistInfoItem
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import org.schabi.newpipe.extractor.stream.StreamType.*
import org.schabi.newpipe.extractor.stream.SubtitlesStream
import org.schabi.newpipe.extractor.stream.VideoStream
import java.io.IOException
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * MavinEngine — NewPipe Extractor v0.26.0 Integration
 *
 * Based on latest stable release: https://github.com/TeamNewPipe/NewPipeExtractor/releases/tag/v0.26.0 
 * Documentation: https://teamnewpipe.github.io/documentation/ 
 *
 * Key changes in v0.26.0:
 * - Service.getMediaCapabilities() now returns Set<MediaCapability> instead of List<MediaCapability>
 * - YouTube: throw AccountTerminatedException when account is terminated
 * - SoundCloud: Use long integers (64-bit) for track IDs to prevent overflows
 */
class MavinEngineModule : Module() {

    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

    companion object {
        private const val TAG = "MavinEngine"
        private const val VERSION = "6.1.0" // Updated for v0.26.0 compatibility

        private val httpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()

        @Volatile
        private var isInitialized = false
    }

    override fun definition() = ModuleDefinition {
        Name("MavinEngine")

        Property("version").get<String> { VERSION }
        Property("initialized").get<Boolean> { isInitialized }
        Property("services").get<List<Map<String, Any>>> { getServicesList() }

        OnCreate { initializeNewPipe() }

        // Streams
        AsyncFunction("getStreamInfo") { url: String, serviceId: Int? ->
            ensureInit()
            extractStreamInfo(url, serviceId)
        }
        AsyncFunction("getStreamInfoById") { videoId: String, serviceId: Int? ->
            ensureInit()
            extractStreamInfoById(videoId, serviceId)
        }
        AsyncFunction("getStreamUrl") { url: String, format: String?, serviceId: Int? ->
            ensureInit()
            getBestStreamUrl(url, format ?: "best", serviceId)
        }
        AsyncFunction("getAudioStreams") { url: String, serviceId: Int? ->
            ensureInit()
            extractAudioStreams(url, serviceId)
        }
        AsyncFunction("getVideoStreams") { url: String, serviceId: Int? ->
            ensureInit()
            extractVideoStreams(url, serviceId)
        }
        AsyncFunction("getSubtitles") { url: String, language: String?, serviceId: Int? ->
            ensureInit()
            extractSubtitles(url, language, serviceId)
        }

        // Comments
        AsyncFunction("getComments") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit()
            extractComments(url, pageUrl, serviceId)
        }
        AsyncFunction("getCommentReplies") { commentsUrl: String, repliesPageUrl: String, serviceId: Int? ->
            ensureInit()
            extractCommentReplies(commentsUrl, repliesPageUrl, serviceId)
        }

        // Search
        AsyncFunction("search") { query: String, filter: String?, pageUrl: String?, serviceId: Int? ->
            ensureInit()
            performSearch(query, filter ?: "all", pageUrl, serviceId)
        }
        AsyncFunction("getSearchSuggestions") { query: String, serviceId: Int? ->
            ensureInit()
            getSearchSuggestions(query, serviceId)
        }
        AsyncFunction("getSearchFilters") { serviceId: Int? ->
            ensureInit()
            getAvailableSearchFilters(serviceId)
        }

        // Playlist
        AsyncFunction("getPlaylistInfo") { url: String, serviceId: Int? ->
            ensureInit()
            extractPlaylistInfo(url, serviceId)
        }
        AsyncFunction("getPlaylistItems") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit()
            extractPlaylistItems(url, pageUrl, serviceId)
        }

        // Channel
        AsyncFunction("getChannelInfo") { url: String, serviceId: Int? ->
            ensureInit()
            extractChannelInfo(url, serviceId)
        }
        AsyncFunction("getChannelTabs") { url: String, serviceId: Int? ->
            ensureInit()
            extractChannelTabs(url, serviceId)
        }
        AsyncFunction("getChannelTabItems") { url: String, tabFilter: String, pageUrl: String?, serviceId: Int? ->
            ensureInit()
            extractChannelTabItems(url, tabFilter, pageUrl, serviceId)
        }
        AsyncFunction("getChannelFeed") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit()
            extractChannelFeed(url, pageUrl, serviceId)
        }

        // Kiosk (Trending/Most Popular)
        AsyncFunction("getKioskList") { serviceId: Int? ->
            ensureInit()
            listAvailableKiosks(serviceId)
        }
        AsyncFunction("getKioskInfo") { kioskId: String, pageUrl: String?, serviceId: Int? ->
            ensureInit()
            extractKioskInfo(kioskId, pageUrl, serviceId)
        }
        AsyncFunction("getTrending") { serviceId: Int? ->
            ensureInit()
            extractKioskInfo("Music", null, serviceId)
        }
        AsyncFunction("getMostPopular") { serviceId: Int? ->
            ensureInit()
            extractKioskInfo("Live", null, serviceId)
        }
        // YouTube v0.24.8+ specific kiosks (Trending deprecated, Live is default)
        AsyncFunction("getYouTubeKiosk") { kioskType: String, serviceId: Int? ->
            ensureInit()
            when (kioskType.uppercase()) {
                "LIVE" -> extractKioskInfo("Live", null, serviceId ?: 0)
                "MUSIC" -> extractKioskInfo("Music", null, serviceId ?: 0)
                "GAMING" -> extractKioskInfo("Gaming", null, serviceId ?: 0)
                "MOVIES" -> extractKioskInfo("Movies", null, serviceId ?: 0)
                "TRENDING" -> extractKioskInfo("Trending", null, serviceId ?: 0)
                else -> extractKioskInfo("Live", null, serviceId ?: 0)
            }
        }

        // URL Utilities
        AsyncFunction("resolveUrl") { url: String, serviceId: Int? ->
            ensureInit()
            resolveUrl(url, serviceId)
        }
        AsyncFunction("canHandleUrl") { url: String, serviceId: Int? ->
            ensureInit()
            checkCanHandle(url, serviceId)
        }
        AsyncFunction("extractIdFromUrl") { url: String, serviceId: Int? ->
            ensureInit()
            extractIdFromUrl(url, serviceId)
        }

        // Utility
        AsyncFunction("ping") {
            mapOf("alive" to true, "version" to VERSION, "timestamp" to System.currentTimeMillis())
        }
        AsyncFunction("emergencyReset") { resetNewPipe() }
        AsyncFunction("getVersion") { 
            mapOf(
                "version" to VERSION, 
                "library" to "NewPipeExtractor 0.26.0",
                "releaseNotes" to "https://github.com/TeamNewPipe/NewPipeExtractor/releases/tag/v0.26.0 "
            ) 
        }
    }

    // Initialization
    private fun initializeNewPipe() {
        if (isInitialized) return
        synchronized(this) {
            if (isInitialized) return
            try {
                NewPipe.init(
                    MavinDownloader(httpClient),
                    Localization.fromLocale(Locale.US),
                    ContentCountry("US")
                )
                isInitialized = true
                Log.i(TAG, "✅ NewPipe v0.26.0 initialized — ${ServiceList.all().size} services loaded")
            } catch (e: Exception) {
                Log.e(TAG, "NewPipe init failed", e)
                throw CodedException("INIT_FAILED", "NewPipe.init failed: ${e.message}", e)
            }
        }
    }

    private fun ensureInit() {
        if (!isInitialized) initializeNewPipe()
    }

    private fun resetNewPipe(): Map<String, Any> {
        isInitialized = false
        initializeNewPipe()
        return mapOf("success" to true, "message" to "NewPipe reset and re-initialised")
    }

    // Service Resolution
    private fun getService(serviceId: Int?): StreamingService {
        val all = ServiceList.all()
        return if (serviceId != null) {
            all.firstOrNull { it.serviceId == serviceId }
                ?: throw ExtractionException("No service with id=$serviceId")
        } else {
            all.firstOrNull { it.serviceId == 0 } // YouTube is typically 0
                ?: all.firstOrNull()
                ?: throw ExtractionException("No streaming services registered")
        }
    }

    private fun getServiceForUrl(url: String): StreamingService {
        return ServiceList.all().firstOrNull { service ->
            try {
                service.getLinkTypeByUrl(url) != StreamingService.LinkType.NONE
            } catch (_: Exception) {
                false
            }
        } ?: throw ExtractionException("No service can handle URL: $url")
    }

    private fun resolveService(url: String, serviceId: Int?): StreamingService =
        serviceId?.let { getService(it) } ?: getServiceForUrl(url)

    private fun getServicesList(): List<Map<String, Any>> {
        if (!isInitialized) return emptyList()
        return ServiceList.all().map { s ->
            mapOf(
                "id" to s.serviceId,
                "name" to s.serviceInfo.name,
                "baseUrl" to (s.baseUrl ?: ""),
                // v0.26.0: mediaCapabilities is now a Set
                "mediaCapabilities" to s.serviceInfo.mediaCapabilities.map { it.name }
            )
        }
    }

    // Stream Extraction
    @Throws(ExtractionException::class, IOException::class)
    private fun extractStreamInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        return streamInfoToMap(StreamInfo.getInfo(extractor), service.serviceId)
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun extractStreamInfoById(videoId: String, serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        val linkHandler = service.streamLHFactory.fromId(videoId)
        val extractor = service.getStreamExtractor(linkHandler)
        extractor.fetchPage()
        return streamInfoToMap(StreamInfo.getInfo(extractor), service.serviceId)
    }

    private fun streamInfoToMap(info: StreamInfo, serviceId: Int): Map<String, Any> {
        return mapOf(
            "success" to true,
            "serviceId" to serviceId,
            "id" to info.id,
            "url" to info.url,
            "originalUrl" to info.originalUrl,
            "title" to info.name.orEmpty(),
            "uploaderName" to info.uploaderName.orEmpty(),
            "uploaderUrl" to info.uploaderUrl.orEmpty(),
            "uploaderAvatars" to info.uploaderAvatars.map { imageToMap(it) },
            "uploaderVerified" to info.isUploaderVerified,
            "uploaderSubscriberCount" to info.uploaderSubscriberCount.coerceAtLeast(0),
            "duration" to info.duration,
            "viewCount" to info.viewCount.coerceAtLeast(0),
            "likeCount" to info.likeCount.coerceAtLeast(0),
            "dislikeCount" to info.dislikeCount.coerceAtLeast(0),
            // FIX: Description has getContent() method, not content field
            "description" to info.description.content,
            // FIX: Description may not have html property directly
            "descriptionHtml" to info.description.content,
            "uploadDate" to (info.uploadDate?.offsetDateTime()?.toString() ?: ""),
            "textualUploadDate" to info.textualUploadDate.orEmpty(),
            "thumbnails" to info.thumbnails.map { imageToMap(it) },
            "streamType" to info.streamType.name,
            "isLive" to (info.streamType == LIVE_STREAM || info.streamType == AUDIO_LIVE_STREAM),
            "isShortFormContent" to info.isShortFormContent,
            // FIX: Use getContentAvailability() method
            "availability" to info.contentAvailability.name,
            "ageLimit" to info.ageLimit,
            "tags" to info.tags,
            "category" to info.category.orEmpty(),
            "audioStreams" to info.audioStreams.map { audioStreamToMap(it) },
            "videoStreams" to info.videoStreams.map { videoStreamToMap(it) },
            "videoOnlyStreams" to info.videoOnlyStreams.map { videoStreamToMap(it) },
            "dashMpdUrl" to info.dashMpdUrl.orEmpty(),
            "hlsUrl" to info.hlsUrl.orEmpty(),
            "subtitles" to info.subtitles.map { subtitleToMap(it) },
            "relatedItems" to info.relatedItems.take(20).mapNotNull { infoItemToMap(it) },
            "metaInfo" to info.metaInfo.map { m ->
                mapOf(
                    "title" to m.title.orEmpty(),
                    // FIX: MetaInfo content is Description type
                    "content" to m.content.content,
                    "urls" to m.urls.map { it.toString() },
                    "urlTexts" to m.urlTexts
                )
            }
        )
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun getBestStreamUrl(url: String, format: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        val info = StreamInfo.getInfo(extractor)

        val best = when (format.lowercase()) {
            "audio", "mp3", "m4a", "ogg" ->
                // FIX: Use getAverageBitrate() method
                info.audioStreams.maxByOrNull { it.averageBitrate }?.content
            "video", "mp4", "best" ->
                info.videoStreams.maxByOrNull { it.height ?: 0 }?.content
                    ?: info.videoOnlyStreams.maxByOrNull { it.height ?: 0 }?.content
            "dash" -> info.dashMpdUrl.takeIf { it.isNotEmpty() }
            "hls"  -> info.hlsUrl.takeIf { it.isNotEmpty() }
            else   -> info.audioStreams.maxByOrNull { it.averageBitrate }?.content
        }

        return mapOf(
            "success" to (best != null),
            "url" to (best ?: ""),
            "format" to format,
            "title" to info.name.orEmpty(),
            "duration" to info.duration,
            "fallbackUrls" to listOfNotNull(
                info.dashMpdUrl.takeIf { it.isNotEmpty() },
                info.hlsUrl.takeIf { it.isNotEmpty() }
            )
        )
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun extractAudioStreams(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        val info = StreamInfo.getInfo(extractor)
        return mapOf(
            "success" to true,
            "title" to info.name.orEmpty(),
            "audioStreams" to info.audioStreams.map { audioStreamToMap(it) }
        )
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun extractVideoStreams(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        val info = StreamInfo.getInfo(extractor)
        return mapOf(
            "success" to true,
            "title" to info.name.orEmpty(),
            "videoStreams" to info.videoStreams.map { videoStreamToMap(it) },
            "videoOnlyStreams" to info.videoOnlyStreams.map { videoStreamToMap(it) }
        )
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun extractSubtitles(url: String, language: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        val info = StreamInfo.getInfo(extractor)
        val all = info.subtitles
        // FIX: Use getLanguageTag() method instead of languageCode field
        val filtered = if (language.isNullOrBlank()) all
                       else all.filter { it.getLanguageTag().equals(language, ignoreCase = true) }
        return mapOf(
            "success" to true,
            "title" to info.name.orEmpty(),
            "subtitles" to filtered.map { subtitleToMap(it) },
            // FIX: Use getLanguageTag() method
            "availableLanguages" to all.map { it.getLanguageTag() }.distinct()
        )
    }

    // Comments
    @Throws(ExtractionException::class, IOException::class)
    private fun extractComments(url: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)

        return if (pageUrl.isNullOrEmpty()) {
            val commentsInfo = CommentsInfo.getInfo(service, url)
            mapOf(
                "success" to true,
                "disabled" to commentsInfo.isCommentsDisabled,
                "commentsCount" to commentsInfo.commentsCount,
                "comments" to commentsInfo.relatedItems.map { commentItemToMap(it) },
                "nextPage" to commentsInfo.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (commentsInfo.nextPage != null),
                "errors" to commentsInfo.errors.map { it.message.orEmpty() }
            )
        } else {
            val morePage = CommentsInfo.getMoreItems(service, url, Page(pageUrl))
            mapOf(
                "success" to true,
                "comments" to morePage.items.map { commentItemToMap(it) },
                "nextPage" to morePage.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (morePage.nextPage != null),
                "errors" to morePage.errors.map { it.message.orEmpty() }
            )
        }
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun extractCommentReplies(
        commentsUrl: String,
        repliesPageUrl: String,
        serviceId: Int?
    ): Map<String, Any> {
        val service = resolveService(commentsUrl, serviceId)
        val page = CommentsInfo.getMoreItems(service, commentsUrl, Page(repliesPageUrl))
        return mapOf(
            "success" to true,
            "replies" to page.items.map { commentItemToMap(it) },
            "nextPage" to page.nextPage?.let { pageToMap(it) },
            "hasNextPage" to (page.nextPage != null),
            "errors" to page.errors.map { it.message.orEmpty() }
        )
    }

    private fun commentItemToMap(item: CommentsInfoItem): Map<String, Any> = mapOf(
        "authorName" to item.uploaderName.orEmpty(),
        "authorUrl" to item.uploaderUrl.orEmpty(),
        "authorAvatars" to item.uploaderAvatars.map { imageToMap(it) },
        "authorVerified" to item.isUploaderVerified,
        "commentId" to item.commentId.orEmpty(),
        // FIX: Description has getContent() method
        "commentText" to item.commentText.content,
        // FIX: Description may not have html directly
        "commentHtml" to item.commentText.content,
        "publishedTime" to item.textualUploadDate.orEmpty(),
        "publishedTimestamp" to (item.uploadDate?.offsetDateTime()?.toEpochSecond() ?: 0L),
        "likeCount" to item.likeCount.coerceAtLeast(0),
        "textualLikeCount" to item.textualLikeCount.orEmpty(),
        "replyCount" to item.replyCount,
        // FIX: Use getReplies() method
        "repliesPageUrl" to (item.getReplies()?.url ?: ""),
        "hasReplies" to (item.replyCount > 0 || item.getReplies() != null),
        "isPinned" to item.isPinned,
        "isHearted" to item.isHeartedByUploader,
        "isChannelOwner" to item.isChannelOwner,
        "hasCreatorReply" to item.hasCreatorReply(),
        "streamPosition" to item.streamPosition
    )

    // Search
    @Throws(ExtractionException::class, IOException::class)
    private fun performSearch(
        query: String,
        filter: String,
        pageUrl: String?,
        serviceId: Int?
    ): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        val handler = service.searchQHFactory.fromQuery(query, listOf(filter), "")

        return if (pageUrl.isNullOrEmpty()) {
            val info = SearchInfo.getInfo(service, handler)
            mapOf(
                "success" to true,
                "query" to info.searchString.orEmpty(),
                "suggestion" to info.searchSuggestion.orEmpty(),
                "isCorrectedSearch" to info.isCorrectedSearch,
                "results" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to info.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message.orEmpty() }
            )
        } else {
            val more = SearchInfo.getMoreItems(service, handler, Page(pageUrl))
            mapOf(
                "success" to true,
                "results" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to more.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message.orEmpty() }
            )
        }
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun getSearchSuggestions(query: String, serviceId: Int?): List<String> {
        val service = getService(serviceId ?: 0)
        return service.getSuggestionExtractor().suggestionList(query)
    }

    private fun getAvailableSearchFilters(serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        return mapOf(
            "serviceId" to service.serviceId,
            "serviceName" to service.serviceInfo.name,
            "availableFilters" to service.searchQHFactory.availableContentFilter.toList()
        )
    }

    // Playlist
    @Throws(ExtractionException::class, IOException::class)
    private fun extractPlaylistInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = PlaylistInfo.getInfo(service, url)
        return mapOf(
            "success" to true,
            "serviceId" to service.serviceId,
            "id" to info.id,
            "url" to info.url,
            "originalUrl" to info.originalUrl,
            "name" to info.name.orEmpty(),
            // FIX: PlaylistInfo description is Description type
            "description" to info.description.content,
            "descriptionHtml" to info.description.content,
            "thumbnails" to info.thumbnails.map { imageToMap(it) },
            "uploaderName" to info.uploaderName.orEmpty(),
            "uploaderUrl" to info.uploaderUrl.orEmpty(),
            "uploaderAvatars" to info.uploaderAvatars.map { imageToMap(it) },
            "streamCount" to info.streamCount.coerceAtLeast(0),
            "viewCount" to info.viewCount.coerceAtLeast(0),
            "playlistType" to (info.playlistType?.name ?: "NORMAL"),
            "nextPage" to info.nextPage?.let { pageToMap(it) },
            "hasNextPage" to (info.nextPage != null),
            "items" to info.relatedItems.mapNotNull { infoItemToMap(it) },
            "errors" to info.errors.map { it.message.orEmpty() }
        )
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun extractPlaylistItems(url: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        if (pageUrl.isNullOrEmpty()) {
            val info = PlaylistInfo.getInfo(service, url)
            return mapOf(
                "success" to true,
                "items" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to info.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message.orEmpty() }
            )
        }
        val more = PlaylistInfo.getMoreItems(service, url, Page(pageUrl))
        return mapOf(
            "success" to true,
            "items" to more.items.mapNotNull { infoItemToMap(it) },
            "nextPage" to more.nextPage?.let { pageToMap(it) },
            "hasNextPage" to (more.nextPage != null),
            "errors" to more.errors.map { it.message.orEmpty() }
        )
    }

    // Channel
    @Throws(ExtractionException::class, IOException::class)
    private fun extractChannelInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = ChannelInfo.getInfo(service, url)
        return mapOf(
            "success" to true,
            "serviceId" to service.serviceId,
            "id" to info.id,
            "url" to info.url,
            "originalUrl" to info.originalUrl,
            "name" to info.name.orEmpty(),
            // FIX: ChannelInfo description is String type, not Description
            "description" to info.description.orEmpty(),
            "avatars" to info.avatars.map { imageToMap(it) },
            "banners" to info.banners.map { imageToMap(it) },
            "feedUrl" to info.feedUrl.orEmpty(),
            "subscriberCount" to info.subscriberCount.coerceAtLeast(0),
            // FIX: ChannelInfo does NOT have viewCount or streamCount in v0.26.0
            "isVerified" to info.isVerified,
            "tabs" to info.tabs.map { tab ->
                mapOf(
                    // FIX: ListLinkHandler doesn't have name field
                    "name" to tab.contentFilters.firstOrNull().orEmpty(),
                    "contentFilters" to tab.contentFilters,
                    "url" to tab.url
                )
            },
            "nextPage" to info.nextPage?.let { pageToMap(it) },
            "errors" to info.errors.map { it.message.orEmpty() }
        )
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun extractChannelTabs(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = ChannelInfo.getInfo(service, url)
        return mapOf(
            "success" to true,
            "channelName" to info.name.orEmpty(),
            "tabs" to info.tabs.map { tab ->
                mapOf(
                    // FIX: ListLinkHandler doesn't have name field
                    "name" to tab.contentFilters.firstOrNull().orEmpty(),
                    "contentFilters" to tab.contentFilters,
                    "url" to tab.url
                )
            }
        )
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun extractChannelTabItems(
        channelUrl: String,
        tabFilter: String,
        pageUrl: String?,
        serviceId: Int?
    ): Map<String, Any> {
        val service = resolveService(channelUrl, serviceId)
        val channelInfo = ChannelInfo.getInfo(service, channelUrl)

        // IMPORTANT: Empty filter means "all" - per documentation
        val targetTab = if (tabFilter.isBlank()) {
            channelInfo.tabs.firstOrNull()
        } else {
            channelInfo.tabs.firstOrNull { tab ->
                tab.contentFilters.any { it.equals(tabFilter, ignoreCase = true) }
            }
        } ?: throw ExtractionException("No tab matching filter '$tabFilter'")

        return if (pageUrl.isNullOrEmpty()) {
            val tabInfo = ChannelTabInfo.getInfo(service, targetTab.url)
            mapOf(
                "success" to true,
                // FIX: Use contentFilters for name since ListLinkHandler has no name
                "tabName" to targetTab.contentFilters.firstOrNull().orEmpty(),
                "tabFilter" to tabFilter,
                "items" to tabInfo.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to tabInfo.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (tabInfo.nextPage != null),
                "errors" to tabInfo.errors.map { it.message.orEmpty() }
            )
        } else {
            val more = ChannelTabInfo.getMoreItems(service, targetTab.url, Page(pageUrl))
            mapOf(
                "success" to true,
                "tabName" to targetTab.contentFilters.firstOrNull().orEmpty(),
                "tabFilter" to tabFilter,
                "items" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to more.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message.orEmpty() }
            )
        }
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun extractChannelFeed(url: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val feedExtractor = service.getFeedExtractor(url)
            ?: return mapOf("success" to false, "error" to "NO_FEED", "message" to "No feed available for this service/channel")

        return if (pageUrl.isNullOrEmpty()) {
            val feedInfo = FeedInfo.getInfo(feedExtractor)
            mapOf(
                "success" to true,
                // FIX: FeedInfo extends ListInfo which extends Info - getName() is available
                "name" to feedInfo.name.orEmpty(),
                "items" to feedInfo.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to feedInfo.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (feedInfo.nextPage != null),
                "errors" to feedInfo.errors.map { it.message.orEmpty() }
            )
        } else {
            val more = FeedInfo.getMoreItems(service, url, Page(pageUrl))
            mapOf(
                "success" to true,
                "items" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to more.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message.orEmpty() }
            )
        }
    }

    // Kiosk
    @Throws(ExtractionException::class, IOException::class)
    private fun listAvailableKiosks(serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        val kioskList = service.kioskList
        val ids = kioskList.availableKiosks
        return mapOf(
            "success" to true,
            "serviceId" to service.serviceId,
            "defaultKioskId" to kioskList.defaultKioskId,
            "kiosks" to ids.map { id ->
                try {
                    val extractor = kioskList.getExtractorById(id, Localization.fromLocale(Locale.US))
                    mapOf("id" to id, "name" to extractor.name, "url" to extractor.url, "available" to true)
                } catch (e: Exception) {
                    mapOf("id" to id, "name" to id, "available" to false, "error" to e.message.orEmpty())
                }
            }
        )
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun extractKioskInfo(kioskId: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        val localization = Localization.fromLocale(Locale.US)

        return if (pageUrl.isNullOrEmpty()) {
            // FIX: KioskInfo.getInfo with service and kioskId (2 params)
            val info = KioskInfo.getInfo(service, kioskId)
            mapOf(
                "success" to true,
                "kioskId" to kioskId,
                // FIX: Info has getName() method
                "name" to info.name.orEmpty(),
                "items" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to info.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message.orEmpty() }
            )
        } else {
            // FIX: Need to get kiosk URL first for getMoreItems
            val kioskExtractor = service.kioskList.getExtractorById(kioskId, localization)
            val more = KioskInfo.getMoreItems(service, kioskExtractor.url, Page(pageUrl))
            mapOf(
                "success" to true,
                "kioskId" to kioskId,
                "items" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to more.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message.orEmpty() }
            )
        }
    }

    // URL Utilities
    @Throws(ExtractionException::class)
    private fun resolveUrl(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val linkType = service.getLinkTypeByUrl(url)
        val id = when (linkType) {
            StreamingService.LinkType.STREAM   -> service.streamLHFactory.fromUrl(url).id
            StreamingService.LinkType.CHANNEL  -> service.channelLHFactory.fromUrl(url).id
            StreamingService.LinkType.PLAYLIST -> service.playlistLHFactory.fromUrl(url).id
            StreamingService.LinkType.NONE     -> throw ExtractionException("URL not handled: $url")
        }
        return mapOf(
            "type" to linkType.name.lowercase(),
            "id" to id,
            "url" to url,
            "serviceId" to service.serviceId,
            "serviceName" to service.serviceInfo.name
        )
    }

    @Throws(ExtractionException::class)
    private fun checkCanHandle(url: String, serviceId: Int?): Map<String, Any> {
        val service = serviceId?.let { getService(it) } ?: run {
            val match = ServiceList.all().firstOrNull { s ->
                try { s.getLinkTypeByUrl(url) != StreamingService.LinkType.NONE } catch (_: Exception) { false }
            }
            return mapOf(
                "canHandle" to (match != null),
                "serviceId" to (match?.serviceId ?: -1),
                "serviceName" to (match?.serviceInfo?.name ?: ""),
                "url" to url
            )
        }
        val linkType = service.getLinkTypeByUrl(url)
        return mapOf(
            "canHandle" to (linkType != StreamingService.LinkType.NONE),
            "linkType" to linkType.name.lowercase(),
            "serviceId" to service.serviceId,
            "url" to url
        )
    }

    @Throws(ExtractionException::class)
    private fun extractIdFromUrl(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val linkType = service.getLinkTypeByUrl(url)
        val id = when (linkType) {
            StreamingService.LinkType.STREAM   -> service.streamLHFactory.fromUrl(url).id
            StreamingService.LinkType.CHANNEL  -> service.channelLHFactory.fromUrl(url).id
            StreamingService.LinkType.PLAYLIST -> service.playlistLHFactory.fromUrl(url).id
            StreamingService.LinkType.NONE     -> throw ExtractionException("Cannot extract ID: $url")
        }
        return mapOf("id" to id, "type" to linkType.name.lowercase(), "url" to url, "serviceId" to service.serviceId)
    }

    // InfoItem mapping
    private fun infoItemToMap(item: InfoItem): Map<String, Any>? = when (item) {
        is StreamInfoItem -> mapOf(
            "type" to "stream",
            "serviceId" to item.serviceId,
            "url" to item.url,
            "name" to item.name.orEmpty(),
            "uploaderName" to item.uploaderName.orEmpty(),
            "uploaderUrl" to item.uploaderUrl.orEmpty(),
            "uploaderVerified" to item.isUploaderVerified,
            "thumbnails" to item.thumbnails.map { imageToMap(it) },
            "duration" to (item.duration ?: 0L),
            "viewCount" to (item.viewCount ?: 0L),
            "textualUploadDate" to item.textualUploadDate.orEmpty(),
            "streamType" to item.streamType.name,
            "isLive" to (item.streamType == LIVE_STREAM || item.streamType == AUDIO_LIVE_STREAM),
            "isShortFormContent" to item.isShortFormContent
        )
        is PlaylistInfoItem -> mapOf(
            "type" to "playlist",
            "serviceId" to item.serviceId,
            "url" to item.url,
            "name" to item.name.orEmpty(),
            "uploaderName" to item.uploaderName.orEmpty(),
            "uploaderUrl" to item.uploaderUrl.orEmpty(),
            "thumbnails" to item.thumbnails.map { imageToMap(it) },
            "streamCount" to (item.streamCount ?: 0L),
            "playlistType" to (item.playlistType?.name ?: "NORMAL")
        )
        is ChannelInfoItem -> mapOf(
            "type" to "channel",
            "serviceId" to item.serviceId,
            "url" to item.url,
            "name" to item.name.orEmpty(),
            "thumbnails" to item.thumbnails.map { imageToMap(it) },
            "subscriberCount" to (item.subscriberCount ?: 0L),
            "streamCount" to (item.streamCount ?: 0L),
            "isVerified" to item.isVerified,
            "description" to item.description.orEmpty()
        )
        else -> null
    }

    // Stream field mapping
    private fun audioStreamToMap(s: AudioStream): Map<String, Any> = mapOf(
        "url" to (s.content ?: ""),
        "isUrl" to s.isUrl,
        "deliveryMethod" to s.deliveryMethod.name,
        "format" to (s.format?.name ?: ""),
        "codec" to (s.codec ?: ""),
        // FIX: Use getAverageBitrate() method
        "averageBitrate" to s.averageBitrate,
        "audioTrackId" to (s.audioTrackId ?: ""),
        "audioTrackName" to (s.audioTrackName ?: ""),
        "audioLocale" to (s.audioLocale?.toLanguageTag() ?: ""),
        "manifestUrl" to (s.manifestUrl ?: "")
    )

    private fun videoStreamToMap(s: VideoStream): Map<String, Any> = mapOf(
        "url" to (s.content ?: ""),
        "isUrl" to s.isUrl,
        "deliveryMethod" to s.deliveryMethod.name,
        "format" to (s.format?.name ?: ""),
        "codec" to (s.codec ?: ""),
        "width" to (s.width ?: 0),
        "height" to (s.height ?: 0),
        "fps" to (s.fps ?: 0),
        "averageBitrate" to s.averageBitrate,
        "manifestUrl" to (s.manifestUrl ?: ""),
        "quality" to (s.quality ?: "")
    )

    private fun subtitleToMap(s: SubtitlesStream): Map<String, Any> = mapOf(
        "url" to (s.content ?: ""),
        "isUrl" to s.isUrl,
        "deliveryMethod" to s.deliveryMethod.name,
        "format" to (s.format?.name ?: ""),
        // FIX: Use getLanguageTag() method
        "languageTag" to s.getLanguageTag(),
        "displayLanguageName" to (s.displayLanguageName ?: ""),
        "isAutoGenerated" to s.isAutoGenerated,
        "manifestUrl" to (s.manifestUrl ?: "")
    )

    private fun imageToMap(img: Image): Map<String, Any> = mapOf(
        "url" to img.url,
        "width" to img.width,
        "height" to img.height,
        "resolutionLevel" to img.estimatedResolutionLevel.name
    )

    private fun pageToMap(p: Page): Map<String, Any> = mapOf(
        "url" to p.url,
        "ids" to p.ids,
        "cookies" to p.cookies
    )

    // Downloader implementation
    class MavinDownloader(private val client: OkHttpClient) : Downloader() {

        @Throws(IOException::class, ExtractionException::class)
        override fun execute(request: org.schabi.newpipe.extractor.downloader.Request): Response {
            val builder = Request.Builder().url(request.url())

            when (request.httpMethod()) {
                "POST" -> {
                    val body = request.dataToSend()
                    builder.post(
                        if (body != null)
                            RequestBody.create("application/x-www-form-urlencoded".toMediaTypeOrNull(), body)
                        else
                            RequestBody.create(null, ByteArray(0))
                    )
                }
                "HEAD" -> builder.head()
                else   -> builder.get()
            }

            val headers = request.headers()
            if (!headers.containsKey("User-Agent")) {
                builder.addHeader(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                )
            }
            headers.forEach { (key, values) ->
                values.forEach { value -> builder.addHeader(key, value) }
            }

            val okResponse = client.newCall(builder.build()).execute()
            val responseBody = okResponse.body?.string() ?: ""
            val responseHeaders = okResponse.headers.toMultimap()

            return Response(
                okResponse.code,
                okResponse.message,
                responseHeaders,
                responseBody,
                okResponse.request.url.toString()
            )
        }
    }
}