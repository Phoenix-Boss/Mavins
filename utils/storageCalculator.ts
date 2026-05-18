// utils/storageCalculator.ts
import { file, directory } from 'expo-file-system/next';
import { getCacheStats } from './artworkCache';

export async function calculateArtworkCacheSize(): Promise<number> {
  const stats = await getCacheStats();
  return stats.totalSizeMB * 1024 * 1024;
}

export async function getFreeStorageMB(): Promise<number> {
  try {
    // Get free disk space - need to use a known path
    const testFile = file('/storage/emulated/0');
    const freeSpace = await testFile.getFreeSpace();
    return freeSpace / (1024 * 1024);
  } catch (error) {
    console.error('[StorageCalculator] Failed to get free storage:', error);
    return 0;
  }
}

export async function getTotalStorageMB(): Promise<number> {
  try {
    const testFile = file('/storage/emulated/0');
    const totalSpace = await testFile.getTotalSpace();
    return totalSpace / (1024 * 1024);
  } catch (error) {
    console.error('[StorageCalculator] Failed to get total storage:', error);
    return 0;
  }
}

export async function needsCacheCleanup(): Promise<boolean> {
  const cacheSize = await calculateArtworkCacheSize();
  const freeSpace = await getFreeStorageMB();
  
  // Cleanup if cache > 50MB or free space < 100MB
  return cacheSize > 50 * 1024 * 1024 || freeSpace < 100;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}