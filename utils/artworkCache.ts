// utils/artworkCache.ts - USES expo-file-system/legacy FOR SDK 54 COMPATIBILITY
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import {
  addCacheMetadata,
  removeCacheMetadata,
  getOldestCacheEntries,
  getTotalCacheSize,
  updateCacheAccess
} from '@/db/localDatabase';

let ARTWORK_CACHE_DIR: string = '';
const MAX_CACHE_SIZE_MB = 50;
const MAX_CACHE_SIZE_BYTES = MAX_CACHE_SIZE_MB * 1024 * 1024;

// Initialize cache directory
export async function initArtworkCache(): Promise<void> {
  try {
    const cacheDir = FileSystem.cacheDirectory + 'local_artwork/';
    ARTWORK_CACHE_DIR = cacheDir;
    
    const dirInfo = await FileSystem.getInfoAsync(cacheDir);
    
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
      console.log('[ArtworkCache] Created cache directory:', cacheDir);
    }
  } catch (error) {
    console.error('[ArtworkCache] Failed to create cache directory:', error);
    
    // Try alternative location using documentDirectory
    const altDir = FileSystem.documentDirectory + 'local_artwork/';
    console.log('[ArtworkCache] Trying alternative directory:', altDir);
    try {
      const altInfo = await FileSystem.getInfoAsync(altDir);
      if (!altInfo.exists) {
        await FileSystem.makeDirectoryAsync(altDir, { intermediates: true });
        console.log('[ArtworkCache] Created alternative cache directory:', altDir);
        ARTWORK_CACHE_DIR = altDir;
      }
    } catch (altError) {
      console.error('[ArtworkCache] Alternative directory also failed:', altError);
    }
  }
}

function generateArtworkHash(assetId: string): string {
  let hash = 0;
  for (let i = 0; i < assetId.length; i++) {
    const char = assetId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `artwork_${Math.abs(hash)}.jpg`;
}

function getArtworkCachePath(assetId: string): string {
  const hash = generateArtworkHash(assetId);
  return `${ARTWORK_CACHE_DIR}${hash}`;
}

export async function cacheArtworkFromUri(contentUri: string, assetId: string): Promise<string | null> {
  try {
    await initArtworkCache();
    
    const cachePath = getArtworkCachePath(assetId);
    const cacheInfo = await FileSystem.getInfoAsync(cachePath);
    
    if (cacheInfo.exists) {
      return cachePath;
    }
    
    if (Platform.OS === 'android') {
      try {
        // Use copyAsync for content URIs on Android
        await FileSystem.copyAsync({
          from: contentUri,
          to: cachePath,
        });
        
        const stats = await FileSystem.getInfoAsync(cachePath);
        const fileSize = stats.exists && 'size' in stats ? stats.size : 0;
        
        await addCacheMetadata(assetId, cachePath, fileSize);
        await enforceCacheSizeLimit();
        
        console.log(`[ArtworkCache] Cached artwork for ${assetId}`);
        return cachePath;
      } catch (copyError) {
        console.warn('[ArtworkCache] Failed to copy from content URI:', copyError);
      }
    }
    
    return null;
  } catch (error) {
    console.error('[ArtworkCache] Failed to cache artwork:', error);
    return null;
  }
}

export async function loadArtworkFromCache(assetId: string): Promise<string | null> {
  try {
    const cachePath = getArtworkCachePath(assetId);
    const cacheInfo = await FileSystem.getInfoAsync(cachePath);
    
    if (cacheInfo.exists) {
      await updateCacheAccess(assetId);
      return cachePath;
    }
    return null;
  } catch (error) {
    console.error('[ArtworkCache] Failed to load artwork:', error);
    return null;
  }
}

export async function hasArtworkInCache(assetId: string): Promise<boolean> {
  try {
    const cachePath = getArtworkCachePath(assetId);
    const cacheInfo = await FileSystem.getInfoAsync(cachePath);
    return cacheInfo.exists;
  } catch {
    return false;
  }
}

export async function deleteArtworkFromCache(assetId: string): Promise<void> {
  try {
    const cachePath = getArtworkCachePath(assetId);
    const cacheInfo = await FileSystem.getInfoAsync(cachePath);
    
    if (cacheInfo.exists) {
      await FileSystem.deleteAsync(cachePath);
      await removeCacheMetadata(assetId);
    }
  } catch (error) {
    console.error('[ArtworkCache] Failed to delete artwork:', error);
  }
}

export async function enforceCacheSizeLimit(): Promise<void> {
  try {
    let totalSize = await getTotalCacheSize();
    
    while (totalSize > MAX_CACHE_SIZE_BYTES) {
      const oldestEntries = await getOldestCacheEntries(20);
      
      if (oldestEntries.length === 0) break;
      
      for (const entry of oldestEntries) {
        try {
          const fileInfo = await FileSystem.getInfoAsync(entry.file_path);
          if (fileInfo.exists) {
            await FileSystem.deleteAsync(entry.file_path);
          }
          await removeCacheMetadata(entry.cache_key);
          totalSize -= entry.file_size;
          
          if (totalSize <= MAX_CACHE_SIZE_BYTES) break;
        } catch (error) {
          console.error('[ArtworkCache] Failed to delete cache entry:', error);
        }
      }
    }
    
    console.log(`[ArtworkCache] Cache size: ${totalSize / 1024 / 1024} MB`);
  } catch (error) {
    console.error('[ArtworkCache] Failed to enforce cache limit:', error);
  }
}

export async function clearArtworkCache(): Promise<void> {
  try {
    await initArtworkCache();
    const dirInfo = await FileSystem.getInfoAsync(ARTWORK_CACHE_DIR);
    
    if (dirInfo.exists) {
      const contents = await FileSystem.readDirectoryAsync(ARTWORK_CACHE_DIR);
      
      for (const entry of contents) {
        const filePath = `${ARTWORK_CACHE_DIR}${entry}`;
        await FileSystem.deleteAsync(filePath);
      }
      
      console.log(`[ArtworkCache] Cleared ${contents.length} cache files`);
    }
  } catch (error) {
    console.error('[ArtworkCache] Failed to clear cache:', error);
  }
}

export async function getArtworkCacheSizeMB(): Promise<number> {
  const totalSize = await getTotalCacheSize();
  return totalSize / 1024 / 1024;
}

export async function getCacheStats(): Promise<{ totalSizeMB: number; totalFiles: number }> {
  try {
    let totalSize = 0;
    let totalFiles = 0;
    
    await initArtworkCache();
    const dirInfo = await FileSystem.getInfoAsync(ARTWORK_CACHE_DIR);
    
    if (dirInfo.exists) {
      const contents = await FileSystem.readDirectoryAsync(ARTWORK_CACHE_DIR);
      totalFiles = contents.length;
      
      for (const entry of contents) {
        const filePath = `${ARTWORK_CACHE_DIR}${entry}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        if (fileInfo.exists && 'size' in fileInfo) {
          totalSize += fileInfo.size || 0;
        }
      }
    }
    
    return {
      totalSizeMB: totalSize / (1024 * 1024),
      totalFiles,
    };
  } catch (error) {
    console.error('[ArtworkCache] Failed to get cache stats:', error);
    return { totalSizeMB: 0, totalFiles: 0 };
  }
}