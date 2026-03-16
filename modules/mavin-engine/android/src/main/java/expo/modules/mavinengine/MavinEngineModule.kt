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
import org.schabi.newpipe.extractor.stream.*
import org.schabi.newpipe.extractor.stream.StreamType.*
import java.io.IOException
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * MavinEngine — NewPipe Extractor v0.26.0 Integration
 * v8.0.0 — Self-healing InnerTube config + 6-layer fallback + connection pooling + caching
 */
class MavinEngineModule : Module() {

    companion object {
        private const val TAG = "MavinEngine"
        private const val VERSION = "8.1.0"

        // ── OkHttp with connection pooling (30–40% latency reduction) ──────
        private val httpClient = OkHttpClient.Builder()
            .connectionPool(ConnectionPool(10, 5, TimeUnit.MINUTES))
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()

        @Volatile private var isInitialized = false

        // ── User-Agent ───────────────────────────────────────────────────────
        private const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

        // ── InnerTube dynamic config ─────────────────────────────────────────
        data class InnerTubeConfig(
            val apiKey: String,
            val clientVersion: String,
            val musicClientVersion: String
        )

        @Volatile private var cachedConfig: InnerTubeConfig? = null
        @Volatile private var configFetchTime = 0L
        private const val CONFIG_TTL = 24 * 60 * 60 * 1000L // 24 hours

        // Fallback hardcoded values (used only if live extraction fails)
        private const val FALLBACK_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
        private const val FALLBACK_CLIENT_VERSION = "2.20260304.01.00"
        private const val FALLBACK_MUSIC_CLIENT_VERSION = "1.20260304.03.00"

        // ── Key rotation pool (still useful for Music API) ───────────────────
        private val INNER_TUBE_API_KEYS = listOf(
            "AIzaSyC9XL3ZjWpsSbsWxvX-8Tj2j03mNPHxTuE",
            "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
            "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
            "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc"
        )
        private val currentKeyIndex = AtomicInteger(0)
        private val failedKeys: MutableSet<String> =
            java.util.Collections.synchronizedSet(mutableSetOf())

        // ── Trending cache (5 minutes) ───────────────────────────────────────
        @Volatile private var trendingCache: List<Map<String, Any>>? = null
        @Volatile private var trendingCacheTime = 0L
        private const val TRENDING_CACHE_TTL = 5 * 60 * 1000L // 5 minutes

        // ── YouTube Music & Charts ────────────────────────────────────────────
        private const val YOUTUBE_MUSIC_BASE_URL = "https://music.youtube.com/youtubei/v1"
        // charts.youtube.com — TrendingVideos/RightNow was removed with the Trending page
        // (July 2025). Current chart paths discovered from artists.youtube.com/charts:
        private const val CHARTS_BASE_URL = "https://charts.youtube.com"
        // Ordered list of chart paths to try (first that returns valid data wins)
        private val CHART_URLS = listOf(
            "$CHARTS_BASE_URL/charts/TopMusicVideos/global/weekly",   // Weekly Top Music Videos
            "$CHARTS_BASE_URL/charts/TrendingMusicVideos/global",     // Trending Music Videos
            "$CHARTS_BASE_URL/charts/TopSongs/global/weekly",         // Weekly Top Songs
            "$CHARTS_BASE_URL/charts/TopSongs/us/weekly"              // US Weekly Top Songs
        )
        private const val MAX_TRENDING_ITEMS = 6
    }

    override fun definition() = ModuleDefinition {
        Name("MavinEngine")

        Property("version").get<String> { VERSION }
        Property("initialized").get<Boolean> { isInitialized }
        Property("services").get<List<Map<String, Any>>> { getServicesList() }

        OnCreate { initializeNewPipe() }

        // ── Streams ───────────────────────────────────────────────────────────
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

        // ── Comments ──────────────────────────────────────────────────────────
        AsyncFunction("getComments") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit(); extractComments(url, pageUrl, serviceId)
        }
        AsyncFunction("getCommentReplies") { commentsUrl: String, repliesPageUrl: String, serviceId: Int? ->
            ensureInit(); extractCommentReplies(commentsUrl, repliesPageUrl, serviceId)
        }

        // ── Search ────────────────────────────────────────────────────────────
        // Per NewPipe API docs:
        //   service.getSearchExtractor(query, contentFilter, sortFilter)
        //   contentFilter = List<String>  — empty list = no filter (all results)
        //   Valid YouTube filters: "videos","channels","playlists",
        //   "music_songs","music_videos","music_albums","music_playlists"
        //   DO NOT pass "all" — it is not a NewPipe filter value.
        AsyncFunction("search") { query: String, filter: String?, pageUrl: String?, serviceId: Int? ->
            ensureInit()
            // filter null/"" → emptyList (no filter). Any other string → listOf(filter).
            performSearch(query, filter?.takeIf { it.isNotBlank() }, pageUrl, serviceId)
        }
        AsyncFunction("getSearchSuggestions") { query: String, serviceId: Int? ->
            ensureInit(); getSearchSuggestions(query, serviceId)
        }
        AsyncFunction("getSearchFilters") { serviceId: Int? ->
            ensureInit(); getAvailableSearchFilters(serviceId)
        }

        // ── Playlist ──────────────────────────────────────────────────────────
        AsyncFunction("getPlaylistInfo") { url: String, serviceId: Int? ->
            ensureInit(); extractPlaylistInfo(url, serviceId)
        }
        AsyncFunction("getPlaylistItems") { url: String, pageUrl: String?, serviceId: Int? ->
            ensureInit(); extractPlaylistItems(url, pageUrl, serviceId)
        }

        // ── Channel ───────────────────────────────────────────────────────────
        AsyncFunction("getChannelInfo") { url: String, serviceId: Int? ->
            ensureInit(); extractChannelInfo(url, serviceId)
        }
        AsyncFunction("getChannelTabItems") { url: String, tabFilter: String, pageUrl: String?, serviceId: Int? ->
            ensureInit(); extractChannelTabItems(url, tabFilter, pageUrl, serviceId)
        }
        AsyncFunction("getChannelFeed") { url: String, serviceId: Int? ->
            ensureInit(); extractChannelFeed(url, serviceId)
        }

        // ── Kiosk ─────────────────────────────────────────────────────────────
        AsyncFunction("getKioskList") { serviceId: Int? ->
            ensureInit(); listAvailableKiosks(serviceId)
        }
        AsyncFunction("getKioskInfo") { kioskId: String, pageUrl: String?, serviceId: Int? ->
            ensureInit(); extractKioskInfo(kioskId, pageUrl, serviceId)
        }
        AsyncFunction("getTrending") { serviceId: Int? ->
            // NOTE: YouTube removed the global Trending page on July 21 2025.
            // YoutubeTrendingExtractor ("Trending" kiosk) throws ParsingException in the field.
            // We now route getTrending → getTrendingWithFallback which tries live charts first.
            ensureInit(); getTrendingWithFallback("music", serviceId ?: 0)
        }
        AsyncFunction("getMostPopular") { serviceId: Int? ->
            // Since July 2025 there is no single "most popular" feed. YouTube's mostPopular
            // chart now covers Music/Movies/Gaming. We proxy through fallback which hits
            // FEmusic_charts (Layer 1) → YouTube Music API → search. The "Live" kiosk
            // only returns live-streams and is not a popularity chart.
            ensureInit(); getTrendingWithFallback("videos", serviceId ?: 0)
        }
        AsyncFunction("getYouTubeKiosk") { kioskType: String, serviceId: Int? ->
            ensureInit()
            val id = when (kioskType.lowercase().replace(" ", "_").replace("-", "_")) {
                "live"                                          -> "Live"
                // "Trending" (global feed) was removed July 21 2025.
                // Map to "trending_music" which is still alive via YouTube Charts.
                "trending"                                      -> "trending_music"
                "music", "trending_music"                       -> "trending_music"
                "gaming", "trending_gaming"                     -> "trending_gaming"
                "movies", "trending_movies",
                "trending_movies_and_shows"                     -> "trending_movies_and_shows"
                "podcasts", "trending_podcasts",
                "trending_podcasts_episodes"                    -> "trending_podcasts_episodes"
                else                                            -> kioskType
            }
            extractKioskInfo(id, null, serviceId ?: 0)
        }

        // ── ENHANCED: Reliable Trending with 6-Layer Fallback ─────────────────
        AsyncFunction("getTrendingWithFallback") { category: String?, serviceId: Int? ->
            ensureInit()
            getTrendingWithFallback(category ?: "music", serviceId ?: 0)
        }

        // ── InnerTube Config Management ───────────────────────────────────────
        AsyncFunction("getInnerTubeConfig") {
            val config = getInnerTubeConfig()
            mapOf<String, Any>(
                "apiKey"              to config.apiKey,
                "clientVersion"       to config.clientVersion,
                "musicClientVersion"  to config.musicClientVersion,
                "cacheAge"            to (System.currentTimeMillis() - configFetchTime),
                "isCached"            to (cachedConfig != null)
            )
        }
        AsyncFunction("refreshInnerTubeConfig") {
            cachedConfig = null
            configFetchTime = 0L
            val config = getInnerTubeConfig()
            mapOf<String, Any>(
                "success"             to true,
                "apiKey"              to config.apiKey,
                "clientVersion"       to config.clientVersion,
                "musicClientVersion"  to config.musicClientVersion
            )
        }

        // ── Key Management ────────────────────────────────────────────────────
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

        // ── Trending cache management ─────────────────────────────────────────
        AsyncFunction("clearTrendingCache") {
            trendingCache = null
            trendingCacheTime = 0L
            mapOf<String, Any>("success" to true)
        }
        AsyncFunction("getTrendingCacheStatus") {
            mapOf<String, Any>(
                "hasCachedData" to (trendingCache != null),
                "cacheAgeMs"    to (System.currentTimeMillis() - trendingCacheTime),
                "ttlMs"         to TRENDING_CACHE_TTL,
                "isValid"       to (trendingCache != null &&
                        System.currentTimeMillis() - trendingCacheTime < TRENDING_CACHE_TTL)
            )
        }

        // ── URL Utilities ─────────────────────────────────────────────────────
        AsyncFunction("resolveUrl") { url: String, serviceId: Int? ->
            ensureInit(); resolveUrl(url, serviceId)
        }
        AsyncFunction("canHandleUrl") { url: String, serviceId: Int? ->
            ensureInit(); checkCanHandle(url, serviceId)
        }
        AsyncFunction("extractIdFromUrl") { url: String, serviceId: Int? ->
            ensureInit(); extractIdFromUrl(url, serviceId)
        }

        // ── Utility ───────────────────────────────────────────────────────────
        AsyncFunction("ping") {
            mapOf<String, Any>(
                "alive"     to true,
                "version"   to VERSION,
                "timestamp" to System.currentTimeMillis()
            )
        }
        AsyncFunction("emergencyReset") { resetNewPipe() }
        AsyncFunction("getVersion") {
            mapOf<String, Any>(
                "version"      to VERSION,
                "library"      to "NewPipeExtractor 0.26.0",
                "architecture" to "v8.1 — post-July-2025 YouTube Charts-first, 6-layer fallback",
                "notes"        to listOf(
                    "YouTube Trending page removed 2025-07-21 — FEtrending is dead",
                    "Primary source now: YouTube Music Charts (FEmusic_charts)",
                    "PoToken: call YoutubeStreamExtractor.setPoTokenProvider(provider) after NewPipe.init() — WebView BotGuard impl needed from app layer",
                    "Stream extraction works without poToken but some formats may be limited"
                )
            )
        }
    }

    // ── Initialization ───────────────────────────────────────────────────────

    private fun initializeNewPipe() {
        if (isInitialized) return
        // Lock on the class — not `this` (instance) — so a second module instance
        // created on hot-reload cannot bypass the double-checked lock.
        synchronized(MavinEngineModule::class.java) {
            if (isInitialized) return
            try {
                NewPipe.init(
                    MavinDownloader(httpClient),
                    Localization.fromLocale(Locale.US),
                    ContentCountry("US")
                )
                isInitialized = true
                // ── PoToken note ─────────────────────────────────────────────
                // NewPipeExtractor v0.26.0 exposes PoToken support via a static
                // method on YoutubeStreamExtractor:
                //   YoutubeStreamExtractor.setPoTokenProvider(provider)
                // Call this AFTER NewPipe.init() to enable WEB client streams.
                // Without a provider the extractor uses Android/iOS clients which
                // do not currently require poTokens (some formats may be absent).
                // To implement: create a PoTokenProvider using a WebView BotGuard
                // challenge at the app layer.
                // See: NewPipe app repo → util/potoken/ for reference.
                // For metadata-only usage (search, channel, comments) no poToken needed.
                Log.i(TAG, "✅ NewPipe v0.26.0 initialized — ${NewPipe.getServices().size} services loaded")
                Log.i(TAG, "ℹ️  PoToken: not set — stream URLs use Android/iOS clients (limited formats)")
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
        synchronized(failedKeys) { failedKeys.clear(); currentKeyIndex.set(0) }
        initializeNewPipe()
        return mapOf("success" to true, "message" to "MavinEngine v8 reset and re-initialised")
    }

    // ── Dynamic InnerTube Config ─────────────────────────────────────────────

    /**
     * Returns a live InnerTube config extracted from YouTube's homepage.
     * Caches for 24 hours. Falls back to hardcoded values if live fetch fails.
     */
    private fun getInnerTubeConfig(): InnerTubeConfig {
        cachedConfig?.let { config ->
            if (System.currentTimeMillis() - configFetchTime < CONFIG_TTL) {
                return config
            }
        }

        return try {
            val config = loadInnerTubeConfigFromYouTube()
            cachedConfig = config
            configFetchTime = System.currentTimeMillis()
            Log.i(TAG, "✅ InnerTube config refreshed: key=${config.apiKey.take(10)}..., " +
                "ver=${config.clientVersion}, musicVer=${config.musicClientVersion}")
            config
        } catch (e: Exception) {
            Log.w(TAG, "⚠️ Live InnerTube config fetch failed, using fallback: ${e.message}")
            cachedConfig ?: InnerTubeConfig(
                FALLBACK_API_KEY,
                FALLBACK_CLIENT_VERSION,
                FALLBACK_MUSIC_CLIENT_VERSION
            )
        }
    }

    /**
     * Fetch YouTube homepage and extract InnerTube API key + client versions.
     */
    private fun loadInnerTubeConfigFromYouTube(): InnerTubeConfig {
        Log.d(TAG, "🔄 Fetching InnerTube config from YouTube homepage...")

        val request = Request.Builder()
            .url("https://www.youtube.com")
            .header("User-Agent", USER_AGENT)
            .header("Accept-Language", "en-US,en;q=0.9")
            .build()

        val html = httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Homepage returned ${response.code}")
            response.body?.string() ?: throw IOException("Empty homepage body")
        }

        val apiKey = extractApiKeyFromHtml(html)
        val clientVersion = extractClientVersionFromHtml(html)
        val musicClientVersion = extractMusicClientVersionFromHtml(html)

        return InnerTubeConfig(apiKey, clientVersion, musicClientVersion)
    }

    private fun extractApiKeyFromHtml(html: String): String {
        val patterns = listOf(
            """"INNERTUBE_API_KEY":"([A-Za-z0-9_-]{39})"""".toRegex(),
            """"key":"([A-Za-z0-9_-]{39})"""".toRegex(),
            """innertubeApiKey\s*[=:]\s*"([A-Za-z0-9_-]{39})"""".toRegex()
        )
        for (pattern in patterns) {
            val match = pattern.find(html)
            if (match != null) return match.groupValues[1]
        }
        Log.w(TAG, "API key not found in HTML, using fallback")
        return FALLBACK_API_KEY
    }

    private fun extractClientVersionFromHtml(html: String): String {
        val patterns = listOf(
            """"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"""".toRegex(),
            """"clientVersion":"(2\.\d{8}\.\d+\.\d+)"""".toRegex()
        )
        for (pattern in patterns) {
            val match = pattern.find(html)
            if (match != null) return match.groupValues[1]
        }
        return FALLBACK_CLIENT_VERSION
    }

    private fun extractMusicClientVersionFromHtml(html: String): String {
        return try {
            val request = Request.Builder()
                .url("https://music.youtube.com")
                .header("User-Agent", USER_AGENT)
                .header("Accept-Language", "en-US,en;q=0.9")
                .build()
            val musicHtml = httpClient.newCall(request).execute().use { r ->
                // Cannot use bare 'return' inside lambda — assign to local instead
                r.body?.string() ?: ""
            }
            if (musicHtml.isEmpty()) return FALLBACK_MUSIC_CLIENT_VERSION
            val pattern = """"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"""".toRegex()
            pattern.find(musicHtml)?.groupValues?.get(1) ?: FALLBACK_MUSIC_CLIENT_VERSION
        } catch (e: Exception) {
            Log.w(TAG, "Music client version fetch failed: ${e.message}")
            FALLBACK_MUSIC_CLIENT_VERSION
        }
    }

    // ── Key Rotation ─────────────────────────────────────────────────────────

    /** Round-robin rotation — prevents rate limits */
    private fun getNextApiKey(): String {
        synchronized(failedKeys) {
            if (failedKeys.size >= INNER_TUBE_API_KEYS.size) {
                failedKeys.clear()
                currentKeyIndex.set(0)
            }
            val startIndex = currentKeyIndex.getAndIncrement() % INNER_TUBE_API_KEYS.size
            var index = startIndex
            do {
                val key = INNER_TUBE_API_KEYS[index]
                if (!failedKeys.contains(key)) {
                    currentKeyIndex.set((index + 1) % INNER_TUBE_API_KEYS.size)
                    return key
                }
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

    // ── 5-Layer Trending Fallback (post-July-2025 architecture) ──────────────
    // YouTube removed the global Trending page on 2025-07-21. The new sources are:
    //   1. YouTube Music Charts InnerTube (FEmusic_charts) — primary, most reliable
    //   2. InnerTube Browse (FEwhat_to_watch / FEexplore) — general popular content
    //   3. NewPipe sub-kiosks (trending_music, trending_gaming, etc.) — no "Trending"
    //   4. YouTube Charts HTML scraping (charts.youtube.com) — fallback
    //   5. Search fallback — last resort

    private fun getTrendingWithFallback(category: String, serviceId: Int): Map<String, Any> {
        // ── Check trending cache first ───────────────────────────────────────
        trendingCache?.let { cached ->
            if (System.currentTimeMillis() - trendingCacheTime < TRENDING_CACHE_TTL) {
                Log.i(TAG, "✅ Returning cached trending (${cached.size} items)")
                return mapOf(
                    "success"        to true,
                    "source"         to "cache",
                    "items"          to cached.take(MAX_TRENDING_ITEMS),
                    "totalAvailable" to cached.size,
                    "errors"         to emptyList<String>()
                )
            }
        }

        val errors = mutableListOf<String>()
        Log.i(TAG, "🔍 Starting 5-layer trending fetch for category: $category")

        // ── LAYER 1: YouTube Music InnerTube API (FEmusic_charts) ────────────
        // Primary layer since the global Trending page was removed (July 2025).
        // YouTube Charts (music.youtube.com) replaced /feed/trending as the
        // canonical trending source. Confirmed working browseIds:
        //   FEmusic_charts       → Top Songs / Trending Music Videos
        //   FEmusic_trending     → Trending Music
        try {
            Log.i(TAG, "🎵 Layer 1: YouTube Music Charts (FEmusic_charts)...")
            val items = fetchFromYouTubeMusicAPIWithRotation(category)
            if (items.isNotEmpty()) {
                cacheTrending(items)
                return successResult("youtube_music_charts", items, errors)
            }
            errors.add("YouTube Music Charts returned empty")
        } catch (e: Exception) {
            val msg = "YouTube Music Charts failed: ${e.message}"
            Log.w(TAG, "⚠️ $msg")
            errors.add(msg)
        }

        // ── LAYER 2: InnerTube Browse (FEwhat_to_watch) ──────────────────────
        // FEtrending is dead. FEwhat_to_watch returns YouTube's homepage
        // recommendation feed — not trending per-se, but populated with
        // currently popular content for anonymous sessions.
        try {
            Log.i(TAG, "📡 Layer 2: InnerTube Browse (FEwhat_to_watch)...")
            val items = fetchTrendingFromBrowseAPI()
            if (items.isNotEmpty()) {
                cacheTrending(items)
                return successResult("innertube_browse", items, errors)
            }
            errors.add("InnerTube Browse returned empty")
        } catch (e: Exception) {
            val msg = "InnerTube Browse failed: ${e.message}"
            Log.w(TAG, "⚠️ $msg")
            errors.add(msg)
        }

        // ── LAYER 3: NewPipe sub-kiosks ──────────────────────────────────────
        // IMPORTANT: Never use "Trending" kiosk — it maps to /feed/trending which
        // was removed. Use category sub-kiosks which map to charts that still exist.
        try {
            Log.i(TAG, "🏪 Layer 3: NewPipe sub-kiosks...")
            val kioskIds = when (category.lowercase()) {
                "gaming"  -> listOf("trending_gaming",  "trending_music")
                "movies"  -> listOf("trending_movies_and_shows", "trending_music")
                "podcast" -> listOf("trending_podcasts_episodes", "trending_music")
                else      -> listOf("trending_music",   "trending_gaming")
            }
            for (kioskId in kioskIds) {
                try {
                    val result = extractKioskInfo(kioskId, null, serviceId)
                    val items = result["items"] as? List<Map<String, Any>>
                    if (!items.isNullOrEmpty()) {
                        cacheTrending(items)
                        return successResult("kiosk_$kioskId", items, errors)
                    }
                } catch (e: Exception) {
                    errors.add("Kiosk '$kioskId' failed: ${e.message}")
                }
            }
            errors.add("All sub-kiosks returned empty or failed")
        } catch (e: Exception) {
            errors.add("Kiosk layer failed: ${e.message}")
        }

        // ── LAYER 4: YouTube Charts HTML (charts.youtube.com) ────────────────
        try {
            Log.i(TAG, "📊 Layer 4: YouTube Charts HTML...")
            val items = fetchFromYouTubeChartsHTML(category)
            if (items.isNotEmpty()) {
                cacheTrending(items)
                return successResult("youtube_charts_html", items, errors)
            }
            errors.add("Charts HTML returned empty")
        } catch (e: Exception) {
            val msg = "Charts HTML failed: ${e.message}"
            Log.w(TAG, "⚠️ $msg")
            errors.add(msg)
        }

        // ── LAYER 5: InnerTube Next API (recommendations seed) ───────────────
        // Demoted to last-API-resort: this returns recommendations for a given
        // videoId — not global trending — but provides valid video metadata.
        try {
            Log.i(TAG, "📡 Layer 5: InnerTube Next API (recommendations seed)...")
            val items = fetchTrendingFromNextAPI()
            if (items.isNotEmpty()) {
                cacheTrending(items)
                return successResult("innertube_next_recommendations", items, errors)
            }
            errors.add("InnerTube Next returned empty")
        } catch (e: Exception) {
            val msg = "InnerTube Next failed: ${e.message}"
            Log.w(TAG, "⚠️ $msg")
            errors.add(msg)
        }

        // ── LAYER 6: Search Fallback ─────────────────────────────────────────
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
                    if (items.isNotEmpty()) {
                        cacheTrending(items)
                        return successResult("search_$year", items, errors)
                    }
                } catch (e: Exception) {
                    errors.add("Search '$query' failed: ${e.message}")
                }
            }
            errors.add("All search queries returned empty")
        } catch (e: Exception) {
            errors.add("Search layer failed: ${e.message}")
        }

        // ── ALL LAYERS FAILED ────────────────────────────────────────────────
        Log.e(TAG, "❌ All layers failed. Errors: $errors")
        return mapOf(
            "success"        to false,
            "source"         to "none",
            "items"          to emptyList<Map<String, Any>>(),
            "totalAvailable" to 0,
            "errors"         to errors,
            "message"        to "No trending data available from any source (YouTube Trending removed July 2025)"
        )
    }

    private fun cacheTrending(items: List<Map<String, Any>>) {
        trendingCache = items
        trendingCacheTime = System.currentTimeMillis()
        Log.d(TAG, "💾 Trending cached: ${items.size} items")
    }

    private fun successResult(
        source: String,
        items: List<Map<String, Any>>,
        errors: List<String>
    ): Map<String, Any> {
        Log.i(TAG, "✅ Trending SUCCESS via '$source': ${items.size} items")
        return mapOf(
            "success"        to true,
            "source"         to source,
            "items"          to items.take(MAX_TRENDING_ITEMS),
            "totalAvailable" to items.size,
            "errors"         to errors
        )
    }

    // ── InnerTube Browse API (FEwhat_to_watch — homepage feed) ──────────────
    // NOTE: FEtrending was removed by YouTube on 2025-07-21. FEwhat_to_watch
    // returns the anonymous homepage recommendation feed which contains currently
    // popular content. This is the closest available replacement via InnerTube browse.

    private fun fetchTrendingFromBrowseAPI(): List<Map<String, Any>> {
        val config = getInnerTubeConfig()
        val url = "https://www.youtube.com/youtubei/v1/browse"
        // The ?key= param is vestigial — YouTube ignores it for unauthenticated WEB
        // client requests. Keeping it for back-compat but not rotating it here.

        val body = JSONObject().apply {
            put("context", JSONObject().apply {
                put("client", JSONObject().apply {
                    put("clientName", "WEB")
                    put("clientVersion", config.clientVersion)
                    put("hl", "en")
                    put("gl", "US")
                })
            })
            // FEwhat_to_watch = YouTube homepage — replaces defunct FEtrending
            put("browseId", "FEwhat_to_watch")
        }.toString()

        Log.d(TAG, "📡 Browse API → $url (clientVersion=${config.clientVersion})")

        val request = Request.Builder()
            .url(url)
            .post(body.toRequestBody("application/json".toMediaType()))
            .header("User-Agent", USER_AGENT)
            .header("Content-Type", "application/json")
            .header("Origin", "https://www.youtube.com")
            .header("Referer", "https://www.youtube.com/")
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBodyStr = response.use { r ->
            if (!r.isSuccessful) throw IOException("Browse API ${r.code}")
            r.body?.string() ?: throw IOException("Browse API empty body")
        }

        val json = JSONObject(responseBodyStr)

        if (json.has("error")) {
            val err = json.getJSONObject("error")
            throw IOException("Browse API error: ${err.optString("message")} (${err.optInt("code")})")
        }

        return parseBrowseTrending(json)
    }

    private fun parseBrowseTrending(json: JSONObject): List<Map<String, Any>> {
        val items = mutableListOf<Map<String, Any>>()

        fun extractFromRichGrid(grid: org.json.JSONArray) {
            for (i in 0 until grid.length()) {
                val entry = grid.optJSONObject(i) ?: continue
                val directVideo = entry.optJSONObject("richItemRenderer")
                    ?.optJSONObject("content")
                    ?.optJSONObject("videoRenderer")
                if (directVideo != null) {
                    extractVideoFromRenderer(directVideo)?.let { items.add(it) }
                    continue
                }
                val shelfContents = entry.optJSONObject("richSectionRenderer")
                    ?.optJSONObject("content")
                    ?.optJSONObject("richShelfRenderer")
                    ?.optJSONArray("contents")
                if (shelfContents != null) {
                    for (j in 0 until shelfContents.length()) {
                        val v = shelfContents.optJSONObject(j)
                            ?.optJSONObject("richItemRenderer")
                            ?.optJSONObject("content")
                            ?.optJSONObject("videoRenderer") ?: continue
                        extractVideoFromRenderer(v)?.let { items.add(it) }
                    }
                }
            }
        }

        try {
            val contents = json.optJSONObject("contents") ?: return emptyList()

            // PATH A: FEwhat_to_watch (homepage) — richGridRenderer directly under contents
            val directGrid = contents.optJSONObject("richGridRenderer")
                ?.optJSONArray("contents")
            if (directGrid != null) {
                extractFromRichGrid(directGrid)
            }

            // PATH B: twoColumnBrowseResultsRenderer → tabs[0] → richGridRenderer
            // (was used by FEtrending; may still apply to other browseIds)
            if (items.isEmpty()) {
                val tabGrid = contents.optJSONObject("twoColumnBrowseResultsRenderer")
                    ?.optJSONArray("tabs")
                    ?.optJSONObject(0)
                    ?.optJSONObject("tabRenderer")
                    ?.optJSONObject("content")
                    ?.optJSONObject("richGridRenderer")
                    ?.optJSONArray("contents")
                if (tabGrid != null) extractFromRichGrid(tabGrid)
            }

            // PATH C: sectionListRenderer (older or alternate response shapes)
            if (items.isEmpty()) {
                val sectionList = contents
                    .optJSONObject("twoColumnBrowseResultsRenderer")
                    ?.optJSONArray("tabs")
                    ?.optJSONObject(0)
                    ?.optJSONObject("tabRenderer")
                    ?.optJSONObject("content")
                    ?.optJSONObject("sectionListRenderer")
                    ?.optJSONArray("contents")
                if (sectionList != null) {
                    for (i in 0 until sectionList.length()) {
                        val shelf = sectionList.optJSONObject(i)
                            ?.optJSONObject("itemSectionRenderer")
                            ?.optJSONArray("contents") ?: continue
                        for (j in 0 until shelf.length()) {
                            extractVideoFromItem(shelf.optJSONObject(j) ?: continue)
                                ?.let { items.add(it) }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "parseBrowseTrending error: ${e.message}", e)
        }

        Log.d(TAG, "parseBrowseTrending → ${items.size} items")
        return items
    }

    // ── LAYER 2: InnerTube Next API ──────────────────────────────────────────

    private fun fetchTrendingFromNextAPI(): List<Map<String, Any>> {
        val config = getInnerTubeConfig()
        val url = "https://www.youtube.com/youtubei/v1/next?key=${config.apiKey}"

        // Use a stable, well-known video ID to get recommendations
        val body = JSONObject().apply {
            put("context", JSONObject().apply {
                put("client", JSONObject().apply {
                    put("clientName", "WEB")
                    put("clientVersion", config.clientVersion)
                    put("hl", "en")
                    put("gl", "US")
                })
            })
            put("videoId", "dQw4w9WgXcQ")
        }.toString()

        Log.d(TAG, "📡 Next API → $url")

        val request = Request.Builder()
            .url(url)
            .post(body.toRequestBody("application/json".toMediaType()))
            .header("User-Agent", USER_AGENT)
            .header("Content-Type", "application/json")
            .header("Origin", "https://www.youtube.com")
            .header("Referer", "https://www.youtube.com/")
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBodyStr = response.use { r ->
            if (!r.isSuccessful) throw IOException("Next API ${r.code}")
            r.body?.string() ?: throw IOException("Next API empty body")
        }

        val json = JSONObject(responseBodyStr)

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
                ?.optJSONObject("secondaryResults")
                ?.optJSONObject("secondaryResults")
                ?.optJSONArray("results")

            if (secondaryResults != null) {
                for (i in 0 until secondaryResults.length()) {
                    val result = secondaryResults.optJSONObject(i) ?: continue

                    // Standard compact video
                    val directRenderer = result.optJSONObject("compactVideoRenderer")
                    if (directRenderer != null) {
                        extractVideoFromRenderer(directRenderer)?.let { items.add(it) }
                        continue
                    }

                    // Autoplay shelf — contains an array of compactVideoRenderer
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
        } catch (e: Exception) {
            Log.e(TAG, "parseNextRecommendations error: ${e.message}", e)
        }

        Log.d(TAG, "parseNextRecommendations → ${items.size} items")
        return items
    }

    // ── LAYER 3: YouTube Music InnerTube API ─────────────────────────────────

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
        val config = getInnerTubeConfig()
        val browseId = getBrowseIdForCategory(category)
        val url = "$YOUTUBE_MUSIC_BASE_URL/browse?alt=json&key=$apiKey"

        val context = JSONObject().apply {
            put("client", JSONObject().apply {
                put("clientName", "WEB_REMIX")
                put("clientVersion", config.musicClientVersion)
                put("hl", "en")
                put("gl", "US")
                put("visitorData", generateVisitorId())
                put("userAgent", USER_AGENT)
            })
            put("user", JSONObject().apply { put("lockedSafetyMode", false) })
            put("request", JSONObject().apply {
                put("useSsl", true)
                put("internalExperimentFlags", JSONArray())
                put("consistencyTokenJars", JSONArray())
            })
        }

        val body = JSONObject().apply {
            put("context", context)
            put("browseId", browseId)
        }.toString()

        val request = Request.Builder()
            .url(url)
            .post(body.toRequestBody("application/json".toMediaType()))
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .header("Origin", "https://music.youtube.com")
            .header("Referer", "https://music.youtube.com/")
            .header("X-Goog-Visitor-Id", generateVisitorId())
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBodyStr = response.use { r ->
            // Read body exactly once — OkHttp body can only be consumed once
            val bodyStr = r.body?.string() ?: ""
            if (!r.isSuccessful) {
                if (r.code == 403 || bodyStr.contains("API key not valid"))
                    throw IOException("API key not valid (403)")
                throw IOException("YouTube Music API ${r.code}: $bodyStr")
            }
            bodyStr
        }

        val json = JSONObject(responseBodyStr)
        if (json.has("error")) {
            val error = json.getJSONObject("error")
            val code = error.optInt("code", 0)
            val message = error.optString("message", "Unknown error")
            if (code == 403 || message.contains("API key")) throw IOException("API Error: $message ($code)")
            throw IOException("API Error: $message")
        }

        return parseYouTubeMusicResponse(json)
    }

    private fun getBrowseIdForCategory(category: String): String = when (category.lowercase()) {
        "music", "songs", "audio" -> "FEmusic_charts"      // Confirmed: Top Songs/Music Videos
        "trending"                -> "FEmusic_trending"     // Confirmed: Trending Music
        // FEmusic_charts_videos was observed in A/B tests only — not reliably available.
        // Fall through to FEmusic_charts for all other categories.
        else                      -> "FEmusic_charts"
    }

    /**
     * Generate a visitorData value in YouTube's protobuf format.
     *
     * YouTube's visitorData is a base64-encoded protobuf with:
     *   field 1 (type 2, length-delimited string): random ~11-char alphanumeric ID
     *   field 5 (type 0, varint): Unix timestamp in seconds
     *
     * Random raw bytes are REJECTED by YouTube's Music API as invalid visitorData.
     * This minimal protobuf encoding matches the format observed in real YouTube traffic.
     */
    private fun generateVisitorId(): String {
        // Generate an 11-character random alphanumeric ID (matches YouTube's format)
        val chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        val random = java.security.SecureRandom()
        val randomId = (1..11).map { chars[random.nextInt(chars.length)] }.joinToString("")

        val timestampSeconds = (System.currentTimeMillis() / 1000L).toInt()

        // Encode as minimal protobuf:
        //   field 1, wire type 2 (length-delimited): 0x0A + length + bytes
        //   field 5, wire type 0 (varint):           0x28 + varint(timestamp)
        val idBytes = randomId.toByteArray(Charsets.UTF_8)
        val buf = java.io.ByteArrayOutputStream()

        // Field 1: tag = (1 << 3) | 2 = 0x0A
        buf.write(0x0A)
        buf.write(idBytes.size)
        buf.write(idBytes)

        // Field 5: tag = (5 << 3) | 0 = 0x28
        buf.write(0x28)
        // Write timestamp as varint
        var v = timestampSeconds.toLong() and 0xFFFFFFFFL
        while (v > 0x7F) {
            buf.write(((v and 0x7F) or 0x80).toInt())
            v = v ushr 7
        }
        buf.write(v.toInt())

        return android.util.Base64.encodeToString(
            buf.toByteArray(),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING
        )
    }

    private fun parseYouTubeMusicResponse(json: JSONObject): List<Map<String, Any>> {
        val items = mutableListOf<Map<String, Any>>()
        try {
            val contents = json.optJSONObject("contents")
                ?.optJSONObject("singleColumnBrowseResultsRenderer")
                ?.optJSONArray("tabs")
                ?.optJSONObject(0)
                ?.optJSONObject("tabRenderer")
                ?.optJSONObject("content")
                ?.optJSONObject("sectionListRenderer")
                ?.optJSONArray("contents") ?: return emptyList()

            for (i in 0 until contents.length()) {
                val section = contents.optJSONObject(i) ?: continue
                val musicShelf = section.optJSONObject("musicShelfRenderer")
                    ?: section.optJSONObject("musicCarouselShelfRenderer") ?: continue
                val shelfContents = musicShelf.optJSONArray("contents") ?: continue

                for (j in 0 until shelfContents.length()) {
                    val item = shelfContents.optJSONObject(j) ?: continue
                    val renderer = item.optJSONObject("musicResponsiveListItemRenderer")
                        ?: item.optJSONObject("musicTwoRowItemRenderer") ?: continue

                    val videoId = extractVideoIdFromMusicRenderer(renderer) ?: continue
                    items.add(buildMusicItem(renderer, videoId))
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "parseYouTubeMusicResponse error: ${e.message}", e)
        }
        return items
    }

    private fun extractVideoIdFromMusicRenderer(renderer: JSONObject): String? {
        renderer.optJSONObject("playlistItemData")
            ?.optString("videoId")?.takeIf { it.isNotEmpty() }?.let { return it }

        renderer.optJSONObject("navigationEndpoint")
            ?.optJSONObject("watchEndpoint")
            ?.optString("videoId")?.takeIf { it.isNotEmpty() }?.let { return it }

        renderer.optJSONObject("overlay")
            ?.optJSONObject("musicItemThumbnailOverlayRenderer")
            ?.optJSONObject("content")
            ?.optJSONObject("musicPlayButtonRenderer")
            ?.optJSONObject("playNavigationEndpoint")
            ?.optJSONObject("watchEndpoint")
            ?.optString("videoId")?.takeIf { it.isNotEmpty() }?.let { return it }

        return null
    }

    private fun buildMusicItem(renderer: JSONObject, videoId: String): Map<String, Any> {
        val title = renderer.optJSONArray("flexColumns")
            ?.optJSONObject(0)
            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")
            ?.optJSONObject("text")?.optJSONArray("runs")
            ?.optJSONObject(0)?.optString("text", "Unknown Title") ?: "Unknown Title"

        val artist = renderer.optJSONArray("flexColumns")
            ?.optJSONObject(1)
            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")
            ?.optJSONObject("text")?.optJSONArray("runs")
            ?.optJSONObject(0)?.optString("text", "Unknown Artist") ?: "Unknown Artist"

        val thumbnails = buildThumbnails(renderer, videoId)
        val durationText = renderer.optJSONArray("fixedColumns")
            ?.optJSONObject(0)
            ?.optJSONObject("musicResponsiveListItemFixedColumnRenderer")
            ?.optJSONObject("text")?.optJSONArray("runs")
            ?.optJSONObject(0)?.optString("text", "") ?: ""

        return mapOf(
            "type"               to "stream",
            "serviceId"          to 0,
            "url"                to "https://www.youtube.com/watch?v=$videoId",
            "name"               to title,
            "uploaderName"       to artist,
            "uploaderUrl"        to "",
            "uploaderVerified"   to false,
            "thumbnails"         to thumbnails,
            "duration"           to parseDuration(durationText),
            "viewCount"          to 0L,
            "textualUploadDate"  to "",
            "streamType"         to "VIDEO_STREAM",
            "isLive"             to false,
            "isShortFormContent" to false
        )
    }

    private fun buildThumbnails(renderer: JSONObject, videoId: String): List<Map<String, Any>> {
        val thumbArray = renderer.optJSONObject("thumbnail")
            ?.optJSONObject("musicThumbnailRenderer")
            ?.optJSONObject("thumbnail")
            ?.optJSONArray("thumbnails")

        if (thumbArray != null) {
            return List(thumbArray.length()) { i ->
                val t = thumbArray.optJSONObject(i) ?: return@List mapOf<String, Any>()
                mapOf(
                    "url"             to t.optString("url", ""),
                    "width"           to t.optInt("width", 0),
                    "height"          to t.optInt("height", 0),
                    "resolutionLevel" to when {
                        t.optInt("width", 0) >= 1280 -> "HIGH"
                        t.optInt("width", 0) >= 640  -> "MEDIUM"
                        else                          -> "LOW"
                    }
                )
            }.filter { it.isNotEmpty() }
        }

        return listOf(mapOf(
            "url"             to "https://i.ytimg.com/vi/$videoId/hqdefault.jpg",
            "width"           to 480, "height" to 360, "resolutionLevel" to "MEDIUM"
        ))
    }

    // ── LAYER 5: YouTube Charts HTML Scraping ────────────────────────────────

    private fun fetchFromYouTubeChartsHTML(category: String): List<Map<String, Any>> {
        // Try each chart URL in order — stop at first that returns valid data.
        // TrendingVideos/RightNow was removed July 2025 along with the Trending page.
        for (chartUrl in CHART_URLS) {
            val url = "$chartUrl?hl=en"
            Log.d(TAG, "📊 Charts HTML → $url")
            try {
                val request = Request.Builder()
                    .url(url)
                    .header("User-Agent", USER_AGENT)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .header("DNT", "1")
                    .build()

                val body = httpClient.newCall(request).execute().use { r ->
                    if (!r.isSuccessful) {
                        Log.d(TAG, "Charts $url → ${r.code}, trying next")
                        return@use null
                    }
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
            } catch (e: Exception) {
                Log.d(TAG, "Charts $url failed: ${e.message}, trying next")
            }
        }
        throw IOException("No chart data found from any chart URL")
    }

    private fun extractYtInitialData(html: String): String? {
        // Use indexOf to find the assignment start — avoids catastrophic backtracking
        // on YouTube's ~400KB HTML with greedy DOT_MATCHES_ALL regex
        val markers = listOf(
            "ytInitialData = ",
            "ytInitialData=",
            """window["ytInitialData"] = """,
            "var ytInitialData = "
        )
        for (marker in markers) {
            val start = html.indexOf(marker)
            if (start == -1) continue
            val jsonStart = html.indexOf('{', start + marker.length)
            if (jsonStart == -1) continue
            // Find the balanced closing brace
            val jsonStr = extractBalancedJson(html, jsonStart) ?: continue
            if (jsonStr.length > 100) return jsonStr
        }
        return null
    }

    private fun extractYtInitialPlayerResponse(html: String): String? {
        val markers = listOf("ytInitialPlayerResponse = ", "ytInitialPlayerResponse=")
        for (marker in markers) {
            val start = html.indexOf(marker)
            if (start == -1) continue
            val jsonStart = html.indexOf('{', start + marker.length)
            if (jsonStart == -1) continue
            return extractBalancedJson(html, jsonStart)
        }
        return null
    }

    /**
     * Extract a balanced JSON object starting at [startIndex] in [html].
     * Much faster than greedy regex on large HTML.
     */
    private fun extractBalancedJson(html: String, startIndex: Int): String? {
        var depth = 0
        var inString = false
        var escape = false
        var i = startIndex
        while (i < html.length) {
            val c = html[i]
            when {
                escape          -> escape = false
                c == '\\'       -> if (inString) escape = true
                c == '"'        -> inString = !inString
                !inString && c == '{' -> depth++
                !inString && c == '}' -> {
                    depth--
                    if (depth == 0) return html.substring(startIndex, i + 1)
                }
            }
            i++
        }
        return null
    }

    private fun extractJsonLd(html: String): List<String> {
        val results = mutableListOf<String>()
        val pattern = """<script type="application/ld\+json">(.*?)</script>""".toRegex(RegexOption.DOT_MATCHES_ALL)
        for (match in pattern.findAll(html)) {
            val s = match.groupValues[1].trim()
            if (s.contains("\"@type\"") && (s.contains("VideoObject") ||
                s.contains("MusicRecording") || s.contains("ItemList"))) results.add(s)
        }
        return results
    }

    private fun parseYouTubeInitialData(jsonStr: String): List<Map<String, Any>> {
        val items = mutableListOf<Map<String, Any>>()
        try {
            val json = JSONObject(jsonStr)
            val contents = findVideoArray(json)

            if (contents != null) {
                for (i in 0 until contents.length()) {
                    val section = contents.optJSONObject(i) ?: continue

                    // itemSectionRenderer
                    section.optJSONObject("itemSectionRenderer")
                        ?.optJSONArray("contents")
                        ?.let { arr ->
                            for (j in 0 until arr.length()) {
                                extractVideoFromItem(arr.optJSONObject(j) ?: continue)?.let { items.add(it) }
                            }
                        }

                    // shelfRenderer
                    section.optJSONObject("shelfRenderer")
                        ?.optJSONObject("content")
                        ?.let { content ->
                            val shelf = content.optJSONObject("horizontalListRenderer")
                                ?.optJSONArray("items")
                                ?: content.optJSONObject("verticalListRenderer")
                                    ?.optJSONArray("items")
                            shelf?.let { arr ->
                                for (j in 0 until arr.length()) {
                                    extractVideoFromItem(arr.optJSONObject(j) ?: continue)?.let { items.add(it) }
                                }
                            }
                        }

                    // richSectionRenderer
                    section.optJSONObject("richSectionRenderer")
                        ?.optJSONObject("content")
                        ?.let { extractVideoFromRichContent(it)?.let { v -> items.add(v) } }

                    // musicResponsiveListItemRenderer
                    section.optJSONObject("musicResponsiveListItemRenderer")
                        ?.let { extractVideoFromMusicItem(it)?.let { v -> items.add(v) } }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "parseYouTubeInitialData error: ${e.message}", e)
        }
        Log.d(TAG, "parseYouTubeInitialData → ${items.size} items")
        return items
    }

    private fun findVideoArray(json: JSONObject): JSONArray? {
        val keys = json.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            when (val value = json.opt(key)) {
                is JSONArray -> if (value.length() > 0) {
                    val first = value.optJSONObject(0)
                    if (first != null && (first.has("videoRenderer") ||
                        first.has("playlistVideoRenderer") ||
                        first.has("musicResponsiveListItemRenderer") ||
                        first.has("gridVideoRenderer"))) return value
                }
                is JSONObject -> findVideoArray(value)?.let { return it }
            }
        }
        return null
    }

    private fun extractVideoFromItem(item: JSONObject): Map<String, Any>? {
        return extractVideoFromRenderer(
            item.optJSONObject("videoRenderer")
                ?: item.optJSONObject("playlistVideoRenderer")
                ?: item.optJSONObject("gridVideoRenderer")
                ?: item.optJSONObject("compactVideoRenderer")
                ?: item.optJSONObject("videoCardRenderer")
                ?: return null
        )
    }

    private fun extractVideoFromRichContent(content: JSONObject?): Map<String, Any>? {
        if (content == null) return null
        return extractVideoFromRenderer(
            content.optJSONObject("videoRenderer")
                ?: content.optJSONObject("richItemRenderer")
                    ?.optJSONObject("content")
                    ?.optJSONObject("videoRenderer")
                ?: return null
        )
    }

    private fun extractVideoFromMusicItem(musicItem: JSONObject): Map<String, Any>? {
        val videoId = musicItem.optJSONObject("playlistItemData")
            ?.optString("videoId", "")
            ?.takeIf { it.isNotEmpty() }
            ?: musicItem.optJSONObject("navigationEndpoint")
                ?.optJSONObject("watchEndpoint")
                ?.optString("videoId", "")
                ?.takeIf { it.isNotEmpty() }
            ?: return null

        val title = musicItem.optJSONArray("flexColumns")
            ?.optJSONObject(0)
            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")
            ?.optJSONObject("text")?.optJSONArray("runs")
            ?.optJSONObject(0)?.optString("text", "Unknown Title") ?: "Unknown Title"

        val artist = musicItem.optJSONArray("flexColumns")
            ?.optJSONObject(1)
            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")
            ?.optJSONObject("text")?.optJSONArray("runs")
            ?.optJSONObject(0)?.optString("text", "Unknown Artist") ?: "Unknown Artist"

        val thumbnails = buildThumbnails(musicItem, videoId)

        val durationText = musicItem.optJSONArray("fixedColumns")
            ?.optJSONObject(0)
            ?.optJSONObject("musicResponsiveListItemFixedColumnRenderer")
            ?.optJSONObject("text")?.optJSONArray("runs")
            ?.optJSONObject(0)?.optString("text", "") ?: ""

        return mapOf(
            "type" to "stream", "serviceId" to 0,
            "url" to "https://www.youtube.com/watch?v=$videoId",
            "name" to title, "uploaderName" to artist,
            "uploaderUrl" to "", "uploaderVerified" to false,
            "thumbnails" to thumbnails, "duration" to parseDuration(durationText),
            "viewCount" to 0L, "textualUploadDate" to "",
            "streamType" to "VIDEO_STREAM", "isLive" to false, "isShortFormContent" to false
        )
    }

    private fun extractVideoFromRenderer(videoRenderer: JSONObject): Map<String, Any>? {
        val videoId = videoRenderer.optString("videoId", "").takeIf { it.isNotEmpty() } ?: return null

        val title = videoRenderer.optJSONObject("title")
            ?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "Unknown Title")
            ?: videoRenderer.optJSONObject("headline")
                ?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "Unknown Title")
            ?: "Unknown Title"

        val uploaderName = videoRenderer.optJSONObject("longBylineText")
            ?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "Unknown Artist")
            ?: videoRenderer.optJSONObject("shortBylineText")
                ?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "Unknown Artist")
            ?: videoRenderer.optJSONObject("ownerText")
                ?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "Unknown Artist")
            ?: "Unknown Artist"

        val thumbArray = videoRenderer.optJSONObject("thumbnail")?.optJSONArray("thumbnails")
        val thumbnailList = if (thumbArray != null) {
            List(thumbArray.length()) { idx ->
                val t = thumbArray.optJSONObject(idx) ?: return@List mapOf<String, Any>()
                mapOf(
                    "url" to t.optString("url", ""),
                    "width" to t.optInt("width", 0),
                    "height" to t.optInt("height", 0),
                    "resolutionLevel" to when {
                        t.optInt("width", 0) >= 1280 -> "HIGH"
                        t.optInt("width", 0) >= 640  -> "MEDIUM"
                        else                          -> "LOW"
                    }
                )
            }.filter { it.isNotEmpty() }
        } else {
            listOf(mapOf("url" to "https://i.ytimg.com/vi/$videoId/hqdefault.jpg",
                "width" to 480, "height" to 360, "resolutionLevel" to "MEDIUM"))
        }

        val lengthText = videoRenderer.optJSONObject("lengthText")
            ?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "")
            ?: videoRenderer.optString("lengthSeconds", "")
        val duration = if (lengthText.isNotEmpty()) parseDuration(lengthText) else 0L

        val viewCountText = videoRenderer.optJSONObject("viewCountText")
            ?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "") ?: ""
        val viewCount = parseViewCount(viewCountText)

        val isLive = videoRenderer.optJSONObject("badges")?.toString()?.contains("LIVE") == true
        val isShortForm = videoRenderer.optBoolean("isShort", false) ||
            title.contains("#shorts", ignoreCase = true)

        return mapOf(
            "type" to "stream", "serviceId" to 0,
            "url" to "https://www.youtube.com/watch?v=$videoId",
            "name" to title, "uploaderName" to uploaderName,
            "uploaderUrl" to "", "uploaderVerified" to false,
            "thumbnails" to thumbnailList, "duration" to duration,
            "viewCount" to viewCount, "textualUploadDate" to "",
            "streamType" to if (isLive) "LIVE_STREAM" else "VIDEO_STREAM",
            "isLive" to isLive, "isShortFormContent" to isShortForm
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
                        val item = list.optJSONObject(i)?.optJSONObject("item") ?: continue
                        val videoId = extractVideoIdFromUrl(item.optString("url", ""))
                            ?: extractVideoIdFromUrl(item.optString("@id", "")) ?: continue
                        val title = item.optString("name", "Unknown Title")
                        val artist = item.optJSONObject("byArtist")?.optString("name", "Unknown Artist")
                            ?: "Unknown Artist"
                        items.add(buildSimpleVideoMap(videoId, title, artist))
                    }
                }
                if (type == "VideoObject" || type == "MusicRecording") {
                    val videoId = extractVideoIdFromUrl(json.optString("url", ""))
                        ?: extractVideoIdFromUrl(json.optString("@id", "")) ?: continue
                    items.add(buildSimpleVideoMap(
                        videoId,
                        json.optString("name", "Unknown Title"),
                        json.optJSONObject("byArtist")?.optString("name", "Unknown Artist") ?: "Unknown Artist"
                    ))
                }
            } catch (e: Exception) {
                Log.w(TAG, "JSON-LD parse error: ${e.message}")
            }
        }
        return items
    }

    private fun buildSimpleVideoMap(videoId: String, title: String, artist: String): Map<String, Any> = mapOf(
        "type" to "stream", "serviceId" to 0,
        "url" to "https://www.youtube.com/watch?v=$videoId",
        "name" to title, "uploaderName" to artist,
        "uploaderUrl" to "", "uploaderVerified" to false,
        "thumbnails" to listOf(mapOf(
            "url" to "https://i.ytimg.com/vi/$videoId/hqdefault.jpg",
            "width" to 480, "height" to 360, "resolutionLevel" to "MEDIUM"
        )),
        "duration" to 0L, "viewCount" to 0L, "textualUploadDate" to "",
        "streamType" to "VIDEO_STREAM", "isLive" to false, "isShortFormContent" to false
    )

    private fun parsePlayerResponse(jsonStr: String): List<Map<String, Any>> {
        val items = mutableListOf<Map<String, Any>>()
        try {
            val json = JSONObject(jsonStr)
            val results = json.optJSONObject("watchNextResponse")
                ?.optJSONObject("contents")
                ?.optJSONObject("twoColumnWatchNextResults")
                ?.optJSONObject("secondaryResults")
                ?.optJSONObject("secondaryResults")
                ?.optJSONArray("results")

            if (results != null) {
                for (i in 0 until results.length()) {
                    val r = results.optJSONObject(i) ?: continue
                    val renderer = r.optJSONObject("compactVideoRenderer")
                        ?: r.optJSONObject("compactAutoplayVideoRenderer") ?: continue
                    extractVideoFromRenderer(renderer)?.let { items.add(it) }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "parsePlayerResponse error: ${e.message}", e)
        }
        return items
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun extractVideoIdFromUrl(url: String): String? {
        if (url.isEmpty()) return null
        if (url.contains("youtu.be/")) return url.substringAfter("youtu.be/").substringBefore("?").substringBefore("&")
        if (url.contains("v=")) return url.substringAfter("v=").substringBefore("&").substringBefore("?")
        if (url.contains("/shorts/")) return url.substringAfter("/shorts/").substringBefore("?").substringBefore("&")
        if (url.contains("/embed/")) return url.substringAfter("/embed/").substringBefore("?").substringBefore("&")
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

    // ── Service Resolution ────────────────────────────────────────────────────

    /**
     * Get a StreamingService by ID using the canonical NewPipe API.
     * Per NewPipe.java javadoc: NewPipe.getService(int serviceId)
     * throws ExtractionException if no service with that ID is registered.
     * Service IDs: 0=YouTube, 1=SoundCloud, 2=MediaCCC, 3=PeerTube, 4=Bandcamp.
     */
    private fun getService(serviceId: Int): StreamingService =
        NewPipe.getService(serviceId)

    /**
     * YouTube (serviceId=0) is the default service per NewPipe convention.
     */
    private fun getDefaultService(): StreamingService =
        NewPipe.getService(0)

    /**
     * Resolve a service from a URL by probing registered services.
     * Used when caller does not specify a serviceId — iterates NewPipe.getServices()
     * and checks each service's getLinkTypeByUrl().
     */
    private fun getServiceForUrl(url: String): StreamingService =
        NewPipe.getServices().firstOrNull { service ->
            try { service.getLinkTypeByUrl(url) != StreamingService.LinkType.NONE }
            catch (_: Exception) { false }
        } ?: throw ExtractionException("No service can handle URL: $url")

    /**
     * If serviceId is provided use it directly via NewPipe.getService(id).
     * Otherwise auto-detect service from the URL.
     */
    private fun resolveService(url: String, serviceId: Int?): StreamingService =
        if (serviceId != null) getService(serviceId) else getServiceForUrl(url)

    private fun getServicesList(): List<Map<String, Any>> {
        if (!isInitialized) return emptyList()
        // NewPipe.getServices() is the canonical public API per docs.
        return NewPipe.getServices().map { s ->
            mapOf<String, Any>(
                "id"                to s.serviceId,
                "name"              to s.serviceInfo.name,
                "baseUrl"           to (s.baseUrl ?: ""),
                "mediaCapabilities" to s.serviceInfo.mediaCapabilities.map { it.name }
            )
        }
    }

    // ── Stream Extraction ─────────────────────────────────────────────────────

    private fun extractStreamInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        return streamInfoToMap(StreamInfo.getInfo(service.getStreamExtractor(url)), service.serviceId)
    }

    private fun extractStreamInfoById(videoId: String, serviceId: Int?): Map<String, Any> {
        val service = if (serviceId != null) getService(serviceId) else getDefaultService()
        val linkHandler = service.streamLHFactory.fromId(videoId)
        return streamInfoToMap(StreamInfo.getInfo(service.getStreamExtractor(linkHandler)), service.serviceId)
    }

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
            put("uploaderSubscriberCount", info.uploaderSubscriberCount.coerceAtLeast(0))
            put("duration",                info.duration)
            put("viewCount",               info.viewCount.coerceAtLeast(0))
            put("likeCount",               info.likeCount.coerceAtLeast(0))
            put("dislikeCount",            info.dislikeCount.coerceAtLeast(0))
            put("description",             info.description.content)
            put("uploadDate",              info.uploadDate?.offsetDateTime()?.toString() ?: "")
            put("textualUploadDate",       info.textualUploadDate.orEmpty())
            put("thumbnails",              info.thumbnails.map { imageToMap(it) })
            put("streamType",              info.streamType.name)
            put("isLive",                  info.streamType == LIVE_STREAM || info.streamType == AUDIO_LIVE_STREAM)
            put("isShortFormContent",      info.isShortFormContent)
            put("availability",            info.getContentAvailability().name)
            put("ageLimit",                info.ageLimit)
            put("tags",                    info.tags)
            put("category",                info.category.orEmpty())
            put("audioStreams",            info.audioStreams.map { audioStreamToMap(it) })
            put("videoStreams",            info.videoStreams.map { videoStreamToMap(it) })
            put("videoOnlyStreams",        info.videoOnlyStreams.map { videoStreamToMap(it) })
            put("dashMpdUrl",              info.dashMpdUrl.orEmpty())
            put("hlsUrl",                  info.hlsUrl.orEmpty())
            put("subtitles",               info.subtitles.map { subtitleToMap(it) })
            put("relatedItems",            info.relatedItems.take(20).mapNotNull { infoItemToMap(it) })
            put("metaInfo",                info.metaInfo.map { m ->
                mapOf<String, Any>(
                    "title"    to m.title.orEmpty(),
                    "content"  to (m.content?.content ?: ""),
                    "urls"     to m.urls.map { it.toString() },
                    "urlTexts" to m.urlTexts
                )
            })
        }

    private fun getBestStreamUrl(url: String, format: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = StreamInfo.getInfo(service.getStreamExtractor(url))
        val best = when (format.lowercase()) {
            "audio", "mp3", "m4a", "ogg" -> info.audioStreams.maxByOrNull { it.getBitrate() }?.content
            "video", "mp4", "best"        -> info.videoStreams.maxByOrNull { it.getHeight() }?.content
                ?: info.videoOnlyStreams.maxByOrNull { it.getHeight() }?.content
            "dash"                        -> info.dashMpdUrl.takeIf { it.isNotEmpty() }
            "hls"                         -> info.hlsUrl.takeIf { it.isNotEmpty() }
            else                          -> info.audioStreams.maxByOrNull { it.getBitrate() }?.content
        }
        return mapOf<String, Any>(
            "success"      to (best != null),
            "url"          to (best ?: ""),
            "format"       to format,
            "title"        to info.name.orEmpty(),
            "duration"     to info.duration,
            "fallbackUrls" to listOfNotNull(
                info.dashMpdUrl.takeIf { it.isNotEmpty() },
                info.hlsUrl.takeIf { it.isNotEmpty() }
            )
        )
    }

    private fun extractAudioStreams(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = StreamInfo.getInfo(service.getStreamExtractor(url))
        return mapOf<String, Any>("success" to true, "title" to info.name.orEmpty(),
            "audioStreams" to info.audioStreams.map { audioStreamToMap(it) })
    }

    private fun extractVideoStreams(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = StreamInfo.getInfo(service.getStreamExtractor(url))
        return mapOf<String, Any>("success" to true, "title" to info.name.orEmpty(),
            "videoStreams"     to info.videoStreams.map { videoStreamToMap(it) },
            "videoOnlyStreams" to info.videoOnlyStreams.map { videoStreamToMap(it) })
    }

    private fun extractSubtitles(url: String, language: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = StreamInfo.getInfo(service.getStreamExtractor(url))
        val all = info.subtitles
        val filtered = if (language.isNullOrBlank()) all
                       else all.filter { it.getLanguageTag().equals(language, ignoreCase = true) }
        return mapOf<String, Any>("success" to true, "title" to info.name.orEmpty(),
            "subtitles" to filtered.map { subtitleToMap(it) },
            "availableLanguages" to all.map { it.getLanguageTag() }.distinct())
    }

    // ── Comments ──────────────────────────────────────────────────────────────

    private fun extractComments(url: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        return if (pageUrl.isNullOrEmpty()) {
            val info = CommentsInfo.getInfo(service, url)
            mapOf<String, Any>(
                "success" to true, "disabled" to info.isCommentsDisabled,
                "commentsCount" to info.commentsCount,
                "comments" to info.relatedItems.map { commentItemToMap(it) },
                "nextPage" to pageOrEmpty(info.nextPage), "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message.orEmpty() }
            )
        } else {
            val more = CommentsInfo.getMoreItems(service, url, Page(pageUrl))
            mapOf<String, Any>(
                "success" to true,
                "comments" to more.items.map { commentItemToMap(it) },
                "nextPage" to pageOrEmpty(more.nextPage), "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message.orEmpty() }
            )
        }
    }

    private fun extractCommentReplies(commentsUrl: String, repliesPageUrl: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(commentsUrl, serviceId)
        val page = CommentsInfo.getMoreItems(service, commentsUrl, Page(repliesPageUrl))
        return mapOf<String, Any>(
            "success" to true,
            "replies" to page.items.map { commentItemToMap(it) },
            "nextPage" to pageOrEmpty(page.nextPage), "hasNextPage" to (page.nextPage != null),
            "errors" to page.errors.map { it.message.orEmpty() }
        )
    }

    private fun commentItemToMap(item: CommentsInfoItem): Map<String, Any> = mapOf<String, Any>(
        "authorName"             to item.uploaderName.orEmpty(),
        "authorUrl"              to item.uploaderUrl.orEmpty(),
        "authorAvatars"          to item.uploaderAvatars.map { imageToMap(it) },
        "authorVerified"         to item.isUploaderVerified,
        "commentId"              to item.commentId.orEmpty(),
        "commentText"            to item.commentText.content,
        "publishedTime"          to item.textualUploadDate.orEmpty(),
        "publishedTimestamp"     to (item.uploadDate?.offsetDateTime()?.toEpochSecond() ?: 0L),
        "likeCount"              to item.likeCount.coerceAtLeast(0),
        "textualLikeCount"       to item.textualLikeCount.orEmpty(),
        "replyCount"             to item.replyCount,
        "repliesPageUrl"         to (item.getReplies()?.url ?: ""),
        "hasReplies"             to (item.replyCount > 0 || item.getReplies() != null),
        "isPinned"               to item.isPinned,
        "isHearted"              to item.isHeartedByUploader,
        "isChannelOwner"         to item.isChannelOwner,
        "hasCreatorReply"        to item.hasCreatorReply(),
        "streamPosition"         to item.streamPosition
    )

    // ── Search ────────────────────────────────────────────────────────────────

    /**
     * Search via NewPipe API.
     *
     * Per StreamingService javadoc:
     *   getSearchExtractor(String query, List<String> contentFilter, String sortFilter)
     *   Returns a SearchExtractor. Call fetchPage() then SearchInfo.getInfo(extractor).
     *
     * Per SearchQueryHandlerFactory javadoc:
     *   fromQuery(String query, List<String> contentFilter, String sortFilter)
     *   contentFilter = emptyList() means NO filter (all content types).
     *   DO NOT pass listOf("all") — "all" is not a valid NewPipe filter token.
     *
     * Per SearchInfo javadoc:
     *   getInfo(StreamingService, SearchQueryHandler) for first page.
     *   getMoreItems(StreamingService, SearchQueryHandler, Page) for pagination.
     *   The handler must be re-created with the same query+filters for getMoreItems.
     *
     * filter: null or blank → emptyList() (no filter, returns all content types)
     *         non-blank     → listOf(filter) e.g. listOf("music_songs")
     */
    private fun performSearch(query: String, filter: String?, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        // NewPipe.getService(id) is the canonical lookup per API docs.
        // serviceId null → service 0 (YouTube) via NewPipe.getService(0).
        val service = NewPipe.getService(serviceId ?: 0)

        // Build contentFilter list. emptyList() = no filter per API docs.
        val contentFilters: List<String> = if (filter.isNullOrBlank()) emptyList() else listOf(filter)

        // sortFilter: "" = no sort (default relevance). NewPipe docs: pass "" for default.
        val sortFilter = ""

        return if (pageUrl.isNullOrEmpty()) {
            // First page: use service.getSearchExtractor(query, contentFilters, sortFilter)
            // per StreamingService javadoc. Then SearchInfo.getInfo(extractor).
            val extractor = service.getSearchExtractor(query, contentFilters, sortFilter)
            extractor.fetchPage()
            val info = SearchInfo.getInfo(extractor)
            mapOf<String, Any>(
                "success"          to true,
                "query"            to info.searchString.orEmpty(),
                "suggestion"       to info.searchSuggestion.orEmpty(),
                "isCorrectedSearch" to info.isCorrectedSearch,
                "results"          to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage"         to pageOrEmpty(info.nextPage),
                "hasNextPage"      to (info.nextPage != null),
                "errors"           to info.errors.map { it.message.orEmpty() }
            )
        } else {
            // Subsequent pages: SearchInfo.getMoreItems(service, handler, page).
            // handler must be re-built with same query+filters per API docs.
            val handler = service.searchQHFactory.fromQuery(query, contentFilters, sortFilter)
            val more = SearchInfo.getMoreItems(service, handler, Page(pageUrl))
            mapOf<String, Any>(
                "success"     to true,
                "results"     to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage"    to pageOrEmpty(more.nextPage),
                "hasNextPage" to (more.nextPage != null),
                "errors"      to more.errors.map { it.message.orEmpty() }
            )
        }
    }

    private fun getSearchSuggestions(query: String, serviceId: Int?): List<String> {
        val service = if (serviceId != null) getService(serviceId) else getDefaultService()
        return service.getSuggestionExtractor().suggestionList(query)
    }

    private fun getAvailableSearchFilters(serviceId: Int?): Map<String, Any> {
        // NewPipe.getService(id) per API docs. 0=YouTube is default.
        val service = NewPipe.getService(serviceId ?: 0)
        return mapOf<String, Any>(
            "serviceId" to service.serviceId,
            "serviceName" to service.serviceInfo.name,
            "availableFilters" to service.searchQHFactory.availableContentFilter.toList()
        )
    }

    // ── Playlist ──────────────────────────────────────────────────────────────

    private fun extractPlaylistInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = PlaylistInfo.getInfo(service, url)
        return mapOf<String, Any>(
            "success" to true, "serviceId" to service.serviceId,
            "id" to info.id, "url" to info.url, "originalUrl" to info.originalUrl,
            "name" to info.name.orEmpty(), "description" to info.description.content,
            "thumbnails" to info.thumbnails.map { imageToMap(it) },
            "uploaderName" to info.uploaderName.orEmpty(),
            "uploaderUrl" to info.uploaderUrl.orEmpty(),
            "uploaderAvatars" to info.uploaderAvatars.map { imageToMap(it) },
            "streamCount" to info.streamCount.coerceAtLeast(0),
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
            mapOf<String, Any>(
                "success" to true, "items" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(info.nextPage), "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message.orEmpty() }
            )
        } else {
            val more = PlaylistInfo.getMoreItems(service, url, Page(pageUrl))
            mapOf<String, Any>(
                "success" to true, "items" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(more.nextPage), "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message.orEmpty() }
            )
        }
    }

    // ── Channel ───────────────────────────────────────────────────────────────

    private fun extractChannelInfo(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val info = ChannelInfo.getInfo(service, url)
        return mapOf<String, Any>(
            "success" to true, "serviceId" to service.serviceId,
            "id" to info.id, "url" to info.url, "originalUrl" to info.originalUrl,
            "name" to info.name.orEmpty(), "description" to info.description.orEmpty(),
            "avatars" to info.avatars.map { imageToMap(it) },
            "banners" to info.banners.map { imageToMap(it) },
            "feedUrl" to info.feedUrl.orEmpty(),
            "subscriberCount" to info.subscriberCount.coerceAtLeast(0),
            "isVerified" to info.isVerified,
            "tabs" to info.tabs.map { tabLinkHandlerToMap(it) },
            "errors" to info.errors.map { it.message.orEmpty() }
        )
    }

    private fun tabLinkHandlerToMap(tab: ListLinkHandler): Map<String, Any> = mapOf<String, Any>(
        "name" to (tab.contentFilters.firstOrNull() ?: ""),
        "contentFilters" to tab.contentFilters, "url" to tab.url
    )

    private fun extractChannelTabItems(channelUrl: String, tabFilter: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = resolveService(channelUrl, serviceId)
        val channelInfo = ChannelInfo.getInfo(service, channelUrl)
        val targetTab: ListLinkHandler = (
            if (tabFilter.isBlank()) channelInfo.tabs.firstOrNull()
            else channelInfo.tabs.firstOrNull { t -> t.contentFilters.any { it.equals(tabFilter, ignoreCase = true) } }
        ) ?: throw ExtractionException("No tab matching filter '$tabFilter'")

        return if (pageUrl.isNullOrEmpty()) {
            val tabInfo = ChannelTabInfo.getInfo(service, targetTab)
            mapOf<String, Any>(
                "success" to true, "tabName" to (targetTab.contentFilters.firstOrNull() ?: ""),
                "tabFilter" to tabFilter, "items" to tabInfo.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(tabInfo.nextPage), "hasNextPage" to (tabInfo.nextPage != null),
                "errors" to tabInfo.errors.map { it.message.orEmpty() }
            )
        } else {
            val more = ChannelTabInfo.getMoreItems(service, targetTab, Page(pageUrl))
            mapOf<String, Any>(
                "success" to true, "tabName" to (targetTab.contentFilters.firstOrNull() ?: ""),
                "tabFilter" to tabFilter, "items" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(more.nextPage), "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message.orEmpty() }
            )
        }
    }

    private fun extractChannelFeed(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val feedExtractor = service.getFeedExtractor(url)
            ?: return mapOf<String, Any>("success" to false, "error" to "NO_FEED",
                "message" to "No feed available for this service/channel")
        val feedInfo = FeedInfo.getInfo(feedExtractor)
        return mapOf<String, Any>("success" to true, "name" to feedInfo.name.orEmpty(),
            "items" to feedInfo.relatedItems.mapNotNull { infoItemToMap(it) },
            "errors" to feedInfo.errors.map { it.message.orEmpty() })
    }

    // ── Kiosk ─────────────────────────────────────────────────────────────────

    private fun listAvailableKiosks(serviceId: Int?): Map<String, Any> {
        val service = if (serviceId != null) getService(serviceId) else getDefaultService()
        val kioskList = service.kioskList
        val kiosks = kioskList.availableKiosks.map { id ->
            val entry = mutableMapOf<String, Any>()
            try {
                val extractor = kioskList.getExtractorById(id, null)
                entry["id"] = id; entry["name"] = extractor.name
                entry["url"] = extractor.url; entry["available"] = true
            } catch (e: Exception) {
                entry["id"] = id; entry["name"] = id
                entry["available"] = false; entry["error"] = e.message ?: ""
            }
            entry
        }
        return mapOf<String, Any>("success" to true, "serviceId" to service.serviceId,
            "defaultKioskId" to kioskList.defaultKioskId, "kiosks" to kiosks)
    }

    private fun extractKioskInfo(kioskId: String, pageUrl: String?, serviceId: Int?): Map<String, Any> {
        val service = if (serviceId != null) getService(serviceId) else getDefaultService()
        // Guard: "Trending" kiosk was removed by YouTube on 2025-07-21 and from
        // NewPipeExtractor in v0.24.8. Attempting to use it throws inside getExtractorById.
        // The default kiosk is now "Live". Callers should use getTrendingWithFallback instead.
        val availableKiosks = service.kioskList.availableKiosks
        if (!availableKiosks.contains(kioskId)) {
            return mapOf(
                "success" to false,
                "kioskId" to kioskId,
                "error"   to "KIOSK_NOT_FOUND",
                "message" to "Kiosk '$kioskId' does not exist. Available: $availableKiosks",
                "items"   to emptyList<Map<String, Any>>()
            )
        }
        val kioskUrl = service.kioskList.getExtractorById(kioskId, null).url
        return if (pageUrl.isNullOrEmpty()) {
            val info = KioskInfo.getInfo(service, kioskUrl)
            mapOf<String, Any>(
                "success" to true, "kioskId" to kioskId, "name" to info.name.orEmpty(),
                "items" to info.relatedItems.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(info.nextPage), "hasNextPage" to (info.nextPage != null),
                "errors" to info.errors.map { it.message.orEmpty() }
            )
        } else {
            val more = KioskInfo.getMoreItems(service, kioskUrl, Page(pageUrl))
            mapOf<String, Any>(
                "success" to true, "kioskId" to kioskId,
                "items" to more.items.mapNotNull { infoItemToMap(it) },
                "nextPage" to pageOrEmpty(more.nextPage), "hasNextPage" to (more.nextPage != null),
                "errors" to more.errors.map { it.message.orEmpty() }
            )
        }
    }

    // ── URL Utilities ─────────────────────────────────────────────────────────

    /**
     * Extract the canonical content ID for a given URL and link type.
     * Guards against null factories — services like MediaCCC don't support all link types.
     * getLinkTypeByUrl() is always called before this, so NONE is already excluded.
     */
    private fun extractIdForLinkType(
        service: StreamingService,
        linkType: StreamingService.LinkType,
        url: String
    ): String = when (linkType) {
        StreamingService.LinkType.STREAM -> service.streamLHFactory.fromUrl(url).id
        StreamingService.LinkType.CHANNEL -> {
            val factory = service.channelLHFactory
                ?: throw ExtractionException("Service '${service.serviceInfo.name}' does not support channels")
            factory.fromUrl(url).id
        }
        StreamingService.LinkType.PLAYLIST -> {
            val factory = service.playlistLHFactory
                ?: throw ExtractionException("Service '${service.serviceInfo.name}' does not support playlists")
            factory.fromUrl(url).id
        }
        StreamingService.LinkType.NONE -> throw ExtractionException("URL not handled: $url")
    }

    private fun resolveUrl(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val linkType = try {
            service.getLinkTypeByUrl(url)
        } catch (e: Exception) {
            throw ExtractionException("Could not determine link type for URL: $url — ${e.message}", e)
        }
        if (linkType == StreamingService.LinkType.NONE)
            throw ExtractionException("URL not handled by service '${service.serviceInfo.name}': $url")
        val id = extractIdForLinkType(service, linkType, url)
        return mapOf<String, Any>(
            "type"        to linkType.name.lowercase(),
            "id"          to id,
            "url"         to url,
            "serviceId"   to service.serviceId,
            "serviceName" to service.serviceInfo.name
        )
    }

    private fun checkCanHandle(url: String, serviceId: Int?): Map<String, Any> {
        if (serviceId != null) {
            val service = getService(serviceId)
            val linkType = try {
                service.getLinkTypeByUrl(url)
            } catch (_: Exception) {
                StreamingService.LinkType.NONE
            }
            return mapOf<String, Any>(
                "canHandle"   to (linkType != StreamingService.LinkType.NONE),
                "linkType"    to linkType.name.lowercase(),
                "serviceId"   to service.serviceId,
                "serviceName" to service.serviceInfo.name,
                "url"         to url
            )
        }
        // No serviceId — probe all services via canonical NewPipe.getServices() API
        var matchedLinkType = StreamingService.LinkType.NONE
        val match = NewPipe.getServices().firstOrNull { s ->
            try {
                val lt = s.getLinkTypeByUrl(url)
                if (lt != StreamingService.LinkType.NONE) { matchedLinkType = lt; true } else false
            } catch (_: Exception) { false }
        }
        return mapOf<String, Any>(
            "canHandle"   to (match != null),
            "linkType"    to matchedLinkType.name.lowercase(),
            "serviceId"   to (match?.serviceId ?: -1),
            "serviceName" to (match?.serviceInfo?.name ?: ""),
            "url"         to url
        )
    }

    private fun extractIdFromUrl(url: String, serviceId: Int?): Map<String, Any> {
        val service = resolveService(url, serviceId)
        val linkType = try {
            service.getLinkTypeByUrl(url)
        } catch (e: Exception) {
            throw ExtractionException("Could not determine link type for URL: $url — ${e.message}", e)
        }
        if (linkType == StreamingService.LinkType.NONE)
            throw ExtractionException("Cannot extract ID — URL not handled: $url")
        val id = extractIdForLinkType(service, linkType, url)
        return mapOf<String, Any>(
            "id"        to id,
            "type"      to linkType.name.lowercase(),
            "url"       to url,
            "serviceId" to service.serviceId
        )
    }

    // ── InfoItem mapping ──────────────────────────────────────────────────────

    private fun infoItemToMap(item: InfoItem): Map<String, Any>? = when (item) {
        is StreamInfoItem -> mapOf<String, Any>(
            "type" to "stream", "serviceId" to item.serviceId,
            "url" to item.url, "name" to item.name.orEmpty(),
            "uploaderName" to item.uploaderName.orEmpty(),
            "uploaderUrl" to item.uploaderUrl.orEmpty(),
            "uploaderVerified" to item.isUploaderVerified,
            "thumbnails" to item.thumbnails.map { imageToMap(it) },
            "duration" to item.duration.coerceAtLeast(0L),
            "viewCount" to item.viewCount.coerceAtLeast(0L),
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
            "streamCount" to item.streamCount.coerceAtLeast(0L),
            "playlistType" to (item.playlistType?.name ?: "NORMAL")
        )
        is ChannelInfoItem -> mapOf<String, Any>(
            "type" to "channel", "serviceId" to item.serviceId,
            "url" to item.url, "name" to item.name.orEmpty(),
            "thumbnails" to item.thumbnails.map { imageToMap(it) },
            "subscriberCount" to item.subscriberCount.coerceAtLeast(0L),
            "streamCount" to item.streamCount.coerceAtLeast(0L),
            "isVerified" to item.isVerified, "description" to item.description.orEmpty()
        )
        else -> null
    }

    // ── Stream field mapping ──────────────────────────────────────────────────

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
        "codec" to s.getCodec(), "width" to s.getWidth(), "height" to s.getHeight(),
        "fps" to s.getFps(), "bitrate" to s.getBitrate(),
        "quality" to s.getQuality(), "manifestUrl" to (s.manifestUrl ?: "")
    )

    private fun subtitleToMap(s: SubtitlesStream): Map<String, Any> = mapOf<String, Any>(
        "url" to s.content, "isUrl" to s.isUrl,
        "deliveryMethod" to s.deliveryMethod.name, "format" to (s.format?.name ?: ""),
        "languageTag" to s.getLanguageTag(),
        "displayLanguageName" to (s.displayLanguageName ?: ""),
        "isAutoGenerated" to s.isAutoGenerated, "manifestUrl" to (s.manifestUrl ?: "")
    )

    private fun imageToMap(img: Image): Map<String, Any> = mapOf<String, Any>(
        "url" to img.url, "width" to img.width, "height" to img.height,
        "resolutionLevel" to img.estimatedResolutionLevel.name
    )

    private fun pageOrEmpty(p: Page?): Map<String, Any> = p?.let { pageToMap(it) } ?: emptyMap()

    private fun pageToMap(p: Page): Map<String, Any> = mapOf<String, Any>(
        "url"     to (p.url ?: ""),
        "ids"     to (p.ids ?: emptyList<String>()),
        "cookies" to (p.cookies ?: emptyMap<String, String>())
    )

    // ── Downloader ────────────────────────────────────────────────────────────

    class MavinDownloader(private val client: OkHttpClient) : Downloader() {
        override fun execute(request: org.schabi.newpipe.extractor.downloader.Request): Response {
            val builder = Request.Builder().url(request.url())
            when (request.httpMethod()) {
                "POST" -> {
                    val body = request.dataToSend()
                    builder.post(
                        if (body != null)
                            body.toRequestBody("application/x-www-form-urlencoded".toMediaType())
                        else
                            ByteArray(0).toRequestBody()
                    )
                }
                "HEAD" -> builder.head()
                else   -> builder.get()
            }
            if (!request.headers().containsKey("User-Agent")) {
                builder.addHeader("User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            }
            request.headers().forEach { (key, values) ->
                values.forEach { value -> builder.addHeader(key, value) }
            }
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