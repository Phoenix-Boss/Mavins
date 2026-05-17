// utils/cacheManager.ts
import { cacheDirectory } from 'expo-file-system';
import { File, Directory } from 'expo-file-system/next';
import { initArtworkCache, clearArtworkCache, getArtworkCacheSizeMB, getCacheStats, enforceCacheSizeLimit } from './artworkCache';
import { cleanupExpiredSnapshots } from './folderSnapshotManager';

export async function initAllCaches(): Promise<void> {
  await initArtworkCache();
  await cleanupExpiredSnapshots();
  console.log('[CacheManager] All caches initialized');
}

export async function clearAllCaches(): Promise<void> {
  await clearArtworkCache();
  await cleanupExpiredSnapshots();
  console.log('[CacheManager] All caches cleared');
}

export async function getTotalCacheUsage(): Promise<{ artworkSizeMB: number; artworkFileCount: number }> {
  const stats = await getCacheStats();
  return { artworkSizeMB: stats.totalSizeMB, artworkFileCount: stats.totalFiles };
}

export async function manualCacheCleanup(): Promise<void> {
  await enforceCacheSizeLimit();
  await cleanupExpiredSnapshots();
  console.log('[CacheManager] Manual cache cleanup completed');
}

let maintenanceInterval: NodeJS.Timeout | null = null;

export function startPeriodicCacheMaintenance(intervalHours: number = 24): void {
  if (maintenanceInterval) clearInterval(maintenanceInterval);
  maintenanceInterval = setInterval(async () => {
    console.log('[CacheManager] Running periodic maintenance');
    await manualCacheCleanup();
  }, intervalHours * 60 * 60 * 1000);
}

export function stopPeriodicCacheMaintenance(): void {
  if (maintenanceInterval) {
    clearInterval(maintenanceInterval);
    maintenanceInterval = null;
  }
}

export async function checkCacheHealth(): Promise<{ healthy: boolean; issues: string[] }> {
  const issues: string[] = [];
  try {
    const artworkDir = new Directory(`${cacheDirectory}local_artwork/`);
    if (!await artworkDir.exists()) issues.push('Artwork cache directory missing');
    const size = await getArtworkCacheSizeMB();
    if (size > 100) issues.push(`Cache size (${size.toFixed(2)}MB) exceeds 100MB`);
  } catch (error) {
    issues.push(`Cache health check error: ${error}`);
  }
  return { healthy: issues.length === 0, issues };
}