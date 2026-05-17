// utils/artworkCache.ts
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

// Get a valid cache directory - fallback to documentDirectory if cacheDirectory is invalid
const getCacheDir = (): string => {
  // Try cacheDirectory first (preferred for temporary files)
  if (FileSystem.cacheDirectory && FileSystem.cacheDirectory.startsWith('file://')) {
    return `${FileSystem.cacheDirectory}local_artwork/`;
  }
  // Fallback to documentDirectory (more reliable on some devices)
  if (FileSystem.documentDirectory) {
    return `${FileSystem.documentDirectory}local_artwork/`;
  }
  // Last resort - use a relative path (might not work but better than nothing)
  return `local_artwork/`;
};

const ARTWORK_CACHE_DIR = getCacheDir();
const MAX_CACHE_SIZE_MB = 50;
const MAX_CACHE_SIZE_BYTES = MAX_CACHE_SIZE_MB * 1024 * 1024;

export async function initArtworkCache(): Promise<void> {
  try {
    // Try primary cache directory
    const dirInfo = await FileSystem.getInfoAsync(ARTWORK_CACHE_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(ARTWORK_CACHE_DIR, { intermediates: true });
      console.log('[ArtworkCache] Created cache directory:', ARTWORK_CACHE_DIR);
    }
  } catch (error) {
    console.error('[ArtworkCache] Failed to create cache directory:', error);
    
    // Try alternative location using documentDirectory
    if (FileSystem.documentDirectory) {
      const altDir = `${FileSystem.documentDirectory}local_artwork/`;
      console.log('[ArtworkCache] Trying alternative directory:', altDir);
      try {
        const altInfo = await FileSystem.getInfoAsync(altDir);
        if (!altInfo.exists) {
          await FileSystem.makeDirectoryAsync(altDir, { intermediates: true });
          console.log('[ArtworkCache] Created alternative cache directory:', altDir);
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
    
    const existingInfo = await FileSystem.getInfoAsync(cachePath);
    if (existingInfo.exists) {
      return cachePath;
    }
    
    if (Platform.OS === 'android') {
      try {
        await FileSystem.copyAsync({ from: contentUri, to: cachePath });
        
        const fileInfo = await FileSystem.getInfoAsync(cachePath);
        const fileSize = fileInfo.size || 0;
        
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
    const fileInfo = await FileSystem.getInfoAsync(cachePath);
    
    if (fileInfo.exists) {
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
    const fileInfo = await FileSystem.getInfoAsync(cachePath);
    return fileInfo.exists;
  } catch {
    return false;
  }
}

export async function deleteArtworkFromCache(assetId: string): Promise<void> {
  try {
    const cachePath = getArtworkCachePath(assetId);
    const fileInfo = await FileSystem.getInfoAsync(cachePath);
    
    if (fileInfo.exists) {
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
    const cacheFiles = await FileSystem.readDirectoryAsync(ARTWORK_CACHE_DIR);
    
    for (const file of cacheFiles) {
      const filePath = `${ARTWORK_CACHE_DIR}${file}`;
      await FileSystem.deleteAsync(filePath);
    }
    
    console.log(`[ArtworkCache] Cleared ${cacheFiles.length} cache files`);
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
    
    const dirInfo = await FileSystem.getInfoAsync(ARTWORK_CACHE_DIR);
    if (dirInfo.exists) {
      const files = await FileSystem.readDirectoryAsync(ARTWORK_CACHE_DIR);
      totalFiles = files.length;
      
      for (const file of files) {
        const filePath = `${ARTWORK_CACHE_DIR}${file}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        if (fileInfo.exists && fileInfo.size) {
          totalSize += fileInfo.size;
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