// constants/cacheTTL.ts
//
// LAYER 4: Centralized Cache TTL Constants
//
// This file provides a single source of truth for all cache expiry durations
// across the entire application. Every cache TTL value must be imported from here.
//
// Benefits:
//   - Consistency across device cache, Supabase cache, and memory cache
//   - Easy to adjust global TTL values from one location
//   - Clear documentation of each cache's purpose
//   - Separation of concerns from config files
//
// All values are in milliseconds unless otherwise specified.

/**
 * Device Cache TTLs (AsyncStorage)
 * Used for storing search results, metadata, and user history on the device
 */
export const DEVICE_CACHE_TTL = {
  /**
   * Search result metadata (song titles, artists, thumbnails, video IDs)
   * These do not expire quickly — 7 days is safe
   */
  SEARCH_RESULT: 7 * 24 * 60 * 60 * 1000,  // 7 days
  
  /**
   * Search history (user's past searches)
   * Persists effectively forever but with LRU eviction
   */
  SEARCH_HISTORY: 365 * 24 * 60 * 60 * 1000,  // 365 days (1 year)
  
  /**
   * Track metadata (non-stream URLs)
   * Artist names, album info, durations — stable data
   */
  TRACK_METADATA: 30 * 24 * 60 * 60 * 1000,  // 30 days
  
  /**
   * Artist information
   * Name, subscriber counts, top tracks — changes rarely
   */
  ARTIST_INFO: 7 * 24 * 60 * 60 * 1000,  // 7 days
  
  /**
   * Playlist structure (song order, title, thumbnail)
   * Stable unless user modifies playlist
   */
  PLAYLIST_STRUCTURE: 7 * 24 * 60 * 60 * 1000,  // 7 days
  
  /**
   * Genre folder data (grouped songs by genre)
   * Updates as user searches more
   */
  GENRE_FOLDERS: 12 * 60 * 60 * 1000,  // 12 hours
} as const;

/**
 * Supabase Cache TTLs
 * Used for persistent cloud storage across devices
 */
export const SUPABASE_CACHE_TTL = {
  /**
   * Active stream URLs (from YouTube CDN)
   * YouTube stream tokens typically expire in 6 hours
   * Must be re-fetched before expiry
   */
  STREAM_URL: 6 * 60 * 60 * 1000,  // 6 hours
  
  /**
   * Track statistics (view counts, like counts, comment counts)
   * Changes frequently but doesn't need real-time accuracy
   * 24 hours is acceptable for non-critical stats
   */
  TRACK_STATS: 24 * 60 * 60 * 1000,  // 24 hours
  
  /**
   * Search-to-track mappings (cache_metadata table)
   * Used for quick lookup of popular searches
   */
  SEARCH_MAPPING: 30 * 24 * 60 * 60 * 1000,  // 30 days
  
  /**
   * Related tracks relationships
   * Changes infrequently — safe for long-term cache
   */
  RELATED_TRACKS: 14 * 24 * 60 * 60 * 1000,  // 14 days
} as const;

/**
 * Memory Cache TTLs (in-memory maps, cleared on app restart)
 * Used for temporary storage during app session
 */
export const MEMORY_CACHE_TTL = {
  /**
   * Track extras (like counts, comments, video URLs)
   * Stored per session, cleared on app restart
   */
  TRACK_EXTRAS: 0,  // No expiry — cleared on app restart
  
  /**
   * Active stream health scores
   * Tracked during app session only
   */
  STREAM_HEALTH: 0,  // No expiry — cleared on app restart
  
  /**
   * Pending track for optimistic UI updates
   * Cleared when real track loads or after timeout
   */
  PENDING_TRACK: 10 * 1000,  // 10 seconds
} as const;

/**
 * Network Request Timeouts
 * Used for aborting hanging HTTP requests
 */
export const REQUEST_TIMEOUTS = {
  /**
   * Primary YouTube stream extraction
   * Can be slow due to multiple format checks
   */
  PRIMARY_EXTRACTION: 15 * 1000,  // 15 seconds
  
  /**
   * Video ID-based stream extraction (backup)
   * Slightly faster than primary
   */
  VIDEO_ID_EXTRACTION: 10 * 1000,  // 10 seconds
  
  /**
   * Search query to YouTube API
   * Should be relatively fast
   */
  SEARCH_QUERY: 8 * 1000,  // 8 seconds
  
  /**
   * Comments API fetch
   * Can be slow for videos with many comments
   */
  COMMENTS_FETCH: 10 * 1000,  // 10 seconds
  
  /**
   * Channel/Artist page info
   * Moderate complexity
   */
  CHANNEL_INFO: 10 * 1000,  // 10 seconds
  
  /**
   * Playlist info extraction
   * Can be slow for large playlists
   */
  PLAYLIST_INFO: 15 * 1000,  // 15 seconds
  
  /**
   * Related songs fetch
   * Low priority, can timeout faster
   */
  RELATED_SONGS: 8 * 1000,  // 8 seconds
  
  /**
   * Cache warmup requests
   * Non-critical, fastest timeout
   */
  CACHE_WARMUP: 5 * 1000,  // 5 seconds
} as const;

/**
 * Background Job Intervals
 * How often background tasks run
 */
export const BACKGROUND_JOB_INTERVALS = {
  /**
   * Refresh expiring stream URLs
   * Prevents playback failures by refreshing URLs before they expire
   */
  REFRESH_STREAMS: 60 * 60 * 1000,  // Every hour
  
  /**
   * Pre-cache popular searches
   * Keeps trending content ready
   */
  CACHE_POPULAR: 12 * 60 * 60 * 1000,  // Every 12 hours
  
  /**
   * Clean stale cache entries
   * Removes old/unused data
   */
  CLEAN_STALE: 24 * 60 * 60 * 1000,  // Every 24 hours
  
  /**
   * Update cache statistics
   * Analytics for cache performance
   */
  UPDATE_STATS: 6 * 60 * 60 * 1000,  // Every 6 hours
} as const;

/**
 * UI Update Intervals
 * Throttling for performance
 */
export const UI_UPDATE_INTERVALS = {
  /**
   * Position save to AsyncStorage
   * Save every 5 seconds + on app background
   */
  POSITION_SAVE: 5 * 1000,  // 5 seconds
  
  /**
   * Seek bar progress update
   * Smooth visual update
   */
  PROGRESS_UPDATE: 250,  // 250ms (4 times per second)
  
  /**
   * System media controls position sync
   * Update lockscreen every 2 seconds
   */
  MEDIA_CONTROLS_SYNC: 2 * 1000,  // 2 seconds
} as const;

/**
 * Cache Limits (maximum entries)
 */
export const CACHE_LIMITS = {
  /**
   * Maximum device cache entries
   * Prevents AsyncStorage from growing too large
   */
  DEVICE_MAX_ITEMS: 500,
  
  /**
   * Maximum track extras in memory
   * Prevents memory leaks
   */
  TRACK_EXTRAS_MAX: 50,
  
  /**
   * Maximum search history entries
   * Keeps UI manageable
   */
  SEARCH_HISTORY_MAX: 20,
  
  /**
   * Popular searches to pre-cache
   * Balances cache size vs coverage
   */
  POPULAR_SEARCHES_MAX: 50,
  
  /**
   * Minimum hit count for "popular" classification
   * Filters out one-off searches
   */
  POPULAR_SEARCHES_MIN_HITS: 5,
} as const;

/**
 * Retry Configuration
 */
export const RETRY_CONFIG = {
  /**
   * Maximum number of retry attempts for failed requests
   */
  MAX_ATTEMPTS: 3,
  
  /**
   * Initial delay before first retry (ms)
   * Increases exponentially with each retry
   */
  INITIAL_DELAY_MS: 1000,  // 1 second
  
  /**
   * Maximum delay between retries
   * Prevents exponential backoff from growing too large
   */
  MAX_DELAY_MS: 10000,  // 10 seconds
  
  /**
   * Backoff multiplier
   * Each retry: delay = min(delay * multiplier, MAX_DELAY_MS)
   */
  BACKOFF_MULTIPLIER: 2,
} as const;

/**
 * Preserve Sync/Async compatibility for any legacy code expecting numeric values
 */
export function getTtl(tier: 'device' | 'supabase' | 'memory', key: string): number {
  switch (tier) {
    case 'device':
      return (DEVICE_CACHE_TTL as any)[key] ?? DEVICE_CACHE_TTL.SEARCH_RESULT;
    case 'supabase':
      return (SUPABASE_CACHE_TTL as any)[key] ?? SUPABASE_CACHE_TTL.STREAM_URL;
    case 'memory':
      return (MEMORY_CACHE_TTL as any)[key] ?? 0;
    default:
      return DEVICE_CACHE_TTL.SEARCH_RESULT;
  }
}

// Default export for convenience
export default {
  DEVICE_CACHE_TTL,
  SUPABASE_CACHE_TTL,
  MEMORY_CACHE_TTL,
  REQUEST_TIMEOUTS,
  BACKGROUND_JOB_INTERVALS,
  UI_UPDATE_INTERVALS,
  CACHE_LIMITS,
  RETRY_CONFIG,
  getTtl,
};