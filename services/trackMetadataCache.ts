// services/trackMetadataCache.ts
//
// Persistent storage for TrackExtras with TTL management
// Separates ephemeral stream URLs from persistent metadata
//
// ANDROID-ONLY: All iOS-specific code removed

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TrackExtras } from '@/libs/playerSetup';

// TTL Constants (in milliseconds)
export const METADATA_CACHE_TTL = {
  // Persistent metadata that rarely changes (likeCount, viewCount, commentsCount, uploaderUrl)
  STATS: 7 * 24 * 60 * 60 * 1000,      // 7 days
  
  // Track identifiers (videoId, etc.) - very stable
  IDENTIFIERS: 30 * 24 * 60 * 60 * 1000, // 30 days
  
  // Stream URLs - must be resolved fresh each session or on 403 errors
  STREAMS: 0,                            // 0 = always expire, always resolve fresh
  
  // Fallback for unknown categories
  DEFAULT: 24 * 60 * 60 * 1000,          // 1 day
} as const;

// Cache key prefix
const CACHE_KEY_PREFIX = 'track_metadata:';

// In-memory cache for fast access during current session
interface CachedTrackExtras {
  data: TrackExtras;
  fetchedAt: number;
  expiresAt: number;
  metadataType: keyof typeof METADATA_CACHE_TTL;
}

const memoryCache = new Map<string, CachedTrackExtras>();

// Version counter for cache invalidation (increment when schema changes)
let cacheVersion = 1;
const CACHE_VERSION_KEY = 'track_metadata_cache_version';

// Helper to determine which TTL to use based on the metadata type
function getTTLForExtras(extras: TrackExtras): number {
  // If this is primarily stream data (URLs), use STREAMS TTL
  if (extras.videoUrl || extras.muxedVideoUrl) {
    return METADATA_CACHE_TTL.STREAMS;
  }
  
  // If this has stats data
  if (extras.likeCount !== undefined || extras.viewCount !== undefined || extras.commentsCount !== undefined) {
    return METADATA_CACHE_TTL.STATS;
  }
  
  // If this has identifiers
  if (extras.videoId || extras.uploaderUrl) {
    return METADATA_CACHE_TTL.IDENTIFIERS;
  }
  
  // Default fallback
  return METADATA_CACHE_TTL.DEFAULT;
}

// Helper to check if a cached entry is expired
function isExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt;
}

// Helper to build storage key
function getStorageKey(trackId: string): string {
  return `${CACHE_KEY_PREFIX}${trackId}`;
}

// Initialize cache version on module load
async function initializeCacheVersion(): Promise<void> {
  try {
    const savedVersion = await AsyncStorage.getItem(CACHE_VERSION_KEY);
    if (savedVersion && parseInt(savedVersion, 10) !== cacheVersion) {
      // Version mismatch - clear all cached metadata
      const allKeys = await AsyncStorage.getAllKeys();
      const metadataKeys = allKeys.filter(key => key.startsWith(CACHE_KEY_PREFIX));
      if (metadataKeys.length > 0) {
        await AsyncStorage.multiRemove(metadataKeys);
      }
      memoryCache.clear();
      await AsyncStorage.setItem(CACHE_VERSION_KEY, String(cacheVersion));
    } else if (!savedVersion) {
      await AsyncStorage.setItem(CACHE_VERSION_KEY, String(cacheVersion));
    }
  } catch (error) {
    console.warn('[TrackMetadataCache] Failed to initialize cache version:', error);
  }
}

// Call initialization immediately
initializeCacheVersion();

/**
 * Get cached track extras from memory or disk
 * Returns null if not found or expired
 */
export async function getCachedTrackExtras(trackId: string): Promise<TrackExtras | null> {
  if (!trackId) return null;
  
  try {
    // Check memory cache first
    const memoryCached = memoryCache.get(trackId);
    if (memoryCached && !isExpired(memoryCached.expiresAt)) {
      return memoryCached.data;
    }
    
    // If memory cache expired, delete it
    if (memoryCached && isExpired(memoryCached.expiresAt)) {
      memoryCache.delete(trackId);
    }
    
    // Check disk cache
    const key = getStorageKey(trackId);
    const stored = await AsyncStorage.getItem(key);
    
    if (!stored) {
      return null;
    }
    
    const parsed: CachedTrackExtras = JSON.parse(stored);
    
    // Check expiration
    if (isExpired(parsed.expiresAt)) {
      // Delete expired entry
      await AsyncStorage.removeItem(key);
      memoryCache.delete(trackId);
      return null;
    }
    
    // Restore to memory cache
    memoryCache.set(trackId, parsed);
    
    return parsed.data;
  } catch (error) {
    console.warn('[TrackMetadataCache] Failed to get cached extras:', error);
    return null;
  }
}

/**
 * Get cached track extras synchronously from memory only
 * Useful for UI components that need immediate data
 */
export function getCachedTrackExtrasSync(trackId: string): TrackExtras | null {
  if (!trackId) return null;
  
  const memoryCached = memoryCache.get(trackId);
  if (memoryCached && !isExpired(memoryCached.expiresAt)) {
    return memoryCached.data;
  }
  
  return null;
}

/**
 * Store track extras to both memory and disk cache
 * @param trackId - Unique identifier for the track
 * @param extras - Track metadata to cache
 * @param forceTTL - Optional override for TTL (in milliseconds)
 */
export async function setCachedTrackExtras(
  trackId: string,
  extras: TrackExtras,
  forceTTL?: number
): Promise<void> {
  if (!trackId || !extras) return;
  
  try {
    const ttl = forceTTL ?? getTTLForExtras(extras);
    const fetchedAt = Date.now();
    const expiresAt = ttl === 0 ? 0 : fetchedAt + ttl;
    
    const cachedEntry: CachedTrackExtras = {
      data: extras,
      fetchedAt,
      expiresAt,
      metadataType: forceTTL ? 'DEFAULT' : 
        extras.videoUrl || extras.muxedVideoUrl ? 'STREAMS' :
        extras.likeCount !== undefined ? 'STATS' : 'IDENTIFIERS',
    };
    
    // Update memory cache
    memoryCache.set(trackId, cachedEntry);
    
    // For stream URLs with TTL=0, don't persist to disk (always resolve fresh)
    if (ttl === 0 && (extras.videoUrl || extras.muxedVideoUrl)) {
      return;
    }
    
    // Persist to disk
    const key = getStorageKey(trackId);
    await AsyncStorage.setItem(key, JSON.stringify(cachedEntry));
  } catch (error) {
    console.warn('[TrackMetadataCache] Failed to set cached extras:', error);
  }
}

/**
 * Update specific fields of cached track extras without overwriting the entire object
 * @param trackId - Unique identifier for the track
 * @param updates - Partial TrackExtras to merge
 */
export async function updateCachedTrackExtras(
  trackId: string,
  updates: Partial<TrackExtras>
): Promise<void> {
  if (!trackId || !updates) return;
  
  const existing = await getCachedTrackExtras(trackId);
  if (existing) {
    const merged = { ...existing, ...updates };
    await setCachedTrackExtras(trackId, merged);
  } else {
    await setCachedTrackExtras(trackId, updates as TrackExtras);
  }
}

/**
 * Invalidate stream URLs for a track (called on 403 errors)
 * Preserves all other metadata (stats, identifiers)
 */
export async function invalidateCachedStreams(trackId: string): Promise<void> {
  if (!trackId) return;
  
  const existing = await getCachedTrackExtras(trackId);
  if (existing) {
    // Remove stream URLs but keep everything else
    const { videoUrl, muxedVideoUrl, ...preservedExtras } = existing;
    await setCachedTrackExtras(trackId, preservedExtras as TrackExtras);
  }
}

/**
 * Invalidate entire cache entry for a track
 */
export async function invalidateTrackCache(trackId: string): Promise<void> {
  if (!trackId) return;
  
  try {
    memoryCache.delete(trackId);
    const key = getStorageKey(trackId);
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.warn('[TrackMetadataCache] Failed to invalidate track cache:', error);
  }
}

/**
 * Batch invalidate multiple tracks
 * @param trackIds - Array of track IDs to invalidate
 */
export async function invalidateTracksCache(trackIds: string[]): Promise<void> {
  if (!trackIds?.length) return;
  
  try {
    for (const trackId of trackIds) {
      memoryCache.delete(trackId);
    }
    
    const keys = trackIds.map(id => getStorageKey(id));
    await AsyncStorage.multiRemove(keys);
  } catch (error) {
    console.warn('[TrackMetadataCache] Failed to invalidate tracks cache:', error);
  }
}

/**
 * Invalidate all expired cache entries
 * Can be called periodically (e.g., on app start)
 */
export async function cleanExpiredCache(): Promise<number> {
  let cleanedCount = 0;
  
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const metadataKeys = allKeys.filter(key => key.startsWith(CACHE_KEY_PREFIX));
    
    for (const key of metadataKeys) {
      const stored = await AsyncStorage.getItem(key);
      if (stored) {
        try {
          const parsed: CachedTrackExtras = JSON.parse(stored);
          if (isExpired(parsed.expiresAt)) {
            await AsyncStorage.removeItem(key);
            cleanedCount++;
          }
        } catch {
          // Invalid JSON, remove it
          await AsyncStorage.removeItem(key);
          cleanedCount++;
        }
      }
    }
    
    // Also clean memory cache
    for (const [trackId, entry] of memoryCache.entries()) {
      if (isExpired(entry.expiresAt)) {
        memoryCache.delete(trackId);
      }
    }
    
    console.log(`[TrackMetadataCache] Cleaned ${cleanedCount} expired entries`);
    return cleanedCount;
  } catch (error) {
    console.warn('[TrackMetadataCache] Failed to clean expired cache:', error);
    return 0;
  }
}

/**
 * Get cache stats for debugging
 */
export async function getCacheStats(): Promise<{
  memorySize: number;
  diskSize: number;
  expiredMemoryCount: number;
}> {
  let diskSize = 0;
  let expiredMemoryCount = 0;
  
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const metadataKeys = allKeys.filter(key => key.startsWith(CACHE_KEY_PREFIX));
    diskSize = metadataKeys.length;
    
    for (const entry of memoryCache.values()) {
      if (isExpired(entry.expiresAt)) {
        expiredMemoryCount++;
      }
    }
  } catch (error) {
    console.warn('[TrackMetadataCache] Failed to get cache stats:', error);
  }
  
  return {
    memorySize: memoryCache.size,
    diskSize,
    expiredMemoryCount,
  };
}

/**
 * Preload multiple tracks into cache
 * Useful for playlist/queue preloading
 */
export async function preloadTrackMetadata(
  tracks: Array<{ id: string; extras: TrackExtras }>
): Promise<void> {
  if (!tracks?.length) return;
  
  const promises = tracks.map(({ id, extras }) => setCachedTrackExtras(id, extras));
  await Promise.allSettled(promises);
}

/**
 * Check if a track has valid (non-expired) cached stats
 */
export async function hasValidCachedStats(trackId: string): Promise<boolean> {
  const cached = await getCachedTrackExtras(trackId);
  if (!cached) return false;
  
  // Check if it has at least some stats data
  const hasStats = cached.likeCount !== undefined && cached.likeCount !== -1 &&
                   cached.viewCount !== undefined && cached.viewCount !== -1;
  
  return hasStats;
}

/**
 * Extract only persistent metadata from TrackExtras (excludes stream URLs)
 * Useful when saving to cache with long TTL
 */
export function extractPersistentMetadata(extras: TrackExtras): TrackExtras {
  const { videoUrl, muxedVideoUrl, ...persistent } = extras;
  return persistent as TrackExtras;
}

/**
 * Extract only stream URLs from TrackExtras (excludes persistent metadata)
 */
export function extractStreamUrls(extras: TrackExtras): Partial<TrackExtras> {
  return {
    videoUrl: extras.videoUrl,
    muxedVideoUrl: extras.muxedVideoUrl,
  };
}

/**
 * Merge cached persistent metadata with fresh stream URLs
 * @param cached - Cached persistent metadata
 * @param streams - Fresh stream URLs
 */
export function mergeWithFreshStreams(
  cached: TrackExtras,
  streams: Partial<TrackExtras>
): TrackExtras {
  return {
    ...cached,
    ...streams,
    // Ensure we don't overwrite persistent data with undefined
    videoId: cached.videoId ?? streams.videoId,
    uploaderUrl: cached.uploaderUrl ?? streams.uploaderUrl,
    likeCount: cached.likeCount ?? streams.likeCount ?? -1,
    dislikeCount: cached.dislikeCount ?? streams.dislikeCount ?? -1,
    viewCount: cached.viewCount ?? streams.viewCount ?? -1,
    commentsCount: cached.commentsCount ?? streams.commentsCount ?? -1,
  };
}

// Export a singleton object for easy importing
export const trackMetadataCache = {
  get: getCachedTrackExtras,
  getSync: getCachedTrackExtrasSync,
  set: setCachedTrackExtras,
  update: updateCachedTrackExtras,
  invalidateStreams: invalidateCachedStreams,
  invalidateTrack: invalidateTrackCache,
  invalidateTracks: invalidateTracksCache,
  cleanExpired: cleanExpiredCache,
  getStats: getCacheStats,
  preload: preloadTrackMetadata,
  hasValidStats: hasValidCachedStats,
  extractPersistent: extractPersistentMetadata,
  extractStreams: extractStreamUrls,
  mergeStreams: mergeWithFreshStreams,
};

export default trackMetadataCache;