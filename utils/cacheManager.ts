// utils/cacheManager.ts
import { file, directory } from 'expo-file-system/next';
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
  return await getCacheStats();
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
    const artworkDir = directory(`${file('/').path}local_artwork/`);
    const exists = await artworkDir.exists();
    if (!exists) issues.push('Artwork cache directory missing');
    const size = await getArtworkCacheSizeMB();
    if (size > 100) issues.push(`Cache size (${size.toFixed(2)}MB) exceeds 100MB`);
  } catch (error) {
    issues.push(`Cache health check error: ${error}`);
  }
  return { healthy: issues.length === 0, issues };
}