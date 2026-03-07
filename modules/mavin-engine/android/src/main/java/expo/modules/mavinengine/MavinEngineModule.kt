@file:Suppress("unused", "MemberVisibilityCanBePrivate")

package expo.modules.mavinengine

import android.content.Context
import android.util.Log
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
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.playlist.PlaylistInfo
import org.schabi.newpipe.extractor.playlist.PlaylistInfoItem
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.stream.*
import java.io.IOException
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * MavinEngine — NewPipe Extractor v0.26.0 Integration
 */
class MavinEngineModule : Module() {

    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

    companion object {
        private const val TAG = "MavinEngine"
        private const val VERSION = "6.0.3"

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
        AsyncFunction("getComments") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit()
            extractComments(url, pageUrl, serviceId)
        }
        AsyncFunction("getCommentReplies") { commentsUrl: String, repliesPageUrl: String, serviceId: Int? ->
            ensureInit()
            extractCommentReplies(commentsUrl, repliesPageUrl, serviceId)
        }
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
        AsyncFunction("getPlaylistInfo") { url: String, serviceId: Int? ->
            ensureInit()
            extractPlaylistInfo(url, serviceId)
        }
        AsyncFunction("getPlaylistItems") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit()
            extractPlaylistItems(url, pageUrl, serviceId)
        }
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
            extractKioskInfo("Trending", null, serviceId)
        }
        AsyncFunction("getMostPopular") { serviceId: Int? ->
            ensureInit()
            extractKioskInfo("Most Popular", null, serviceId)
        }
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
        AsyncFunction("ping") {
            mapOf<String, Any>(
                "alive" to true,
                "version" to VERSION,
                "timestamp" to System.currentTimeMillis()
            )
        }
        AsyncFunction("emergencyReset") { resetNewPipe() }
        AsyncFunction("getVersion") {
            mapOf<String, Any>(
                "version" to VERSION,
                "library" to "NewPipeExtractor 0.26.0"
            )
        }
    }

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
                throw Exception("INIT_FAILED: ${e.message}")
            }
        }
    }

    private fun ensureInit() {
        if (!isInitialized) initializeNewPipe()
    }

    private fun resetNewPipe(): Map<String, Any> {
        isInitialized = false
        initializeNewPipe()
        return mapOf(
            "success" to true,
            "message" to "NewPipe reset and re-initialised"
        )
    }

    private fun getService(serviceId: Int?): StreamingService {
        val all = ServiceList.all()
        return if (serviceId != null) {
            all.firstOrNull { it.serviceId == serviceId }
                ?: throw Exception("No service with id=$serviceId")
        } else {
            all.firstOrNull { it.serviceId == 0 }
                ?: all.firstOrNull()
                ?: throw Exception("No streaming services registered")
        }
    }

    private fun getServiceForUrl(url: String): StreamingService {
        return ServiceList.all().firstOrNull { service ->
            try {
                service.getLinkTypeByUrl(url) != StreamingService.LinkType.NONE
            } catch (_: Exception) {
                false
            }
        } ?: throw Exception("No service can handle URL: $url")
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
                "mediaCapabilities" to s.serviceInfo.mediaCapabilities.map { it.name }
            )
        }
    }

    // ── Description helper ────────────────────────────────────────────────────
    // In NewPipe 0.26.x Description only exposes .content (plain text).
    // There is no separate .html getter on the Description class itself.
    private fun descContent(d: org.schabi.newpipe.extractor.utils.Identifiable?): String =
        (d as? org.schabi.newpipe.extractor.description.Description)?.content ?: ""

    // ── Stream Info ───────────────────────────────────────────────────────────

    @Throws(Exception::class, IOException::class)
    private fun extractStreamInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        return streamInfoToMap(StreamInfo.getInfo(extractor))
    }

    @Throws(Exception::class, IOException::class)
    private fun extractStreamInfoById(videoId: String, serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        val linkHandler = service.streamLHFactory.fromId(videoId)
        val extractor = service.getStreamExtractor(linkHandler)
        extractor.fetchPage()
        return streamInfoToMap(StreamInfo.getInfo(extractor))
    }

    private fun streamInfoToMap(info: StreamInfo): Map<String, Any> {
        val desc = info.description
        return mapOf<String, Any>(
            "success" to true,
            "serviceId" to info.serviceId,
            "id" to (info.id ?: ""),
            "url" to (info.url ?: ""),
            "originalUrl" to (info.originalUrl ?: ""),
            "title" to (info.name ?: ""),
            "uploaderName" to (info.uploaderName ?: ""),
            "uploaderUrl" to (info.uploaderUrl ?: ""),
            "uploaderAvatars" to info.uploaderAvatars.map { imageToMap(it) },
            "uploaderVerified" to info.isUploaderVerified,
            "uploaderSubscriberCount" to info.uploaderSubscriberCount.coerceAtLeast(0),
            "duration" to info.duration,
            "viewCount" to info.viewCount.coerceAtLeast(0),
            "likeCount" to info.likeCount.coerceAtLeast(0),
            "dislikeCount" to info.dislikeCount.coerceAtLeast(0),
            "description" to (desc?.content ?: ""),
            // Description has no .html in 0.26.x — return content for both
            "descriptionHtml" to (desc?.content ?: ""),
            "uploadDate" to (info.uploadDate?.offsetDateTime()?.toString() ?: ""),
            "textualUploadDate" to (info.textualUploadDate ?: ""),
            "thumbnails" to info.thumbnails.map { imageToMap(it) },
            "streamType" to info.streamType.name,
            "isLive" to (info.streamType == StreamType.LIVE_STREAM || info.streamType == StreamType.AUDIO_LIVE_STREAM),
            "isShortFormContent" to info.isShortFormContent,
            "availability" to (info.contentAvailability?.name ?: "PUBLIC"),
            "ageLimit" to info.ageLimit,
            "tags" to info.tags,
            "category" to (info.category ?: ""),
            "audioStreams" to info.audioStreams.map { audioStreamToMap(it) },
            "videoStreams" to info.videoStreams.map { videoStreamToMap(it) },
            "videoOnlyStreams" to info.videoOnlyStreams.map { videoStreamToMap(it) },
            "dashMpdUrl" to (info.dashMpdUrl ?: ""),
            "hlsUrl" to (info.hlsUrl ?: ""),
            "subtitles" to info.subtitles.map { subtitleToMap(it) },
            "relatedItems" to info.relatedItems.take(20).mapNotNull { infoItemToMap(it) },
            "metaInfo" to info.metaInfo.map { m ->
                mapOf<String, Any>(
                    "title" to (m.title ?: ""),
                    "content" to (m.content?.content ?: ""),
                    "urls" to m.urls.map { it.toString() },
                    "urlTexts" to m.urlTexts
                )
            }
        )
    }

    @Throws(Exception::class, IOException::class)
    private fun getBestStreamUrl(url: String, format: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        val info = StreamInfo.getInfo(extractor)

        val best = when (format.lowercase(Locale.US)) {
            "audio", "mp3", "m4a", "ogg" ->
                info.audioStreams.maxByOrNull { it.averageBitrate }?.content
            "video", "mp4", "best" ->
                info.videoStreams.maxByOrNull { (it.height ?: 0) }?.content
                    ?: info.videoOnlyStreams.maxByOrNull { (it.height ?: 0) }?.content
            "dash" -> info.dashMpdUrl.takeIf { !it.isNullOrEmpty() }
            "hls"  -> info.hlsUrl.takeIf { !it.isNullOrEmpty() }
            else   -> info.audioStreams.maxByOrNull { it.averageBitrate }?.content
        }

        return mapOf<String, Any>(
            "success" to (best != null),
            "url" to (best ?: ""),
            "format" to format,
            "title" to (info.name ?: ""),
            "duration" to info.duration,
            "fallbackUrls" to listOfNotNull(
                info.dashMpdUrl?.takeIf { it.isNotEmpty() },
                info.hlsUrl?.takeIf { it.isNotEmpty() }
            )
        )
    }

    @Throws(Exception::class, IOException::class)
    private fun extractAudioStreams(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        val info = StreamInfo.getInfo(extractor)
        return mapOf<String, Any>(
            "success" to true,
            "title" to (info.name ?: ""),
            "audioStreams" to info.audioStreams.map { audioStreamToMap(it) }
        )
    }

    @Throws(Exception::class, IOException::class)
    private fun extractVideoStreams(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        val info = StreamInfo.getInfo(extractor)
        return mapOf<String, Any>(
            "success" to true,
            "title" to (info.name ?: ""),
            "videoStreams" to info.videoStreams.map { videoStreamToMap(it) },
            "videoOnlyStreams" to info.videoOnlyStreams.map { videoStreamToMap(it) }
        )
    }

    @Throws(Exception::class, IOException::class)
    private fun extractSubtitles(url: String, language: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        val info = StreamInfo.getInfo(extractor)
        val all = info.subtitles
        val filtered = if (language.isNullOrBlank()) all
                       else all.filter { it.languageTag.equals(language, ignoreCase = true) }
        return mapOf<String, Any>(
            "success" to true,
            "title" to (info.name ?: ""),
            "subtitles" to filtered.map { subtitleToMap(it) },
            "availableLanguages" to all.mapNotNull { it.languageTag }.distinct()
        )
    }

    // ── Comments ──────────────────────────────────────────────────────────────

    @Throws(Exception::class, IOException::class)
    private fun extractComments(url: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)

        return if (pageUrl.isNullOrEmpty()) {
            val commentsInfo = CommentsInfo.getInfo(service, url)
            mapOf<String, Any>(
                "success" to true,
                "disabled" to commentsInfo.isCommentsDisabled,
                "commentsCount" to commentsInfo.commentsCount,
                "comments" to commentsInfo.relatedItems.map { commentItemToMap(it) },
                "nextPage" to (commentsInfo.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
                "hasNextPage" to (commentsInfo.nextPage != null),
                "errors" to commentsInfo.errors.map { it.message ?: "" }
            )
        } else {
            val morePage = CommentsInfo.getMoreItems(service, url, Page(pageUrl))
            mapOf<String, Any>(
                "success" to true,
                "comments" to morePage.items.map { commentItemToMap(it) },
                "nextPage" to (morePage.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
                "hasNextPage" to (morePage.nextPage != null),
                "errors" to morePage.errors.map { it.message ?: "" }
            )
        }
    }

    @Throws(Exception::class, IOException::class)
    private fun extractCommentReplies(
        commentsUrl: String,
        repliesPageUrl: String,
        serviceId: Int?
    ): Map<String, Any> {
        val service = resolveService(commentsUrl, serviceId)
        val page = CommentsInfo.getMoreItems(service, commentsUrl, Page(repliesPageUrl))
        return mapOf<String, Any>(
            "success" to true,
            "replies" to page.items.map { commentItemToMap(it) },
            "nextPage" to (page.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
            "hasNextPage" to (page.nextPage != null),
            "errors" to page.errors.map { it.message ?: "" }
        )
    }

    private fun commentItemToMap(item: CommentsInfoItem): Map<String, Any> {
        return mapOf<String, Any>(
            "authorName" to (item.uploaderName ?: ""),
            "authorUrl" to (item.uploaderUrl ?: ""),
            "authorAvatars" to item.uploaderAvatars.map { imageToMap(it) },
            "authorVerified" to item.isUploaderVerified,
            "commentId" to (item.commentId ?: ""),
            "commentText" to (item.commentText?.content ?: ""),
            "commentHtml" to (item.commentText?.content ?: ""),
            "publishedTime" to (item.textualUploadDate ?: ""),
            "publishedTimestamp" to (item.uploadDate?.offsetDateTime()?.toEpochSecond() ?: 0L),
            "likeCount" to item.likeCount.coerceAtLeast(0),
            "textualLikeCount" to (item.textualLikeCount ?: ""),
            "replyCount" to item.replyCount,
            "repliesPageUrl" to (item.replies?.url ?: ""),
            "hasReplies" to (item.replyCount > 0 || item.replies != null),
            "isPinned" to item.isPinned,
            "isHearted" to item.isHeartedByUploader,
            "isChannelOwner" to item.isChannelOwner,
            "hasCreatorReply" to item.hasCreatorReply(),
            "streamPosition" to item.streamPosition
        )
    }

    // ── Search ────────────────────────────────────────────────────────────────

    @Throws(Exception::class, IOException::class)
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
            mapOf<String, Any>(
                "success" to true,
                "query" to (info.searchString ?: ""),
                "suggestion" to (info.searchSuggestion ?: ""),
                "isCorrectedSearch" to info.isCorrectedSearch,
                "results" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to (info.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
                "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message ?: "" }
            )
        } else {
            val more = SearchInfo.getMoreItems(service, handler, Page(pageUrl))
            mapOf<String, Any>(
                "success" to true,
                "results" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to (more.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
                "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message ?: "" }
            )
        }
    }

    @Throws(Exception::class, IOException::class)
    private fun getSearchSuggestions(query: String, serviceId: Int?): List<String> {
        val service = getService(serviceId ?: 0)
        return service.suggestionExtractor.suggestionList(query)
    }

    private fun getAvailableSearchFilters(serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        return mapOf<String, Any>(
            "serviceId" to service.serviceId,
            "serviceName" to service.serviceInfo.name,
            "availableFilters" to service.searchQHFactory.availableContentFilter.toList()
        )
    }

    // ── Playlist ──────────────────────────────────────────────────────────────

    @Throws(Exception::class, IOException::class)
    private fun extractPlaylistInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = PlaylistInfo.getInfo(service, url)
        val desc = info.description
        return mapOf<String, Any>(
            "success" to true,
            "serviceId" to service.serviceId,
            "id" to (info.id ?: ""),
            "url" to (info.url ?: ""),
            "originalUrl" to (info.originalUrl ?: ""),
            "name" to (info.name ?: ""),
            "description" to (desc?.content ?: ""),
            "descriptionHtml" to (desc?.content ?: ""),
            "thumbnails" to info.thumbnails.map { imageToMap(it) },
            "uploaderName" to (info.uploaderName ?: ""),
            "uploaderUrl" to (info.uploaderUrl ?: ""),
            "uploaderAvatars" to info.uploaderAvatars.map { imageToMap(it) },
            "streamCount" to info.streamCount.coerceAtLeast(0),
            "playlistType" to (info.playlistType?.name ?: "NORMAL"),
            "nextPage" to (info.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
            "hasNextPage" to (info.nextPage != null),
            "items" to info.relatedItems.mapNotNull { infoItemToMap(it) },
            "errors" to info.errors.map { it.message ?: "" }
        )
    }

    @Throws(Exception::class, IOException::class)
    private fun extractPlaylistItems(url: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        if (pageUrl.isNullOrEmpty()) {
            val info = PlaylistInfo.getInfo(service, url)
            return mapOf<String, Any>(
                "success" to true,
                "items" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to (info.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
                "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message ?: "" }
            )
        }
        val more = PlaylistInfo.getMoreItems(service, url, Page(pageUrl))
        return mapOf<String, Any>(
            "success" to true,
            "items" to more.items.mapNotNull { infoItemToMap(it) },
            "nextPage" to (more.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
            "hasNextPage" to (more.nextPage != null),
            "errors" to more.errors.map { it.message ?: "" }
        )
    }

    // ── Channel ───────────────────────────────────────────────────────────────

    @Throws(Exception::class, IOException::class)
    private fun extractChannelInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = ChannelInfo.getInfo(service, url)
        val desc = info.description
        return mapOf<String, Any>(
            "success" to true,
            "serviceId" to service.serviceId,
            "id" to (info.id ?: ""),
            "url" to (info.url ?: ""),
            "originalUrl" to (info.originalUrl ?: ""),
            "name" to (info.name ?: ""),
            "description" to (desc?.content ?: ""),
            "descriptionHtml" to (desc?.content ?: ""),
            "avatars" to info.avatars.map { imageToMap(it) },
            "banners" to info.banners.map { imageToMap(it) },
            "feedUrl" to (info.feedUrl ?: ""),
            "subscriberCount" to info.subscriberCount.coerceAtLeast(0),
            "isVerified" to info.isVerified,
            "tabs" to info.tabs.map { tab ->
                mapOf<String, Any>(
                    "name" to tab.name,
                    "contentFilters" to tab.contentFilters,
                    "url" to tab.url
                )
            },
            "nextPage" to (info.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
            "errors" to info.errors.map { it.message ?: "" }
        )
    }

    @Throws(Exception::class, IOException::class)
    private fun extractChannelTabs(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = ChannelInfo.getInfo(service, url)
        return mapOf<String, Any>(
            "success" to true,
            "channelName" to (info.name ?: ""),
            "tabs" to info.tabs.map { tab ->
                mapOf<String, Any>(
                    "name" to tab.name,
                    "contentFilters" to tab.contentFilters,
                    "url" to tab.url
                )
            }
        )
    }

    @Throws(Exception::class, IOException::class)
    private fun extractChannelTabItems(
        channelUrl: String,
        tabFilter: String,
        pageUrl: String?,
        serviceId: Int?
    ): Map<String, Any> {
        val service = resolveService(channelUrl, serviceId)
        val channelInfo = ChannelInfo.getInfo(service, channelUrl)

        val targetTab = channelInfo.tabs.firstOrNull { tab ->
            tab.contentFilters.any { it.equals(tabFilter, ignoreCase = true) }
                || tab.name.equals(tabFilter, ignoreCase = true)
        } ?: throw Exception("No tab matching filter '$tabFilter'")

        return if (pageUrl.isNullOrEmpty()) {
            val tabInfo = ChannelTabInfo.getInfo(service, targetTab)
            mapOf<String, Any>(
                "success" to true,
                "tabName" to targetTab.name,
                "tabFilter" to tabFilter,
                "items" to tabInfo.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to (tabInfo.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
                "hasNextPage" to (tabInfo.nextPage != null),
                "errors" to tabInfo.errors.map { it.message ?: "" }
            )
        } else {
            val more = ChannelTabInfo.getMoreItems(service, targetTab, Page(pageUrl))
            mapOf<String, Any>(
                "success" to true,
                "tabName" to targetTab.name,
                "tabFilter" to tabFilter,
                "items" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to (more.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
                "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message ?: "" }
            )
        }
    }

    @Throws(Exception::class, IOException::class)
    private fun extractChannelFeed(url: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val feedExtractor = service.feedExtractor
            ?: return mapOf<String, Any>(
                "success" to false,
                "error" to "NO_FEED",
                "message" to "No feed available for this service/channel"
            )

        return if (pageUrl.isNullOrEmpty()) {
            val feedInfo = FeedInfo.getInfo(feedExtractor)
            mapOf<String, Any>(
                "success" to true,
                "name" to (feedInfo.name ?: ""),
                "items" to feedInfo.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to (feedInfo.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
                "hasNextPage" to (feedInfo.nextPage != null),
                "errors" to feedInfo.errors.map { it.message ?: "" }
            )
        } else {
            val more = FeedInfo.getMoreItems(service, url, Page(pageUrl))
            mapOf<String, Any>(
                "success" to true,
                "items" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to (more.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
                "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message ?: "" }
            )
        }
    }

    // ── Kiosk ─────────────────────────────────────────────────────────────────

    @Throws(Exception::class, IOException::class)
    private fun listAvailableKiosks(serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        val kioskList = service.kioskList
        val ids = kioskList.availableKiosks
        return mapOf<String, Any>(
            "success" to true,
            "serviceId" to service.serviceId,
            "defaultKioskId" to kioskList.defaultKioskId,
            "kiosks" to ids.map { id ->
                try {
                    val extractor = kioskList.getExtractorById(id, null)
                    mapOf<String, Any>(
                        "id" to id,
                        "name" to extractor.name,
                        "url" to extractor.url,
                        "available" to true
                    )
                } catch (e: Exception) {
                    mapOf<String, Any>(
                        "id" to id,
                        "name" to id,
                        "available" to false,
                        "error" to (e.message ?: "")
                    )
                }
            }
        )
    }

    @Throws(Exception::class, IOException::class)
    private fun extractKioskInfo(kioskId: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        val kioskList = service.kioskList
        val kioskExtractor = kioskList.getExtractorById(kioskId, null)
        val kioskUrl = kioskExtractor.url

        return if (pageUrl.isNullOrEmpty()) {
            val info = KioskInfo.getInfo(service, kioskUrl)
            mapOf<String, Any>(
                "success" to true,
                "kioskId" to kioskId,
                "name" to (info.name ?: ""),
                "items" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to (info.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
                "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message ?: "" }
            )
        } else {
            val more = KioskInfo.getMoreItems(service, kioskUrl, Page(pageUrl))
            mapOf<String, Any>(
                "success" to true,
                "kioskId" to kioskId,
                "items" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to (more.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()),
                "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message ?: "" }
            )
        }
    }

    // ── URL utilities ─────────────────────────────────────────────────────────

    @Throws(Exception::class)
    private fun resolveUrl(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val linkType = service.getLinkTypeByUrl(url)
        val id = when (linkType) {
            StreamingService.LinkType.STREAM   -> service.streamLHFactory.fromUrl(url).id
            StreamingService.LinkType.CHANNEL  -> service.channelLHFactory.fromUrl(url).id
            StreamingService.LinkType.PLAYLIST -> service.playlistLHFactory.fromUrl(url).id
            StreamingService.LinkType.NONE     -> throw Exception("URL not handled: $url")
        }
        return mapOf<String, Any>(
            "type" to linkType.name.lowercase(Locale.US),
            "id" to id,
            "url" to url,
            "serviceId" to service.serviceId,
            "serviceName" to service.serviceInfo.name
        )
    }

    @Throws(Exception::class)
    private fun checkCanHandle(url: String, serviceId: Int?): Map<String, Any> {
        val service = serviceId?.let { getService(it) } ?: run {
            val match = ServiceList.all().firstOrNull { s ->
                try { s.getLinkTypeByUrl(url) != StreamingService.LinkType.NONE } catch (_: Exception) { false }
            }
            return mapOf<String, Any>(
                "canHandle" to (match != null),
                "serviceId" to (match?.serviceId ?: -1),
                "serviceName" to (match?.serviceInfo?.name ?: ""),
                "url" to url
            )
        }
        val linkType = service.getLinkTypeByUrl(url)
        return mapOf<String, Any>(
            "canHandle" to (linkType != StreamingService.LinkType.NONE),
            "linkType" to linkType.name.lowercase(Locale.US),
            "serviceId" to service.serviceId,
            "url" to url
        )
    }

    @Throws(Exception::class)
    private fun extractIdFromUrl(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val linkType = service.getLinkTypeByUrl(url)
        val id = when (linkType) {
            StreamingService.LinkType.STREAM   -> service.streamLHFactory.fromUrl(url).id
            StreamingService.LinkType.CHANNEL  -> service.channelLHFactory.fromUrl(url).id
            StreamingService.LinkType.PLAYLIST -> service.playlistLHFactory.fromUrl(url).id
            StreamingService.LinkType.NONE     -> throw Exception("Cannot extract ID: $url")
        }
        return mapOf<String, Any>(
            "id" to id,
            "type" to linkType.name.lowercase(Locale.US),
            "url" to url,
            "serviceId" to service.serviceId
        )
    }

    // ── InfoItem mapper ───────────────────────────────────────────────────────

    private fun infoItemToMap(item: InfoItem): Map<String, Any>? = when (item) {
        is StreamInfoItem -> mapOf<String, Any>(
            "type" to "stream",
            "serviceId" to item.serviceId,
            "url" to item.url,
            "name" to (item.name ?: ""),
            "uploaderName" to (item.uploaderName ?: ""),
            "uploaderUrl" to (item.uploaderUrl ?: ""),
            "uploaderVerified" to item.isUploaderVerified,
            "thumbnails" to item.thumbnails.map { imageToMap(it) },
            "duration" to (item.duration ?: 0L),
            "viewCount" to (item.viewCount ?: 0L),
            "textualUploadDate" to (item.textualUploadDate ?: ""),
            "streamType" to item.streamType.name,
            "isLive" to (item.streamType == StreamType.LIVE_STREAM || item.streamType == StreamType.AUDIO_LIVE_STREAM),
            "isShortFormContent" to item.isShortFormContent
        )
        is PlaylistInfoItem -> mapOf<String, Any>(
            "type" to "playlist",
            "serviceId" to item.serviceId,
            "url" to item.url,
            "name" to (item.name ?: ""),
            "uploaderName" to (item.uploaderName ?: ""),
            "uploaderUrl" to (item.uploaderUrl ?: ""),
            "thumbnails" to item.thumbnails.map { imageToMap(it) },
            "streamCount" to (item.streamCount ?: 0L),
            "playlistType" to (item.playlistType?.name ?: "NORMAL")
        )
        is ChannelInfoItem -> mapOf<String, Any>(
            "type" to "channel",
            "serviceId" to item.serviceId,
            "url" to item.url,
            "name" to (item.name ?: ""),
            "thumbnails" to item.thumbnails.map { imageToMap(it) },
            "subscriberCount" to (item.subscriberCount ?: 0L),
            "isVerified" to item.isVerified,
            "description" to (item.description ?: "")
        )
        else -> null
    }

    // ── Stream mappers ────────────────────────────────────────────────────────

    private fun audioStreamToMap(s: AudioStream): Map<String, Any> = mapOf<String, Any>(
        "url" to (s.content ?: ""),
        "isUrl" to s.isUrl,
        "deliveryMethod" to s.deliveryMethod.name,
        "format" to (s.format?.name ?: ""),
        "codec" to (s.codec ?: ""),
        "averageBitrate" to s.averageBitrate,
        "audioTrackId" to (s.audioTrackId ?: ""),
        "audioTrackName" to (s.audioTrackName ?: ""),
        "audioLocale" to (s.audioLocale?.toLanguageTag() ?: ""),
        "manifestUrl" to (s.manifestUrl ?: "")
    )

    private fun videoStreamToMap(s: VideoStream): Map<String, Any> = mapOf<String, Any>(
        "url" to (s.content ?: ""),
        "isUrl" to s.isUrl,
        "deliveryMethod" to s.deliveryMethod.name,
        "format" to (s.format?.name ?: ""),
        "codec" to (s.codec ?: ""),
        "width" to (s.width ?: 0),
        "height" to (s.height ?: 0),
        "fps" to (s.fps ?: 0),
        "bitrate" to s.bitrate,
        "manifestUrl" to (s.manifestUrl ?: ""),
        "quality" to (s.quality ?: "")
    )

    private fun subtitleToMap(s: SubtitlesStream): Map<String, Any> = mapOf<String, Any>(
        "url" to (s.content ?: ""),
        "isUrl" to s.isUrl,
        "deliveryMethod" to s.deliveryMethod.name,
        "format" to (s.format?.name ?: ""),
        "languageTag" to (s.languageTag ?: ""),
        "displayLanguageName" to (s.displayLanguageName ?: ""),
        "isAutoGenerated" to s.isAutoGenerated,
        "manifestUrl" to (s.manifestUrl ?: "")
    )

    private fun imageToMap(img: Image): Map<String, Any> = mapOf<String, Any>(
        "url" to img.url,
        "width" to img.width,
        "height" to img.height,
        "resolutionLevel" to img.estimatedResolutionLevel.name
    )

    private fun pageToMap(p: Page): Map<String, Any> = mapOf<String, Any>(
        "url" to (p.url ?: ""),
        "ids" to p.ids,
        "cookies" to p.cookies
    )

    // ── Downloader ────────────────────────────────────────────────────────────

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