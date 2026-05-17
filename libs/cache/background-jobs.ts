// libs/cache/background-jobs.ts

import { cacheManager } from './cache-manager';
import { supabaseCache } from './supabase-cache';
import { getConfig } from './config';
import { StreamData, TrackMetadata } from './types';

// `config` was previously imported as a static named export but `config.ts`
// exports a function `getConfig()` — there is no `config` named export, so
// `config` was `undefined` at runtime, crashing every access to
// `config.background.*`.
//
// Additionally, `CacheConfig` has no `background` key at all, so those
// property paths (`maxPreCache`, `popularThreshold`, `refreshIntervalMinutes`)
// do not exist anywhere in the config shape.
//
// Fix: call `getConfig()` where we actually need config values, and use
// local constants for values that were never in the config.

/** How often background jobs run (ms). Defaults to 60 minutes. */
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/** Max popular searches to pre-cache per run. */
const MAX_PRE_CACHE = 50;

/** Minimum hit count to qualify as a "popular" search. */
const POPULAR_THRESHOLD = 10;

/**
 * Background Jobs - Run every hour
 * Auto-cache related tracks, refresh streams, clean stale data
 */
export class BackgroundJobs {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start background jobs
   */
  public start(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }

    console.log('🚀 Starting background cache jobs...');

    // Run immediately on start
    this.runAllJobs();

    // Then run every hour
    this.interval = setInterval(() => {
      this.runAllJobs();
    }, REFRESH_INTERVAL_MS);
  }

  /**
   * Stop background jobs
   */
  public stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('🛑 Background jobs stopped');
    }
  }

  /**
   * Run all background jobs
   */
  public async runAllJobs(): Promise<void> {
    if (this.isRunning) {
      console.log('Background jobs already running, skipping...');
      return;
    }

    this.isRunning = true;
    console.log('📊 Running background cache jobs...');

    try {
      await Promise.all([
        this.refreshExpiringStreams(),
        this.cachePopularSearches(),
        this.cleanStaleData(),
        this.updateStats()
      ]);

      console.log('✅ Background jobs completed');
    } catch (error) {
      console.error('❌ Background jobs error:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Job 1: Refresh expiring streams
   */
  private async refreshExpiringStreams(): Promise<void> {
    console.log('  🔄 Checking for expiring streams...');

    const expiringStreams = await supabaseCache.getExpiringStreams(6);

    if (!expiringStreams || expiringStreams.length === 0) {
      console.log('  ✅ No expiring streams found');
      return;
    }

    console.log(`  Found ${expiringStreams.length} expiring streams`);

    for (const stream of expiringStreams) {
      try {
        // Get track info
        const track = await supabaseCache.getTrack(stream.trackId);
        
        if (!track) continue;

        console.log(`    Refreshing stream for: ${track.title} - ${track.artist}`);
        
        // TODO: Implement actual stream refresh logic
        // This would call your API to get a fresh stream URL
        
        // For now, just extend expiry
        // await this.extendStreamExpiry(stream);
        
      } catch (error) {
        console.error(`    Error refreshing stream ${stream.id}:`, error);
      }
    }
  }

  /**
   * Job 2: Cache popular searches
   * Previously crashed with "Cannot read property 'background' of undefined"
   * because it read config.background.maxPreCache / config.background.popularThreshold
   * — neither property path exists. Now uses local constants instead.
   */
  private async cachePopularSearches(): Promise<void> {
    console.log('  🔄 Caching popular searches...');

    const popular = await supabaseCache.getPopularSearches(
      MAX_PRE_CACHE,
      POPULAR_THRESHOLD
    );

    if (!popular || popular.length === 0) {
      console.log('  ✅ No popular searches to cache');
      return;
    }

    console.log(`  Found ${popular.length} popular searches`);

    for (const search of popular) {
      try {
        // Check if we already have related tracks for this track
        const related = await supabaseCache.getRelatedTracks(search.trackId, 1);
        
        if (!related || related.length === 0) {
          // Need to cache related tracks
          const track = await supabaseCache.getTrack(search.trackId);
          
          if (track) {
            console.log(`    Pre-caching related for: ${track.title}`);
            
            // This will trigger background caching
            await cacheManager.cacheRelatedTracks(
              search.trackId,
              track.artist,
              track.title
            );
          }
        }
      } catch (error) {
        console.error(`    Error caching popular search ${search.query}:`, error);
      }
    }
  }

  /**
   * Job 3: Clean stale data
   */
  private async cleanStaleData(): Promise<void> {
    console.log('  🧹 Cleaning stale data...');

    const staleTracks = await supabaseCache.getStaleTracks(90);

    if (!staleTracks || staleTracks.length === 0) {
      console.log('  ✅ No stale tracks found');
      return;
    }

    console.log(`  Found ${staleTracks.length} stale tracks`);
    
    // TODO: Implement archival or deletion logic
    // For now, just log
  }

  /**
   * Job 4: Update statistics
   */
  private async updateStats(): Promise<void> {
    console.log('  📈 Updating cache statistics...');

    const stats = await cacheManager.getStats();
    
    console.log('  Current cache stats:');
    console.log(`    Device cache: ${stats.device.size}/${stats.device.maxSize} items`);
    console.log(`    Supabase tracks: ${stats.supabase?.tracks || 0}`);
    console.log(`    Active streams: ${stats.supabase?.activeStreams || 0}`);
    console.log(`    Total searches: ${stats.supabase?.searches || 0}`);

    // You could save these stats to a separate table
  }

  /**
   * Helper: Extend stream expiry
   */
  private async extendStreamExpiry(stream: StreamData): Promise<boolean> {
    // This would call your API to verify the stream is still valid
    // and extend its expiry in the database
    
    // For now, return false
    return false;
  }
}

// Export singleton instance
export const backgroundJobs = new BackgroundJobs();

// Start background jobs if run directly
if (require.main === module) {
  backgroundJobs.start();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    backgroundJobs.stop();
    process.exit();
  });
}
