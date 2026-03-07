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
 * Strictly follows official Javadoc:
 *   https://teamnewpipe.github.io/NewPipeExtractor/javadoc/ (v0.26.0)
 *
 * ═══════════════════════════════════════════════════════════════
 *  CRITICAL API USAGE (v0.26.0 compatible):
 * ═══════════════════════════════════════════════════════════════
 *  • Description: getContent(), getHtml()
 *  • Page: getUrl(), getIds(), getCookies(), getBody()
 *  • InfoItem: getName(), getUrl(), getThumbnails()
 *  • CommentsInfoItem: getCommentText(), getReplies() (NOT getRepliesPage)
 *  • AudioStream: getAverageBitrate(), getBitrate()
 *  • VideoStream: getBitrate() (NO getAverageBitrate)
 *  • SubtitlesStream: getLanguageTag(), getLocale() (NO getLanguageCode)
 *  • ListLinkHandler: getContentFilters() (field is protected)
 *  • StreamingService: getMediaCapabilities() returns Set<MediaCapability>
 */
class MavinEngineModule : Module() {

    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

    companion object {
        private const val TAG = "MavinEngine"
        private const val VERSION = "6.0.3"

        // ✅ OFFICIAL: Single shared OkHttpClient
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
        AsyncFunction("getVersion") { mapOf("version" to VERSION, "library" to "NewPipeExtractor 0.26.0") }
    }

    // ════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ════════════════════════════════════════════════════════════

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
    // SERVICE RESOLUTION
    // ════════════════════════════════════════════════════════════

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
                // ✅ FIXED: v0.26.0 returns Set<MediaCapability>, convert to List
                "mediaCapabilities" to s.serviceInfo.mediaCapabilities.map { it.name }
            )
        }
    }

    // ════════════════════════════════════════════════════════════
    // STREAM EXTRACTION
    // ════════════════════════════════════════════════════════════

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
        val result = HashMap<String, Any>()
        result["success"] = true
        result["serviceId"] = serviceId
        result["id"] = info.id
        result["url"] = info.url
        result["originalUrl"] = info.originalUrl
        result["title"] = info.name.orEmpty()
        result["uploaderName"] = info.uploaderName.orEmpty()
        result["uploaderUrl"] = info.uploaderUrl.orEmpty()
        result["uploaderAvatars"] = info.uploaderAvatars.map { imageToMap(it) }
        result["uploaderVerified"] = info.isUploaderVerified
        result["uploaderSubscriberCount"] = info.uploaderSubscriberCount.coerceAtLeast(0)
        result["duration"] = info.duration
        result["viewCount"] = info.viewCount.coerceAtLeast(0)
        result["likeCount"] = info.likeCount.coerceAtLeast(0)
        result["dislikeCount"] = info.dislikeCount.coerceAtLeast(0)
        // ✅ FIXED: Description uses getContent() and getHtml()
        result["description"] = info.description?.getContent().orEmpty()
        result["descriptionHtml"] = info.description?.getHtml().orEmpty()
        result["uploadDate"] = info.uploadDate?.offsetDateTime()?.toString() ?: ""
        result["textualUploadDate"] = info.textualUploadDate.orEmpty()
        result["thumbnails"] = info.thumbnails.map { imageToMap(it) }
        result["streamType"] = info.streamType.name
        result["isLive"] = (info.streamType == LIVE_STREAM || info.streamType == AUDIO_LIVE_STREAM)
        result["isShortFormContent"] = info.isShortFormContent
        result["availability"] = info.contentAvailability?.name ?: "PUBLIC"
        result["ageLimit"] = info.ageLimit
        result["tags"] = info.tags
        result["category"] = info.category.orEmpty()
        result["audioStreams"] = info.audioStreams.map { audioStreamToMap(it) }
        result["videoStreams"] = info.videoStreams.map { videoStreamToMap(it) }
        result["videoOnlyStreams"] = info.videoOnlyStreams.map { videoStreamToMap(it) }
        result["dashMpdUrl"] = info.dashMpdUrl.orEmpty()
        result["hlsUrl"] = info.hlsUrl.orEmpty()
        result["subtitles"] = info.subtitles.map { subtitleToMap(it) }
        // ✅ FIXED: Use getRelatedItems() method
        result["relatedItems"] = info.relatedItems.take(20).mapNotNull { infoItemToMap(it) }
        // ✅ FIXED: MetaInfo.getContent() returns Description
        result["metaInfo"] = info.metaInfo.map { m ->
            mapOf(
                "title" to m.title.orEmpty(),
                "content" to m.content?.getContent().orEmpty(),
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
                // ✅ FIXED: AudioStream has getAverageBitrate()
                info.audioStreams.maxByOrNull { it.getAverageBitrate() }?.content
            "video", "mp4", "best" ->
                info.videoStreams.maxByOrNull { (it.height ?: 0) }?.content
                    ?: info.videoOnlyStreams.maxByOrNull { (it.height ?: 0) }?.content
            "dash" -> info.dashMpdUrl.takeIf { it.isNotEmpty() }
            "hls"  -> info.hlsUrl.takeIf { it.isNotEmpty() }
            else   -> info.audioStreams.maxByOrNull { it.getAverageBitrate() }?.content
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
        // ✅ FIXED: SubtitlesStream uses getLanguageTag() (NOT getLanguageCode)
        val filtered = if (language.isNullOrBlank()) all
                       else all.filter { it.getLanguageTag().equals(language, ignoreCase = true) }
        return mapOf(
            "success" to true,
            "title" to info.name.orEmpty(),
            "subtitles" to filtered.map { subtitleToMap(it) },
            "availableLanguages" to all.mapNotNull { it.getLanguageTag() }.distinct()
        )
    }

    // ════════════════════════════════════════════════════════════
    // COMMENTS
    // ════════════════════════════════════════════════════════════

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

    /**
     * ✅ CRITICAL FIX: CommentsInfoItem uses getReplies() (NOT getRepliesPage)
     */
    private fun commentItemToMap(item: CommentsInfoItem): Map<String, Any> {
        val result = HashMap<String, Any>()
        result["authorName"] = item.uploaderName.orEmpty()
        result["authorUrl"] = item.uploaderUrl.orEmpty()
        result["authorAvatars"] = item.uploaderAvatars.map { imageToMap(it) }
        result["authorVerified"] = item.isUploaderVerified
        result["commentId"] = item.commentId.orEmpty()
        // ✅ FIXED: getCommentText() returns Description
        result["commentText"] = item.commentText?.getContent().orEmpty()
        result["commentHtml"] = item.commentText?.getHtml().orEmpty()
        result["publishedTime"] = item.textualUploadDate.orEmpty()
        result["publishedTimestamp"] = item.uploadDate?.offsetDateTime()?.toEpochSecond() ?: 0L
        result["likeCount"] = item.likeCount.coerceAtLeast(0)
        result["textualLikeCount"] = item.textualLikeCount.orEmpty()
        result["replyCount"] = item.replyCount
        // ✅ CRITICAL: CommentsInfoItem uses getReplies() (NOT getRepliesPage)
        result["repliesPageUrl"] = item.replies?.getUrl().orEmpty()
        result["hasReplies"] = (item.replyCount > 0 || item.replies != null)
        result["isPinned"] = item.isPinned
        result["isHearted"] = item.isHeartedByUploader
        result["isChannelOwner"] = item.isChannelOwner
        result["hasCreatorReply"] = item.hasCreatorReply()
        result["streamPosition"] = item.streamPosition
        return result
    }

    // ════════════════════════════════════════════════════════════
    // SEARCH
    // ════════════════════════════════════════════════════════════

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

    // ════════════════════════════════════════════════════════════
    // PLAYLIST
    // ════════════════════════════════════════════════════════════

    @Throws(ExtractionException::class, IOException::class)
    private fun extractPlaylistInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = PlaylistInfo.getInfo(service, url)
        val result = HashMap<String, Any>()
        result["success"] = true
        result["serviceId"] = service.serviceId
        result["id"] = info.id
        result["url"] = info.url
        result["originalUrl"] = info.originalUrl
        result["name"] = info.name.orEmpty()
        result["description"] = info.description?.getContent().orEmpty()
        result["descriptionHtml"] = info.description?.getHtml().orEmpty()
        result["thumbnails"] = info.thumbnails.map { imageToMap(it) }
        result["uploaderName"] = info.uploaderName.orEmpty()
        result["uploaderUrl"] = info.uploaderUrl.orEmpty()
        result["uploaderAvatars"] = info.uploaderAvatars.map { imageToMap(it) }
        result["streamCount"] = info.streamCount.coerceAtLeast(0)
        result["viewCount"] = info.viewCount.coerceAtLeast(0)
        result["playlistType"] = info.playlistType?.name ?: "NORMAL"
        result["nextPage"] = info.nextPage?.let { pageToMap(it) }
        result["hasNextPage"] = (info.nextPage != null)
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
    // ════════════════════════════════════════════════════════════

    @Throws(ExtractionException::class, IOException::class)
    private fun extractChannelInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = ChannelInfo.getInfo(service, url)
        val result = HashMap<String, Any>()
        result["success"] = true
        result["serviceId"] = service.serviceId
        result["id"] = info.id
        result["url"] = info.url
        result["originalUrl"] = info.originalUrl
        result["name"] = info.name.orEmpty()
        result["description"] = info.description?.getContent().orEmpty()
        result["descriptionHtml"] = info.description?.getHtml().orEmpty()
        result["avatars"] = info.avatars.map { imageToMap(it) }
        result["banners"] = info.banners.map { imageToMap(it) }
        result["feedUrl"] = info.feedUrl.orEmpty()
        result["subscriberCount"] = info.subscriberCount.coerceAtLeast(0)
        result["streamCount"] = info.streamCount.coerceAtLeast(0)
        result["viewCount"] = info.viewCount.coerceAtLeast(0)
        result["isVerified"] = info.isVerified
        // ✅ FIXED: ListLinkHandler uses getContentFilters() method (field is protected)
        result["tabs"] = info.tabs.map { tab ->
            mapOf(
                "name" to tab.getName(),
                "contentFilters" to tab.getContentFilters(),
                "url" to tab.getUrl()
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
                    "name" to tab.getName(),
                    "contentFilters" to tab.getContentFilters(),
                    "url" to tab.getUrl()
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

        // ✅ FIXED: Use getContentFilters() method and getName()
        val targetTab = channelInfo.tabs.firstOrNull { tab ->
            tab.getContentFilters().any { it.equals(tabFilter, ignoreCase = true) }
                || tab.getName().equals(tabFilter, ignoreCase = true)
        } ?: throw ExtractionException("No tab matching filter '$tabFilter'")

        return if (pageUrl.isNullOrEmpty()) {
            val tabInfo = ChannelTabInfo.getInfo(service, targetTab.getUrl())
            mapOf(
                "success" to true,
                "tabName" to targetTab.getName(),
                "tabFilter" to tabFilter,
                "items" to tabInfo.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to tabInfo.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (tabInfo.nextPage != null),
                "errors" to tabInfo.errors.map { it.message.orEmpty() }
            )
        } else {
            val more = ChannelTabInfo.getMoreItems(service, targetTab.getUrl(), Page(pageUrl))
            mapOf(
                "success" to true,
                "tabName" to targetTab.getName(),
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

    // ════════════════════════════════════════════════════════════
    // KIOSK
    // ════════════════════════════════════════════════════════════

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
                    mapOf("id" to id, "name" to extractor.getName(), "url" to extractor.getUrl(), "available" to true)
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
            val info = KioskInfo.getInfo(service, kioskId, localization)
            mapOf(
                "success" to true,
                "kioskId" to kioskId,
                "name" to info.name.orEmpty(),
                "items" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to info.nextPage?.let { pageToMap(it) },
                "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message.orEmpty() }
            )
        } else {
            val kioskExtractor = service.kioskList.getExtractorById(kioskId, localization)
            val more = KioskInfo.getMoreItems(service, kioskExtractor.getUrl(), Page(pageUrl))
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
    // InfoItem → Map
    // ════════════════════════════════════════════════════════════

    private fun infoItemToMap(item: InfoItem): Map<String, Any>? = when (item) {
        is StreamInfoItem -> {
            val result = HashMap<String, Any>()
            result["type"] = "stream"
            result["serviceId"] = item.serviceId
            // ✅ FIXED: Use getter methods from InfoItem
            result["url"] = item.getUrl()
            result["name"] = item.getName().orEmpty()
            result["uploaderName"] = item.uploaderName.orEmpty()
            result["uploaderUrl"] = item.uploaderUrl.orEmpty()
            result["uploaderVerified"] = item.isUploaderVerified
            result["thumbnails"] = item.getThumbnails().map { imageToMap(it) }
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
            result["url"] = item.getUrl()
            result["name"] = item.getName().orEmpty()
            result["uploaderName"] = item.uploaderName.orEmpty()
            result["uploaderUrl"] = item.uploaderUrl.orEmpty()
            result["thumbnails"] = item.getThumbnails().map { imageToMap(it) }
            result["streamCount"] = item.streamCount ?: 0L
            result["playlistType"] = item.playlistType?.name ?: "NORMAL"
            result
        }
        is ChannelInfoItem -> {
            val result = HashMap<String, Any>()
            result["type"] = "channel"
            result["serviceId"] = item.serviceId
            result["url"] = item.getUrl()
            result["name"] = item.getName().orEmpty()
            result["thumbnails"] = item.getThumbnails().map { imageToMap(it) }
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
    // ════════════════════════════════════════════════════════════

    /**
     * ✅ AudioStream: getContent(), getDeliveryMethod(), getFormat(),
     *    getAverageBitrate(), getCodec(), getAudioTrackId(), getAudioTrackName(),
     *    getAudioLocale()
     */
    private fun audioStreamToMap(s: AudioStream): Map<String, Any> {
        val result = HashMap<String, Any>()
        result["url"] = s.content ?: ""
        result["isUrl"] = s.isUrl
        result["deliveryMethod"] = s.deliveryMethod.name
        result["format"] = s.format?.name ?: ""
        result["codec"] = s.codec ?: ""
        // ✅ AudioStream has getAverageBitrate()
        result["averageBitrate"] = s.getAverageBitrate()
        result["audioTrackId"] = s.audioTrackId ?: ""
        result["audioTrackName"] = s.audioTrackName ?: ""
        result["audioLocale"] = s.audioLocale?.toLanguageTag() ?: ""
        result["manifestUrl"] = s.manifestUrl ?: ""
        return result
    }

    /**
     * ✅ VideoStream: getContent(), getDeliveryMethod(), getFormat(),
     *    getCodec(), getWidth(), getHeight(), getFps(), getBitrate()
     *    ❌ NO getAverageBitrate() - only getBitrate()
     */
    private fun videoStreamToMap(s: VideoStream): Map<String, Any> {
        val result = HashMap<String, Any>()
        result["url"] = s.content ?: ""
        result["isUrl"] = s.isUrl
        result["deliveryMethod"] = s.deliveryMethod.name
        result["format"] = s.format?.name ?: ""
        result["codec"] = s.codec ?: ""
        result["width"] = s.width ?: 0
        result["height"] = s.height ?: 0
        result["fps"] = s.fps ?: 0
        // ✅ VideoStream has getBitrate(), NOT getAverageBitrate()
        result["bitrate"] = s.getBitrate()
        result["manifestUrl"] = s.manifestUrl ?: ""
        result["quality"] = s.quality ?: ""
        return result
    }

    /**
     * ✅ SubtitlesStream: getContent(), getDeliveryMethod(), getFormat(),
     *    getLanguageTag(), getDisplayLanguageName(), isAutoGenerated()
     *    ❌ NO getLanguageCode() - use getLanguageTag()
     */
    private fun subtitleToMap(s: SubtitlesStream): Map<String, Any> {
        val result = HashMap<String, Any>()
        result["url"] = s.content ?: ""
        result["isUrl"] = s.isUrl
        result["deliveryMethod"] = s.deliveryMethod.name
        result["format"] = s.format?.name ?: ""
        // ✅ SubtitlesStream has getLanguageTag(), NOT getLanguageCode()
        result["languageTag"] = s.getLanguageTag() ?: ""
        result["displayLanguageName"] = s.displayLanguageName ?: ""
        result["isAutoGenerated"] = s.isAutoGenerated
        result["manifestUrl"] = s.manifestUrl ?: ""
        return result
    }

    /**
     * ✅ Image: getUrl(), getHeight(), getWidth(), getEstimatedResolutionLevel()
     */
    private fun imageToMap(img: Image): Map<String, Any> {
        val result = HashMap<String, Any>()
        result["url"] = img.getUrl()
        result["width"] = img.getWidth()
        result["height"] = img.getHeight()
        result["resolutionLevel"] = img.estimatedResolutionLevel.name
        return result
    }

    /**
     * ✅ Page: getUrl(), getIds(), getCookies(), getBody()
     */
    private fun pageToMap(p: Page): Map<String, Any> {
        val result = HashMap<String, Any>()
        result["url"] = p.getUrl()
        result["ids"] = p.getIds()
        result["cookies"] = p.getCookies()
        return result
    }

    // ════════════════════════════════════════════════════════════
    // OFFICIAL DOWNLOADER
    // ════════════════════════════════════════════════════════════

    class MavinDownloader(private val client: OkHttpClient) : Downloader() {

        @Throws(IOException::class, ExtractionException::class)
        override fun execute(
            request: org.schabi.newpipe.extractor.downloader.Request
        ): Response {
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