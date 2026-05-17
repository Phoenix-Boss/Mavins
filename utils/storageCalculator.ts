// utils/storageCalculator.ts
import * as FileSystem from 'expo-file-system/legacy';

export async function calculateArtworkCacheSize(): Promise<number> {
  const cacheDir = `${FileSystem.cacheDirectory}local_artwork/`;
  try {
    const dirInfo = await (await (new File(cacheDir)).exists());
    if (!dirInfo.exists) return 0;
    
    const files = await (await (new Directory(cacheDir)).list()).map(item => item.name);
    let totalSize = 0;
    
    for (const file of files) {
      const filePath = `${cacheDir}${file}`;
      const fileInfo = await (await (new File(filePath)).exists());
      if (fileInfo.exists && fileInfo.size) {
        totalSize += fileInfo.size;
      }
    }
    
    return totalSize;
  } catch (error) {
    console.error('[StorageCalculator] Failed to calculate cache size:', error);
    return 0;
  }
}

export async function getFreeStorageMB(): Promise<number> {
  try {
    const freeSpace = await FileSystem.getFreeDiskStorageAsync();
    return freeSpace / (1024 * 1024);
  } catch (error) {
    console.error('[StorageCalculator] Failed to get free storage:', error);
    return 0;
  }
}

export async function getTotalStorageMB(): Promise<number> {
  try {
    const totalSpace = await FileSystem.getTotalDiskCapacityAsync();
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