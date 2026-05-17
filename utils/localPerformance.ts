// utils/localPerformance.ts
import { InteractionManager } from 'react-native';
import { getAllLocalTracks, getTotalLocalTracks } from '@/db/localDatabase';

let cacheValid = false;
let cachedTotalTracks = 0;
let lastCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

export async function getCachedTotalTracks(): Promise<number> {
  const now = Date.now();
  if (cacheValid && (now - lastCacheTime) < CACHE_TTL) {
    return cachedTotalTracks;
  }
  
  cachedTotalTracks = await getTotalLocalTracks();
  lastCacheTime = now;
  cacheValid = true;
  return cachedTotalTracks;
}

export function invalidateCache() {
  cacheValid = false;
  cachedTotalTracks = 0;
  lastCacheTime = 0;
}

export async function runAfterInteractions(callback: () => void) {
  await InteractionManager.runAfterInteractions(callback);
}

let scrollDebounceTimer: NodeJS.Timeout | null = null;

export function debounceScroll<T extends (...args: any[]) => void>(
  callback: T,
  delay = 100
): (...args: Parameters<T>) => void {
  return (...args: Parameters<T>) => {
    if (scrollDebounceTimer) {
      clearTimeout(scrollDebounceTimer);
    }
    scrollDebounceTimer = setTimeout(() => {
      callback(...args);
      scrollDebounceTimer = null;
    }, delay);
  };
}

export function throttle<T extends (...args: any[]) => void>(
  callback: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      callback(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

const BATCH_SIZE = 50;
let batchQueue: any[] = [];
let batchTimer: NodeJS.Timeout | null = null;

export async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  onBatchComplete?: (results: R[]) => void
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
    if (onBatchComplete) {
      onBatchComplete(batchResults);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  return results;
}

export function queueBatchItem<T>(item: T, processor: (item: T) => Promise<void>) {
  batchQueue.push(item);
  
  if (batchTimer) {
    clearTimeout(batchTimer);
  }
  
  batchTimer = setTimeout(async () => {
    const itemsToProcess = [...batchQueue];
    batchQueue = [];
    batchTimer = null;
    
    for (const itemToProcess of itemsToProcess) {
      await processor(itemToProcess);
    }
  }, 500);
}