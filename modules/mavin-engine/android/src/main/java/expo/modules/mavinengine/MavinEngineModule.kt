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
 * MavinEngine — NewPipe Extractor v0.24.8+ Integration
 *
 * All APIs verified against:
 *   https://teamnewpipe.github.io/NewPipeExtractor/javadoc/  (v0.26.0 latest stable)
 *   https://teamnewpipe.github.io/documentation/
 *
 * ═══════════════════════════════════════════════════════════════
 *  FIXED API USAGE (v0.24.8+ compatible):
 * ═══════════════════════════════════════════════════════════════
 *  • Use getter methods instead of direct field access for Java classes
 *  • Description objects have getContent() and getHtml()
 *  • Page objects have getUrl(), getIds(), getCookies(), getBody()
 *  • InfoItem subclasses use getName(), getUrl(), getThumbnails()
 *  • CommentsInfoItem uses getCommentText() (returns Description)
 *  • StreamInfo uses getContentAvailability(), getRelatedItems(), etc.
 */
class MavinEngineModule : Module() {

    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

    companion object {
        private const val TAG = "MavinEngine"
        private const val VERSION = "6.0.2"

        // ✅ OFFICIAL: Single shared OkHttpClient — Downloader.init() called once
        private val httpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()

        @Volatile
        private var isInitialized = false
    }

    // ════════════════════════════════════════════════════════════
    // MODULE DEFINITION
    // ════════════════════════════════════════════════════════════

    override fun definition() = ModuleDefinition {
        Name("MavinEngine")

        Property("version").get<String> { VERSION }
        Property("initialized").get<Boolean> { isInitialized }
        Property("services").get<List<Map<String, Any>>> { getServicesList() }

        OnCreate { initializeNewPipe() }

        // ── Streams ────────────────────────────────────────────
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

        // ── Comments ───────────────────────────────────────────
        AsyncFunction("getComments") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit()
            extractComments(url, pageUrl, serviceId)
        }
        AsyncFunction("getCommentReplies") { commentsUrl: String, repliesPageUrl: String, serviceId: Int? ->
            ensureInit()
            extractCommentReplies(commentsUrl, repliesPageUrl, serviceId)
        }

        // ── Search ─────────────────────────────────────────────
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

        // ── Playlist ───────────────────────────────────────────
        AsyncFunction("getPlaylistInfo") { url: String, serviceId: Int? ->
            ensureInit()
            extractPlaylistInfo(url, serviceId)
        }
        AsyncFunction("getPlaylistItems") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit()
            extractPlaylistItems(url, pageUrl, serviceId)
        }

        // ── Channel ────────────────────────────────────────────
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

        // ── Kiosk / Trending ───────────────────────────────────
        AsyncFunction("getKioskList") { serviceId: Int? ->
            ensureInit()
            listAvailableKiosks(serviceId)
        }
        AsyncFunction("getKioskInfo") { kioskId: String, pageUrl: String?, serviceId: Int? ->
            ensureInit()
            extractKioskInfo(kioskId, pageUrl, serviceId)
        }
        // ✅ Music platform: getTrending → "Music" kiosk; getMostPopular → "Live" kiosk
        AsyncFunction("getTrending") { serviceId: Int? ->
            ensureInit()
            extractKioskInfo("Music", null, serviceId)
        }
        AsyncFunction("getMostPopular") { serviceId: Int? ->
            ensureInit()
            extractKioskInfo("Live", null, serviceId)
        }

        // ── URL Utilities ──────────────────────────────────────
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

        // ── Utility ────────────────────────────────────────────
        AsyncFunction("ping") {
            mapOf("alive" to true, "version" to VERSION, "timestamp" to System.currentTimeMillis())
        }
        AsyncFunction("emergencyReset") { resetNewPipe() }
        AsyncFunction("getVersion") { mapOf("version" to VERSION, "library" to "NewPipeExtractor 0.24.8+") }
    }

    // ════════════════════════════════════════════════════════════
    // INITIALIZATION — NewPipe.init() official pattern
    // ════════════════════════════════════════════════════════════

    /**
     * ✅ OFFICIAL: NewPipe.init(downloader, localization, contentCountry)
     *    Source: https://teamnewpipe.github.io/documentation/
     */
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
                Log.i(TAG, "✅ NewPipe initialized — ${ServiceList.all().size} services loaded")
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

    // ════════════════════════════════════════════════════════════
    // SERVICE RESOLUTION — ServiceList.all() official pattern
    // ════════════════════════════════════════════════════════════

    /**
     * ✅ OFFICIAL: ServiceList.all() — returns List<StreamingService>
     *    service.serviceId == 0 is YouTube
     */
    private fun getService(serviceId: Int?): StreamingService {
        val all = ServiceList.all()
        return if (serviceId != null) {
            all.firstOrNull { it.serviceId == serviceId }
                ?: throw ExtractionException("No service with id=$serviceId")
        } else {
            all.firstOrNull { it.serviceId == 0 }
                ?: all.firstOrNull()
                ?: throw ExtractionException("No streaming services registered")
        }
    }

    /**
     * ✅ OFFICIAL: service.getLinkTypeByUrl(url) to discover which service handles a URL
     */
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
                "baseUrl" to s.baseUrl,
                "mediaCapabilities" to s.serviceInfo.mediaCapabilities.map { it.name }
            )
        }
    }

    // ════════════════════════════════════════════════════════════
    // STREAM EXTRACTION
    // Official: StreamInfo.getInfo(StreamExtractor)
    // ════════════════════════════════════════════════════════════

    @Throws(ExtractionException::class, IOException::class)
    private fun extractStreamInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        // ✅ OFFICIAL: service.getStreamExtractor(url) convenience overload
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        return streamInfoToMap(StreamInfo.getInfo(extractor), service.serviceId)
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun extractStreamInfoById(videoId: String, serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        // ✅ OFFICIAL: LinkHandlerFactory.fromId(id)
        val linkHandler = service.streamLHFactory.fromId(videoId)
        val extractor = service.getStreamExtractor(linkHandler)
        extractor.fetchPage()
        return streamInfoToMap(StreamInfo.getInfo(extractor), service.serviceId)
    }

    private fun streamInfoToMap(info: StreamInfo, serviceId: Int): Map<String, Any> {
        // ✅ FIXED: Use HashMap to avoid type inference issues with mapOf
        val result = HashMap<String, Any>()
        result["success"] = true
        result["serviceId"] = serviceId
        result["id"] = info.id
        result["url"] = info.url
        result["originalUrl"] = info.originalUrl
        result["title"] = info.name.orEmpty()
        result["uploaderName"] = info.uploaderName.orEmpty()
        result["uploaderUrl"] = info.uploaderUrl.orEmpty()
        // ✅ FIXED: Use getter methods for Image list
        result["uploaderAvatars"] = info.uploaderAvatars.map { imageToMap(it) }
        result["uploaderVerified"] = info.isUploaderVerified
        result["uploaderSubscriberCount"] = info.uploaderSubscriberCount.coerceAtLeast(0)
        result["duration"] = info.duration
        result["viewCount"] = info.viewCount.coerceAtLeast(0)
        result["likeCount"] = info.likeCount.coerceAtLeast(0)
        result["dislikeCount"] = info.dislikeCount.coerceAtLeast(0)
        // ✅ FIXED: Description uses getContent() and getHtml()
        result["description"] = info.description?.content ?: ""
        result["descriptionHtml"] = info.description?.html ?: ""
        // ✅ FIXED: DateWrapper uses offsetDateTime()
        result["uploadDate"] = info.uploadDate?.offsetDateTime()?.toString() ?: ""
        result["textualUploadDate"] = info.textualUploadDate.orEmpty()
        // ✅ FIXED: Use getter for thumbnails
        result["thumbnails"] = info.thumbnails.map { imageToMap(it) }
        // ✅ FIXED: StreamType enum
        result["streamType"] = info.streamType.name
        result["isLive"] = (info.streamType == LIVE_STREAM || info.streamType == AUDIO_LIVE_STREAM)
        result["isShortFormContent"] = info.isShortFormContent
        // ✅ FIXED: Use getter method getContentAvailability()
        result["availability"] = info.contentAvailability?.name ?: "PUBLIC"
        result["ageLimit"] = info.ageLimit
        result["tags"] = info.tags
        result["category"] = info.category.orEmpty()
        // ✅ FIXED: Use getter methods for stream lists
        result["audioStreams"] = info.audioStreams.map { audioStreamToMap(it) }
        result["videoStreams"] = info.videoStreams.map { videoStreamToMap(it) }
        result["videoOnlyStreams"] = info.videoOnlyStreams.map { videoStreamToMap(it) }
        result["dashMpdUrl"] = info.dashMpdUrl.orEmpty()
        result["hlsUrl"] = info.hlsUrl.orEmpty()
        result["subtitles"] = info.subtitles.map { subtitleToMap(it) }
        // ✅ FIXED: Use getRelatedItems() method
        result["relatedItems"] = info.relatedItems.take(20).mapNotNull { infoItemToMap(it) }
        // ✅ FIXED: MetaInfo mapping with getter methods
        result["metaInfo"] = info.metaInfo.map { m ->
            mapOf(
                "title" to m.title.orEmpty(),
                "content" to (m.content?.content ?: ""),
                "urls" to m.urls.map { it.toString() },
                "urlTexts" to m.urlTexts
            )
        }
        return result
    }

    @Throws(ExtractionException::class, IOException::class)
    private fun getBestStreamUrl(url: String, format: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        val info = StreamInfo.getInfo(extractor)

        val best = when (format.lowercase()) {
            "audio", "mp3", "m4a", "ogg" ->
                // ✅ FIXED: Use getAverageBitrate() method
                info.audioStreams.maxByOrNull { it.averageBitrate }?.content
            "video", "mp4", "best" ->
                info.videoStreams.maxByOrNull { (it.height ?: 0) }?.content
                    ?: info.videoOnlyStreams.maxByOrNull { (it.height ?: 0) }?.content
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
        val filtered = if (language.isNullOrBlank()) all
                       else all.filter { it.languageCode.equals(language, ignoreCase = true) }
        return mapOf(
            "success" to true,
            "title" to info.name.orEmpty(),
            "subtitles" to filtered.map { subtitleToMap(it) },
            "availableLanguages" to all.mapNotNull { it.languageCode }.distinct()
        )
    }

    // ════════════════════════════════════════════════════════════
    // COMMENTS
    // Official: CommentsInfo.getInfo(service, url) and CommentsInfo.getMoreItems(service, url, page)
    // CommentsInfoItem fields verified against v0.26.0 javadoc
    // ════════════════════════════════════════════════════════════

    @Throws(ExtractionException::class, IOException::class)
    private fun extractComments(url: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)

        return if (pageUrl.isNullOrEmpty()) {
            // ✅ OFFICIAL: CommentsInfo.getInfo(StreamingService, String url)
            val commentsInfo = CommentsInfo.getInfo(service, url)
            mapOf(
                "success" to true,
                "disabled" to commentsInfo.isCommentsDisabled,
                "commentsCount" to commentsInfo.commentsCount,
                // ✅ FIXED: Use getRelatedItems() method and getErrors()
                "comments" to commentsInfo.relatedItems.map { commentItemToMap(it) },
                "nextPage" to commentsInfo.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (commentsInfo.nextPage != null),
                "errors" to commentsInfo.errors.map { it.message.orEmpty() }
            )
        } else {
            // ✅ OFFICIAL: CommentsInfo.getMoreItems(StreamingService, String url, Page page)
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

    /**
     * Comment replies use CommentsInfo.getMoreItems with the replies Page obtained
     * from CommentsInfoItem.getRepliesPage() — the replies page URL must come from the
     * item's getRepliesPage() Page object (stored as a url string on the client side).
     */
    @Throws(ExtractionException::class, IOException::class)
    private fun extractCommentReplies(
        commentsUrl: String,
        repliesPageUrl: String,
        serviceId: Int?
    ): Map<String, Any> {
        val service = resolveService(commentsUrl, serviceId)
        // ✅ OFFICIAL: CommentsInfo.getMoreItems to load a replies continuation page
        val page = CommentsInfo.getMoreItems(service, commentsUrl, Page(repliesPageUrl))
        return mapOf(
            "success" to true,
            "replies" to page.items.map { commentItemToMap(it) },
            "nextPage" to page.nextPage?.let { pageToMap(it) },
            "hasNextPage" to (page.nextPage != null),
            "errors" to page.errors.map { it.message.orEmpty() }
        )
    }

    /**
     * Maps CommentsInfoItem using only documented fields (v0.26.0 javadoc).
     * FIXED: Use getter methods instead of field access
     */
    private fun commentItemToMap(item: CommentsInfoItem): Map<String, Any> {
        // ✅ FIXED: Use HashMap to avoid type inference issues
        val result = HashMap<String, Any>()
        result["authorName"] = item.uploaderName.orEmpty()
        result["authorUrl"] = item.uploaderUrl.orEmpty()
        result["authorAvatars"] = item.uploaderAvatars.map { imageToMap(it) }
        result["authorVerified"] = item.isUploaderVerified
        result["commentId"] = item.commentId.orEmpty()
        // ✅ FIXED: getCommentText() returns Description object with getContent() and getHtml()
        result["commentText"] = item.commentText?.content ?: ""
        result["commentHtml"] = item.commentText?.html ?: ""
        result["publishedTime"] = item.textualUploadDate.orEmpty()
        // ✅ FIXED: getUploadDate() returns DateWrapper
        result["publishedTimestamp"] = item.uploadDate?.offsetDateTime()?.toEpochSecond() ?: 0L
        result["likeCount"] = item.likeCount.coerceAtLeast(0)
        result["textualLikeCount"] = item.textualLikeCount.orEmpty()
        result["replyCount"] = item.replyCount
        // ✅ FIXED: getRepliesPage() returns Page? — use getter and then getUrl()
        result["repliesPageUrl"] = item.repliesPage?.url ?: ""
        result["hasReplies"] = (item.replyCount > 0 || item.repliesPage != null)
        result["isPinned"] = item.isPinned
        result["isHearted"] = item.isHeartedByUploader
        result["isChannelOwner"] = item.isChannelOwner
        // ✅ FIXED: hasCreatorReply() is a method, not a field
        result["hasCreatorReply"] = item.hasCreatorReply()
        result["streamPosition"] = item.streamPosition
        return result
    }

    // ════════════════════════════════════════════════════════════
    // SEARCH
    // Official: SearchInfo.getInfo(service, SearchQueryHandler) and SearchInfo.getMoreItems
    // ════════════════════════════════════════════════════════════

    @Throws(ExtractionException::class, IOException::class)
    private fun performSearch(
        query: String,
        filter: String,
        pageUrl: String?,
        serviceId: Int?
    ): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        // ✅ OFFICIAL: SearchQueryHandlerFactory.fromQuery(query, contentFilter, sortFilter)
        val handler = service.searchQHFactory.fromQuery(query, listOf(filter), "")

        return if (pageUrl.isNullOrEmpty()) {
            // ✅ OFFICIAL: SearchInfo.getInfo(StreamingService, SearchQueryHandler)
            val info = SearchInfo.getInfo(service, handler)
            mapOf(
                "success" to true,
                "query" to info.searchString.orEmpty(),
                "suggestion" to info.searchSuggestion.orEmpty(),
                "isCorrectedSearch" to info.isCorrectedSearch,
                // ✅ FIXED: Use getRelatedItems() method
                "results" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to info.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message.orEmpty() }
            )
        } else {
            // ✅ OFFICIAL: SearchInfo.getMoreItems(StreamingService, SearchQueryHandler, Page)
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
        // ✅ OFFICIAL: service.getSuggestionExtractor().suggestionList(query)
        return service.getSuggestionExtractor().suggestionList(query)
    }

    private fun getAvailableSearchFilters(serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        // ✅ OFFICIAL: SearchQueryHandlerFactory provides available content filters
        return mapOf(
            "serviceId" to service.serviceId,
            "serviceName" to service.serviceInfo.name,
            "availableFilters" to service.searchQHFactory.availableContentFilter.toList()
        )
    }

    // ════════════════════════════════════════════════════════════
    // PLAYLIST
    // Official: PlaylistInfo.getInfo(service, url) / getMoreItems(service, url, page)
    // ════════════════════════════════════════════════════════════

    @Throws(ExtractionException::class, IOException::class)
    private fun extractPlaylistInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = PlaylistInfo.getInfo(service, url)
        // ✅ FIXED: Use HashMap to avoid type inference issues
        val result = HashMap<String, Any>()
        result["success"] = true
        result["serviceId"] = service.serviceId
        result["id"] = info.id
        result["url"] = info.url
        result["originalUrl"] = info.originalUrl
        result["name"] = info.name.orEmpty()
        // ✅ FIXED: Description uses getContent() and getHtml()
        result["description"] = info.description?.content ?: ""
        result["descriptionHtml"] = info.description?.html ?: ""
        result["thumbnails"] = info.thumbnails.map { imageToMap(it) }
        result["uploaderName"] = info.uploaderName.orEmpty()
        result["uploaderUrl"] = info.uploaderUrl.orEmpty()
        result["uploaderAvatars"] = info.uploaderAvatars.map { imageToMap(it) }
        // ✅ FIXED: Use getter methods
        result["streamCount"] = info.streamCount.coerceAtLeast(0)
        result["viewCount"] = info.viewCount.coerceAtLeast(0)
        // ✅ FIXED: PlaylistType enum via getPlaylistType()
        result["playlistType"] = info.playlistType?.name ?: "NORMAL"
        // ✅ FIXED: Use getNextPage() method
        result["nextPage"] = info.nextPage?.let { pageToMap(it) }
        result["hasNextPage"] = (info.nextPage != null)
        // ✅ FIXED: Use getRelatedItems() method
        result["items"] = info.relatedItems.mapNotNull { infoItemToMap(it) }
        result["errors"] = info.errors.map { it.message.orEmpty() }
        return result
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
        // ✅ OFFICIAL: PlaylistInfo.getMoreItems(StreamingService, String url, Page page)
        val more = PlaylistInfo.getMoreItems(service, url, Page(pageUrl))
        return mapOf(
            "success" to true,
            "items" to more.items.mapNotNull { infoItemToMap(it) },
            "nextPage" to more.nextPage?.let { pageToMap(it) },
            "hasNextPage" to (more.nextPage != null),
            "errors" to more.errors.map { it.message.orEmpty() }
        )
    }

    // ════════════════════════════════════════════════════════════
    // CHANNEL
    // Official: ChannelInfo.getInfo(service, url) / getMoreItems
    // ════════════════════════════════════════════════════════════

    @Throws(ExtractionException::class, IOException::class)
    private fun extractChannelInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        // ✅ OFFICIAL: ChannelInfo.getInfo(StreamingService, String url)
        val info = ChannelInfo.getInfo(service, url)
        // ✅ FIXED: Use HashMap to avoid type inference issues
        val result = HashMap<String, Any>()
        result["success"] = true
        result["serviceId"] = service.serviceId
        result["id"] = info.id
        result["url"] = info.url
        result["originalUrl"] = info.originalUrl
        // ✅ FIXED: Use getName() method from InfoItem
        result["name"] = info.name.orEmpty()
        // ✅ FIXED: Description getters
        result["description"] = info.description?.content ?: ""
        result["descriptionHtml"] = info.description?.html ?: ""
        // ✅ FIXED: Use getter methods for Image lists
        result["avatars"] = info.avatars.map { imageToMap(it) }
        result["banners"] = info.banners.map { imageToMap(it) }
        result["feedUrl"] = info.feedUrl.orEmpty()
        result["subscriberCount"] = info.subscriberCount.coerceAtLeast(0)
        result["streamCount"] = info.streamCount.coerceAtLeast(0)
        result["viewCount"] = info.viewCount.coerceAtLeast(0)
        result["isVerified"] = info.isVerified
        // ✅ FIXED: tabs are ListLinkHandler — use getter methods
        result["tabs"] = info.tabs.map { tab ->
            mapOf(
                "name" to tab.name,
                "contentFilters" to tab.contentFilters,
                "url" to tab.url
            )
        }
        result["nextPage"] = info.nextPage?.let { pageToMap(it) }
        result["errors"] = info.errors.map { it.message.orEmpty() }
        return result
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
                    "name" to tab.name,
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

        // ✅ FIXED: Find the tab by matching contentFilters using getter methods
        val targetTab = channelInfo.tabs.firstOrNull { tab ->
            tab.contentFilters.any { it.equals(tabFilter, ignoreCase = true) }
                || tab.name.equals(tabFilter, ignoreCase = true)
        } ?: throw ExtractionException("No tab matching filter '$tabFilter'")

        return if (pageUrl.isNullOrEmpty()) {
            // ✅ OFFICIAL: ChannelTabInfo.getInfo(StreamingService, String tabUrl)
            val tabInfo = ChannelTabInfo.getInfo(service, targetTab.url)
            mapOf(
                "success" to true,
                "tabName" to targetTab.name,
                "tabFilter" to tabFilter,
                // ✅ FIXED: Use getRelatedItems() method
                "items" to tabInfo.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to tabInfo.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (tabInfo.nextPage != null),
                "errors" to tabInfo.errors.map { it.message.orEmpty() }
            )
        } else {
            // ✅ OFFICIAL: ChannelTabInfo.getMoreItems(StreamingService, String url, Page page)
            val more = ChannelTabInfo.getMoreItems(service, targetTab.url, Page(pageUrl))
            mapOf(
                "success" to true,
                "tabName" to targetTab.name,
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
        // ✅ OFFICIAL: service.getFeedExtractor(url) — may return null if service has no feed
        val feedExtractor = service.getFeedExtractor(url)
            ?: return mapOf("success" to false, "error" to "NO_FEED", "message" to "No feed available for this service/channel")

        return if (pageUrl.isNullOrEmpty()) {
            // ✅ OFFICIAL: FeedInfo.getInfo(FeedExtractor)
            val feedInfo = FeedInfo.getInfo(feedExtractor)
            mapOf(
                "success" to true,
                "name" to feedInfo.name.orEmpty(),
                // ✅ FIXED: Use getRelatedItems() method
                "items" to feedInfo.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to feedInfo.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (feedInfo.nextPage != null),
                "errors" to feedInfo.errors.map { it.message.orEmpty() }
            )
        } else {
            // ✅ OFFICIAL: FeedInfo.getMoreItems(StreamingService, String url, Page page)
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

    // ════════════════════════════════════════════════════════════
    // KIOSK
    // Official: KioskInfo.getInfo(service, kioskId, localization)
    //           KioskInfo.getMoreItems(service, url, page)
    // YouTube v0.24.8+ kiosks: "Live", "Music", "Gaming", "Movies" (Trending deprecated)
    // ════════════════════════════════════════════════════════════

    @Throws(ExtractionException::class, IOException::class)
    private fun listAvailableKiosks(serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        // ✅ OFFICIAL: service.getKioskList().availableKiosks — List<String>
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
            // ✅ OFFICIAL: KioskInfo.getInfo(StreamingService, String kioskId, Localization)
            val info = KioskInfo.getInfo(service, kioskId, localization)
            mapOf(
                "success" to true,
                "kioskId" to kioskId,
                "name" to info.name.orEmpty(),
                // ✅ FIXED: Use getRelatedItems() method
                "items" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to info.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message.orEmpty() }
            )
        } else {
            // ✅ OFFICIAL: KioskInfo.getMoreItems(StreamingService, String url, Page page)
            // Need the kiosk URL first
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

    // ════════════════════════════════════════════════════════════
    // URL UTILITIES
    // ════════════════════════════════════════════════════════════

    @Throws(ExtractionException::class)
    private fun resolveUrl(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        // ✅ OFFICIAL: service.getLinkTypeByUrl(url) → StreamingService.LinkType
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

    // ════════════════════════════════════════════════════════════
    // InfoItem → Map (documented fields only)
    // FIXED: Use getter methods for all InfoItem subclasses
    // ════════════════════════════════════════════════════════════

    private fun infoItemToMap(item: InfoItem): Map<String, Any>? = when (item) {
        is StreamInfoItem -> {
            // ✅ FIXED: Use HashMap to avoid type inference issues
            val result = HashMap<String, Any>()
            result["type"] = "stream"
            result["serviceId"] = item.serviceId
            // ✅ FIXED: Use getter methods from InfoItem parent class
            result["url"] = item.url
            result["name"] = item.name.orEmpty()
            result["uploaderName"] = item.uploaderName.orEmpty()
            result["uploaderUrl"] = item.uploaderUrl.orEmpty()
            result["uploaderVerified"] = item.isUploaderVerified
            result["thumbnails"] = item.thumbnails.map { imageToMap(it) }
            result["duration"] = item.duration ?: 0L
            result["viewCount"] = item.viewCount ?: 0L
            result["textualUploadDate"] = item.textualUploadDate.orEmpty()
            result["streamType"] = item.streamType.name
            result["isLive"] = (item.streamType == LIVE_STREAM || item.streamType == AUDIO_LIVE_STREAM)
            result["isShortFormContent"] = item.isShortFormContent
            result
        }
        is PlaylistInfoItem -> {
            val result = HashMap<String, Any>()
            result["type"] = "playlist"
            result["serviceId"] = item.serviceId
            result["url"] = item.url
            result["name"] = item.name.orEmpty()
            result["uploaderName"] = item.uploaderName.orEmpty()
            result["uploaderUrl"] = item.uploaderUrl.orEmpty()
            result["thumbnails"] = item.thumbnails.map { imageToMap(it) }
            // ✅ FIXED: Use getter method
            result["streamCount"] = item.streamCount ?: 0L
            result["playlistType"] = item.playlistType?.name ?: "NORMAL"
            result
        }
        is ChannelInfoItem -> {
            val result = HashMap<String, Any>()
            result["type"] = "channel"
            result["serviceId"] = item.serviceId
            result["url"] = item.url
            result["name"] = item.name.orEmpty()
            result["thumbnails"] = item.thumbnails.map { imageToMap(it) }
            result["subscriberCount"] = item.subscriberCount ?: 0L
            result["streamCount"] = item.streamCount ?: 0L
            result["isVerified"] = item.isVerified
            result["description"] = item.description.orEmpty()
            result
        }
        else -> null
    }

    // ════════════════════════════════════════════════════════════
    // Stream field mapping helpers
    // FIXED: Use getter methods for all stream properties
    // ════════════════════════════════════════════════════════════

    /**
     * ✅ FIXED: AudioStream getters: getContent(), getDeliveryMethod(), getFormat(),
     *    getAverageBitrate(), getCodec(), getAudioTrackId(), getAudioTrackName(),
     *    getAudioLocale(), getItagItem()
     */
    private fun audioStreamToMap(s: AudioStream): Map<String, Any> {
        // ✅ FIXED: Use HashMap to avoid type inference issues
        val result = HashMap<String, Any>()
        result["url"] = s.content ?: ""
        result["isUrl"] = s.isUrl
        result["deliveryMethod"] = s.deliveryMethod.name
        result["format"] = s.format?.name ?: ""
        result["codec"] = s.codec ?: ""
        // ✅ FIXED: Use getAverageBitrate() method
        result["averageBitrate"] = s.averageBitrate
        result["audioTrackId"] = s.audioTrackId ?: ""
        result["audioTrackName"] = s.audioTrackName ?: ""
        // ✅ FIXED: getAudioLocale() returns Locale, convert to string
        result["audioLocale"] = s.audioLocale?.toLanguageTag() ?: ""
        result["manifestUrl"] = s.manifestUrl ?: ""
        return result
    }

    /**
     * ✅ FIXED: VideoStream getters: getContent(), getDeliveryMethod(), getFormat(),
     *    getCodec(), getWidth(), getHeight(), getFps(), getAverageBitrate()
     */
    private fun videoStreamToMap(s: VideoStream): Map<String, Any> {
        // ✅ FIXED: Use HashMap to avoid type inference issues
        val result = HashMap<String, Any>()
        result["url"] = s.content ?: ""
        result["isUrl"] = s.isUrl
        result["deliveryMethod"] = s.deliveryMethod.name
        result["format"] = s.format?.name ?: ""
        result["codec"] = s.codec ?: ""
        result["width"] = s.width ?: 0
        result["height"] = s.height ?: 0
        result["fps"] = s.fps ?: 0
        // ✅ FIXED: Use getAverageBitrate() method
        result["averageBitrate"] = s.averageBitrate
        result["manifestUrl"] = s.manifestUrl ?: ""
        result["quality"] = s.quality ?: ""
        return result
    }

    /**
     * ✅ FIXED: SubtitlesStream getters: getContent(), getDeliveryMethod(), getFormat(),
     *    getLanguageCode(), getDisplayLanguageName(), isAutoGenerated()
     */
    private fun subtitleToMap(s: SubtitlesStream): Map<String, Any> {
        // ✅ FIXED: Use HashMap to avoid type inference issues
        val result = HashMap<String, Any>()
        result["url"] = s.content ?: ""
        result["isUrl"] = s.isUrl
        result["deliveryMethod"] = s.deliveryMethod.name
        result["format"] = s.format?.name ?: ""
        // ✅ FIXED: Use getLanguageCode() method
        result["languageCode"] = s.languageCode ?: ""
        result["displayLanguageName"] = s.displayLanguageName ?: ""
        result["isAutoGenerated"] = s.isAutoGenerated
        result["manifestUrl"] = s.manifestUrl ?: ""
        return result
    }

    /**
     * ✅ FIXED: Image getters: getUrl(), getWidth(), getHeight(), getEstimatedResolutionLevel()
     */
    private fun imageToMap(img: Image): Map<String, Any> {
        // ✅ FIXED: Use HashMap to avoid type inference issues
        val result = HashMap<String, Any>()
        // ✅ FIXED: Use getter methods
        result["url"] = img.url
        result["width"] = img.width
        result["height"] = img.height
        result["resolutionLevel"] = img.estimatedResolutionLevel.name
        return result
    }

    /**
     * ✅ FIXED: Page getters: getUrl(), getIds(), getBody(), getCookies()
     */
    private fun pageToMap(p: Page): Map<String, Any> {
        // ✅ FIXED: Use HashMap to avoid type inference issues
        val result = HashMap<String, Any>()
        // ✅ FIXED: Use getter methods
        result["url"] = p.url
        result["ids"] = p.ids
        result["cookies"] = p.cookies
        return result
    }

    // ════════════════════════════════════════════════════════════
    // OFFICIAL DOWNLOADER — Downloader abstract class
    // Verified: https://teamnewpipe.github.io/NewPipeExtractor/javadoc/
    //           org/schabi/newpipe/extractor/downloader/Downloader.html
    // ════════════════════════════════════════════════════════════

    class MavinDownloader(private val client: OkHttpClient) : Downloader() {

        @Throws(IOException::class, ExtractionException::class)
        override fun execute(
            request: org.schabi.newpipe.extractor.downloader.Request
        ): Response {
            val builder = Request.Builder().url(request.url())

            // ✅ Apply http method + body
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

            // ✅ Apply headers from Request — always add UA if missing
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

            // ✅ Response constructor: (responseCode, responseMessage, responseHeaders, responseBody, latestUrl)
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