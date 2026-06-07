/**
 * MavinEngine Native Module Wrapper
 *
 * Single source of truth JS/TS bridge.
 * Every type and function maps 1-to-1 to MavinEngineModule.kt.
 *
 * Kotlin module name:  "MavinEngine"
 * Extractor version:   NewPipeExtractor v0.26.0
 * Architecture:        v10.1.0 — getCookieHeader() consent pattern (official DownloaderImpl)
 *
 * ── v10.1.0 fixes (MavinEngineModule.kt) ─────────────────────────────────────
 *
 * [A] SimpleCookieJar removed — SOCS cookie injected per-request via
 *     YoutubeParsingHelper.getCookieHeader() in execute(). No Cookie.Builder,
 *     no domain strings, no CookieJar. Eliminates the init-time crash:
 *     IllegalArgumentException: unexpected domain: .youtube.com
 *
 * [B] execute() header forwarding: removeHeader() + addHeader() per key,
 *     matching the official DownloaderImpl (PR #11969, merged Jan 31 2025).
 *
 * [C] HTTP 429 → ReCaptchaException (official DownloaderImpl pattern).
 *
 * [D] setFetchIosClient(true) called at init — enables iOS player responses
 *     for better stream availability on restricted content.
 *
 * [E] AccountTerminatedException caught specifically in extractStreamInfo —
 *     surfaces as { success: false, error: "ACCOUNT_TERMINATED" } instead of
 *     triggering all fallback retry strategies.
 *
 * [F] DateWrapper.offsetDateTime() removed in v0.25.0 — now uses
 *     DateWrapper.date() (returns java.time.Instant) throughout.
 *     uploadDate in StreamInfo → Instant.toString() (ISO-8601 instant string).
 *     publishedTimestamp in CommentItem → Instant.epochSecond.toDouble().
 *
 * ── v10.0.0 changes (retained) ───────────────────────────────────────────────
 *
 * [G] POST Content-Type defaults to "application/json" (InnerTube fix).
 * [H] No getYouTubeHeaders() inside execute() (infinite recursion guard).
 * [I] visitorData prefetched on background thread.
 * [J] WEB client not used for stream extraction (SABR fix).
 * [K] Set<MediaCapability> returned by getMediaCapabilities() in v0.26.0 —
 *     handled in Kotlin's getServicesList(); arrives here as string[].
 *
 * ── Long → Double bridge rule ─────────────────────────────────────────────────
 * Every Kotlin Long field is converted to Double before crossing the bridge.
 * Fields confirmed as Int in the Kotlin javadoc are passed as-is (no toDouble()).
 * All such fields arrive in JS as number regardless.
 *
 * Service IDs (NewPipe standard):
 *   0 = YouTube  |  1 = SoundCloud  |  2 = media.ccc.de
 *   3 = PeerTube  |  4 = Bandcamp
 */

import { requireNativeModule } from 'expo-modules-core';

const Native = requireNativeModule('MavinEngine');

if (!Native) {
  console.error('[MavinEngine] CRITICAL: native module not loaded.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kotlin: Image — width/height are int (no toDouble()).
 * resolutionLevel maps to Image.ResolutionLevel.name via estimatedResolutionLevel.
 */
export interface NativeImage {
  url:             string;
  width:           number;  // int in Kotlin
  height:          number;  // int in Kotlin
  resolutionLevel: 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
}

/**
 * Pagination cursor from the Kotlin layer.
 * When there is no next page, nextPage is an empty object {}.
 * Always use hasNextPage to check — never inspect nextPage.url directly.
 * Kotlin: pageToMap() → { url, ids, cookies }.
 */
export interface NativePage {
  url:     string;
  ids:     string[];
  cookies: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AudioStream — audioStreamToMap() in Kotlin.
 * Note: Kotlin writes s.content to "url" key (DeliveryData.content = playback URL).
 * bitrate, audioTrackId, audioTrackName, audioLocale, audioTrackType are all
 * @Nullable in the extractor — normalised to "" in Kotlin, never null here.
 */
export interface AudioStream {
  /** s.content — the playable URL or manifest URL */
  url:            string;
  isUrl:          boolean;
  deliveryMethod: string;
  format:         string;
  codec:          string;
  /** int in Kotlin (getBitrate() returns Int) */
  bitrate:        number;
  audioTrackId:   string;
  audioTrackName: string;
  /** BCP-47 language tag, e.g. "en-US" — empty string if not set */
  audioLocale:    string;
  /** AudioTrackType enum name, e.g. "ORIGINAL" — empty string if not set */
  audioTrackType: string;
  manifestUrl:    string;
}

/**
 * VideoStream — videoStreamToMap() in Kotlin.
 * width, height, fps, bitrate are all int in the extractor (no toDouble()).
 * Note: Kotlin writes s.content to "url" key.
 */
export interface VideoStream {
  /** s.content — the playable URL or manifest URL */
  url:            string;
  isUrl:          boolean;
  deliveryMethod: string;
  format:         string;
  codec:          string;
  /** int in Kotlin (getWidth() returns Int) */
  width:          number;
  /** int in Kotlin (getHeight() returns Int) */
  height:         number;
  /** int in Kotlin (getFps() returns Int) */
  fps:            number;
  /** int in Kotlin (getBitrate() returns Int) */
  bitrate:        number;
  quality:        string;
  manifestUrl:    string;
}

/**
 * SubtitlesStream — subtitleToMap() in Kotlin.
 * Note: Kotlin writes s.content to "url" key.
 */
export interface SubtitleStream {
  /** s.content — the playable URL */
  url:                 string;
  isUrl:               boolean;
  deliveryMethod:      string;
  format:              string;
  languageTag:         string;
  /** @Nullable in extractor — empty string if not set */
  displayLanguageName: string;
  isAutoGenerated:     boolean;
  manifestUrl:         string;
}

/**
 * StreamSegment — segmentToMap() in Kotlin.
 * startTimeSeconds is int in the extractor (javadoc confirmed — NOT Long).
 * channelName, url, previewUrl are @Nullable — normalised to "" in Kotlin.
 */
export interface StreamSegment {
  title:            string;
  /** int in Kotlin — seconds from stream start */
  startTimeSeconds: number;
  /** @Nullable — empty string if not provided */
  channelName:      string;
  /** @Nullable — direct URL to this segment, empty string if not provided */
  url:              string;
  /** @Nullable — thumbnail URL for this segment, empty string if not provided */
  previewUrl:       string;
}

/**
 * Frameset — framesetToMap() in Kotlin.
 * Used by StreamInfo.previewFrames for seek-preview storyboard images.
 * All int fields in the extractor.
 */
export interface Frameset {
  urls:             string[];
  /** int in Kotlin */
  frameWidth:       number;
  /** int in Kotlin */
  frameHeight:      number;
  /** int in Kotlin */
  totalCount:       number;
  /** int in Kotlin — milliseconds per frame */
  durationPerFrame: number;
  /** int in Kotlin */
  framesPerPageX:   number;
  /** int in Kotlin */
  framesPerPageY:   number;
}

export interface MetaInfo {
  title:    string;
  content:  string;
  urls:     string[];
  urlTexts: string[];
}

export type StreamType =
  | 'VIDEO_STREAM'
  | 'AUDIO_STREAM'
  | 'LIVE_STREAM'
  | 'AUDIO_LIVE_STREAM'
  | 'POST_LIVE_STREAM'
  | 'POST_LIVE_AUDIO_STREAM'
  | 'NONE';

/**
 * StreamExtractor.ContentAvailability enum name.
 * Returned by info.getContentAvailability().name in Kotlin.
 */
export type StreamAvailability =
  | 'AVAILABLE'
  | 'GEOBLOCKED'
  | 'NOT_YET_AVAILABLE'
  | 'PAYMENT_REQUIRED'
  | 'PREMIUM_ONLY'
  | 'PRIVATE'
  | 'SUBSCRIBER_ONLY'
  | 'UNKNOWN'
  | 'UNAVAILABLE';

/**
 * StreamExtractor.Privacy enum name.
 * Returned by info.privacy.name in Kotlin.
 */
export type StreamPrivacy =
  | 'PUBLIC'
  | 'UNLISTED'
  | 'PRIVATE'
  | 'INTERNAL'
  | 'OTHER';

// ─────────────────────────────────────────────────────────────────────────────
// InfoItem union — infoItemToMap() in Kotlin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Long fields (duration, viewCount) coerced to >= 0 then toDouble() in Kotlin.
 * Arrive here as JS number.
 */
export interface StreamInfoItem {
  type:              'stream';
  serviceId:         number;
  url:               string;
  name:              string;
  uploaderName:      string;
  uploaderUrl:       string;
  uploaderVerified:  boolean;
  thumbnails:        NativeImage[];
  /** Seconds — Long→Double in Kotlin. 0 if unknown. */
  duration:          number;
  /** Long→Double in Kotlin. 0 if unknown. */
  viewCount:         number;
  textualUploadDate: string;
  streamType:        StreamType;
  isLive:            boolean;
  isShortFormContent: boolean;
}

/**
 * streamCount is Long in extractor, coerced to >= 0 then toDouble() in Kotlin.
 * playlistType is PlaylistInfo.PlaylistType?.name ?: "NORMAL".
 */
export interface PlaylistInfoItem {
  type:         'playlist';
  serviceId:    number;
  url:          string;
  name:         string;
  uploaderName: string;
  uploaderUrl:  string;
  thumbnails:   NativeImage[];
  /** Long→Double in Kotlin. 0 if unknown. */
  streamCount:  number;
  playlistType: string;
}

/**
 * subscriberCount, streamCount are Long in extractor, coerced then toDouble().
 * description is @Nullable — normalised to "" in Kotlin.
 */
export interface ChannelInfoItem {
  type:            'channel';
  serviceId:       number;
  url:             string;
  name:            string;
  thumbnails:      NativeImage[];
  /** Long→Double in Kotlin. 0 if unknown. */
  subscriberCount: number;
  /** Long→Double in Kotlin. 0 if unknown. */
  streamCount:     number;
  isVerified:      boolean;
  description:     string;
}

export type InfoItem = StreamInfoItem | PlaylistInfoItem | ChannelInfoItem;

// ─────────────────────────────────────────────────────────────────────────────
// Full StreamInfo — streamInfoToMap() in Kotlin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returned by getStreamInfo() and getStreamInfoById().
 *
 * On success:  { success: true, ...all fields }
 * On AccountTerminatedException: { success: false, error: "ACCOUNT_TERMINATED", message: string }
 *
 * Long fields coerced to >= 0 then toDouble() in Kotlin.
 * Int fields passed as-is.
 *
 * uploadDate: ISO-8601 instant string (e.g. "2024-01-15T12:34:56Z").
 * In Kotlin: info.uploadDate?.date?.toString() ?: ""
 * Fix [F]: DateWrapper.offsetDateTime() was removed in v0.25.0.
 *          DateWrapper.date() returns java.time.Instant.
 *
 * likeCount/dislikeCount: coerceAtLeast(0L) — never negative at the bridge.
 * YouTube has not returned public dislike counts since 2021; dislikeCount
 * will always be 0 for YouTube streams.
 */
export interface StreamInfo {
  success:   boolean;

  // ── Error fields — only present when success === false ─────────────────────
  /** Only present when success === false */
  error?:   'ACCOUNT_TERMINATED' | string;
  /** Human-readable error detail — only present when success === false */
  message?: string;

  // ── Identity ───────────────────────────────────────────────────────────────
  serviceId:   number;
  id:          string;
  url:         string;
  originalUrl: string;
  title:       string;

  // ── Uploader ───────────────────────────────────────────────────────────────
  uploaderName:            string;
  uploaderUrl:             string;
  uploaderAvatars:         NativeImage[];
  uploaderVerified:        boolean;
  /** Long→Double. -1 coerced to 0. */
  uploaderSubscriberCount: number;

  // ── Metrics ────────────────────────────────────────────────────────────────
  /** Seconds — Long→Double */
  duration:     number;
  /** Long→Double. 0 if unknown. */
  viewCount:    number;
  /** Long→Double. coerceAtLeast(0). YouTube hides likes → 0. */
  likeCount:    number;
  /** Long→Double. coerceAtLeast(0). Always 0 for YouTube (removed 2021). */
  dislikeCount: number;

  // ── Metadata ───────────────────────────────────────────────────────────────
  description:        string;
  /**
   * ISO-8601 instant string, e.g. "2024-01-15T12:34:56Z".
   * Empty string if upload date was not available.
   * Fix [F]: Uses DateWrapper.date().toString() — Instant, not OffsetDateTime.
   */
  uploadDate:         string;
  textualUploadDate:  string;
  thumbnails:         NativeImage[];
  streamType:         StreamType;
  isLive:             boolean;
  isShortFormContent: boolean;
  availability:       StreamAvailability;
  /** int in Kotlin (NO_AGE_LIMIT = 0 if unrestricted) */
  ageLimit:           number;
  tags:               string[];
  category:           string;
  /** Seconds — Long→Double. Typically 0; non-zero when URL contains timestamp. */
  startPosition:      number;
  /** PeerTube instance host — empty for YouTube */
  host:               string;
  privacy:            StreamPrivacy;
  licence:            string;
  /** BCP-47 tag e.g. "en-US". Empty string if not set. */
  languageInfo:       string;
  subChannelName:     string;
  subChannelUrl:      string;
  subChannelAvatars:  NativeImage[];
  supportInfo:        string;

  // ── Streams ────────────────────────────────────────────────────────────────
  audioStreams:     AudioStream[];
  videoStreams:     VideoStream[];
  /**
   * DASH adaptive video-only streams (no embedded audio) — typically HD on YouTube.
   * Pair with the highest-bitrate audioStream for full HD playback.
   * videoOnlyStreams is preferred over videoStreams for 720p+ content.
   */
  videoOnlyStreams: VideoStream[];
  dashMpdUrl:       string;
  hlsUrl:           string;
  subtitles:        SubtitleStream[];

  // ── Related & extras ───────────────────────────────────────────────────────
  /** Up to 20 related InfoItems from the watch-next panel */
  relatedItems:   InfoItem[];
  streamSegments: StreamSegment[];
  previewFrames:  Frameset[];
  metaInfo:       MetaInfo[];
  /** Non-fatal extraction errors — usually empty */
  errors:         string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Comments — commentItemToMap() in Kotlin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * likeCount, replyCount, streamPosition are int in the extractor (NOT Long).
 * publishedTimestamp: item.uploadDate?.date?.epochSecond?.toDouble() ?: 0.0
 * Fix [F]: Uses DateWrapper.date().epochSecond (Instant) not offsetDateTime().
 */
export interface CommentItem {
  authorName:      string;
  authorUrl:       string;
  authorAvatars:   NativeImage[];
  authorVerified:  boolean;
  commentId:       string;
  commentText:     string;
  publishedTime:   string;
  /**
   * Epoch seconds — Double in Kotlin (Instant.epochSecond.toDouble()).
   * 0.0 if upload date was not available.
   * Fix [F]: Uses DateWrapper.date().epochSecond — not offsetDateTime().
   */
  publishedTimestamp: number;
  /** int in Kotlin — CommentsInfoItem.NO_LIKE_COUNT coerced to 0 */
  likeCount:          number;
  textualLikeCount:   string;
  /** int in Kotlin — CommentsInfoItem.UNKNOWN_REPLY_COUNT when not available */
  replyCount:         number;
  repliesPageUrl:     string;
  hasReplies:         boolean;
  isPinned:           boolean;
  isHearted:          boolean;
  isChannelOwner:     boolean;
  hasCreatorReply:    boolean;
  /** int in Kotlin — CommentsInfoItem.NO_STREAM_POSITION when not available */
  streamPosition:     number;
}

/**
 * First-page comments response.
 * commentsCount is int in Kotlin (CommentsInfo.getCommentsCount() returns Int).
 */
export interface CommentsPage {
  success:       boolean;
  disabled:      boolean;
  /** int in Kotlin — not Long, no toDouble() conversion */
  commentsCount: number;
  comments:      CommentItem[];
  nextPage:      NativePage;
  hasNextPage:   boolean;
  errors:        string[];
}

/** Paginated comments (when pageUrl is supplied to getComments) */
export interface CommentsMorePage {
  success:     boolean;
  comments:    CommentItem[];
  nextPage:    NativePage;
  hasNextPage: boolean;
  errors:      string[];
}

export interface CommentRepliesPage {
  success:     boolean;
  replies:     CommentItem[];
  nextPage:    NativePage;
  hasNextPage: boolean;
  errors:      string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valid content filter tokens for YouTube (NewPipe SearchQueryHandlerFactory).
 *
 * ''               → no filter — returns all content types
 * 'videos'         → video results only
 * 'channels'       → channel results only
 * 'playlists'      → playlist results only
 * 'music_songs'    → YouTube Music: songs
 * 'music_videos'   → YouTube Music: music videos
 * 'music_albums'   → YouTube Music: albums
 * 'music_playlists'→ YouTube Music: playlists
 *
 * IMPORTANT: 'all' is NOT a valid NewPipe filter token.
 * Use '' (empty string) for unfiltered / all-types search.
 * Kotlin: if (filter.isNullOrBlank()) emptyList() else listOf(filter)
 */
export type YouTubeSearchFilter =
  | ''
  | 'videos'
  | 'channels'
  | 'playlists'
  | 'music_songs'
  | 'music_videos'
  | 'music_albums'
  | 'music_playlists';

export type SearchFilter = YouTubeSearchFilter | string;

/** First-page search response (no pageUrl supplied) */
export interface SearchPage {
  success:          boolean;
  query:            string;
  suggestion:       string;
  isCorrectedSearch: boolean;
  results:          InfoItem[];
  nextPage:         NativePage;
  hasNextPage:      boolean;
  errors:           string[];
}

/** Paginated search response (pageUrl supplied) */
export interface SearchMorePage {
  success:     boolean;
  results:     InfoItem[];
  nextPage:    NativePage;
  hasNextPage: boolean;
  errors:      string[];
}

/**
 * Fix [K]: Kotlin wraps List<String> in a Map root so expo-modules-core
 * can serialise it. Always access via result.suggestions.
 */
export interface SearchSuggestionsResult {
  suggestions: string[];
}

export interface SearchFiltersResult {
  serviceId:        number;
  serviceName:      string;
  availableFilters: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Playlist — extractPlaylistInfo() / extractPlaylistItems() in Kotlin
// ─────────────────────────────────────────────────────────────────────────────

export interface PlaylistInfo {
  success:          boolean;
  serviceId:        number;
  id:               string;
  url:              string;
  originalUrl:      string;
  name:             string;
  description:      string;
  thumbnails:       NativeImage[];
  banners:          NativeImage[];
  uploaderName:     string;
  uploaderUrl:      string;
  uploaderAvatars:  NativeImage[];
  subChannelName:   string;
  subChannelUrl:    string;
  subChannelAvatars: NativeImage[];
  /** Long→Double in Kotlin. 0 if unknown. */
  streamCount:      number;
  /** PlaylistInfo.PlaylistType?.name ?: "NORMAL" */
  playlistType:     string;
  nextPage:         NativePage;
  hasNextPage:      boolean;
  items:            InfoItem[];
  errors:           string[];
}

export interface PlaylistItemsPage {
  success:     boolean;
  items:       InfoItem[];
  nextPage:    NativePage;
  hasNextPage: boolean;
  errors:      string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel — extractChannelInfo() / extractChannelTabItems() / extractChannelFeed()
// ─────────────────────────────────────────────────────────────────────────────

export interface ChannelInfo {
  success:              boolean;
  serviceId:            number;
  id:                   string;
  url:                  string;
  originalUrl:          string;
  name:                 string;
  description:          string;
  avatars:              NativeImage[];
  banners:              NativeImage[];
  feedUrl:              string;
  /** Long→Double. -1 coerced to 0. */
  subscriberCount:      number;
  isVerified:           boolean;
  tags:                 string[];
  /** String[] in extractor — toList() in Kotlin */
  donationLinks:        string[];
  parentChannelName:    string;
  parentChannelUrl:     string;
  parentChannelAvatars: NativeImage[];
  tabs:                 ChannelTab[];
  errors:               string[];
}

/**
 * tabLinkHandlerToMap() in Kotlin:
 *   name = tab.contentFilters.firstOrNull() ?: ""
 *   contentFilters = tab.contentFilters  (full list)
 *   url = tab.url
 */
export interface ChannelTab {
  name:           string;
  contentFilters: string[];
  url:            string;
}

export interface ChannelTabItemsPage {
  success:     boolean;
  tabName:     string;
  tabFilter:   string;
  items:       InfoItem[];
  nextPage:    NativePage;
  hasNextPage: boolean;
  errors:      string[];
}

/**
 * extractChannelFeed() — uses FeedInfo.getInfo().
 * On success: { success: true, name, items, errors }
 * On no feed: { success: false, error: "NO_FEED", message: string }
 */
export interface ChannelFeedResult {
  success: boolean;
  name?:   string;
  items?:  InfoItem[];
  errors?: string[];
  /** Only present when success === false */
  error?:   'NO_FEED' | string;
  message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kiosk — extractKioskInfo() / listAvailableKiosks() in Kotlin
// ─────────────────────────────────────────────────────────────────────────────

export interface KioskEntry {
  id:        string;
  name:      string;
  url?:      string;
  available: boolean;
  error?:    string;
}

export interface KioskListResult {
  success:        boolean;
  serviceId:      number;
  defaultKioskId: string;
  kiosks:         KioskEntry[];
}

/**
 * extractKioskInfo() return shape.
 *
 * On success (first page):  { success: true, kioskId, name, items, nextPage, hasNextPage, errors }
 * On success (more pages):  { success: true, kioskId, items, nextPage, hasNextPage, errors }
 *                           (no "name" key on paginated response)
 * On KIOSK_NOT_FOUND:       { success: false, kioskId, error: "KIOSK_NOT_FOUND", message, items: [] }
 *
 * Valid YouTube kiosk IDs in v0.26.0:
 *   "Live" | "trending_music" | "trending_gaming" |
 *   "trending_movies_and_shows" | "trending_podcasts_episodes"
 * "Trending" (global) was removed by YouTube on 2025-07-21.
 */
export interface KioskPage {
  success:      boolean;
  kioskId:      string;
  /** Present on first-page success — absent on paginated responses */
  name?:        string;
  items:        InfoItem[];
  nextPage?:    NativePage;
  hasNextPage?: boolean;
  errors?:      string[];
  /** Only present when success === false */
  error?:       'KIOSK_NOT_FOUND' | string;
  message?:     string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trending — 6-layer fallback (getTrendingWithFallback)
// ─────────────────────────────────────────────────────────────────────────────

export type TrendingSource =
  | 'youtube_music_charts'
  | 'innertube_browse'
  | `kiosk_${string}`
  | 'youtube_charts_html'
  | 'innertube_next_recommendations'
  | `search_${number}`
  | 'cache'
  | 'none';

export interface TrendingResult {
  success:        boolean;
  source:         TrendingSource;
  items:          InfoItem[];
  /** Total items available before the MAX_TRENDING_ITEMS (6) cap */
  totalAvailable: number;
  errors:         string[];
  /** Only present when success === false */
  message?:       string;
}

// ─────────────────────────────────────────────────────────────────────────────
// InnerTube config
// ─────────────────────────────────────────────────────────────────────────────

export interface InnerTubeConfig {
  apiKey:             string;
  clientVersion:      string;
  musicClientVersion: string;
  /** Cache age in milliseconds — Long→Double in Kotlin */
  cacheAge:           number;
  isCached:           boolean;
}

export interface InnerTubeRefreshResult {
  success:            boolean;
  apiKey:             string;
  clientVersion:      string;
  musicClientVersion: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Visitor data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fix [I]: Fetched via YoutubeParsingHelper.getVisitorDataFromInnertube()
 * on a background thread using InnertubeClientRequestInfo.ofWebClient().
 * Never called inside execute() — no recursion risk.
 * Auto-refreshed every hour (VISITOR_DATA_TTL = 60 min).
 */
export interface VisitorDataStatus {
  hasVisitorData: boolean;
  /** Cache age in milliseconds — Long→Double in Kotlin */
  cacheAgeMs:     number;
  /** TTL in milliseconds (1 hour) — Long→Double in Kotlin */
  ttlMs:          number;
  isValid:        boolean;
}

export interface VisitorDataRefreshResult {
  success:        boolean;
  hasVisitorData: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Key management
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiKeyStatus {
  totalKeys:       number;
  failedKeys:      number;
  workingKeys:     number;
  currentKeyIndex: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trending cache
// ─────────────────────────────────────────────────────────────────────────────

export interface TrendingCacheStatus {
  hasCachedData: boolean;
  /** Long→Double in Kotlin */
  cacheAgeMs:    number;
  /** Long→Double in Kotlin */
  ttlMs:         number;
  isValid:       boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// URL utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * resolveUrl() — linkType.name.lowercase() in Kotlin.
 * Possible values: "stream" | "channel" | "playlist" | "none"
 */
export interface ResolvedUrl {
  type:        'stream' | 'channel' | 'playlist' | 'none';
  id:          string;
  url:         string;
  serviceId:   number;
  serviceName: string;
}

/** checkCanHandle() — linkType.name.lowercase() in Kotlin */
export interface CanHandleResult {
  canHandle:   boolean;
  linkType:    'stream' | 'channel' | 'playlist' | 'none';
  serviceId:   number;
  serviceName: string;
  url:         string;
}

/** extractIdFromUrl() — linkType.name.lowercase() in Kotlin */
export interface ExtractedId {
  id:        string;
  type:      'stream' | 'channel' | 'playlist' | 'none';
  url:       string;
  serviceId: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

export interface PingResult {
  alive:     boolean;
  version:   string;
  /** Long→Double in Kotlin — System.currentTimeMillis() */
  timestamp: number;
}

export interface ResetResult {
  success: boolean;
  message: string;
}

export interface VersionInfo {
  version:      string;
  library:      string;
  architecture: string;
  notes:        string[];
}

/**
 * Fix [K]: getMediaCapabilities() returns Set<MediaCapability> in v0.26.0.
 * Handled in Kotlin's getServicesList() via .map { it.name } — arrives here
 * as string[] regardless of the underlying collection type.
 */
export interface ServiceInfo {
  id:                 number;
  name:               string;
  baseUrl:            string;
  mediaCapabilities:  string[];
}

// ═════════════════════════════════════════════════════════════════════════════
// STREAMS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Extract full stream info for a given URL.
 *
 * Fix [J]: Uses YouTube Android/iOS client internally (not WEB) — resolves the
 * SABR-only player response that caused empty audioStreams/videoStreams arrays.
 * Fix [D]: setFetchIosClient(true) called at init for better stream coverage.
 * Fix [E]: AccountTerminatedException returns { success: false, error: "ACCOUNT_TERMINATED" }
 *          instead of crashing or triggering fallback retries.
 */
export const getStreamInfo = (
  url:       string,
  serviceId?: number,
): Promise<StreamInfo> =>
  Native.getStreamInfo(url, serviceId ?? null);

/**
 * Extract stream info by bare video ID.
 * Uses service.streamLHFactory.fromId(videoId) — bypasses acceptUrl() entirely,
 * immune to URL encoding issues from Expo Router param passing.
 */
export const getStreamInfoById = (
  videoId:   string,
  serviceId?: number,
): Promise<StreamInfo> =>
  Native.getStreamInfoById(videoId, serviceId ?? null);

/**
 * Get the single best playable URL for a given format.
 *
 * format:
 *   'audio'|'mp3'|'m4a'|'ogg'|'webm' → highest-bitrate audioStream
 *   'video'|'mp4'|'best'             → highest-res videoOnlyStream (DASH),
 *                                       falling back to muxed videoStream
 *   'dash'                           → dashMpdUrl
 *   'hls'                            → hlsUrl
 *
 * For full HD playback, use getStreamInfo() and pair videoOnlyStreams
 * (no audio) with audioStreams in your player.
 */
export const getStreamUrl = (
  url:     string,
  format?: 'audio' | 'video' | 'mp3' | 'm4a' | 'ogg' | 'mp4' | 'best' | 'dash' | 'hls',
  serviceId?: number,
): Promise<{
  success:      boolean;
  url:          string;
  format:       string;
  title:        string;
  /** Seconds — Long→Double in Kotlin */
  duration:     number;
  fallbackUrls: string[];
}> =>
  Native.getStreamUrl(url, format ?? null, serviceId ?? null);

export const getAudioStreams = (
  url:       string,
  serviceId?: number,
): Promise<{
  success:      boolean;
  title:        string;
  audioStreams: AudioStream[];
}> =>
  Native.getAudioStreams(url, serviceId ?? null);

export const getVideoStreams = (
  url:       string,
  serviceId?: number,
): Promise<{
  success:          boolean;
  title:            string;
  videoStreams:      VideoStream[];
  videoOnlyStreams:  VideoStream[];
}> =>
  Native.getVideoStreams(url, serviceId ?? null);

export const getSubtitles = (
  url:       string,
  language?:  string,
  serviceId?: number,
): Promise<{
  success:            boolean;
  title:              string;
  subtitles:          SubtitleStream[];
  availableLanguages: string[];
}> =>
  Native.getSubtitles(url, language ?? null, serviceId ?? null);

// ─────────────────────────────────────────────────────────────────────────────
// HTTP CONTEXT TYPE
// Returned as the "httpContext" field inside every getStreamInfo / getStreamInfoById
// response. No separate call needed. Engine packages URLs + session as one unit.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The HTTP session context captured atomically inside streamInfoToMap at
 * extraction time. It is returned as the "httpContext" field of every
 * getStreamInfo() and getStreamInfoById() response.
 *
 * Industry standard: the resolver returns one complete package containing
 * both the resolved URLs and the session that produced them. There is no
 * separate context call. The player receives this object and uses it to
 * build OkHttpDataSource.Factory so CDN segment requests carry the exact
 * same session identity that extracted the video.
 */
export interface HttpContextResult {
  /** Raw SOCS consent cookie string. Injected as Cookie header on CDN requests. */
  cookie:                string;
  origin:                string;
  referer:               string;
  acceptLanguage:        string;
  xYoutubeClientName:    string;
  xYoutubeClientVersion: string;
  userAgent:             string;
}

// ═════════════════════════════════════════════════════════════════════════════
// COMMENTS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fetch comments for a stream URL.
 * First call (no pageUrl) → CommentsPage  (includes disabled, commentsCount)
 * Subsequent calls (with pageUrl) → CommentsMorePage  (no disabled/commentsCount)
 */
export const getComments = (
  url:       string,
  pageUrl?:  string,
  serviceId?: number,
): Promise<CommentsPage | CommentsMorePage> =>
  Native.getComments(url, pageUrl ?? null, serviceId ?? null);

export const getCommentReplies = (
  commentsUrl:    string,
  repliesPageUrl: string,
  serviceId?:     number,
): Promise<CommentRepliesPage> =>
  Native.getCommentReplies(commentsUrl, repliesPageUrl, serviceId ?? null);

// ═════════════════════════════════════════════════════════════════════════════
// SEARCH
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Search for content on a service.
 *
 * filter: '' (empty string, the default) = all content types.
 * Kotlin: if (filter.isNullOrBlank()) emptyList() else listOf(filter)
 * An empty contentFilter list means no filter in NewPipe's API.
 * 'all' is NOT a valid token — always use '' for unfiltered results.
 *
 * First call (no pageUrl) → SearchPage (includes query, suggestion, isCorrectedSearch)
 * Subsequent calls (with pageUrl) → SearchMorePage
 */
export const search = (
  query:     string,
  filter:    SearchFilter = '',
  pageUrl?:  string,
  serviceId?: number,
): Promise<SearchPage | SearchMorePage> => {
  if (!query?.trim()) {
    return Promise.reject(new Error('Search query cannot be empty'));
  }
  return Native.search(query.trim(), filter, pageUrl ?? null, serviceId ?? null);
};

/**
 * Get autocomplete suggestions for a partial query.
 * Returns { suggestions: string[] } — Map root required for bridge serialisation.
 */
export const getSearchSuggestions = (
  query:     string,
  serviceId?: number,
): Promise<SearchSuggestionsResult> =>
  Native.getSearchSuggestions(query, serviceId ?? null);

export const getSearchFilters = (
  serviceId?: number,
): Promise<SearchFiltersResult> =>
  Native.getSearchFilters(serviceId ?? null);

// ═════════════════════════════════════════════════════════════════════════════
// PLAYLIST
// ═════════════════════════════════════════════════════════════════════════════

export const getPlaylistInfo = (
  url:       string,
  serviceId?: number,
): Promise<PlaylistInfo> =>
  Native.getPlaylistInfo(url, serviceId ?? null);

export const getPlaylistItems = (
  url:       string,
  pageUrl?:  string,
  serviceId?: number,
): Promise<PlaylistItemsPage> =>
  Native.getPlaylistItems(url, pageUrl ?? null, serviceId ?? null);

// ═════════════════════════════════════════════════════════════════════════════
// CHANNEL
// ═════════════════════════════════════════════════════════════════════════════

export const getChannelInfo = (
  url:       string,
  serviceId?: number,
): Promise<ChannelInfo> =>
  Native.getChannelInfo(url, serviceId ?? null);

/**
 * Fetch items from a specific channel tab.
 * tabFilter: one of the strings from ChannelTab.contentFilters
 *   e.g. "videos" | "albums" | "singles" | "shorts" | "live" | "playlists"
 * Kotlin: matches tab where tab.contentFilters.any { it.equals(tabFilter, ignoreCase=true) }
 */
export const getChannelTabItems = (
  url:       string,
  tabFilter: string,
  pageUrl?:  string,
  serviceId?: number,
): Promise<ChannelTabItemsPage> =>
  Native.getChannelTabItems(url, tabFilter, pageUrl ?? null, serviceId ?? null);

/**
 * Fetch a channel's RSS/Atom feed.
 * Returns ChannelFeedResult — success: false with error: "NO_FEED"
 * if the service/channel has no feed extractor.
 */
export const getChannelFeed = (
  url:       string,
  serviceId?: number,
): Promise<ChannelFeedResult> =>
  Native.getChannelFeed(url, serviceId ?? null);

// ═════════════════════════════════════════════════════════════════════════════
// KIOSK
// ═════════════════════════════════════════════════════════════════════════════

export const getKioskList = (
  serviceId?: number,
): Promise<KioskListResult> =>
  Native.getKioskList(serviceId ?? null);

/**
 * Fetch a specific kiosk by ID.
 * Invalid kioskId returns { success: false, error: "KIOSK_NOT_FOUND" } — does not throw.
 *
 * Valid YouTube kiosk IDs in v0.26.0:
 *   "Live" | "trending_music" | "trending_gaming" |
 *   "trending_movies_and_shows" | "trending_podcasts_episodes"
 *
 * "Trending" (global) was removed by YouTube on 2025-07-21.
 * Use getTrendingWithFallback() instead.
 */
export const getKioskInfo = (
  kioskId:   string,
  pageUrl?:  string,
  serviceId?: number,
): Promise<KioskPage> =>
  Native.getKioskInfo(kioskId, pageUrl ?? null, serviceId ?? null);

/** @deprecated YouTube Trending page removed 2025-07-21. Use getTrendingWithFallback(). */
export const getTrending = (serviceId?: number): Promise<TrendingResult> =>
  Native.getTrending(serviceId ?? null);

/** @deprecated YouTube Trending page removed 2025-07-21. Use getTrendingWithFallback(). */
export const getMostPopular = (serviceId?: number): Promise<TrendingResult> =>
  Native.getMostPopular(serviceId ?? null);

/** @deprecated YouTube Trending page removed 2025-07-21. Use getTrendingWithFallback(). */
export const getYouTubeKiosk = (
  kioskType:
    | 'live' | 'Live'
    | 'trending' | 'Trending'
    | 'music' | 'trending_music'
    | 'gaming' | 'trending_gaming'
    | 'movies' | 'trending_movies' | 'trending_movies_and_shows'
    | 'podcasts' | 'trending_podcasts' | 'trending_podcasts_episodes',
  serviceId: number = 0,
): Promise<KioskPage> =>
  Native.getYouTubeKiosk(kioskType, serviceId);

// ═════════════════════════════════════════════════════════════════════════════
// TRENDING — 6-LAYER FALLBACK
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fetch trending content with 6-layer fallback.
 * Recommended since YouTube removed the global Trending page (2025-07-21).
 *
 * Layer 1: YouTube Music Charts (FEmusic_charts)    — InnerTube WEB_REMIX client
 * Layer 2: InnerTube Browse (FEwhat_to_watch)       — homepage feed
 * Layer 3: NewPipe sub-kiosks                       — trending_music / trending_gaming / etc.
 * Layer 4: YouTube Charts HTML (charts.youtube.com) — HTML scrape
 * Layer 5: InnerTube Next API                       — recommendations seed
 * Layer 6: Search fallback                          — "trending music official video {year}"
 *
 * Results cached for 5 minutes (TRENDING_CACHE_TTL). Inspect result.source
 * to see which layer succeeded. result.success === false means all layers failed.
 *
 * Fix [A]: SOCS consent cookie injected per-request via getCookieHeader() in
 * MavinDownloader.execute() — official v0.26.0 pattern. No CookieJar involved.
 */
export const getTrendingWithFallback = (
  category:  'music' | 'gaming' | 'movies' | 'podcast' | 'videos' | string = 'music',
  serviceId?: number,
): Promise<TrendingResult> =>
  Native.getTrendingWithFallback(category, serviceId ?? 0);

// ═════════════════════════════════════════════════════════════════════════════
// INNERTUBE CONFIG
// ═════════════════════════════════════════════════════════════════════════════

export const getInnerTubeConfig = (): Promise<InnerTubeConfig> =>
  Native.getInnerTubeConfig();

export const refreshInnerTubeConfig = (): Promise<InnerTubeRefreshResult> =>
  Native.refreshInnerTubeConfig();

// ═════════════════════════════════════════════════════════════════════════════
// VISITOR DATA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Refresh the cached visitorData token.
 * Fix [I]: Calls getVisitorDataFromInnertube() on a background thread.
 * Token is prefetched at init and auto-refreshed every hour.
 * Call manually only if getVisitorDataStatus() reports isValid === false.
 */
export const refreshVisitorData = (): Promise<VisitorDataRefreshResult> =>
  Native.refreshVisitorData();

export const getVisitorDataStatus = (): Promise<VisitorDataStatus> =>
  Native.getVisitorDataStatus();

// ═════════════════════════════════════════════════════════════════════════════
// KEY MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════

export const getApiKeyStatus = (): Promise<ApiKeyStatus> =>
  Native.getApiKeyStatus();

export const resetFailedKeys = (): Promise<{ success: boolean }> =>
  Native.resetFailedKeys();

// ═════════════════════════════════════════════════════════════════════════════
// TRENDING CACHE
// ═════════════════════════════════════════════════════════════════════════════

export const clearTrendingCache = (): Promise<{ success: boolean }> =>
  Native.clearTrendingCache();

export const getTrendingCacheStatus = (): Promise<TrendingCacheStatus> =>
  Native.getTrendingCacheStatus();

// ═════════════════════════════════════════════════════════════════════════════
// URL UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

export const resolveUrl = (
  url:       string,
  serviceId?: number,
): Promise<ResolvedUrl> =>
  Native.resolveUrl(url, serviceId ?? null);

export const canHandleUrl = (
  url:       string,
  serviceId?: number,
): Promise<CanHandleResult> =>
  Native.canHandleUrl(url, serviceId ?? null);

export const extractIdFromUrl = (
  url:       string,
  serviceId?: number,
): Promise<ExtractedId> =>
  Native.extractIdFromUrl(url, serviceId ?? null);

// ═════════════════════════════════════════════════════════════════════════════
// MODULE PROPERTIES
// ═════════════════════════════════════════════════════════════════════════════

export const version:     string       = Native.version;
export const initialized: boolean      = Native.initialized;
export const services:    ServiceInfo[] = Native.services;

// ═════════════════════════════════════════════════════════════════════════════
// UTILITY
// ═════════════════════════════════════════════════════════════════════════════

export const ping = (): Promise<PingResult> =>
  Native.ping();

export const emergencyReset = (): Promise<ResetResult> =>
  Native.emergencyReset();

export const getVersion = (): Promise<VersionInfo> =>
  Native.getVersion();

// ═════════════════════════════════════════════════════════════════════════════
// DEFAULT EXPORT
// ═════════════════════════════════════════════════════════════════════════════

const MavinEngine = {
  // Properties
  version,
  initialized,
  services,

  // Streams
  getStreamInfo,
  getStreamInfoById,
  getStreamUrl,
  getAudioStreams,
  getVideoStreams,
  getSubtitles,


  // Comments
  getComments,
  getCommentReplies,

  // Search
  search,
  getSearchSuggestions,
  getSearchFilters,

  // Playlist
  getPlaylistInfo,
  getPlaylistItems,

  // Channel
  getChannelInfo,
  getChannelTabItems,
  getChannelFeed,

  // Kiosk
  getKioskList,
  getKioskInfo,
  /** @deprecated Use getTrendingWithFallback() — YouTube Trending removed 2025-07-21 */
  getTrending,
  /** @deprecated Use getTrendingWithFallback() — YouTube Trending removed 2025-07-21 */
  getMostPopular,
  /** @deprecated Use getTrendingWithFallback() — YouTube Trending removed 2025-07-21 */
  getYouTubeKiosk,

  // Trending
  getTrendingWithFallback,

  // InnerTube config
  getInnerTubeConfig,
  refreshInnerTubeConfig,

  // Visitor data
  refreshVisitorData,
  getVisitorDataStatus,

  // Key management
  getApiKeyStatus,
  resetFailedKeys,

  // Trending cache
  clearTrendingCache,
  getTrendingCacheStatus,

  // URL utilities
  resolveUrl,
  canHandleUrl,
  extractIdFromUrl,

  // Utility
  ping,
  emergencyReset,
  getVersion,
};

export default MavinEngine;