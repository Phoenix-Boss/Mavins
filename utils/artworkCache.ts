// utils/artworkCache.ts - CONVERTED TO expo-file-system/next
import { file, directory } from 'expo-file-system/next';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import {
  addCacheMetadata,
  removeCacheMetadata,
  getOldestCacheEntries,
  getTotalCacheSize,
  updateCacheAccess
} from '@/db/localDatabase';

// Get cache directory path using file system API
const getCacheDir = async (): Promise<string> => {
  // Use the cache directory from the file system
  const cacheDir = file('/').cacheDirectory;
  if (cacheDir) {
    return `${cacheDir}local_artwork/`;
  }
  // Fallback to document directory
  const docDir = file('/').documentDirectory;
  if (docDir) {
    return `${docDir}local_artwork/`;
  }
  return 'local_artwork/';
};

let ARTWORK_CACHE_DIR: string = '';
const MAX_CACHE_SIZE_MB = 50;
const MAX_CACHE_SIZE_BYTES = MAX_CACHE_SIZE_MB * 1024 * 1024;

// Initialize cache directory
export async function initArtworkCache(): Promise<void> {
  try {
    ARTWORK_CACHE_DIR = await getCacheDir();
    const cacheDir = directory(ARTWORK_CACHE_DIR);
    const exists = await cacheDir.exists();
    
    if (!exists) {
      await cacheDir.create();
      console.log('[ArtworkCache] Created cache directory:', ARTWORK_CACHE_DIR);
    }
  } catch (error) {
    console.error('[ArtworkCache] Failed to create cache directory:', error);
    
    // Try alternative location using documentDirectory
    const docDir = file('/').documentDirectory;
    if (docDir) {
      const altDir = `${docDir}local_artwork/`;
      console.log('[ArtworkCache] Trying alternative directory:', altDir);
      try {
        const altCacheDir = directory(altDir);
        const altExists = await altCacheDir.exists();
        if (!altExists) {
          await altCacheDir.create();
          console.log('[ArtworkCache] Created alternative cache directory:', altDir);
          ARTWORK_CACHE_DIR = altDir;
        }
      } catch (altError) {
        console.error('[ArtworkCache] Alternative directory also failed:', altError);
      }
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
    const cacheFile = file(cachePath);
    const exists = await cacheFile.exists();
    
    if (exists) {
      return cachePath;
    }
    
    if (Platform.OS === 'android') {
      try {
        const sourceFile = file(contentUri);
        await sourceFile.copy(cachePath);
        
        const stats = await cacheFile.stat();
        const fileSize = stats.size || 0;
        
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
    const cacheFile = file(cachePath);
    const exists = await cacheFile.exists();
    
    if (exists) {
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
    const cacheFile = file(cachePath);
    return await cacheFile.exists();
  } catch {
    return false;
  }
}

export async function deleteArtworkFromCache(assetId: string): Promise<void> {
  try {
    const cachePath = getArtworkCachePath(assetId);
    const cacheFile = file(cachePath);
    const exists = await cacheFile.exists();
    
    if (exists) {
      await cacheFile.remove();
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
          const cacheFile = file(entry.file_path);
          const exists = await cacheFile.exists();
          if (exists) {
            await cacheFile.remove();
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
    const cacheDir = directory(ARTWORK_CACHE_DIR);
    const exists = await cacheDir.exists();
    
    if (exists) {
      const contents = await cacheDir.list();
      
      for (const entry of contents) {
        const filePath = `${ARTWORK_CACHE_DIR}${entry.name}`;
        const cacheFile = file(filePath);
        await cacheFile.remove();
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
    const cacheDir = directory(ARTWORK_CACHE_DIR);
    const exists = await cacheDir.exists();
    
    if (exists) {
      const contents = await cacheDir.list();
      totalFiles = contents.length;
      
      for (const entry of contents) {
        const filePath = `${ARTWORK_CACHE_DIR}${entry.name}`;
        const cacheFile = file(filePath);
        const stats = await cacheFile.stat();
        totalSize += stats.size || 0;
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