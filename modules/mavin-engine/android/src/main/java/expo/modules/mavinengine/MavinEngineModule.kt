@file:Suppress("unused", "MemberVisibilityCanBePrivate")
package expo.modules.mavinengine

import android.util.Log
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.ConnectionPool
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
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
import org.schabi.newpipe.extractor.linkhandler.ListLinkHandler
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.playlist.PlaylistInfo
import org.schabi.newpipe.extractor.playlist.PlaylistInfoItem
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.services.youtube.InnertubeClientRequestInfo
import org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper
import org.schabi.newpipe.extractor.stream.*
import org.schabi.newpipe.extractor.stream.StreamType.*
import java.io.IOException
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * MavinEngine — NewPipe Extractor v0.26.0 Integration
 * v10.0.0 — Deep-research architecture pass (March 2026)
 *
 * ── v10.0.0 research-backed changes ─────────────────────────────────────────
 *
 * [A] MavinDownloader — Official NewPipe pattern (matches TeamNewPipe/NewPipe DownloaderImpl):
 *     • execute() is a clean pass-through: forward the request headers exactly as provided
 *       by NewPipe's extractors; add a User-Agent only if one is absent.
 *     • Cookie injection is done through OkHttp's CookieJar mechanism, NOT by manual header
 *       stitching inside execute(). This matches how DownloaderImpl.java works.
 *     • The SOCS consent cookie is stored in an in-memory cookie store and surfaced to OkHttp
 *       via a SimpleCookieJar so every YouTube/Google request automatically carries it.
 *     • REMOVED: consentCookie companion-object String + manual builder.addHeader("Cookie")
 *       injection. That approach broke when a request already had a Cookie header, and it
 *       hard-coded a SOCS token that can expire or be region-specific.
 *     • REMOVED: getYouTubeHeaders() call inside execute() (infinite recursion / StackOverflow).
 *
 * [B] Consent cookie sourced correctly:
 *     • YoutubeParsingHelper.setConsentAccepted(true) is called after NewPipe.init().
 *     • YoutubeParsingHelper.generateConsentCookie() (no-throw, no network, pure computation)
 *       is called immediately after to obtain the SOCS cookie value and seed the cookie jar.
 *     • This is the approach confirmed by the v0.26.0 Javadoc:
 *         generateConsentCookie() — static, no-throws, returns the accept-all SOCS token.
 *         getCookieHeader()       — returns Map with the cookie, used internally by the extractor.
 *       The cookie jar approach ensures the cookie is sent on every YouTube request automatically
 *       without any per-request conditional logic in execute().
 *
 * [C] fetchAndCacheVisitorData() — corrected sequence:
 *     • getYouTubeHeaders() is called OUTSIDE execute() (safe: only called from a
 *       background thread after NewPipe is fully initialised, not from within a Downloader call).
 *     • It fetches sw.js → triggers Downloader.get() internally, but since we are NOT inside
 *       execute() at this point, there is no recursion.
 *     • InnertubeClientRequestInfo.ofWebClient() used as per v0.26.0 docs.
 *
 * [D] POST body Content-Type corrected in MavinDownloader:
 *     • NewPipe InnerTube POST requests send JSON bodies. The extractor sets the body bytes
 *       and expects the Downloader to forward them as-is with "application/json" if the
 *       request has no explicit Content-Type header. Previously the code used
 *       "application/x-www-form-urlencoded" as a blanket fallback — wrong for InnerTube.
 *     • Fix: if request.headers() contains "Content-Type" use it; otherwise default to
 *       "application/json" for POST (matches official DownloaderImpl behaviour).
 *
 * [E] All previous v9.x fixes retained:
 *     [1] Long → Double at expo-modules bridge boundary.
 *     [2] Int fields NOT converted (no .toDouble() needed).
 *     [3] Full streamInfoToMap field coverage (segments, frames, host, privacy, etc.).
 *     [4] Full channelInfo field coverage.
 *     [5] Full playlistInfo field coverage.
 *     [6] getSearchSuggestions returns Map wrapper.
 *     [7] segmentToMap / framesetToMap helpers.
 *     [8] setConsentAccepted(true) after NewPipe.init().
 *     [9] Real visitorData via getVisitorDataFromInnertube().
 *    [10] WEB client not used for stream extraction (SABR fix).
 *    [11] getMediaCapabilities() returns Set not List.
 *    [12] No getYouTubeHeaders() inside execute() (infinite recursion guard).
 */
class MavinEngineModule : Module() {

    companion object {
        private const val TAG = "MavinEngine"
        private const val VERSION = "10.0.0"

        // ── OkHttp ────────────────────────────────────────────────────────
        // CookieJar is set during httpClient construction (after companion init)
        // so it can reference the SimpleCookieJar singleton.
        private val cookieJar = SimpleCookieJar()

        private val httpClient: OkHttpClient = OkHttpClient.Builder()
            .connectionPool(ConnectionPool(10, 5, TimeUnit.MINUTES))
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .cookieJar(cookieJar)
            .build()

        @Volatile private var isInitialized = false

        private const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

        // ── InnerTube dynamic config ──────────────────────────────────────
        data class InnerTubeConfig(
            val apiKey: String,
            val clientVersion: String,
            val musicClientVersion: String
        )

        @Volatile private var cachedConfig: InnerTubeConfig? = null
        @Volatile private var configFetchTime = 0L
        private const val CONFIG_TTL = 24 * 60 * 60 * 1000L // 24 hours

        private const val FALLBACK_API_KEY             = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
        private const val FALLBACK_CLIENT_VERSION      = "2.20260304.01.00"
        private const val FALLBACK_MUSIC_CLIENT_VERSION = "1.20260304.03.00"

        private val INNER_TUBE_API_KEYS = listOf(
            "AIzaSyC9XL3ZjWpsSbsWxvX-8Tj2j03mNPHxTuE",
            "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
            "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
            "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc"
        )
        private val currentKeyIndex = AtomicInteger(0)
        private val failedKeys: MutableSet<String> =
            java.util.Collections.synchronizedSet(mutableSetOf())

        // ── Trending cache (5 minutes) ────────────────────────────────────
        @Volatile private var trendingCache: List<Map<String, Any>>? = null
        @Volatile private var trendingCacheTime = 0L
        private const val TRENDING_CACHE_TTL = 5 * 60 * 1000L

        // ── Visitor data cache (1 hour) ───────────────────────────────────
        @Volatile private var cachedVisitorData: String = ""
        @Volatile private var visitorDataFetchTime = 0L
        private const val VISITOR_DATA_TTL = 60 * 60 * 1000L // 1 hour

        private const val YOUTUBE_MUSIC_BASE_URL = "https://music.youtube.com/youtubei/v1"
        private const val CHARTS_BASE_URL        = "https://charts.youtube.com"
        private val CHART_URLS = listOf(
            "$CHARTS_BASE_URL/charts/TopMusicVideos/global/weekly",
            "$CHARTS_BASE_URL/charts/TrendingMusicVideos/global",
            "$CHARTS_BASE_URL/charts/TopSongs/global/weekly",
            "$CHARTS_BASE_URL/charts/TopSongs/us/weekly"
        )
        private const val MAX_TRENDING_ITEMS = 6
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SIMPLE IN-MEMORY COOKIE JAR
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Minimal OkHttp CookieJar that keeps YouTube/Google cookies in memory.
     *
     * The official NewPipe DownloaderImpl stores cookies (including the SOCS consent
     * cookie) inside an OkHttp CookieJar so that every request to youtube.com
     * automatically includes them — without any manual header injection in execute().
     *
     * We seed this jar with the SOCS cookie after setConsentAccepted(true) +
     * generateConsentCookie() are called during initializeNewPipe().
     */
    class SimpleCookieJar : okhttp3.CookieJar {
        private val store: MutableMap<String, MutableList<okhttp3.Cookie>> =
            java.util.concurrent.ConcurrentHashMap()

        override fun saveFromResponse(url: okhttp3.HttpUrl, cookies: List<okhttp3.Cookie>) {
            val host = url.host
            store.getOrPut(host) { mutableListOf() }.let { existing ->
                for (incoming in cookies) {
                    existing.removeAll { it.name == incoming.name }
                    existing.add(incoming)
                }
            }
        }

        override fun loadForRequest(url: okhttp3.HttpUrl): List<okhttp3.Cookie> {
            val host = url.host
            // Match against youtube.com, music.youtube.com, googlevideo.com, etc.
            return store.entries
                .filter { (domain, _) ->
                    host == domain || host.endsWith(".$domain") || domain.endsWith(".$host")
                }
                .flatMap { it.value }
                .filter { cookie -> cookie.matches(url) }
        }

        /** Manually inject a cookie for a specific domain (e.g. the SOCS consent cookie). */
        fun addCookie(domain: String, name: String, value: String) {
            val cookie = okhttp3.Cookie.Builder()
                .domain(domain)
                .name(name)
                .value(value)
                .path("/")
                .build()
            store.getOrPut(domain) { mutableListOf() }.let { list ->
                list.removeAll { it.name == name }
                list.add(cookie)
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MODULE DEFINITION
    // ═══════════════════════════════════════════════════════════════════════

    override fun definition() = ModuleDefinition {
        Name("MavinEngine")

        Property("version").get<String> { VERSION }
        Property("initialized").get<Boolean> { isInitialized }
        Property("services").get<List<Map<String, Any>>> { getServicesList() }

        OnCreate { initializeNewPipe() }

        // ── Streams ───────────────────────────────────────────────────────
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

        // ── Comments ──────────────────────────────────────────────────────
        AsyncFunction("getComments") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit(); extractComments(url, pageUrl, serviceId)
        }
        AsyncFunction("getCommentReplies") { commentsUrl: String, repliesPageUrl: String, serviceId: Int? ->
            ensureInit(); extractCommentReplies(commentsUrl, repliesPageUrl, serviceId)
        }

        // ── Search ────────────────────────────────────────────────────────
        // contentFilter docs: emptyList() = no filter. DO NOT pass "all".
        // Valid YouTube filters: "videos","channels","playlists",
        //   "music_songs","music_videos","music_albums","music_playlists"
        AsyncFunction("search") { query: String, filter: String?, pageUrl: String?, serviceId: Int? ->
            ensureInit()
            performSearch(query, filter?.takeIf { it.isNotBlank() }, pageUrl, serviceId)
        }
        // FIX [6]: returns Map<String,Any> root — expo AsyncFunction requires Map, not List
        AsyncFunction("getSearchSuggestions") { query: String, serviceId: Int? ->
            ensureInit(); getSearchSuggestions(query, serviceId)
        }
        AsyncFunction("getSearchFilters") { serviceId: Int? ->
            ensureInit(); getAvailableSearchFilters(serviceId)
        }

        // ── Playlist ──────────────────────────────────────────────────────
        AsyncFunction("getPlaylistInfo") { url: String, serviceId: Int? ->
            ensureInit(); extractPlaylistInfo(url, serviceId)
        }
        AsyncFunction("getPlaylistItems") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit(); extractPlaylistItems(url, pageUrl, serviceId)
        }

        // ── Channel ───────────────────────────────────────────────────────
        AsyncFunction("getChannelInfo") { url: String, serviceId: Int? ->
            ensureInit(); extractChannelInfo(url, serviceId)
        }
        AsyncFunction("getChannelTabItems") { url: String, tabFilter: String, pageUrl: String?, serviceId: Int? ->
            ensureInit(); extractChannelTabItems(url, tabFilter, pageUrl, serviceId)
        }
        AsyncFunction("getChannelFeed") { url: String, serviceId: Int? ->
            ensureInit(); extractChannelFeed(url, serviceId)
        }

        // ── Kiosk ─────────────────────────────────────────────────────────
        AsyncFunction("getKioskList") { serviceId: Int? ->
            ensureInit(); listAvailableKiosks(serviceId)
        }
        AsyncFunction("getKioskInfo") { kioskId: String, pageUrl: String?, serviceId: Int? ->
            ensureInit(); extractKioskInfo(kioskId, pageUrl, serviceId)
        }
        // YouTube removed the global Trending page 2025-07-21 → route to fallback
        AsyncFunction("getTrending") { serviceId: Int? ->
            ensureInit(); getTrendingWithFallback("music", serviceId ?: 0)
        }
        AsyncFunction("getMostPopular") { serviceId: Int? ->
            ensureInit(); getTrendingWithFallback("videos", serviceId ?: 0)
        }
        AsyncFunction("getYouTubeKiosk") { kioskType: String, serviceId: Int? ->
            ensureInit()
            val id = when (kioskType.lowercase().replace(" ", "_").replace("-", "_")) {
                "live"                          -> "Live"
                "trending"                      -> "trending_music" // "Trending" removed July 2025
                "music", "trending_music"       -> "trending_music"
                "gaming", "trending_gaming"     -> "trending_gaming"
                "movies", "trending_movies",
                "trending_movies_and_shows"     -> "trending_movies_and_shows"
                "podcasts", "trending_podcasts",
                "trending_podcasts_episodes"    -> "trending_podcasts_episodes"
                else                            -> kioskType
            }
            extractKioskInfo(id, null, serviceId ?: 0)
        }
        AsyncFunction("getTrendingWithFallback") { category: String?, serviceId: Int? ->
            ensureInit(); getTrendingWithFallback(category ?: "music", serviceId ?: 0)
        }

        // ── InnerTube Config Management ───────────────────────────────────
        AsyncFunction("getInnerTubeConfig") {
            val config = getInnerTubeConfig()
            mapOf<String, Any>(
                "apiKey"             to config.apiKey,
                "clientVersion"      to config.clientVersion,
                "musicClientVersion" to config.musicClientVersion,
                // FIX [1]: System.currentTimeMillis() returns Long → .toDouble()
                "cacheAge"           to (System.currentTimeMillis() - configFetchTime).toDouble(),
                "isCached"           to (cachedConfig != null)
            )
        }
        AsyncFunction("refreshInnerTubeConfig") {
            cachedConfig = null; configFetchTime = 0L
            cachedVisitorData = ""; visitorDataFetchTime = 0L
            val config = getInnerTubeConfig()
            // Prefetch fresh visitor data in background after config refresh
            Thread { try { fetchAndCacheVisitorData() } catch (_: Exception) {} }.start()
            mapOf<String, Any>(
                "success"            to true,
                "apiKey"             to config.apiKey,
                "clientVersion"      to config.clientVersion,
                "musicClientVersion" to config.musicClientVersion
            )
        }

        // ── Visitor Data Management ───────────────────────────────────────
        AsyncFunction("refreshVisitorData") {
            cachedVisitorData = ""; visitorDataFetchTime = 0L
            fetchAndCacheVisitorData()
            mapOf<String, Any>(
                "success"        to cachedVisitorData.isNotEmpty(),
                "hasVisitorData" to cachedVisitorData.isNotEmpty()
            )
        }
        AsyncFunction("getVisitorDataStatus") {
            mapOf<String, Any>(
                "hasVisitorData"  to cachedVisitorData.isNotEmpty(),
                "cacheAgeMs"      to (System.currentTimeMillis() - visitorDataFetchTime).toDouble(),
                "ttlMs"           to VISITOR_DATA_TTL.toDouble(),
                "isValid"         to (cachedVisitorData.isNotEmpty() &&
                    System.currentTimeMillis() - visitorDataFetchTime < VISITOR_DATA_TTL)
            )
        }

        // ── Key Management ────────────────────────────────────────────────
        AsyncFunction("getApiKeyStatus") {
            mapOf<String, Any>(
                "totalKeys"       to INNER_TUBE_API_KEYS.size,
                "failedKeys"      to failedKeys.size,
                "workingKeys"     to (INNER_TUBE_API_KEYS.size - failedKeys.size),
                "currentKeyIndex" to currentKeyIndex.get()
            )
        }
        AsyncFunction("resetFailedKeys") {
            synchronized(failedKeys) { failedKeys.clear(); currentKeyIndex.set(0) }
            mapOf<String, Any>("success" to true)
        }

        // ── Trending cache management ─────────────────────────────────────
        AsyncFunction("clearTrendingCache") {
            trendingCache = null; trendingCacheTime = 0L
            mapOf<String, Any>("success" to true)
        }
        AsyncFunction("getTrendingCacheStatus") {
            mapOf<String, Any>(
                "hasCachedData" to (trendingCache != null),
                // FIX [1]: .toDouble()
                "cacheAgeMs"    to (System.currentTimeMillis() - trendingCacheTime).toDouble(),
                "ttlMs"         to TRENDING_CACHE_TTL.toDouble(),
                "isValid"       to (trendingCache != null &&
                    System.currentTimeMillis() - trendingCacheTime < TRENDING_CACHE_TTL)
            )
        }

        // ── URL Utilities ─────────────────────────────────────────────────
        AsyncFunction("resolveUrl") { url: String, serviceId: Int? ->
            ensureInit(); resolveUrl(url, serviceId)
        }
        AsyncFunction("canHandleUrl") { url: String, serviceId: Int? ->
            ensureInit(); checkCanHandle(url, serviceId)
        }
        AsyncFunction("extractIdFromUrl") { url: String, serviceId: Int? ->
            ensureInit(); extractIdFromUrl(url, serviceId)
        }

        // ── Utility ───────────────────────────────────────────────────────
        AsyncFunction("ping") {
            mapOf<String, Any>(
                "alive"     to true,
                "version"   to VERSION,
                // FIX [1]: .toDouble()
                "timestamp" to System.currentTimeMillis().toDouble()
            )
        }
        AsyncFunction("emergencyReset") { resetNewPipe() }
        AsyncFunction("getVersion") {
            mapOf<String, Any>(
                "version"      to VERSION,
                "library"      to "NewPipeExtractor 0.26.0",
                "architecture" to "v10.0 — official Downloader pattern + CookieJar consent + Content-Type fix",
                "notes"        to listOf(
                    "YouTube Trending page removed 2025-07-21 — FEtrending is dead",
                    "Primary trending source: YouTube Music Charts (FEmusic_charts)",
                    "v0.26.0: WEB client no longer used for stream extraction (SABR fix)",
                    "v0.26.0: Real visitorData fetched via YoutubeParsingHelper.getVisitorDataFromInnertube()",
                    "v10.0: MavinDownloader uses CookieJar for SOCS consent (official pattern)",
                    "v10.0: POST Content-Type defaults to application/json (InnerTube fix)",
                    "v10.0: generateConsentCookie() seeds CookieJar — no hard-coded token strings"
                )
            )
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════

    private fun initializeNewPipe() {
        if (isInitialized) return
        synchronized(MavinEngineModule::class.java) {
            if (isInitialized) return
            try {
                NewPipe.init(
                    MavinDownloader(httpClient),
                    Localization.fromLocale(Locale.US),
                    ContentCountry("US")
                )

                // [B] Per v0.26.0 docs: setConsentAccepted(true) must be called after init()
                // to configure internal SOCS cookie generation within NewPipe.
                YoutubeParsingHelper.setConsentAccepted(true)

                // [B] generateConsentCookie() is a static, no-network, no-throw computation
                // that returns the SOCS accept-all cookie value. We seed the CookieJar with it
                // so OkHttp sends the cookie on every YouTube/Google request automatically.
                // This replaces the previous approach of manually injecting a hard-coded
                // cookie string inside execute() — which was fragile and could conflict with
                // Cookie headers already present on a request.
                val socsValue = YoutubeParsingHelper.generateConsentCookie()
                if (socsValue.isNotEmpty()) {
                    cookieJar.addCookie("youtube.com",   "SOCS", socsValue)
                    cookieJar.addCookie(".youtube.com",  "SOCS", socsValue)
                    cookieJar.addCookie("google.com",    "SOCS", socsValue)
                    cookieJar.addCookie(".google.com",   "SOCS", socsValue)
                    Log.i(TAG, "✅ SOCS cookie seeded in CookieJar: ${socsValue.take(24)}...")
                } else {
                    Log.w(TAG, "⚠️ generateConsentCookie() returned empty — consent cookie not seeded")
                }

                isInitialized = true
                Log.i(TAG, "✅ NewPipe v0.26.0 initialized — ${NewPipe.getServices().size} services loaded")

                // [C] Prefetch real visitorData in background.
                // getYouTubeHeaders() is called INSIDE fetchAndCacheVisitorData() which runs
                // on a background thread — NOT inside execute(), so there is no recursion risk.
                Thread {
                    try { fetchAndCacheVisitorData() }
                    catch (e: Exception) { Log.w(TAG, "visitorData prefetch failed: ${e.message}") }
                }.start()

            } catch (e: Exception) {
                Log.e(TAG, "NewPipe init failed", e)
                throw CodedException("INIT_FAILED", "NewPipe.init failed: ${e.message}", e)
            }
        }
    }

    private fun ensureInit() { if (!isInitialized) initializeNewPipe() }

    private fun resetNewPipe(): Map<String, Any> {
        isInitialized = false
        cachedConfig = null
        trendingCache = null
        cachedVisitorData = ""
        visitorDataFetchTime = 0L
        synchronized(failedKeys) { failedKeys.clear(); currentKeyIndex.set(0) }
        initializeNewPipe()
        return mapOf("success" to true, "message" to "MavinEngine v10 reset and re-initialised")
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VISITOR DATA
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Fetches real visitorData from YouTube's InnerTube endpoint.
     *
     * [C] IMPORTANT: getYouTubeHeaders() is called here, on a background thread,
     * AFTER NewPipe is fully initialised. It is NOT called from within execute().
     * This means its internal Downloader.get() call (which fetches sw.js to extract
     * the client version) goes through MavinDownloader.execute() normally — no recursion.
     *
     * Per v0.26.0 Javadoc:
     *   getVisitorDataFromInnertube() parameters:
     *   - innertubeClientRequestInfo: InnertubeClientRequestInfo.ofWebClient()
     *   - localization + contentCountry: must match NewPipe.init() values
     *   - httpHeaders: YoutubeParsingHelper.getYouTubeHeaders() — safe here (background thread)
     *   - innertubeDomainAndVersionEndpoint: YoutubeParsingHelper.YOUTUBEI_V1_URL (WEB client)
     *   - embedUrl: null for non-embedded requests
     *   - useGuideEndpoint: false — guide endpoint is for logged-in features
     */
    private fun fetchAndCacheVisitorData() {
        if (cachedVisitorData.isNotEmpty() &&
            System.currentTimeMillis() - visitorDataFetchTime < VISITOR_DATA_TTL) {
            Log.d(TAG, "visitorData cache still valid, skipping fetch")
            return
        }
        try {
            val localization = Localization.fromLocale(Locale.US)
            val country      = ContentCountry("US")

            // [C] Safe: called from a background thread, never from within execute().
            // getYouTubeHeaders() internally calls Downloader.get() to fetch sw.js —
            // this is normal HTTP through MavinDownloader, not recursion.
            val headers = YoutubeParsingHelper.getYouTubeHeaders()

            val clientInfo  = InnertubeClientRequestInfo.ofWebClient()

            val visitorData = YoutubeParsingHelper.getVisitorDataFromInnertube(
                clientInfo,
                localization,
                country,
                headers,
                YoutubeParsingHelper.YOUTUBEI_V1_URL,
                null,   // embedUrl — null for non-embedded
                false   // useGuideEndpoint — false for anonymous browsing
            )

            if (!visitorData.isNullOrEmpty()) {
                cachedVisitorData    = visitorData
                visitorDataFetchTime = System.currentTimeMillis()
                Log.i(TAG, "✅ Real visitorData fetched: ${visitorData.take(24)}...")
            } else {
                Log.w(TAG, "⚠️ getVisitorDataFromInnertube returned empty string")
            }
        } catch (e: Exception) {
            Log.w(TAG, "⚠️ fetchAndCacheVisitorData failed: ${e.message}")
        }
    }

    private fun getVisitorData(): String {
        if (cachedVisitorData.isEmpty() ||
            System.currentTimeMillis() - visitorDataFetchTime >= VISITOR_DATA_TTL) {
            fetchAndCacheVisitorData()
        }
        return cachedVisitorData
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INNERTUBE DYNAMIC CONFIG
    // ═══════════════════════════════════════════════════════════════════════

    private fun getInnerTubeConfig(): InnerTubeConfig {
        cachedConfig?.let { c ->
            if (System.currentTimeMillis() - configFetchTime < CONFIG_TTL) return c
        }
        return try {
            val config = loadInnerTubeConfigFromYouTube()
            cachedConfig = config; configFetchTime = System.currentTimeMillis()
            Log.i(TAG, "✅ InnerTube config refreshed: key=${config.apiKey.take(10)}..., " +
                "ver=${config.clientVersion}, musicVer=${config.musicClientVersion}")
            config
        } catch (e: Exception) {
            Log.w(TAG, "⚠️ Live InnerTube config fetch failed, using fallback: ${e.message}")
            cachedConfig ?: InnerTubeConfig(FALLBACK_API_KEY, FALLBACK_CLIENT_VERSION, FALLBACK_MUSIC_CLIENT_VERSION)
        }
    }

    private fun loadInnerTubeConfigFromYouTube(): InnerTubeConfig {
        Log.d(TAG, "🔄 Fetching InnerTube config from YouTube homepage...")
        val html = httpClient.newCall(
            Request.Builder().url("https://www.youtube.com")
                .header("User-Agent", USER_AGENT)
                .header("Accept-Language", "en-US,en;q=0.9")
                .build()
        ).execute().use { r ->
            if (!r.isSuccessful) throw IOException("Homepage returned ${r.code}")
            r.body?.string() ?: throw IOException("Empty homepage body")
        }
        val apiKey            = extractApiKeyFromHtml(html)
        val clientVersion     = extractClientVersionFromHtml(html)
        val musicClientVersion = extractMusicClientVersionFromHtml(html)
        return InnerTubeConfig(apiKey, clientVersion, musicClientVersion)
    }

    private fun extractApiKeyFromHtml(html: String): String {
        for (pattern in listOf(
            """"INNERTUBE_API_KEY":"([A-Za-z0-9_-]{39})"""".toRegex(),
            """"key":"([A-Za-z0-9_-]{39})"""".toRegex(),
            """innertubeApiKey\s*[=:]\s*"([A-Za-z0-9_-]{39})"""".toRegex()
        )) { pattern.find(html)?.let { return it.groupValues[1] } }
        Log.w(TAG, "API key not found in HTML, using fallback")
        return FALLBACK_API_KEY
    }

    private fun extractClientVersionFromHtml(html: String): String {
        for (pattern in listOf(
            """"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"""".toRegex(),
            """"clientVersion":"(2\.\d{8}\.\d+\.\d+)"""".toRegex()
        )) { pattern.find(html)?.let { return it.groupValues[1] } }
        return FALLBACK_CLIENT_VERSION
    }

    private fun extractMusicClientVersionFromHtml(html: String): String {
        return try {
            val musicHtml = httpClient.newCall(
                Request.Builder().url("https://music.youtube.com")
                    .header("User-Agent", USER_AGENT)
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .build()
            ).execute().use { r -> r.body?.string() ?: "" }
            if (musicHtml.isEmpty()) return FALLBACK_MUSIC_CLIENT_VERSION
            """"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"""".toRegex()
                .find(musicHtml)?.groupValues?.get(1) ?: FALLBACK_MUSIC_CLIENT_VERSION
        } catch (e: Exception) {
            Log.w(TAG, "Music client version fetch failed: ${e.message}")
            FALLBACK_MUSIC_CLIENT_VERSION
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // KEY ROTATION
    // ═══════════════════════════════════════════════════════════════════════

    private fun getNextApiKey(): String {
        synchronized(failedKeys) {
            if (failedKeys.size >= INNER_TUBE_API_KEYS.size) { failedKeys.clear(); currentKeyIndex.set(0) }
            val startIndex = currentKeyIndex.getAndIncrement() % INNER_TUBE_API_KEYS.size
            var index = startIndex
            do {
                val key = INNER_TUBE_API_KEYS[index]
                if (!failedKeys.contains(key)) { currentKeyIndex.set((index + 1) % INNER_TUBE_API_KEYS.size); return key }
                index = (index + 1) % INNER_TUBE_API_KEYS.size
            } while (index != startIndex)
            return INNER_TUBE_API_KEYS.first()
        }
    }

    private fun markKeyAsFailed(key: String) {
        synchronized(failedKeys) {
            failedKeys.add(key)
            Log.w(TAG, "Key marked failed: ${key.take(10)}... (${failedKeys.size}/${INNER_TUBE_API_KEYS.size})")
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 6-LAYER TRENDING FALLBACK
    // ═══════════════════════════════════════════════════════════════════════

    private fun getTrendingWithFallback(category: String, serviceId: Int): Map<String, Any> {
        // Cache check
        trendingCache?.let { cached ->
            if (System.currentTimeMillis() - trendingCacheTime < TRENDING_CACHE_TTL) {
                Log.i(TAG, "✅ Returning cached trending (${cached.size} items)")
                return mapOf("success" to true, "source" to "cache",
                    "items" to cached.take(MAX_TRENDING_ITEMS),
                    "totalAvailable" to cached.size, "errors" to emptyList<String>())
            }
        }

        val errors = mutableListOf<String>()
        Log.i(TAG, "🔍 Starting 6-layer trending fetch for category: $category")

        // LAYER 1: YouTube Music InnerTube API (FEmusic_charts)
        try {
            Log.i(TAG, "🎵 Layer 1: YouTube Music Charts (FEmusic_charts)...")
            val items = fetchFromYouTubeMusicAPIWithRotation(category)
            if (items.isNotEmpty()) { cacheTrending(items); return successResult("youtube_music_charts", items, errors) }
            errors.add("YouTube Music Charts returned empty")
        } catch (e: Exception) {
            val msg = "YouTube Music Charts failed: ${e.message}"
            Log.w(TAG, "⚠️ $msg"); errors.add(msg)
        }

        // LAYER 2: InnerTube Browse (FEwhat_to_watch — homepage feed)
        try {
            Log.i(TAG, "📡 Layer 2: InnerTube Browse (FEwhat_to_watch)...")
            val items = fetchTrendingFromBrowseAPI()
            if (items.isNotEmpty()) { cacheTrending(items); return successResult("innertube_browse", items, errors) }
            errors.add("InnerTube Browse returned empty")
        } catch (e: Exception) {
            val msg = "InnerTube Browse failed: ${e.message}"
            Log.w(TAG, "⚠️ $msg"); errors.add(msg)
        }

        // LAYER 3: NewPipe sub-kiosks (NOT "Trending" — removed July 2025)
        try {
            Log.i(TAG, "🏪 Layer 3: NewPipe sub-kiosks...")
            val kioskIds = when (category.lowercase()) {
                "gaming"  -> listOf("trending_gaming", "trending_music")
                "movies"  -> listOf("trending_movies_and_shows", "trending_music")
                "podcast" -> listOf("trending_podcasts_episodes", "trending_music")
                else      -> listOf("trending_music", "trending_gaming")
            }
            for (kioskId in kioskIds) {
                try {
                    val result = extractKioskInfo(kioskId, null, serviceId)
                    val items = result["items"] as? List<Map<String, Any>>
                    if (!items.isNullOrEmpty()) { cacheTrending(items); return successResult("kiosk_$kioskId", items, errors) }
                } catch (e: Exception) { errors.add("Kiosk '$kioskId' failed: ${e.message}") }
            }
            errors.add("All sub-kiosks returned empty or failed")
        } catch (e: Exception) { errors.add("Kiosk layer failed: ${e.message}") }

        // LAYER 4: YouTube Charts HTML (charts.youtube.com)
        try {
            Log.i(TAG, "📊 Layer 4: YouTube Charts HTML...")
            val items = fetchFromYouTubeChartsHTML(category)
            if (items.isNotEmpty()) { cacheTrending(items); return successResult("youtube_charts_html", items, errors) }
            errors.add("Charts HTML returned empty")
        } catch (e: Exception) {
            val msg = "Charts HTML failed: ${e.message}"
            Log.w(TAG, "⚠️ $msg"); errors.add(msg)
        }

        // LAYER 5: InnerTube Next API (recommendations seed)
        try {
            Log.i(TAG, "📡 Layer 5: InnerTube Next API (recommendations seed)...")
            val items = fetchTrendingFromNextAPI()
            if (items.isNotEmpty()) { cacheTrending(items); return successResult("innertube_next_recommendations", items, errors) }
            errors.add("InnerTube Next returned empty")
        } catch (e: Exception) {
            val msg = "InnerTube Next failed: ${e.message}"
            Log.w(TAG, "⚠️ $msg"); errors.add(msg)
        }

        // LAYER 6: Search fallback
        try {
            Log.i(TAG, "🔍 Layer 6: Search fallback...")
            val year = java.util.Calendar.getInstance().get(java.util.Calendar.YEAR)
            for (query in listOf(
                "trending music official video $year",
                "top hits $year official",
                "viral music video $year",
                "billboard hot 100 youtube",
                "popular music official"
            )) {
                try {
                    val result = performSearch(query, "videos", null, serviceId)
                    val items = (result["results"] as? List<Map<String, Any>>)
                        ?.filter { it["type"] == "stream" } ?: emptyList()
                    if (items.isNotEmpty()) { cacheTrending(items); return successResult("search_$year", items, errors) }
                } catch (e: Exception) { errors.add("Search '$query' failed: ${e.message}") }
            }
            errors.add("All search queries returned empty")
        } catch (e: Exception) { errors.add("Search layer failed: ${e.message}") }

        Log.e(TAG, "❌ All 6 layers failed. Errors: $errors")
        return mapOf("success" to false, "source" to "none",
            "items" to emptyList<Map<String, Any>>(), "totalAvailable" to 0,
            "errors" to errors,
            "message" to "No trending data available (YouTube Trending removed July 2025)")
    }

    private fun cacheTrending(items: List<Map<String, Any>>) {
        trendingCache = items
        trendingCacheTime = System.currentTimeMillis()
        Log.d(TAG, "💾 Trending cached: ${items.size} items")
    }

    private fun successResult(source: String, items: List<Map<String, Any>>, errors: List<String>): Map<String, Any> {
        Log.i(TAG, "✅ Trending SUCCESS via '$source': ${items.size} items")
        return mapOf("success" to true, "source" to source,
            "items" to items.take(MAX_TRENDING_ITEMS),
            "totalAvailable" to items.size, "errors" to errors)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INNERTUBE BROWSE API (FEwhat_to_watch)
    // ═══════════════════════════════════════════════════════════════════════

    private fun fetchTrendingFromBrowseAPI(): List<Map<String, Any>> {
        val config = getInnerTubeConfig()
        val url = "https://www.youtube.com/youtubei/v1/browse"
        val body = JSONObject().apply {
            put("context", JSONObject().apply {
                put("client", JSONObject().apply {
                    put("clientName", "WEB"); put("clientVersion", config.clientVersion)
                    put("hl", "en"); put("gl", "US")
                })
            })
            put("browseId", "FEwhat_to_watch")
        }.toString()

        Log.d(TAG, "📡 Browse API → $url (clientVersion=${config.clientVersion})")

        val responseStr = httpClient.newCall(
            Request.Builder().url(url)
                .post(body.toRequestBody("application/json".toMediaType()))
                .header("User-Agent", USER_AGENT)
                .header("Content-Type", "application/json")
                .header("Origin", "https://www.youtube.com")
                .header("Referer", "https://www.youtube.com/")
                .build()
        ).execute().use { r ->
            if (!r.isSuccessful) throw IOException("Browse API ${r.code}")
            r.body?.string() ?: throw IOException("Browse API empty body")
        }
        val json = JSONObject(responseStr)
        if (json.has("error")) {
            val err = json.getJSONObject("error")
            throw IOException("Browse API error: ${err.optString("message")} (${err.optInt("code")})")
        }
        return parseBrowseTrending(json)
    }

    private fun parseBrowseTrending(json: JSONObject): List<Map<String, Any>> {
        val items = mutableListOf<Map<String, Any>>()

        fun fromRichGrid(grid: JSONArray) {
            for (i in 0 until grid.length()) {
                val entry = grid.optJSONObject(i) ?: continue
                val directVideo = entry.optJSONObject("richItemRenderer")
                    ?.optJSONObject("content")?.optJSONObject("videoRenderer")
                if (directVideo != null) {
                    extractVideoFromRenderer(directVideo)?.let { items.add(it) }
                    continue
                }
                val shelfContents = entry.optJSONObject("richSectionRenderer")
                    ?.optJSONObject("content")?.optJSONObject("richShelfRenderer")
                    ?.optJSONArray("contents")
                if (shelfContents != null) {
                    for (j in 0 until shelfContents.length()) {
                        val v = shelfContents.optJSONObject(j)
                            ?.optJSONObject("richItemRenderer")?.optJSONObject("content")
                            ?.optJSONObject("videoRenderer") ?: continue
                        extractVideoFromRenderer(v)?.let { items.add(it) }
                    }
                }
            }
        }

        try {
            val contents = json.optJSONObject("contents") ?: return emptyList()
            // PATH A: richGridRenderer directly under contents
            val directGrid = contents.optJSONObject("richGridRenderer")?.optJSONArray("contents")
            if (directGrid != null) fromRichGrid(directGrid)
            // PATH B: twoColumnBrowseResultsRenderer → tabs[0] → richGridRenderer
            if (items.isEmpty()) {
                val tabGrid = contents.optJSONObject("twoColumnBrowseResultsRenderer")
                    ?.optJSONArray("tabs")?.optJSONObject(0)
                    ?.optJSONObject("tabRenderer")?.optJSONObject("content")
                    ?.optJSONObject("richGridRenderer")?.optJSONArray("contents")
                if (tabGrid != null) fromRichGrid(tabGrid)
            }
            // PATH C: sectionListRenderer (older response shapes)
            if (items.isEmpty()) {
                val sectionList = contents.optJSONObject("twoColumnBrowseResultsRenderer")
                    ?.optJSONArray("tabs")?.optJSONObject(0)
                    ?.optJSONObject("tabRenderer")?.optJSONObject("content")
                    ?.optJSONObject("sectionListRenderer")?.optJSONArray("contents")
                if (sectionList != null) {
                    for (i in 0 until sectionList.length()) {
                        val shelf = sectionList.optJSONObject(i)
                            ?.optJSONObject("itemSectionRenderer")?.optJSONArray("contents") ?: continue
                        for (j in 0 until shelf.length()) {
                            extractVideoFromItem(shelf.optJSONObject(j) ?: continue)?.let { items.add(it) }
                        }
                    }
                }
            }
        } catch (e: Exception) { Log.e(TAG, "parseBrowseTrending error: ${e.message}", e) }

        Log.d(TAG, "parseBrowseTrending → ${items.size} items")
        return items
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INNERTUBE NEXT API
    // ═══════════════════════════════════════════════════════════════════════

    private fun fetchTrendingFromNextAPI(): List<Map<String, Any>> {
        val config = getInnerTubeConfig()
        val url = "https://www.youtube.com/youtubei/v1/next?key=${config.apiKey}"
        val body = JSONObject().apply {
            put("context", JSONObject().apply {
                put("client", JSONObject().apply {
                    put("clientName", "WEB"); put("clientVersion", config.clientVersion)
                    put("hl", "en"); put("gl", "US")
                })
            })
            put("videoId", "dQw4w9WgXcQ")
        }.toString()

        Log.d(TAG, "📡 Next API → $url")

        val responseStr = httpClient.newCall(
            Request.Builder().url(url)
                .post(body.toRequestBody("application/json".toMediaType()))
                .header("User-Agent", USER_AGENT)
                .header("Content-Type", "application/json")
                .header("Origin", "https://www.youtube.com")
                .header("Referer", "https://www.youtube.com/")
                .build()
        ).execute().use { r ->
            if (!r.isSuccessful) throw IOException("Next API ${r.code}")
            r.body?.string() ?: throw IOException("Next API empty body")
        }
        val json = JSONObject(responseStr)
        if (json.has("error")) {
            val err = json.getJSONObject("error")
            throw IOException("Next API error: ${err.optString("message")} (${err.optInt("code")})")
        }
        return parseNextRecommendations(json)
    }

    private fun parseNextRecommendations(json: JSONObject): List<Map<String, Any>> {
        val items = mutableListOf<Map<String, Any>>()
        try {
            val secondaryResults = json
                .optJSONObject("contents")
                ?.optJSONObject("twoColumnWatchNextResults")
                ?.optJSONObject("secondaryResults")?.optJSONObject("secondaryResults")
                ?.optJSONArray("results")
            if (secondaryResults != null) {
                for (i in 0 until secondaryResults.length()) {
                    val result = secondaryResults.optJSONObject(i) ?: continue
                    val directRenderer = result.optJSONObject("compactVideoRenderer")
                    if (directRenderer != null) {
                        extractVideoFromRenderer(directRenderer)?.let { items.add(it) }
                        continue
                    }
                    val autoplayContents = result.optJSONObject("compactAutoplayVideoRenderer")
                        ?.optJSONArray("contents")
                    if (autoplayContents != null) {
                        for (j in 0 until autoplayContents.length()) {
                            val aRenderer = autoplayContents.optJSONObject(j)
                                ?.optJSONObject("compactVideoRenderer") ?: continue
                            extractVideoFromRenderer(aRenderer)?.let { items.add(it) }
                        }
                    }
                }
            }
        } catch (e: Exception) { Log.e(TAG, "parseNextRecommendations error: ${e.message}", e) }
        Log.d(TAG, "parseNextRecommendations → ${items.size} items")
        return items
    }

    // ═══════════════════════════════════════════════════════════════════════
    // YOUTUBE MUSIC INNERTUBE API
    // ═══════════════════════════════════════════════════════════════════════

    private fun fetchFromYouTubeMusicAPIWithRotation(category: String): List<Map<String, Any>> {
        val maxAttempts = minOf(INNER_TUBE_API_KEYS.size, 4)
        for (attempt in 0 until maxAttempts) {
            val key = getNextApiKey()
            try {
                return fetchFromYouTubeMusicAPI(category, key)
            } catch (e: Exception) {
                val msg = e.message ?: ""
                if (msg.contains("403") || msg.contains("401") ||
                    msg.contains("API key not valid") || msg.contains("expired")) {
                    markKeyAsFailed(key)
                } else {
                    throw e
                }
            }
        }
        throw IOException("All Music API keys failed authentication")
    }

    private fun fetchFromYouTubeMusicAPI(category: String, apiKey: String): List<Map<String, Any>> {
        val config     = getInnerTubeConfig()
        val browseId   = getBrowseIdForCategory(category)
        val visitorId  = getVisitorData().ifEmpty { generateVisitorId() }
        val url        = "$YOUTUBE_MUSIC_BASE_URL/browse?alt=json&key=$apiKey"
        val body = JSONObject().apply {
            put("context", JSONObject().apply {
                put("client", JSONObject().apply {
                    put("clientName", "WEB_REMIX"); put("clientVersion", config.musicClientVersion)
                    put("hl", "en"); put("gl", "US"); put("visitorData", visitorId)
                    put("userAgent", USER_AGENT)
                })
                put("user", JSONObject().apply { put("lockedSafetyMode", false) })
                put("request", JSONObject().apply {
                    put("useSsl", true); put("internalExperimentFlags", JSONArray())
                    put("consistencyTokenJars", JSONArray())
                })
            })
            put("browseId", browseId)
        }.toString()

        Log.d(TAG, "🎵 Music API → $url (browseId=$browseId, musicVer=${config.musicClientVersion})")

        val responseStr = httpClient.newCall(
            Request.Builder().url(url)
                .post(body.toRequestBody("application/json".toMediaType()))
                .header("User-Agent", USER_AGENT)
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .header("Origin", "https://music.youtube.com")
                .header("Referer", "https://music.youtube.com/")
                .header("X-Goog-Visitor-Id", visitorId)
                .build()
        ).execute().use { r ->
            val bodyStr = r.body?.string() ?: ""
            if (!r.isSuccessful) {
                if (r.code == 403 || bodyStr.contains("API key not valid"))
                    throw IOException("API key not valid (403)")
                throw IOException("YouTube Music API ${r.code}: $bodyStr")
            }
            bodyStr
        }

        val json = JSONObject(responseStr)
        if (json.has("error")) {
            val err = json.getJSONObject("error")
            val code = err.optInt("code", 0); val msg = err.optString("message", "Unknown")
            if (code == 403 || msg.contains("API key")) throw IOException("API Error: $msg ($code)")
            throw IOException("API Error: $msg")
        }
        return parseYouTubeMusicResponse(json)
    }

    private fun getBrowseIdForCategory(category: String): String = when (category.lowercase()) {
        "music", "songs", "audio" -> "FEmusic_charts"
        "trending"                -> "FEmusic_trending"
        else                      -> "FEmusic_charts"
    }

    private fun generateVisitorId(): String {
        val chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        val rng   = java.security.SecureRandom()
        val id    = (1..11).map { chars[rng.nextInt(chars.length)] }.joinToString("")
        val ts    = (System.currentTimeMillis() / 1000L).toInt()
        val idBytes = id.toByteArray(Charsets.UTF_8)
        val buf   = java.io.ByteArrayOutputStream()
        buf.write(0x0A); buf.write(idBytes.size); buf.write(idBytes)
        buf.write(0x28)
        var v = ts.toLong() and 0xFFFFFFFFL
        while (v > 0x7F) { buf.write(((v and 0x7F) or 0x80).toInt()); v = v ushr 7 }
        buf.write(v.toInt())
        return android.util.Base64.encodeToString(buf.toByteArray(),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING)
    }

    private fun parseYouTubeMusicResponse(json: JSONObject): List<Map<String, Any>> {
        val items = mutableListOf<Map<String, Any>>()
        try {
            val contents = json.optJSONObject("contents")
                ?.optJSONObject("singleColumnBrowseResultsRenderer")?.optJSONArray("tabs")
                ?.optJSONObject(0)?.optJSONObject("tabRenderer")?.optJSONObject("content")
                ?.optJSONObject("sectionListRenderer")?.optJSONArray("contents") ?: return emptyList()
            for (i in 0 until contents.length()) {
                val section = contents.optJSONObject(i) ?: continue
                val shelf   = section.optJSONObject("musicShelfRenderer")
                    ?: section.optJSONObject("musicCarouselShelfRenderer") ?: continue
                val shelfContents = shelf.optJSONArray("contents") ?: continue
                for (j in 0 until shelfContents.length()) {
                    val item     = shelfContents.optJSONObject(j) ?: continue
                    val renderer = item.optJSONObject("musicResponsiveListItemRenderer")
                        ?: item.optJSONObject("musicTwoRowItemRenderer") ?: continue
                    val videoId  = extractVideoIdFromMusicRenderer(renderer) ?: continue
                    items.add(buildMusicItem(renderer, videoId))
                }
            }
        } catch (e: Exception) { Log.e(TAG, "parseYouTubeMusicResponse error: ${e.message}", e) }
        return items
    }

    private fun extractVideoIdFromMusicRenderer(r: JSONObject): String? {
        r.optJSONObject("playlistItemData")?.optString("videoId")?.takeIf { it.isNotEmpty() }?.let { return it }
        r.optJSONObject("navigationEndpoint")?.optJSONObject("watchEndpoint")
            ?.optString("videoId")?.takeIf { it.isNotEmpty() }?.let { return it }
        r.optJSONObject("overlay")?.optJSONObject("musicItemThumbnailOverlayRenderer")
            ?.optJSONObject("content")?.optJSONObject("musicPlayButtonRenderer")
            ?.optJSONObject("playNavigationEndpoint")?.optJSONObject("watchEndpoint")
            ?.optString("videoId")?.takeIf { it.isNotEmpty() }?.let { return it }
        return null
    }

    private fun buildMusicItem(renderer: JSONObject, videoId: String): Map<String, Any> {
        val title = renderer.optJSONArray("flexColumns")?.optJSONObject(0)
            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")
            ?.optJSONObject("text")?.optJSONArray("runs")?.optJSONObject(0)
            ?.optString("text", "Unknown Title") ?: "Unknown Title"
        val artist = renderer.optJSONArray("flexColumns")?.optJSONObject(1)
            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")
            ?.optJSONObject("text")?.optJSONArray("runs")?.optJSONObject(0)
            ?.optString("text", "Unknown Artist") ?: "Unknown Artist"
        val durationText = renderer.optJSONArray("fixedColumns")?.optJSONObject(0)
            ?.optJSONObject("musicResponsiveListItemFixedColumnRenderer")
            ?.optJSONObject("text")?.optJSONArray("runs")?.optJSONObject(0)
            ?.optString("text", "") ?: ""
        return mapOf(
            "type" to "stream", "serviceId" to 0,
            "url" to "https://www.youtube.com/watch?v=$videoId",
            "name" to title, "uploaderName" to artist,
            "uploaderUrl" to "", "uploaderVerified" to false,
            "thumbnails" to buildThumbnails(renderer, videoId),
            // FIX [1]: parseDuration returns Long → .toDouble()
            "duration" to parseDuration(durationText).toDouble(),
            // FIX [1]: literal 0L → 0.0
            "viewCount" to 0.0,
            "textualUploadDate" to "", "streamType" to "VIDEO_STREAM",
            "isLive" to false, "isShortFormContent" to false
        )
    }

    private fun buildThumbnails(renderer: JSONObject, videoId: String): List<Map<String, Any>> {
        val arr = renderer.optJSONObject("thumbnail")?.optJSONObject("musicThumbnailRenderer")
            ?.optJSONObject("thumbnail")?.optJSONArray("thumbnails")
        if (arr != null) {
            return List(arr.length()) { i ->
                val t = arr.optJSONObject(i) ?: return@List mapOf<String, Any>()
                val w = t.optInt("width", 0)
                mapOf("url" to t.optString("url", ""), "width" to w, "height" to t.optInt("height", 0),
                    "resolutionLevel" to if (w >= 1280) "HIGH" else if (w >= 640) "MEDIUM" else "LOW")
            }.filter { it.isNotEmpty() }
        }
        return listOf(mapOf("url" to "https://i.ytimg.com/vi/$videoId/hqdefault.jpg",
            "width" to 480, "height" to 360, "resolutionLevel" to "MEDIUM"))
    }

    // ═══════════════════════════════════════════════════════════════════════
    // YOUTUBE CHARTS HTML SCRAPING
    // ═══════════════════════════════════════════════════════════════════════

    private fun fetchFromYouTubeChartsHTML(category: String): List<Map<String, Any>> {
        for (chartUrl in CHART_URLS) {
            val url = "$chartUrl?hl=en"
            Log.d(TAG, "📊 Charts HTML → $url")
            try {
                val body = httpClient.newCall(
                    Request.Builder().url(url)
                        .header("User-Agent", USER_AGENT)
                        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                        .header("Accept-Language", "en-US,en;q=0.9")
                        .header("DNT", "1")
                        .build()
                ).execute().use { r ->
                    if (!r.isSuccessful) { Log.d(TAG, "Charts $url → ${r.code}, trying next"); return@use null }
                    r.body?.string()
                } ?: continue

                val items = extractYtInitialData(body)?.let { parseYouTubeInitialData(it) }
                    ?: extractJsonLd(body).takeIf { it.isNotEmpty() }?.let { parseJsonLdCharts(it) }
                    ?: extractYtInitialPlayerResponse(body)?.let { parsePlayerResponse(it) }
                    ?: continue

                if (items.isNotEmpty()) {
                    Log.d(TAG, "📊 Charts success via $chartUrl: ${items.size} items")
                    return items
                }
            } catch (e: Exception) { Log.d(TAG, "Charts $url failed: ${e.message}, trying next") }
        }
        throw IOException("No chart data found from any chart URL")
    }

    private fun extractYtInitialData(html: String): String? {
        for (marker in listOf("ytInitialData = ", "ytInitialData=", """window["ytInitialData"] = """, "var ytInitialData = ")) {
            val start  = html.indexOf(marker); if (start == -1) continue
            val jStart = html.indexOf('{', start + marker.length); if (jStart == -1) continue
            val s      = extractBalancedJson(html, jStart) ?: continue
            if (s.length > 100) return s
        }
        return null
    }

    private fun extractYtInitialPlayerResponse(html: String): String? {
        for (marker in listOf("ytInitialPlayerResponse = ", "ytInitialPlayerResponse=")) {
            val start  = html.indexOf(marker); if (start == -1) continue
            val jStart = html.indexOf('{', start + marker.length); if (jStart == -1) continue
            return extractBalancedJson(html, jStart)
        }
        return null
    }

    private fun extractBalancedJson(html: String, startIndex: Int): String? {
        var depth = 0; var inStr = false; var escape = false; var i = startIndex
        while (i < html.length) {
            val c = html[i]
            when {
                escape             -> escape = false
                c == '\\'          -> if (inStr) escape = true
                c == '"'           -> inStr = !inStr
                !inStr && c == '{' -> depth++
                !inStr && c == '}' -> { depth--; if (depth == 0) return html.substring(startIndex, i + 1) }
            }
            i++
        }
        return null
    }

    private fun extractJsonLd(html: String): List<String> {
        val results = mutableListOf<String>()
        """<script type="application/ld\+json">(.*?)</script>""".toRegex(RegexOption.DOT_MATCHES_ALL)
            .findAll(html).forEach { m ->
                val s = m.groupValues[1].trim()
                if (s.contains("\"@type\"") && (s.contains("VideoObject") ||
                    s.contains("MusicRecording") || s.contains("ItemList"))) results.add(s)
            }
        return results
    }

    private fun parseYouTubeInitialData(jsonStr: String): List<Map<String, Any>> {
        val items = mutableListOf<Map<String, Any>>()
        try {
            val json     = JSONObject(jsonStr)
            val contents = findVideoArray(json) ?: return emptyList()
            for (i in 0 until contents.length()) {
                val section = contents.optJSONObject(i) ?: continue
                section.optJSONObject("itemSectionRenderer")?.optJSONArray("contents")?.let { arr ->
                    for (j in 0 until arr.length())
                        extractVideoFromItem(arr.optJSONObject(j) ?: continue)?.let { items.add(it) }
                }
                section.optJSONObject("shelfRenderer")?.optJSONObject("content")?.let { content ->
                    val shelf = content.optJSONObject("horizontalListRenderer")?.optJSONArray("items")
                        ?: content.optJSONObject("verticalListRenderer")?.optJSONArray("items")
                    shelf?.let { arr ->
                        for (j in 0 until arr.length())
                            extractVideoFromItem(arr.optJSONObject(j) ?: continue)?.let { items.add(it) }
                    }
                }
                section.optJSONObject("richSectionRenderer")?.optJSONObject("content")
                    ?.let { extractVideoFromRichContent(it)?.let { v -> items.add(v) } }
                section.optJSONObject("musicResponsiveListItemRenderer")
                    ?.let { extractVideoFromMusicItem(it)?.let { v -> items.add(v) } }
            }
        } catch (e: Exception) { Log.e(TAG, "parseYouTubeInitialData error: ${e.message}", e) }
        Log.d(TAG, "parseYouTubeInitialData → ${items.size} items")
        return items
    }

    private fun findVideoArray(json: JSONObject): JSONArray? {
        val keys = json.keys()
        while (keys.hasNext()) {
            when (val v = json.opt(keys.next())) {
                is JSONArray -> if (v.length() > 0) {
                    val first = v.optJSONObject(0)
                    if (first != null && (first.has("videoRenderer") || first.has("playlistVideoRenderer") ||
                        first.has("musicResponsiveListItemRenderer") || first.has("gridVideoRenderer"))) return v
                }
                is JSONObject -> findVideoArray(v)?.let { return it }
            }
        }
        return null
    }

    private fun extractVideoFromItem(item: JSONObject): Map<String, Any>? {
        val renderer = item.optJSONObject("videoRenderer")
            ?: item.optJSONObject("playlistVideoRenderer")
            ?: item.optJSONObject("gridVideoRenderer")
            ?: item.optJSONObject("compactVideoRenderer")
            ?: item.optJSONObject("videoCardRenderer")
            ?: return null
        return extractVideoFromRenderer(renderer)
    }

    private fun extractVideoFromRichContent(content: JSONObject?): Map<String, Any>? {
        content ?: return null
        return extractVideoFromRenderer(
            content.optJSONObject("videoRenderer")
                ?: content.optJSONObject("richItemRenderer")?.optJSONObject("content")?.optJSONObject("videoRenderer")
                ?: return null
        )
    }

    private fun extractVideoFromMusicItem(musicItem: JSONObject): Map<String, Any>? {
        val videoId = musicItem.optJSONObject("playlistItemData")?.optString("videoId", "")?.takeIf { it.isNotEmpty() }
            ?: musicItem.optJSONObject("navigationEndpoint")?.optJSONObject("watchEndpoint")
                ?.optString("videoId", "")?.takeIf { it.isNotEmpty() } ?: return null
        val title  = musicItem.optJSONArray("flexColumns")?.optJSONObject(0)
            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")
            ?.optJSONObject("text")?.optJSONArray("runs")?.optJSONObject(0)
            ?.optString("text", "Unknown Title") ?: "Unknown Title"
        val artist = musicItem.optJSONArray("flexColumns")?.optJSONObject(1)
            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")
            ?.optJSONObject("text")?.optJSONArray("runs")?.optJSONObject(0)
            ?.optString("text", "Unknown Artist") ?: "Unknown Artist"
        val durationText = musicItem.optJSONArray("fixedColumns")?.optJSONObject(0)
            ?.optJSONObject("musicResponsiveListItemFixedColumnRenderer")
            ?.optJSONObject("text")?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "") ?: ""
        return mapOf(
            "type" to "stream", "serviceId" to 0,
            "url" to "https://www.youtube.com/watch?v=$videoId",
            "name" to title, "uploaderName" to artist, "uploaderUrl" to "", "uploaderVerified" to false,
            "thumbnails" to buildThumbnails(musicItem, videoId),
            // FIX [1]: .toDouble()
            "duration" to parseDuration(durationText).toDouble(), "viewCount" to 0.0,
            "textualUploadDate" to "", "streamType" to "VIDEO_STREAM",
            "isLive" to false, "isShortFormContent" to false
        )
    }

    private fun extractVideoFromRenderer(vr: JSONObject): Map<String, Any>? {
        val videoId = vr.optString("videoId", "").takeIf { it.isNotEmpty() } ?: return null
        val title = vr.optJSONObject("title")?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "Unknown Title")
            ?: vr.optJSONObject("headline")?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "Unknown Title")
            ?: "Unknown Title"
        val uploaderName = vr.optJSONObject("longBylineText")?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "")
            ?: vr.optJSONObject("shortBylineText")?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "")
            ?: vr.optJSONObject("ownerText")?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "")
            ?: "Unknown Artist"
        val thumbArr = vr.optJSONObject("thumbnail")?.optJSONArray("thumbnails")
        val thumbnails = if (thumbArr != null) {
            List(thumbArr.length()) { i ->
                val t = thumbArr.optJSONObject(i) ?: return@List mapOf<String, Any>()
                val w = t.optInt("width", 0)
                mapOf("url" to t.optString("url", ""), "width" to w, "height" to t.optInt("height", 0),
                    "resolutionLevel" to if (w >= 1280) "HIGH" else if (w >= 640) "MEDIUM" else "LOW")
            }.filter { it.isNotEmpty() }
        } else listOf(mapOf("url" to "https://i.ytimg.com/vi/$videoId/hqdefault.jpg",
            "width" to 480, "height" to 360, "resolutionLevel" to "MEDIUM"))
        val lengthText = vr.optJSONObject("lengthText")?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "")
            ?: vr.optString("lengthSeconds", "")
        // FIX [1]: .toDouble()
        val duration      = if (lengthText.isNotEmpty()) parseDuration(lengthText).toDouble() else 0.0
        val viewCountText = vr.optJSONObject("viewCountText")?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "") ?: ""
        // FIX [1]: .toDouble()
        val viewCount     = parseViewCount(viewCountText).toDouble()
        val isLive        = vr.optJSONObject("badges")?.toString()?.contains("LIVE") == true
        val isShort       = vr.optBoolean("isShort", false) || title.contains("#shorts", ignoreCase = true)
        return mapOf(
            "type" to "stream", "serviceId" to 0,
            "url" to "https://www.youtube.com/watch?v=$videoId",
            "name" to title, "uploaderName" to uploaderName,
            "uploaderUrl" to "", "uploaderVerified" to false,
            "thumbnails" to thumbnails, "duration" to duration, "viewCount" to viewCount,
            "textualUploadDate" to "",
            "streamType" to if (isLive) "LIVE_STREAM" else "VIDEO_STREAM",
            "isLive" to isLive, "isShortFormContent" to isShort
        )
    }

    private fun parseJsonLdCharts(jsonLdList: List<String>): List<Map<String, Any>> {
        val items = mutableListOf<Map<String, Any>>()
        for (jsonStr in jsonLdList) {
            try {
                val json = JSONObject(jsonStr)
                val type = json.optString("@type", "")
                if (type == "ItemList") {
                    val list = json.optJSONArray("itemListElement") ?: continue
                    for (i in 0 until list.length()) {
                        val item    = list.optJSONObject(i)?.optJSONObject("item") ?: continue
                        val videoId = extractVideoIdFromUrl(item.optString("url", ""))
                            ?: extractVideoIdFromUrl(item.optString("@id", "")) ?: continue
                        items.add(buildSimpleVideoMap(videoId, item.optString("name", "Unknown Title"),
                            item.optJSONObject("byArtist")?.optString("name", "Unknown Artist") ?: "Unknown Artist"))
                    }
                }
                if (type == "VideoObject" || type == "MusicRecording") {
                    val videoId = extractVideoIdFromUrl(json.optString("url", ""))
                        ?: extractVideoIdFromUrl(json.optString("@id", "")) ?: continue
                    items.add(buildSimpleVideoMap(videoId, json.optString("name", "Unknown Title"),
                        json.optJSONObject("byArtist")?.optString("name", "Unknown Artist") ?: "Unknown Artist"))
                }
            } catch (e: Exception) { Log.w(TAG, "JSON-LD parse: ${e.message}") }
        }
        return items
    }

    private fun buildSimpleVideoMap(videoId: String, title: String, artist: String): Map<String, Any> = mapOf(
        "type" to "stream", "serviceId" to 0,
        "url" to "https://www.youtube.com/watch?v=$videoId",
        "name" to title, "uploaderName" to artist,
        "uploaderUrl" to "", "uploaderVerified" to false,
        "thumbnails" to listOf(mapOf("url" to "https://i.ytimg.com/vi/$videoId/hqdefault.jpg",
            "width" to 480, "height" to 360, "resolutionLevel" to "MEDIUM")),
        // FIX [1]: 0L → 0.0
        "duration" to 0.0, "viewCount" to 0.0, "textualUploadDate" to "",
        "streamType" to "VIDEO_STREAM", "isLive" to false, "isShortFormContent" to false
    )

    private fun parsePlayerResponse(jsonStr: String): List<Map<String, Any>> {
        val items = mutableListOf<Map<String, Any>>()
        try {
            val results = JSONObject(jsonStr).optJSONObject("watchNextResponse")?.optJSONObject("contents")
                ?.optJSONObject("twoColumnWatchNextResults")?.optJSONObject("secondaryResults")
                ?.optJSONObject("secondaryResults")?.optJSONArray("results")
            if (results != null) {
                for (i in 0 until results.length()) {
                    val r = results.optJSONObject(i) ?: continue
                    (r.optJSONObject("compactVideoRenderer") ?: r.optJSONObject("compactAutoplayVideoRenderer"))
                        ?.let { extractVideoFromRenderer(it)?.let { v -> items.add(v) } }
                }
            }
        } catch (e: Exception) { Log.e(TAG, "parsePlayerResponse: ${e.message}", e) }
        return items
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SERVICE RESOLUTION
    // ═══════════════════════════════════════════════════════════════════════

    private fun getService(serviceId: Int): StreamingService = NewPipe.getService(serviceId)
    private fun getDefaultService(): StreamingService        = NewPipe.getService(0)
    private fun getServiceForUrl(url: String): StreamingService =
        NewPipe.getServices().firstOrNull { s ->
            try { s.getLinkTypeByUrl(url) != StreamingService.LinkType.NONE } catch (_: Exception) { false }
        } ?: throw ExtractionException("No service handles URL: $url")
    private fun resolveService(url: String, serviceId: Int?): StreamingService =
        if (serviceId != null) getService(serviceId) else getServiceForUrl(url)

    private fun getServicesList(): List<Map<String, Any>> {
        if (!isInitialized) return emptyList()
        return NewPipe.getServices().map { s ->
            mapOf<String, Any>("id" to s.serviceId, "name" to s.serviceInfo.name,
                "baseUrl" to (s.baseUrl ?: ""),
                // FIX [11]: v0.26.0 breaking — getMediaCapabilities() returns Set not List
                "mediaCapabilities" to s.serviceInfo.mediaCapabilities.map { it.name })
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STREAM EXTRACTION
    // ═══════════════════════════════════════════════════════════════════════

    private fun extractStreamInfo(url: String, serviceId: Int?): Map<String, Any> {
        // FIX [10]: v0.26.0 — "do not use WEB client for stream URLs anymore" (SABR-only fix).
        // Always use getDefaultService() (YouTube Android client) for stream extraction.
        // Only override for an explicit non-YouTube serviceId.
        val service = if (serviceId != null && serviceId != 0) getService(serviceId)
                      else getDefaultService()
        return streamInfoToMap(StreamInfo.getInfo(service.getStreamExtractor(url)), service.serviceId)
    }

    private fun extractStreamInfoById(videoId: String, serviceId: Int?): Map<String, Any> {
        // FIX [10]: Same WEB client avoidance — use default service (YouTube Android client)
        val service = if (serviceId != null && serviceId != 0) getService(serviceId)
                      else getDefaultService()
        return streamInfoToMap(
            StreamInfo.getInfo(service.getStreamExtractor(service.streamLHFactory.fromId(videoId))),
            service.serviceId
        )
    }

    /**
     * Full StreamInfo → Map conversion.
     * Every long-returning field is cast to Double for expo-modules bridge compatibility.
     * All v0.26.0 fields included — verified against teamnewpipe.github.io/NewPipeExtractor/javadoc
     */
    private fun streamInfoToMap(info: StreamInfo, serviceId: Int): Map<String, Any> =
        buildMap<String, Any> {
            put("success",                 true)
            put("serviceId",               serviceId)
            put("id",                      info.id)
            put("url",                     info.url)
            put("originalUrl",             info.originalUrl)
            put("title",                   info.name.orEmpty())
            put("uploaderName",            info.uploaderName.orEmpty())
            put("uploaderUrl",             info.uploaderUrl.orEmpty())
            put("uploaderAvatars",         info.uploaderAvatars.map { imageToMap(it) })
            put("uploaderVerified",        info.isUploaderVerified)
            // FIX [1]: long → .toDouble()
            put("uploaderSubscriberCount", info.uploaderSubscriberCount.coerceAtLeast(0L).toDouble())
            put("duration",                info.duration.toDouble())
            put("viewCount",               info.viewCount.coerceAtLeast(0L).toDouble())
            put("likeCount",               info.likeCount.coerceAtLeast(0L).toDouble())
            put("dislikeCount",            info.dislikeCount.coerceAtLeast(0L).toDouble())
            put("description",             info.description.content)
            put("uploadDate",              info.uploadDate?.offsetDateTime()?.toString() ?: "")
            put("textualUploadDate",       info.textualUploadDate.orEmpty())
            put("thumbnails",              info.thumbnails.map { imageToMap(it) })
            put("streamType",              info.streamType.name)
            put("isLive",                  info.streamType == LIVE_STREAM || info.streamType == AUDIO_LIVE_STREAM)
            put("isShortFormContent",      info.isShortFormContent)
            put("availability",            info.getContentAvailability().name)
            // FIX [2]: int — no .toDouble() needed
            put("ageLimit",                info.ageLimit)
            put("tags",                    info.tags)
            put("category",                info.category.orEmpty())
            // FIX [3]: startPosition is long → .toDouble()
            put("startPosition",           info.startPosition.toDouble())
            put("host",                    info.host.orEmpty())
            put("privacy",                 info.privacy.name)
            put("licence",                 info.licence.orEmpty())
            put("languageInfo",            info.languageInfo?.toLanguageTag() ?: "")
            put("subChannelName",          info.subChannelName.orEmpty())
            put("subChannelUrl",           info.subChannelUrl.orEmpty())
            put("subChannelAvatars",       info.subChannelAvatars.map { imageToMap(it) })
            put("supportInfo",             info.supportInfo.orEmpty())
            put("audioStreams",            info.audioStreams.map { audioStreamToMap(it) })
            put("videoStreams",            info.videoStreams.map { videoStreamToMap(it) })
            put("videoOnlyStreams",        info.videoOnlyStreams.map { videoStreamToMap(it) })
            put("dashMpdUrl",              info.dashMpdUrl.orEmpty())
            put("hlsUrl",                  info.hlsUrl.orEmpty())
            put("subtitles",               info.subtitles.map { subtitleToMap(it) })
            put("relatedItems",            info.relatedItems.take(20).mapNotNull { infoItemToMap(it) })
            // FIX [3]: streamSegments — StreamSegment.startTimeSeconds returns int per javadoc
            put("streamSegments",          info.streamSegments.map { segmentToMap(it) })
            // FIX [3]: previewFrames
            put("previewFrames",           info.previewFrames.map { framesetToMap(it) })
            put("metaInfo",                info.metaInfo.map { m ->
                mapOf<String, Any>("title" to m.title.orEmpty(), "content" to (m.content?.content ?: ""),
                    "urls" to m.urls.map { it.toString() }, "urlTexts" to m.urlTexts)
            })
            put("errors",                  info.errors.map { it.message.orEmpty() })
        }

    private fun getBestStreamUrl(url: String, format: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info    = StreamInfo.getInfo(service.getStreamExtractor(url))

        // Per NewPipe v0.26.0 javadoc:
        //   getAudioStreams()     → audio-only streams (no video)
        //   getVideoStreams()     → muxed streams WITH embedded audio (typically ≤480p on YouTube)
        //   getVideoOnlyStreams() → DASH adaptive streams WITHOUT audio (YouTube HD: 720p, 1080p, etc.)
        val best = when (format.lowercase()) {
            "audio", "mp3", "m4a", "ogg", "webm" ->
                info.audioStreams.maxByOrNull { it.getBitrate() }?.content

            "video", "mp4", "best" ->
                info.videoOnlyStreams.maxByOrNull { it.getHeight() }?.content
                    ?: info.videoStreams.maxByOrNull { it.getHeight() }?.content

            "dash" -> info.dashMpdUrl.takeIf { it.isNotEmpty() }
            "hls"  -> info.hlsUrl.takeIf { it.isNotEmpty() }

            else -> info.audioStreams.maxByOrNull { it.getBitrate() }?.content
        }
        return mapOf<String, Any>("success" to (best != null), "url" to (best ?: ""),
            "format" to format, "title" to info.name.orEmpty(),
            // FIX [1]: .toDouble()
            "duration" to info.duration.toDouble(),
            "fallbackUrls" to listOfNotNull(
                info.dashMpdUrl.takeIf { it.isNotEmpty() },
                info.hlsUrl.takeIf { it.isNotEmpty() }))
    }

    private fun extractAudioStreams(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info    = StreamInfo.getInfo(service.getStreamExtractor(url))
        return mapOf<String, Any>("success" to true, "title" to info.name.orEmpty(),
            "audioStreams" to info.audioStreams.map { audioStreamToMap(it) })
    }

    private fun extractVideoStreams(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info    = StreamInfo.getInfo(service.getStreamExtractor(url))
        return mapOf<String, Any>("success" to true, "title" to info.name.orEmpty(),
            "videoStreams"     to info.videoStreams.map { videoStreamToMap(it) },
            "videoOnlyStreams" to info.videoOnlyStreams.map { videoStreamToMap(it) })
    }

    private fun extractSubtitles(url: String, language: String?, serviceId: Int?): Map<String, Any> {
        val service  = resolveService(url, serviceId)
        val info     = StreamInfo.getInfo(service.getStreamExtractor(url))
        val all      = info.subtitles
        val filtered = if (language.isNullOrBlank()) all
                       else all.filter { it.getLanguageTag().equals(language, ignoreCase = true) }
        return mapOf<String, Any>("success" to true, "title" to info.name.orEmpty(),
            "subtitles" to filtered.map { subtitleToMap(it) },
            "availableLanguages" to all.map { it.getLanguageTag() }.distinct())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // COMMENTS
    // ═══════════════════════════════════════════════════════════════════════

    private fun extractComments(url: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        return if (pageUrl.isNullOrEmpty()) {
            val info = CommentsInfo.getInfo(service, url)
            mapOf<String, Any>("success" to true, "disabled" to info.isCommentsDisabled,
                // FIX [2]: getCommentsCount() returns int — no .toDouble()
                "commentsCount" to info.commentsCount,
                "comments" to info.relatedItems.map { commentItemToMap(it) },
                "nextPage" to pageOrEmpty(info.nextPage), "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message.orEmpty() })
        } else {
            val more = CommentsInfo.getMoreItems(service, url, Page(pageUrl))
            mapOf<String, Any>("success" to true,
                "comments" to more.items.map { commentItemToMap(it) },
                "nextPage" to pageOrEmpty(more.nextPage), "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message.orEmpty() })
        }
    }

    private fun extractCommentReplies(commentsUrl: String, repliesPageUrl: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(commentsUrl, serviceId)
        val page    = CommentsInfo.getMoreItems(service, commentsUrl, Page(repliesPageUrl))
        return mapOf<String, Any>("success" to true,
            "replies" to page.items.map { commentItemToMap(it) },
            "nextPage" to pageOrEmpty(page.nextPage), "hasNextPage" to (page.nextPage != null),
            "errors" to page.errors.map { it.message.orEmpty() })
    }

    private fun commentItemToMap(item: CommentsInfoItem): Map<String, Any> = mapOf<String, Any>(
        "authorName"         to item.uploaderName.orEmpty(),
        "authorUrl"          to item.uploaderUrl.orEmpty(),
        "authorAvatars"      to item.uploaderAvatars.map { imageToMap(it) },
        "authorVerified"     to item.isUploaderVerified,
        "commentId"          to item.commentId.orEmpty(),
        "commentText"        to item.commentText.content,
        "publishedTime"      to item.textualUploadDate.orEmpty(),
        // FIX [1]: toEpochSecond() returns long → .toDouble()
        "publishedTimestamp" to (item.uploadDate?.offsetDateTime()?.toEpochSecond()?.toDouble() ?: 0.0),
        // FIX [2]: getLikeCount() returns int — coerce only, no .toDouble()
        "likeCount"          to item.likeCount.coerceAtLeast(0),
        "textualLikeCount"   to item.textualLikeCount.orEmpty(),
        // FIX [2]: getReplyCount() returns int — no .toDouble()
        "replyCount"         to item.replyCount,
        "repliesPageUrl"     to (item.getReplies()?.url ?: ""),
        "hasReplies"         to (item.replyCount > 0 || item.getReplies() != null),
        "isPinned"           to item.isPinned,
        "isHearted"          to item.isHeartedByUploader,
        "isChannelOwner"     to item.isChannelOwner,
        "hasCreatorReply"    to item.hasCreatorReply(),
        // FIX [2]: getStreamPosition() returns int — no .toDouble()
        "streamPosition"     to item.streamPosition
    )

    // ═══════════════════════════════════════════════════════════════════════
    // SEARCH
    // ═══════════════════════════════════════════════════════════════════════

    private fun performSearch(query: String, filter: String?, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service        = NewPipe.getService(serviceId ?: 0)
        val contentFilters = if (filter.isNullOrBlank()) emptyList() else listOf(filter)
        val sortFilter     = ""
        return if (pageUrl.isNullOrEmpty()) {
            val extractor = service.getSearchExtractor(query, contentFilters, sortFilter)
            extractor.fetchPage()
            val info = SearchInfo.getInfo(extractor)
            mapOf<String, Any>("success" to true, "query" to info.searchString.orEmpty(),
                "suggestion" to info.searchSuggestion.orEmpty(), "isCorrectedSearch" to info.isCorrectedSearch,
                "results" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(info.nextPage), "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message.orEmpty() })
        } else {
            val handler = service.searchQHFactory.fromQuery(query, contentFilters, sortFilter)
            val more    = SearchInfo.getMoreItems(service, handler, Page(pageUrl))
            mapOf<String, Any>("success" to true,
                "results" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(more.nextPage), "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message.orEmpty() })
        }
    }

    // FIX [6]: returns Map<String,Any> — expo-modules AsyncFunction cannot return bare List
    private fun getSearchSuggestions(query: String, serviceId: Int?): Map<String, Any> {
        val service     = if (serviceId != null) getService(serviceId) else getDefaultService()
        val suggestions = service.getSuggestionExtractor().suggestionList(query)
        return mapOf<String, Any>("suggestions" to suggestions)
    }

    private fun getAvailableSearchFilters(serviceId: Int?): Map<String, Any> {
        val service = NewPipe.getService(serviceId ?: 0)
        return mapOf<String, Any>("serviceId" to service.serviceId, "serviceName" to service.serviceInfo.name,
            "availableFilters" to service.searchQHFactory.availableContentFilter.toList())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PLAYLIST
    // ═══════════════════════════════════════════════════════════════════════

    private fun extractPlaylistInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info    = PlaylistInfo.getInfo(service, url)
        return mapOf<String, Any>(
            "success" to true, "serviceId" to service.serviceId,
            "id" to info.id, "url" to info.url, "originalUrl" to info.originalUrl,
            "name" to info.name.orEmpty(), "description" to info.description.content,
            "thumbnails" to info.thumbnails.map { imageToMap(it) },
            // FIX [5]: banners confirmed in v0.26.0 javadoc
            "banners" to info.banners.map { imageToMap(it) },
            "uploaderName" to info.uploaderName.orEmpty(),
            "uploaderUrl" to info.uploaderUrl.orEmpty(),
            "uploaderAvatars" to info.uploaderAvatars.map { imageToMap(it) },
            // FIX [5]: subChannel fields confirmed in v0.26.0 javadoc
            "subChannelName" to info.subChannelName.orEmpty(),
            "subChannelUrl" to info.subChannelUrl.orEmpty(),
            "subChannelAvatars" to info.subChannelAvatars.map { imageToMap(it) },
            // FIX [1]: long → .toDouble()
            "streamCount" to info.streamCount.coerceAtLeast(0L).toDouble(),
            "playlistType" to (info.playlistType?.name ?: "NORMAL"),
            "nextPage" to pageOrEmpty(info.nextPage), "hasNextPage" to (info.nextPage != null),
            "items" to info.relatedItems.mapNotNull { infoItemToMap(it) },
            "errors" to info.errors.map { it.message.orEmpty() }
        )
    }

    private fun extractPlaylistItems(url: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        return if (pageUrl.isNullOrEmpty()) {
            val info = PlaylistInfo.getInfo(service, url)
            mapOf<String, Any>("success" to true, "items" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(info.nextPage), "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message.orEmpty() })
        } else {
            val more = PlaylistInfo.getMoreItems(service, url, Page(pageUrl))
            mapOf<String, Any>("success" to true, "items" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(more.nextPage), "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message.orEmpty() })
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CHANNEL
    // ═══════════════════════════════════════════════════════════════════════

    private fun extractChannelInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info    = ChannelInfo.getInfo(service, url)
        return mapOf<String, Any>(
            "success" to true, "serviceId" to service.serviceId,
            "id" to info.id, "url" to info.url, "originalUrl" to info.originalUrl,
            "name" to info.name.orEmpty(), "description" to info.description.orEmpty(),
            "avatars" to info.avatars.map { imageToMap(it) },
            "banners" to info.banners.map { imageToMap(it) },
            "feedUrl" to info.feedUrl.orEmpty(),
            // FIX [1]: long → .toDouble()
            "subscriberCount" to info.subscriberCount.coerceAtLeast(0L).toDouble(),
            "isVerified" to info.isVerified,
            // FIX [4]: tags confirmed in v0.26.0 javadoc
            "tags" to info.tags,
            // FIX [4]: donationLinks is String[] in javadoc → .toList()
            "donationLinks" to (info.donationLinks?.toList() ?: emptyList<String>()),
            // FIX [4]: parentChannel fields confirmed in v0.26.0 javadoc
            "parentChannelName" to info.parentChannelName.orEmpty(),
            "parentChannelUrl" to info.parentChannelUrl.orEmpty(),
            "parentChannelAvatars" to info.parentChannelAvatars.map { imageToMap(it) },
            "tabs" to info.tabs.map { tabLinkHandlerToMap(it) },
            "errors" to info.errors.map { it.message.orEmpty() }
        )
    }

    private fun tabLinkHandlerToMap(tab: ListLinkHandler): Map<String, Any> = mapOf<String, Any>(
        "name" to (tab.contentFilters.firstOrNull() ?: ""),
        "contentFilters" to tab.contentFilters, "url" to tab.url
    )

    private fun extractChannelTabItems(channelUrl: String, tabFilter: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service      = resolveService(channelUrl, serviceId)
        val channelInfo  = ChannelInfo.getInfo(service, channelUrl)
        val targetTab: ListLinkHandler = (
            if (tabFilter.isBlank()) channelInfo.tabs.firstOrNull()
            else channelInfo.tabs.firstOrNull { t -> t.contentFilters.any { it.equals(tabFilter, ignoreCase = true) } }
        ) ?: throw ExtractionException("No tab matching filter '$tabFilter'")
        return if (pageUrl.isNullOrEmpty()) {
            val tabInfo = ChannelTabInfo.getInfo(service, targetTab)
            mapOf<String, Any>("success" to true, "tabName" to (targetTab.contentFilters.firstOrNull() ?: ""),
                "tabFilter" to tabFilter, "items" to tabInfo.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(tabInfo.nextPage), "hasNextPage" to (tabInfo.nextPage != null),
                "errors" to tabInfo.errors.map { it.message.orEmpty() })
        } else {
            val more = ChannelTabInfo.getMoreItems(service, targetTab, Page(pageUrl))
            mapOf<String, Any>("success" to true, "tabName" to (targetTab.contentFilters.firstOrNull() ?: ""),
                "tabFilter" to tabFilter, "items" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(more.nextPage), "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message.orEmpty() })
        }
    }

    private fun extractChannelFeed(url: String, serviceId: Int?): Map<String, Any> {
        val service       = resolveService(url, serviceId)
        val feedExtractor = service.getFeedExtractor(url)
            ?: return mapOf<String, Any>("success" to false, "error" to "NO_FEED",
                "message" to "No feed available for this service/channel")
        val feedInfo = FeedInfo.getInfo(feedExtractor)
        return mapOf<String, Any>("success" to true, "name" to feedInfo.name.orEmpty(),
            "items" to feedInfo.relatedItems.mapNotNull { infoItemToMap(it) },
            "errors" to feedInfo.errors.map { it.message.orEmpty() })
    }

    // ═══════════════════════════════════════════════════════════════════════
    // KIOSK
    // ═══════════════════════════════════════════════════════════════════════

    private fun listAvailableKiosks(serviceId: Int?): Map<String, Any> {
        val service   = if (serviceId != null) getService(serviceId) else getDefaultService()
        val kioskList = service.kioskList
        val kiosks    = kioskList.availableKiosks.map { id ->
            val entry = mutableMapOf<String, Any>()
            try {
                val extractor = kioskList.getExtractorById(id, null)
                entry["id"] = id; entry["name"] = extractor.name
                entry["url"] = extractor.url; entry["available"] = true
            } catch (e: Exception) {
                entry["id"] = id; entry["name"] = id
                entry["available"] = false; entry["error"] = e.message ?: ""
            }
            entry.toMap()
        }
        return mapOf<String, Any>("success" to true, "serviceId" to service.serviceId,
            "defaultKioskId" to kioskList.defaultKioskId, "kiosks" to kiosks)
    }

    private fun extractKioskInfo(kioskId: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service           = if (serviceId != null) getService(serviceId) else getDefaultService()
        val availableKiosks   = service.kioskList.availableKiosks
        if (!availableKiosks.contains(kioskId)) {
            return mapOf("success" to false, "kioskId" to kioskId, "error" to "KIOSK_NOT_FOUND",
                "message" to "Kiosk '$kioskId' not found. Available: $availableKiosks",
                "items" to emptyList<Map<String, Any>>())
        }
        val kioskUrl = service.kioskList.getExtractorById(kioskId, null).url
        return if (pageUrl.isNullOrEmpty()) {
            val info = KioskInfo.getInfo(service, kioskUrl)
            mapOf<String, Any>("success" to true, "kioskId" to kioskId, "name" to info.name.orEmpty(),
                "items" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(info.nextPage), "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message.orEmpty() })
        } else {
            val more = KioskInfo.getMoreItems(service, kioskUrl, Page(pageUrl))
            mapOf<String, Any>("success" to true, "kioskId" to kioskId,
                "items" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(more.nextPage), "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message.orEmpty() })
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // URL UTILITIES
    // ═══════════════════════════════════════════════════════════════════════

    private fun resolveUrl(url: String, serviceId: Int?): Map<String, Any> {
        val service  = resolveService(url, serviceId)
        val linkType = try { service.getLinkTypeByUrl(url) }
            catch (e: Exception) { throw ExtractionException("Cannot determine link type for $url: ${e.message}", e) }
        if (linkType == StreamingService.LinkType.NONE)
            throw ExtractionException("URL not handled by '${service.serviceInfo.name}': $url")
        val id = extractIdForLinkType(service, linkType, url)
        return mapOf<String, Any>("type" to linkType.name.lowercase(), "id" to id,
            "url" to url, "serviceId" to service.serviceId, "serviceName" to service.serviceInfo.name)
    }

    private fun checkCanHandle(url: String, serviceId: Int?): Map<String, Any> {
        if (serviceId != null) {
            val service  = getService(serviceId)
            val linkType = try { service.getLinkTypeByUrl(url) } catch (_: Exception) { StreamingService.LinkType.NONE }
            return mapOf<String, Any>("canHandle" to (linkType != StreamingService.LinkType.NONE),
                "linkType" to linkType.name.lowercase(), "serviceId" to service.serviceId,
                "serviceName" to service.serviceInfo.name, "url" to url)
        }
        var matchedLinkType = StreamingService.LinkType.NONE
        val match = NewPipe.getServices().firstOrNull { s ->
            try {
                val lt = s.getLinkTypeByUrl(url)
                if (lt != StreamingService.LinkType.NONE) { matchedLinkType = lt; true } else false
            } catch (_: Exception) { false }
        }
        return mapOf<String, Any>("canHandle" to (match != null),
            "linkType" to matchedLinkType.name.lowercase(),
            "serviceId" to (match?.serviceId ?: -1),
            "serviceName" to (match?.serviceInfo?.name ?: ""), "url" to url)
    }

    private fun extractIdFromUrl(url: String, serviceId: Int?): Map<String, Any> {
        val service  = resolveService(url, serviceId)
        val linkType = try { service.getLinkTypeByUrl(url) }
            catch (e: Exception) { throw ExtractionException("Cannot determine link type for $url: ${e.message}", e) }
        if (linkType == StreamingService.LinkType.NONE) throw ExtractionException("URL not handled: $url")
        return mapOf<String, Any>("id" to extractIdForLinkType(service, linkType, url),
            "type" to linkType.name.lowercase(), "url" to url, "serviceId" to service.serviceId)
    }

    private fun extractIdForLinkType(service: StreamingService, linkType: StreamingService.LinkType, url: String): String =
        when (linkType) {
            StreamingService.LinkType.STREAM   -> service.streamLHFactory.fromUrl(url).id
            StreamingService.LinkType.CHANNEL  -> (service.channelLHFactory
                ?: throw ExtractionException("'${service.serviceInfo.name}' has no channel factory")).fromUrl(url).id
            StreamingService.LinkType.PLAYLIST -> (service.playlistLHFactory
                ?: throw ExtractionException("'${service.serviceInfo.name}' has no playlist factory")).fromUrl(url).id
            StreamingService.LinkType.NONE     -> throw ExtractionException("URL not handled: $url")
        }

    // ═══════════════════════════════════════════════════════════════════════
    // INFO ITEM MAPPING
    // ═══════════════════════════════════════════════════════════════════════

    private fun infoItemToMap(item: InfoItem): Map<String, Any>? = when (item) {
        is StreamInfoItem -> mapOf<String, Any>(
            "type" to "stream", "serviceId" to item.serviceId,
            "url" to item.url, "name" to item.name.orEmpty(),
            "uploaderName" to item.uploaderName.orEmpty(),
            "uploaderUrl" to item.uploaderUrl.orEmpty(),
            "uploaderVerified" to item.isUploaderVerified,
            "thumbnails" to item.thumbnails.map { imageToMap(it) },
            // FIX [1]: long → .toDouble()
            "duration" to item.duration.coerceAtLeast(0L).toDouble(),
            "viewCount" to item.viewCount.coerceAtLeast(0L).toDouble(),
            "textualUploadDate" to item.textualUploadDate.orEmpty(),
            "streamType" to item.streamType.name,
            "isLive" to (item.streamType == LIVE_STREAM || item.streamType == AUDIO_LIVE_STREAM),
            "isShortFormContent" to item.isShortFormContent
        )
        is PlaylistInfoItem -> mapOf<String, Any>(
            "type" to "playlist", "serviceId" to item.serviceId,
            "url" to item.url, "name" to item.name.orEmpty(),
            "uploaderName" to item.uploaderName.orEmpty(),
            "uploaderUrl" to item.uploaderUrl.orEmpty(),
            "thumbnails" to item.thumbnails.map { imageToMap(it) },
            // FIX [1]: long → .toDouble()
            "streamCount" to item.streamCount.coerceAtLeast(0L).toDouble(),
            "playlistType" to (item.playlistType?.name ?: "NORMAL")
        )
        is ChannelInfoItem -> mapOf<String, Any>(
            "type" to "channel", "serviceId" to item.serviceId,
            "url" to item.url, "name" to item.name.orEmpty(),
            "thumbnails" to item.thumbnails.map { imageToMap(it) },
            // FIX [1]: long → .toDouble()
            "subscriberCount" to item.subscriberCount.coerceAtLeast(0L).toDouble(),
            "streamCount" to item.streamCount.coerceAtLeast(0L).toDouble(),
            "isVerified" to item.isVerified,
            "description" to item.description.orEmpty()
        )
        else -> null
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STREAM FIELD MAPPERS
    // ═══════════════════════════════════════════════════════════════════════

    private fun audioStreamToMap(s: AudioStream): Map<String, Any> = mapOf<String, Any>(
        "url" to s.content, "isUrl" to s.isUrl,
        "deliveryMethod" to s.deliveryMethod.name, "format" to (s.format?.name ?: ""),
        "codec" to s.getCodec(), "bitrate" to s.getBitrate(),
        "audioTrackId" to (s.getAudioTrackId() ?: ""),
        "audioTrackName" to (s.getAudioTrackName() ?: ""),
        "audioLocale" to (s.getAudioLocale()?.toLanguageTag() ?: ""),
        "audioTrackType" to (s.getAudioTrackType()?.name ?: ""),
        "manifestUrl" to (s.manifestUrl ?: "")
    )

    private fun videoStreamToMap(s: VideoStream): Map<String, Any> = mapOf<String, Any>(
        "url" to s.content, "isUrl" to s.isUrl,
        "deliveryMethod" to s.deliveryMethod.name, "format" to (s.format?.name ?: ""),
        "codec" to s.getCodec(),
        // FIX [2]: getWidth/Height/Fps return int — no conversion needed
        "width" to s.getWidth(), "height" to s.getHeight(), "fps" to s.getFps(),
        "bitrate" to s.getBitrate(), "quality" to s.getQuality(),
        "manifestUrl" to (s.manifestUrl ?: "")
    )

    private fun subtitleToMap(s: SubtitlesStream): Map<String, Any> = mapOf<String, Any>(
        "url" to s.content, "isUrl" to s.isUrl,
        "deliveryMethod" to s.deliveryMethod.name, "format" to (s.format?.name ?: ""),
        "languageTag" to s.getLanguageTag(),
        "displayLanguageName" to (s.displayLanguageName ?: ""),
        "isAutoGenerated" to s.isAutoGenerated, "manifestUrl" to (s.manifestUrl ?: "")
    )

    // FIX [7]: StreamSegment.getStartTimeSeconds() returns int (javadoc confirmed)
    private fun segmentToMap(s: StreamSegment): Map<String, Any> = mapOf<String, Any>(
        "title"            to s.title,
        // FIX [2]: getStartTimeSeconds() returns int — no .toDouble() needed
        "startTimeSeconds" to s.startTimeSeconds,
        "channelName"      to (s.channelName ?: ""),
        "url"              to (s.url ?: ""),
        "previewUrl"       to (s.previewUrl ?: "")
    )

    // FIX [7]: Frameset mapper for getPreviewFrames()
    private fun framesetToMap(f: Frameset): Map<String, Any> = mapOf<String, Any>(
        "urls"             to f.urls.toList(),
        "frameWidth"       to f.frameWidth,
        "frameHeight"      to f.frameHeight,
        "totalCount"       to f.totalCount,
        "durationPerFrame" to f.durationPerFrame,
        "framesPerPageX"   to f.framesPerPageX,
        "framesPerPageY"   to f.framesPerPageY
    )

    private fun imageToMap(img: Image): Map<String, Any> = mapOf<String, Any>(
        // FIX [2]: Image.width/height return int — no conversion
        "url" to img.url, "width" to img.width, "height" to img.height,
        "resolutionLevel" to img.estimatedResolutionLevel.name
    )

    private fun pageOrEmpty(p: Page?): Map<String, Any> = p?.let { pageToMap(it) } ?: emptyMap()
    private fun pageToMap(p: Page): Map<String, Any>    = mapOf<String, Any>(
        "url" to (p.url ?: ""),
        "ids" to (p.ids ?: emptyList<String>()),
        "cookies" to (p.cookies ?: emptyMap<String, String>())
    )

    // ═══════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    private fun extractVideoIdFromUrl(url: String): String? {
        if (url.isEmpty()) return null
        if (url.contains("youtu.be/"))  return url.substringAfter("youtu.be/").substringBefore("?").substringBefore("&")
        if (url.contains("v="))         return url.substringAfter("v=").substringBefore("&").substringBefore("?")
        if (url.contains("/shorts/"))   return url.substringAfter("/shorts/").substringBefore("?").substringBefore("&")
        if (url.contains("/embed/"))    return url.substringAfter("/embed/").substringBefore("?").substringBefore("&")
        if (url.matches("^[a-zA-Z0-9_-]{11}$".toRegex())) return url
        return null
    }

    private fun parseViewCount(viewText: String): Long {
        if (viewText.isEmpty()) return 0L
        return try {
            val s = viewText.lowercase().replace(" views", "").replace("view", "").replace(",", "").trim()
            when {
                s.contains("b") -> ((s.replace("b", "").trim().toDoubleOrNull() ?: 0.0) * 1_000_000_000).toLong()
                s.contains("m") -> ((s.replace("m", "").trim().toDoubleOrNull() ?: 0.0) * 1_000_000).toLong()
                s.contains("k") -> ((s.replace("k", "").trim().toDoubleOrNull() ?: 0.0) * 1_000).toLong()
                else             -> s.toLongOrNull() ?: 0L
            }
        } catch (e: Exception) { 0L }
    }

    private fun parseDuration(durationText: String): Long {
        if (durationText.isEmpty()) return 0L
        return try {
            val parts = durationText.split(":").map { it.trim().toIntOrNull() ?: 0 }
            when (parts.size) {
                3    -> parts[0] * 3600L + parts[1] * 60L + parts[2]
                2    -> parts[0] * 60L + parts[1]
                1    -> parts[0].toLong()
                else -> 0L
            }
        } catch (e: Exception) {
            try {
                val min = "([0-9]+)\\s*min".toRegex().find(durationText)?.groupValues?.get(1)?.toIntOrNull() ?: 0
                val sec = "([0-9]+)\\s*sec".toRegex().find(durationText)?.groupValues?.get(1)?.toIntOrNull() ?: 0
                min * 60L + sec
            } catch (e2: Exception) { 0L }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DOWNLOADER
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * MavinDownloader — Official NewPipe Downloader implementation pattern.
     *
     * Architecture matches TeamNewPipe/NewPipe DownloaderImpl.java:
     *
     * 1. execute() is a clean pass-through. It forwards NewPipe's request headers
     *    exactly as provided. It does NOT inject cookies manually — the CookieJar
     *    on the OkHttpClient handles all cookie management automatically.
     *
     * 2. The SOCS consent cookie is carried by SimpleCookieJar (seeded during
     *    initializeNewPipe() via generateConsentCookie()). OkHttp attaches it
     *    to every youtube.com/google.com request without any per-request logic here.
     *
     * 3. [D] POST Content-Type: NewPipe InnerTube requests use JSON bodies.
     *    The extractor sets the body bytes but does NOT always include a Content-Type
     *    header in the request object — it relies on the Downloader to default to
     *    "application/json". The old code defaulted to "application/x-www-form-urlencoded"
     *    which caused InnerTube POST requests to be rejected with 400/415 errors.
     *    Fix: check request headers for Content-Type; default to "application/json" if absent.
     *
     * 4. User-Agent: added only when absent (same as official DownloaderImpl).
     *
     * IMPORTANT — what is NOT done here (unlike the old v9.x implementation):
     *   ✗ No getYouTubeHeaders() call (infinite recursion risk)
     *   ✗ No manual Cookie header injection (conflicts with CookieJar)
     *   ✗ No hard-coded SOCS token string (fragile, region-dependent)
     */
    class MavinDownloader(private val client: OkHttpClient) : Downloader() {

        override fun execute(request: org.schabi.newpipe.extractor.downloader.Request): Response {
            val builder = Request.Builder().url(request.url())

            // [D] Determine Content-Type for POST bodies:
            //     Use the Content-Type from the extractor's headers if provided,
            //     otherwise default to "application/json" (NewPipe InnerTube pattern).
            //     Never fall back to "application/x-www-form-urlencoded" — InnerTube rejects it.
            val requestContentType: String = request.headers()["Content-Type"]?.firstOrNull()
                ?: "application/json"

            when (request.httpMethod()) {
                "POST" -> {
                    val body = request.dataToSend()
                    builder.post(
                        if (body != null) body.toRequestBody(requestContentType.toMediaType())
                        else              ByteArray(0).toRequestBody()
                    )
                }
                "HEAD" -> builder.head()
                else   -> builder.get()
            }

            // Forward all headers from NewPipe's request object.
            // The extractor classes set the correct YouTube-specific headers (X-YouTube-Client-Name,
            // X-YouTube-Client-Version, Origin, Referer, etc.) internally — we just forward them.
            request.headers().forEach { (key, values) ->
                values.forEach { value -> builder.addHeader(key, value) }
            }

            // Add User-Agent only if the extractor did not already set one.
            if (!request.headers().containsKey("User-Agent")) {
                builder.addHeader("User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            }

            // NOTE: No manual Cookie injection here.
            // The SOCS consent cookie (and any cookies YouTube sets via Set-Cookie) are
            // managed entirely by the SimpleCookieJar attached to the OkHttpClient.
            // OkHttp automatically attaches matching cookies to every request.

            return client.newCall(builder.build()).execute().use { r ->
                Response(
                    r.code,
                    r.message,
                    r.headers.toMultimap(),
                    r.body?.string() ?: "",
                    r.request.url.toString()
                )
            }
        }
    }
}