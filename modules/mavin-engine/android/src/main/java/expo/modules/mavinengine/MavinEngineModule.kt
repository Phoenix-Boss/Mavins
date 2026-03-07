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
import org.schabi.newpipe.extractor.description.Description
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.*
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
            ensureInit(); extractStreamInfo(url, serviceId)
        }
        AsyncFunction("getStreamInfoById") { videoId: String, serviceId: Int? ->
            ensureInit(); extractStreamInfoById(videoId, serviceId)
        }
        AsyncFunction("getStreamUrl") { url: String, format: String?, serviceId: Int? ->
            ensureInit(); getBestStreamUrl(url, format ?: "best", serviceId)
        }
        AsyncFunction("getAudioStreams") { url: String, serviceId: Int? ->
            ensureInit(); extractAudioStreams(url, serviceId)
        }
        AsyncFunction("getVideoStreams") { url: String, serviceId: Int? ->
            ensureInit(); extractVideoStreams(url, serviceId)
        }
        AsyncFunction("getSubtitles") { url: String, language: String?, serviceId: Int? ->
            ensureInit(); extractSubtitles(url, language, serviceId)
        }
        AsyncFunction("getComments") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit(); extractComments(url, pageUrl, serviceId)
        }
        AsyncFunction("getCommentReplies") { commentsUrl: String, repliesPageUrl: String, serviceId: Int? ->
            ensureInit(); extractCommentReplies(commentsUrl, repliesPageUrl, serviceId)
        }
        AsyncFunction("search") { query: String, filter: String?, pageUrl: String?, serviceId: Int? ->
            ensureInit(); performSearch(query, filter ?: "all", pageUrl, serviceId)
        }
        AsyncFunction("getSearchSuggestions") { query: String, serviceId: Int? ->
            ensureInit(); getSearchSuggestions(query, serviceId)
        }
        AsyncFunction("getSearchFilters") { serviceId: Int? ->
            ensureInit(); getAvailableSearchFilters(serviceId)
        }
        AsyncFunction("getPlaylistInfo") { url: String, serviceId: Int? ->
            ensureInit(); extractPlaylistInfo(url, serviceId)
        }
        AsyncFunction("getPlaylistItems") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit(); extractPlaylistItems(url, pageUrl, serviceId)
        }
        AsyncFunction("getChannelInfo") { url: String, serviceId: Int? ->
            ensureInit(); extractChannelInfo(url, serviceId)
        }
        AsyncFunction("getChannelTabs") { url: String, serviceId: Int? ->
            ensureInit(); extractChannelTabs(url, serviceId)
        }
        AsyncFunction("getChannelTabItems") { url: String, tabFilter: String, pageUrl: String?, serviceId: Int? ->
            ensureInit(); extractChannelTabItems(url, tabFilter, pageUrl, serviceId)
        }
        AsyncFunction("getChannelFeed") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit(); extractChannelFeed(url, pageUrl, serviceId)
        }
        AsyncFunction("getKioskList") { serviceId: Int? ->
            ensureInit(); listAvailableKiosks(serviceId)
        }
        AsyncFunction("getKioskInfo") { kioskId: String, pageUrl: String?, serviceId: Int? ->
            ensureInit(); extractKioskInfo(kioskId, pageUrl, serviceId)
        }
        AsyncFunction("getTrending") { serviceId: Int? ->
            ensureInit(); extractKioskInfo("Trending", null, serviceId)
        }
        AsyncFunction("getMostPopular") { serviceId: Int? ->
            ensureInit(); extractKioskInfo("Most Popular", null, serviceId)
        }
        AsyncFunction("resolveUrl") { url: String, serviceId: Int? ->
            ensureInit(); resolveUrl(url, serviceId)
        }
        AsyncFunction("canHandleUrl") { url: String, serviceId: Int? ->
            ensureInit(); checkCanHandle(url, serviceId)
        }
        AsyncFunction("extractIdFromUrl") { url: String, serviceId: Int? ->
            ensureInit(); extractIdFromUrl(url, serviceId)
        }
        AsyncFunction("ping") {
            mapOf("alive" to true, "version" to VERSION, "timestamp" to System.currentTimeMillis())
        }
        AsyncFunction("emergencyReset") { resetNewPipe() }
        AsyncFunction("getVersion") {
            mapOf("version" to VERSION, "library" to "NewPipeExtractor 0.26.0")
        }
    }

    // ── Init ──────────────────────────────────────────────────────────────────

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

    private fun ensureInit() { if (!isInitialized) initializeNewPipe() }

    private fun resetNewPipe(): Map<String, Any> {
        isInitialized = false
        initializeNewPipe()
        return mapOf("success" to true, "message" to "NewPipe reset and re-initialised")
    }

    // ── Service helpers ───────────────────────────────────────────────────────

    private fun getService(serviceId: Int?): StreamingService {
        val all = ServiceList.all()
        return if (serviceId != null) {
            all.firstOrNull { it.serviceId == serviceId }
                ?: throw Exception("No service with id=$serviceId")
        } else {
            all.firstOrNull { it.serviceId == 0 } ?: all.firstOrNull()
                ?: throw Exception("No streaming services registered")
        }
    }

    private fun getServiceForUrl(url: String): StreamingService =
        ServiceList.all().firstOrNull { s ->
            try { s.getLinkTypeByUrl(url) != StreamingService.LinkType.NONE } catch (_: Exception) { false }
        } ?: throw Exception("No service can handle URL: $url")

    private fun resolveService(url: String, serviceId: Int?): StreamingService =
        serviceId?.let { getService(it) } ?: getServiceForUrl(url)

    private fun getServicesList(): List<Map<String, Any>> {
        if (!isInitialized) return emptyList()
        return ServiceList.all().map { s ->
            mapOf(
                "id"                 to s.serviceId,
                "name"               to s.serviceInfo.name,
                "baseUrl"            to (s.baseUrl ?: ""),
                "mediaCapabilities"  to s.serviceInfo.mediaCapabilities.map { it.name }
            )
        }
    }

    // ── Description helper ────────────────────────────────────────────────────
    // Description.content is the only text accessor in v0.26.0.
    // The parameter type is the concrete Description class from the extractor.
    private fun descText(d: Description?): String = d?.content ?: ""

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
        val result = mutableMapOf<String, Any>()
        result["success"]                 = true
        result["serviceId"]               = info.serviceId
        result["id"]                      = (info.id ?: "")
        result["url"]                     = (info.url ?: "")
        result["originalUrl"]             = (info.originalUrl ?: "")
        result["title"]                   = (info.name ?: "")
        result["uploaderName"]            = (info.uploaderName ?: "")
        result["uploaderUrl"]             = (info.uploaderUrl ?: "")
        result["uploaderAvatars"]         = info.uploaderAvatars.map { imageToMap(it) }
        result["uploaderVerified"]        = info.isUploaderVerified
        result["uploaderSubscriberCount"] = info.uploaderSubscriberCount.coerceAtLeast(0)
        result["duration"]                = info.duration
        result["viewCount"]               = info.viewCount.coerceAtLeast(0)
        result["likeCount"]               = info.likeCount.coerceAtLeast(0)
        result["dislikeCount"]            = info.dislikeCount.coerceAtLeast(0)
        result["description"]             = descText(info.description)
        result["descriptionHtml"]         = descText(info.description)
        result["uploadDate"]              = (info.uploadDate?.offsetDateTime()?.toString() ?: "")
        result["textualUploadDate"]       = (info.textualUploadDate ?: "")
        result["thumbnails"]              = info.thumbnails.map { imageToMap(it) }
        result["streamType"]              = info.streamType.name
        result["isLive"]                  = (info.streamType == StreamType.LIVE_STREAM || info.streamType == StreamType.AUDIO_LIVE_STREAM)
        result["isShortFormContent"]      = info.isShortFormContent
        result["availability"]            = (info.contentAvailability?.name ?: "PUBLIC")
        result["ageLimit"]                = info.ageLimit
        result["tags"]                    = info.tags
        result["category"]                = (info.category ?: "")
        result["audioStreams"]            = info.audioStreams.map { audioStreamToMap(it) }
        result["videoStreams"]            = info.videoStreams.map { videoStreamToMap(it) }
        result["videoOnlyStreams"]        = info.videoOnlyStreams.map { videoStreamToMap(it) }
        result["dashMpdUrl"]              = (info.dashMpdUrl ?: "")
        result["hlsUrl"]                  = (info.hlsUrl ?: "")
        result["subtitles"]               = info.subtitles.map { subtitleToMap(it) }
        result["relatedItems"]            = info.relatedItems.take(20).mapNotNull { infoItemToMap(it) }
        result["metaInfo"]                = info.metaInfo.map { m ->
            mapOf(
                "title"    to (m.title ?: ""),
                "content"  to (m.content?.content ?: ""),
                "urls"     to m.urls.map { u -> u.toString() },
                "urlTexts" to m.urlTexts
            )
        }
        return result
    }

    @Throws(Exception::class, IOException::class)
    private fun getBestStreamUrl(url: String, format: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        val info = StreamInfo.getInfo(extractor)
        val best = when (format.lowercase(Locale.US)) {
            "audio", "mp3", "m4a", "ogg" -> info.audioStreams.maxByOrNull { it.averageBitrate }?.content
            "video", "mp4", "best"        -> info.videoStreams.maxByOrNull { it.height ?: 0 }?.content
                                                ?: info.videoOnlyStreams.maxByOrNull { it.height ?: 0 }?.content
            "dash" -> info.dashMpdUrl.takeIf { !it.isNullOrEmpty() }
            "hls"  -> info.hlsUrl.takeIf { !it.isNullOrEmpty() }
            else   -> info.audioStreams.maxByOrNull { it.averageBitrate }?.content
        }
        return mapOf(
            "success"      to (best != null),
            "url"          to (best ?: ""),
            "format"       to format,
            "title"        to (info.name ?: ""),
            "duration"     to info.duration,
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
        return mapOf(
            "success"      to true,
            "title"        to (info.name ?: ""),
            "audioStreams" to info.audioStreams.map { audioStreamToMap(it) }
        )
    }

    @Throws(Exception::class, IOException::class)
    private fun extractVideoStreams(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val extractor = service.getStreamExtractor(url)
        extractor.fetchPage()
        val info = StreamInfo.getInfo(extractor)
        return mapOf(
            "success"          to true,
            "title"            to (info.name ?: ""),
            "videoStreams"     to info.videoStreams.map { videoStreamToMap(it) },
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
        return mapOf(
            "success"            to true,
            "title"              to (info.name ?: ""),
            "subtitles"          to filtered.map { subtitleToMap(it) },
            "availableLanguages" to all.mapNotNull { it.languageTag }.distinct()
        )
    }

    // ── Comments ──────────────────────────────────────────────────────────────

    @Throws(Exception::class, IOException::class)
    private fun extractComments(url: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val result = mutableMapOf<String, Any>()
        if (pageUrl.isNullOrEmpty()) {
            val info = CommentsInfo.getInfo(service, url)
            result["success"]       = true
            result["disabled"]      = info.isCommentsDisabled
            result["commentsCount"] = info.commentsCount
            result["comments"]      = info.relatedItems.map { commentItemToMap(it) }
            result["nextPage"]      = info.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
            result["hasNextPage"]   = info.nextPage != null
            result["errors"]        = info.errors.map { it.message ?: "" }
        } else {
            val more = CommentsInfo.getMoreItems(service, url, Page(pageUrl))
            result["success"]     = true
            result["comments"]    = more.items.map { commentItemToMap(it) }
            result["nextPage"]    = more.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
            result["hasNextPage"] = more.nextPage != null
            result["errors"]      = more.errors.map { it.message ?: "" }
        }
        return result
    }

    @Throws(Exception::class, IOException::class)
    private fun extractCommentReplies(commentsUrl: String, repliesPageUrl: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(commentsUrl, serviceId)
        val page = CommentsInfo.getMoreItems(service, commentsUrl, Page(repliesPageUrl))
        val result = mutableMapOf<String, Any>()
        result["success"]     = true
        result["replies"]     = page.items.map { commentItemToMap(it) }
        result["nextPage"]    = page.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
        result["hasNextPage"] = page.nextPage != null
        result["errors"]      = page.errors.map { it.message ?: "" }
        return result
    }

    private fun commentItemToMap(item: CommentsInfoItem): Map<String, Any> {
        val result = mutableMapOf<String, Any>()
        result["authorName"]         = (item.uploaderName ?: "")
        result["authorUrl"]          = (item.uploaderUrl ?: "")
        result["authorAvatars"]      = item.uploaderAvatars.map { imageToMap(it) }
        result["authorVerified"]     = item.isUploaderVerified
        result["commentId"]          = (item.commentId ?: "")
        result["commentText"]        = (item.commentText?.content ?: "")
        result["commentHtml"]        = (item.commentText?.content ?: "")
        result["publishedTime"]      = (item.textualUploadDate ?: "")
        result["publishedTimestamp"] = (item.uploadDate?.offsetDateTime()?.toEpochSecond() ?: 0L)
        result["likeCount"]          = item.likeCount.coerceAtLeast(0)
        result["textualLikeCount"]   = (item.textualLikeCount ?: "")
        result["replyCount"]         = item.replyCount
        result["repliesPageUrl"]     = (item.replies?.url ?: "")
        result["hasReplies"]         = (item.replyCount > 0 || item.replies != null)
        result["isPinned"]           = item.isPinned
        result["isHearted"]          = item.isHeartedByUploader
        result["isChannelOwner"]     = item.isChannelOwner
        result["hasCreatorReply"]    = item.hasCreatorReply()
        result["streamPosition"]     = item.streamPosition
        return result
    }

    // ── Search ────────────────────────────────────────────────────────────────

    @Throws(Exception::class, IOException::class)
    private fun performSearch(query: String, filter: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        val handler = service.searchQHFactory.fromQuery(query, listOf(filter), "")
        val result = mutableMapOf<String, Any>()
        if (pageUrl.isNullOrEmpty()) {
            val info = SearchInfo.getInfo(service, handler)
            result["success"]           = true
            result["query"]             = (info.searchString ?: "")
            result["suggestion"]        = (info.searchSuggestion ?: "")
            result["isCorrectedSearch"] = info.isCorrectedSearch
            result["results"]           = info.relatedItems.mapNotNull { infoItemToMap(it) }
            result["nextPage"]          = info.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
            result["hasNextPage"]       = info.nextPage != null
            result["errors"]            = info.errors.map { it.message ?: "" }
        } else {
            val more = SearchInfo.getMoreItems(service, handler, Page(pageUrl))
            result["success"]     = true
            result["results"]     = more.items.mapNotNull { infoItemToMap(it) }
            result["nextPage"]    = more.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
            result["hasNextPage"] = more.nextPage != null
            result["errors"]      = more.errors.map { it.message ?: "" }
        }
        return result
    }

    @Throws(Exception::class, IOException::class)
    private fun getSearchSuggestions(query: String, serviceId: Int?): List<String> =
        getService(serviceId ?: 0).suggestionExtractor.suggestionList(query)

    private fun getAvailableSearchFilters(serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        return mapOf(
            "serviceId"        to service.serviceId,
            "serviceName"      to service.serviceInfo.name,
            "availableFilters" to service.searchQHFactory.availableContentFilter.toList()
        )
    }

    // ── Playlist ──────────────────────────────────────────────────────────────

    @Throws(Exception::class, IOException::class)
    private fun extractPlaylistInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = PlaylistInfo.getInfo(service, url)
        val result = mutableMapOf<String, Any>()
        result["success"]         = true
        result["serviceId"]       = service.serviceId
        result["id"]              = (info.id ?: "")
        result["url"]             = (info.url ?: "")
        result["originalUrl"]     = (info.originalUrl ?: "")
        result["name"]            = (info.name ?: "")
        result["description"]     = descText(info.description)
        result["descriptionHtml"] = descText(info.description)
        result["thumbnails"]      = info.thumbnails.map { imageToMap(it) }
        result["uploaderName"]    = (info.uploaderName ?: "")
        result["uploaderUrl"]     = (info.uploaderUrl ?: "")
        result["uploaderAvatars"] = info.uploaderAvatars.map { imageToMap(it) }
        result["streamCount"]     = info.streamCount.coerceAtLeast(0)
        result["playlistType"]    = (info.playlistType?.name ?: "NORMAL")
        result["nextPage"]        = info.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
        result["hasNextPage"]     = info.nextPage != null
        result["items"]           = info.relatedItems.mapNotNull { infoItemToMap(it) }
        result["errors"]          = info.errors.map { it.message ?: "" }
        return result
    }

    @Throws(Exception::class, IOException::class)
    private fun extractPlaylistItems(url: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val result = mutableMapOf<String, Any>()
        if (pageUrl.isNullOrEmpty()) {
            val info = PlaylistInfo.getInfo(service, url)
            result["success"]     = true
            result["items"]       = info.relatedItems.mapNotNull { infoItemToMap(it) }
            result["nextPage"]    = info.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
            result["hasNextPage"] = info.nextPage != null
            result["errors"]      = info.errors.map { it.message ?: "" }
        } else {
            val more = PlaylistInfo.getMoreItems(service, url, Page(pageUrl))
            result["success"]     = true
            result["items"]       = more.items.mapNotNull { infoItemToMap(it) }
            result["nextPage"]    = more.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
            result["hasNextPage"] = more.nextPage != null
            result["errors"]      = more.errors.map { it.message ?: "" }
        }
        return result
    }

    // ── Channel ───────────────────────────────────────────────────────────────

    @Throws(Exception::class, IOException::class)
    private fun extractChannelInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = ChannelInfo.getInfo(service, url)
        val result = mutableMapOf<String, Any>()
        result["success"]         = true
        result["serviceId"]       = service.serviceId
        result["id"]              = (info.id ?: "")
        result["url"]             = (info.url ?: "")
        result["originalUrl"]     = (info.originalUrl ?: "")
        result["name"]            = (info.name ?: "")
        result["description"]     = descText(info.description)
        result["descriptionHtml"] = descText(info.description)
        result["avatars"]         = info.avatars.map { imageToMap(it) }
        result["banners"]         = info.banners.map { imageToMap(it) }
        result["feedUrl"]         = (info.feedUrl ?: "")
        result["subscriberCount"] = info.subscriberCount.coerceAtLeast(0)
        result["isVerified"]      = info.isVerified
        result["tabs"]            = info.tabs.map { tab ->
            mapOf("name" to tab.name, "contentFilters" to tab.contentFilters, "url" to tab.url)
        }
        result["nextPage"]        = info.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
        result["errors"]          = info.errors.map { it.message ?: "" }
        return result
    }

    @Throws(Exception::class, IOException::class)
    private fun extractChannelTabs(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = ChannelInfo.getInfo(service, url)
        return mapOf(
            "success"     to true,
            "channelName" to (info.name ?: ""),
            "tabs"        to info.tabs.map { tab ->
                mapOf("name" to tab.name, "contentFilters" to tab.contentFilters, "url" to tab.url)
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

        val result = mutableMapOf<String, Any>()
        result["tabName"]   = targetTab.name
        result["tabFilter"] = tabFilter

        if (pageUrl.isNullOrEmpty()) {
            // ChannelTabInfo.getInfo() takes the ListLinkHandler (tab object) directly
            val tabInfo = ChannelTabInfo.getInfo(service, targetTab)
            result["success"]     = true
            result["items"]       = tabInfo.relatedItems.mapNotNull { infoItemToMap(it) }
            result["nextPage"]    = tabInfo.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
            result["hasNextPage"] = tabInfo.nextPage != null
            result["errors"]      = tabInfo.errors.map { it.message ?: "" }
        } else {
            val more = ChannelTabInfo.getMoreItems(service, targetTab, Page(pageUrl))
            result["success"]     = true
            result["items"]       = more.items.mapNotNull { infoItemToMap(it) }
            result["nextPage"]    = more.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
            result["hasNextPage"] = more.nextPage != null
            result["errors"]      = more.errors.map { it.message ?: "" }
        }
        return result
    }

    /**
     * Channel feed implemented via the "videos" / "uploads" tab.
     * StreamingService.feedExtractor and FeedInfo.getMoreItems were removed
     * in NewPipe Extractor v0.24+; this is the correct approach for v0.26.0.
     */
    @Throws(Exception::class, IOException::class)
    private fun extractChannelFeed(url: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val channelInfo = ChannelInfo.getInfo(service, url)

        val feedTab = channelInfo.tabs.firstOrNull { tab ->
            tab.contentFilters.any { f ->
                f.equals("videos", ignoreCase = true) || f.equals("uploads", ignoreCase = true)
            }
        } ?: channelInfo.tabs.firstOrNull()
            ?: return mapOf(
                "success" to false,
                "error"   to "NO_FEED",
                "message" to "Channel has no tabs available"
            )

        val result = mutableMapOf<String, Any>()
        if (pageUrl.isNullOrEmpty()) {
            val tabInfo = ChannelTabInfo.getInfo(service, feedTab)
            result["success"]     = true
            result["name"]        = (channelInfo.name ?: "")
            result["items"]       = tabInfo.relatedItems.mapNotNull { infoItemToMap(it) }
            result["nextPage"]    = tabInfo.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
            result["hasNextPage"] = tabInfo.nextPage != null
            result["errors"]      = tabInfo.errors.map { it.message ?: "" }
        } else {
            val more = ChannelTabInfo.getMoreItems(service, feedTab, Page(pageUrl))
            result["success"]     = true
            result["items"]       = more.items.mapNotNull { infoItemToMap(it) }
            result["nextPage"]    = more.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
            result["hasNextPage"] = more.nextPage != null
            result["errors"]      = more.errors.map { it.message ?: "" }
        }
        return result
    }

    // ── Kiosk ─────────────────────────────────────────────────────────────────

    @Throws(Exception::class, IOException::class)
    private fun listAvailableKiosks(serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        val kioskList = service.kioskList
        return mapOf(
            "success"        to true,
            "serviceId"      to service.serviceId,
            "defaultKioskId" to kioskList.defaultKioskId,
            "kiosks"         to kioskList.availableKiosks.map { id ->
                try {
                    val extractor = kioskList.getExtractorById(id, null)
                    mapOf("id" to id, "name" to extractor.name, "url" to extractor.url, "available" to true)
                } catch (e: Exception) {
                    mapOf("id" to id, "name" to id, "available" to false, "error" to (e.message ?: ""))
                }
            }
        )
    }

    @Throws(Exception::class, IOException::class)
    private fun extractKioskInfo(kioskId: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = getService(serviceId ?: 0)
        val kioskExtractor = service.kioskList.getExtractorById(kioskId, null)
        val kioskUrl = kioskExtractor.url
        val result = mutableMapOf<String, Any>()
        result["kioskId"] = kioskId

        if (pageUrl.isNullOrEmpty()) {
            val info = KioskInfo.getInfo(service, kioskUrl)
            result["success"]     = true
            result["name"]        = (info.name ?: "")
            result["items"]       = info.relatedItems.mapNotNull { infoItemToMap(it) }
            result["nextPage"]    = info.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
            result["hasNextPage"] = info.nextPage != null
            result["errors"]      = info.errors.map { it.message ?: "" }
        } else {
            val more = KioskInfo.getMoreItems(service, kioskUrl, Page(pageUrl))
            result["success"]     = true
            result["items"]       = more.items.mapNotNull { infoItemToMap(it) }
            result["nextPage"]    = more.nextPage?.let { pageToMap(it) } ?: emptyMap<String, Any>()
            result["hasNextPage"] = more.nextPage != null
            result["errors"]      = more.errors.map { it.message ?: "" }
        }
        return result
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
        return mapOf(
            "type"        to linkType.name.lowercase(Locale.US),
            "id"          to id,
            "url"         to url,
            "serviceId"   to service.serviceId,
            "serviceName" to service.serviceInfo.name
        )
    }

    @Throws(Exception::class)
    private fun checkCanHandle(url: String, serviceId: Int?): Map<String, Any> {
        val explicitService = serviceId?.let { getService(it) }
        if (explicitService == null) {
            val match = ServiceList.all().firstOrNull { s ->
                try { s.getLinkTypeByUrl(url) != StreamingService.LinkType.NONE } catch (_: Exception) { false }
            }
            return mapOf(
                "canHandle"   to (match != null),
                "serviceId"   to (match?.serviceId ?: -1),
                "serviceName" to (match?.serviceInfo?.name ?: ""),
                "url"         to url
            )
        }
        val linkType = explicitService.getLinkTypeByUrl(url)
        return mapOf(
            "canHandle"  to (linkType != StreamingService.LinkType.NONE),
            "linkType"   to linkType.name.lowercase(Locale.US),
            "serviceId"  to explicitService.serviceId,
            "url"        to url
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
        return mapOf(
            "id"        to id,
            "type"      to linkType.name.lowercase(Locale.US),
            "url"       to url,
            "serviceId" to service.serviceId
        )
    }

    // ── InfoItem mapper ───────────────────────────────────────────────────────

    private fun infoItemToMap(item: InfoItem): Map<String, Any>? {
        return when (item) {
            is StreamInfoItem -> {
                val r = mutableMapOf<String, Any>()
                r["type"]               = "stream"
                r["serviceId"]          = item.serviceId
                r["url"]                = item.url
                r["name"]               = (item.name ?: "")
                r["uploaderName"]       = (item.uploaderName ?: "")
                r["uploaderUrl"]        = (item.uploaderUrl ?: "")
                r["uploaderVerified"]   = item.isUploaderVerified
                r["thumbnails"]         = item.thumbnails.map { imageToMap(it) }
                r["duration"]           = (item.duration ?: 0L)
                r["viewCount"]          = (item.viewCount ?: 0L)
                r["textualUploadDate"]  = (item.textualUploadDate ?: "")
                r["streamType"]         = item.streamType.name
                r["isLive"]             = (item.streamType == StreamType.LIVE_STREAM || item.streamType == StreamType.AUDIO_LIVE_STREAM)
                r["isShortFormContent"] = item.isShortFormContent
                r
            }
            is PlaylistInfoItem -> {
                val r = mutableMapOf<String, Any>()
                r["type"]         = "playlist"
                r["serviceId"]    = item.serviceId
                r["url"]          = item.url
                r["name"]         = (item.name ?: "")
                r["uploaderName"] = (item.uploaderName ?: "")
                r["uploaderUrl"]  = (item.uploaderUrl ?: "")
                r["thumbnails"]   = item.thumbnails.map { imageToMap(it) }
                r["streamCount"]  = (item.streamCount ?: 0L)
                r["playlistType"] = (item.playlistType?.name ?: "NORMAL")
                r
            }
            is ChannelInfoItem -> {
                val r = mutableMapOf<String, Any>()
                r["type"]            = "channel"
                r["serviceId"]       = item.serviceId
                r["url"]             = item.url
                r["name"]            = (item.name ?: "")
                r["thumbnails"]      = item.thumbnails.map { imageToMap(it) }
                r["subscriberCount"] = (item.subscriberCount ?: 0L)
                r["isVerified"]      = item.isVerified
                r["description"]     = (item.description ?: "")
                r
            }
            else -> null
        }
    }

    // ── Stream mappers ────────────────────────────────────────────────────────

    private fun audioStreamToMap(s: AudioStream): Map<String, Any> = mapOf(
        "url"            to (s.content ?: ""),
        "isUrl"          to s.isUrl,
        "deliveryMethod" to s.deliveryMethod.name,
        "format"         to (s.format?.name ?: ""),
        "codec"          to (s.codec ?: ""),
        "averageBitrate" to s.averageBitrate,
        "audioTrackId"   to (s.audioTrackId ?: ""),
        "audioTrackName" to (s.audioTrackName ?: ""),
        "audioLocale"    to (s.audioLocale?.toLanguageTag() ?: ""),
        "manifestUrl"    to (s.manifestUrl ?: "")
    )

    private fun videoStreamToMap(s: VideoStream): Map<String, Any> = mapOf(
        "url"            to (s.content ?: ""),
        "isUrl"          to s.isUrl,
        "deliveryMethod" to s.deliveryMethod.name,
        "format"         to (s.format?.name ?: ""),
        "codec"          to (s.codec ?: ""),
        "width"          to (s.width ?: 0),
        "height"         to (s.height ?: 0),
        "fps"            to (s.fps ?: 0),
        "bitrate"        to s.bitrate,
        "manifestUrl"    to (s.manifestUrl ?: ""),
        "quality"        to (s.quality ?: "")
    )

    private fun subtitleToMap(s: SubtitlesStream): Map<String, Any> = mapOf(
        "url"                 to (s.content ?: ""),
        "isUrl"               to s.isUrl,
        "deliveryMethod"      to s.deliveryMethod.name,
        "format"              to (s.format?.name ?: ""),
        "languageTag"         to (s.languageTag ?: ""),
        "displayLanguageName" to (s.displayLanguageName ?: ""),
        "isAutoGenerated"     to s.isAutoGenerated,
        "manifestUrl"         to (s.manifestUrl ?: "")
    )

    private fun imageToMap(img: Image): Map<String, Any> = mapOf(
        "url"             to img.url,
        "width"           to img.width,
        "height"          to img.height,
        "resolutionLevel" to img.estimatedResolutionLevel.name
    )

    private fun pageToMap(p: Page): Map<String, Any> = mapOf(
        "url"     to (p.url ?: ""),
        "ids"     to p.ids,
        "cookies" to p.cookies
    )

    // ── Downloader ────────────────────────────────────────────────────────────

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