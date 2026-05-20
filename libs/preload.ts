// libs/preload.ts
//
// REWRITE: Safe background preloader that never races with active playback.
//
// KEY DESIGN DECISIONS:
//
//   1. SERIALIZED QUEUE — resolveTrack calls are run one at a time
//   2. SINGLE TRACK PRELOAD — only preload 1 track ahead, not 5
//   3. PLAYBACK LOCK — preload only after current track is playing
//   4. REGISTRATION PATTERN — avoids circular dependencies

import type { Song } from '@/types/song';
import type { ResolvedTrack } from '@/components/MusicPlayerContext';

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVED URL CACHE
// ─────────────────────────────────────────────────────────────────────────────

const resolvedUrlCache = new Map<string, string>();

export function getCachedResolvedUrl(songId: string): string | null {
  return resolvedUrlCache.get(songId) ?? null;
}

export function setCachedResolvedUrl(songId: string, url: string): void {
  if (!songId || !url) return;
  resolvedUrlCache.set(songId, url);
}

export function clearResolvedUrlCache(): void {
  resolvedUrlCache.clear();
}

export function getResolvedCacheSize(): number {
  return resolvedUrlCache.size;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVE TRACK REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

let resolveTrackFn: ((song: Song) => Promise<ResolvedTrack | null>) | null = null;

export function registerResolveTrack(fn: (song: Song) => Promise<ResolvedTrack | null>): void {
  resolveTrackFn = fn;
  console.log('[Preload] resolveTrack registered');
}

function getResolveTrack(): (song: Song) => Promise<ResolvedTrack | null> {
  if (!resolveTrackFn) {
    throw new Error('[Preload] resolveTrack not registered');
  }
  return resolveTrackFn;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE TRACK EXTRAS REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

interface TrackExtras {
  videoId?: string;
  videoUrl?: string;
  muxedVideoUrl?: string;
  isLocal?: boolean;
  likeCount?: number;
  dislikeCount?: number;
  viewCount?: number;
  commentsCount?: number;
  uploaderUrl?: string;
}

let storeTrackExtrasFn: ((trackId: string, extras: TrackExtras) => void) | null = null;

export function registerStoreTrackExtras(fn: (trackId: string, extras: TrackExtras) => void): void {
  storeTrackExtrasFn = fn;
  console.log('[Preload] storeTrackExtras registered');
}

function getStoreTrackExtras(): (trackId: string, extras: TrackExtras) => void {
  return storeTrackExtrasFn || (() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYBACK LOCK - Prevents preload during active playback resolution
// ─────────────────────────────────────────────────────────────────────────────

let playbackActive = false;
let playbackActiveResolvers: Array<() => void> = [];

export function setPlaybackActive(): void {
  playbackActive = true;
  console.log('[Preload] Playback lock ACQUIRED - preload paused');
}

export function setPlaybackInactive(): void {
  playbackActive = false;
  console.log('[Preload] Playback lock RELEASED - preload can resume');
  const resolvers = [...playbackActiveResolvers];
  playbackActiveResolvers = [];
  resolvers.forEach(r => r());
}

async function waitForPlaybackSlot(): Promise<void> {
  if (!playbackActive) return;
  console.log('[Preload] Waiting for playback lock to clear...');
  await new Promise<void>(resolve => {
    playbackActiveResolvers.push(resolve);
  });
  console.log('[Preload] Playback lock cleared, resuming');
}

// ─────────────────────────────────────────────────────────────────────────────
// SERIAL QUEUE - Only ONE resolveTrack at a time
// ─────────────────────────────────────────────────────────────────────────────

let queueTail: Promise<void> = Promise.resolve();
let activeTaskCount = 0;

function enqueue(task: () => Promise<void>): void {
  queueTail = queueTail.then(async () => {
    activeTaskCount++;
    try {
      await task();
    } catch (error) {
      console.error('[Preload] Task error:', error);
    } finally {
      activeTaskCount--;
    }
  }).catch(() => {});
}

export function getActivePreloadCount(): number {
  return activeTaskCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRELOAD SINGLE SONG
// ─────────────────────────────────────────────────────────────────────────────

export interface PreloadSong {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  videoId: string;
  duration: number;
}

function preloadSong(song: PreloadSong, abortSignal?: AbortSignal): void {
  enqueue(async () => {
    if (abortSignal?.aborted) {
      console.log(`[Preload] Aborted: "${song.title}"`);
      return;
    }

    if (resolvedUrlCache.has(song.id)) {
      console.log(`[Preload] Already cached: "${song.title}"`);
      return;
    }

    // Check if local file
    const isLocal = song.url.startsWith('file://') ||
                    song.url.startsWith('/') ||
                    song.url.startsWith('content://');
    
    if (isLocal) {
      const normalizedUrl = song.url.startsWith('/') ? `file://${song.url}` : song.url;
      setCachedResolvedUrl(song.id, normalizedUrl);
      const storeExtras = getStoreTrackExtras();
      storeExtras(song.id, {
        isLocal: true,
        videoId: song.videoId,
        likeCount: -1,
        dislikeCount: -1,
        viewCount: -1,
        commentsCount: -1,
      });
      console.log(`[Preload] Local track cached: "${song.title}"`);
      return;
    }

    // Wait if player is currently loading a track
    await waitForPlaybackSlot();

    if (abortSignal?.aborted) {
      console.log(`[Preload] Aborted after wait: "${song.title}"`);
      return;
    }
    
    if (resolvedUrlCache.has(song.id)) {
      console.log(`[Preload] Cached during wait: "${song.title}"`);
      return;
    }

    const songObj: Song = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      thumbnail: song.thumbnail,
      url: song.url,
      videoId: song.videoId,
      duration: song.duration,
    };

    try {
      console.log(`[Preload] 🔄 Resolving: "${song.title}"`);
      const resolveTrack = getResolveTrack();
      const resolved = await resolveTrack(songObj);

      if (abortSignal?.aborted) {
        console.log(`[Preload] Aborted after resolve: "${song.title}"`);
        return;
      }

      if (resolved?.url) {
        setCachedResolvedUrl(song.id, resolved.url);
        console.log(`[Preload] ✅ Cached: "${song.title}"`);
        
        if (resolved.videoId) {
          const storeExtras = getStoreTrackExtras();
          storeExtras(song.id, {
            videoId: resolved.videoId,
            videoUrl: (resolved as any).videoUrl,
            muxedVideoUrl: (resolved as any).muxedVideoUrl,
            isLocal: resolved.isLocal,
          });
        }
      } else {
        console.warn(`[Preload] ❌ No URL for: "${song.title}"`);
      }
    } catch (err) {
      console.warn(`[Preload] ❌ Error for "${song.title}":`, err);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PRELOAD SEARCH RESULTS
// ─────────────────────────────────────────────────────────────────────────────

export function preloadSearchResults(songs: PreloadSong[]): void {
  if (!songs || songs.length === 0) {
    console.log('[Preload] No songs to preload');
    return;
  }
  
  console.log(`[Preload] 📦 Queuing ${songs.length} search results (serial, 1 at a time)...`);
  for (const song of songs) {
    preloadSong(song);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRELOAD NEXT TRACKS - ONLY 1 TRACK AHEAD
// ─────────────────────────────────────────────────────────────────────────────

export function preloadNextTracks(
  queue: Song[],
  currentIndex: number,
  abortSignal?: AbortSignal,
): void {
  if (!queue.length || currentIndex < 0) return;

  // ONLY preload the very next track (1 ahead), not 5
  const nextTrack = queue[currentIndex + 1];
  
  if (!nextTrack) {
    console.log('[Preload] No upcoming track to preload');
    return;
  }

  console.log(`[Preload] 🎵 Preloading next track (1 ahead): "${nextTrack.title}"`);

  const url = nextTrack.url || '';
  const isLocal = url.startsWith('file://') ||
                  url.startsWith('/') ||
                  url.startsWith('content://') ||
                  (nextTrack as any).isLocal === true ||
                  (nextTrack as any).isDownloaded === true;

  if (isLocal) {
    const normalizedUrl = url.startsWith('/') ? `file://${url}` : url;
    setCachedResolvedUrl(nextTrack.id, normalizedUrl);
    const storeExtras = getStoreTrackExtras();
    storeExtras(nextTrack.id, {
      isLocal: true,
      videoId: nextTrack.videoId,
      likeCount: -1,
      dislikeCount: -1,
      viewCount: -1,
      commentsCount: -1,
    });
    console.log(`[Preload] Local track cached: "${nextTrack.title}"`);
    return;
  }

  preloadSong(
    {
      id: nextTrack.id,
      title: nextTrack.title,
      artist: nextTrack.artist || '',
      thumbnail: nextTrack.thumbnail || '',
      url: nextTrack.url,
      videoId: nextTrack.videoId || '',
      duration: nextTrack.duration || 0,
    },
    abortSignal,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

let globalAbortController: AbortController | null = null;

export function cancelAllPreloads(): void {
  if (globalAbortController) {
    globalAbortController.abort();
    console.log('[Preload] All preload tasks cancelled');
  }
  globalAbortController = new AbortController();
}

export function getPreloadAbortSignal(): AbortSignal {
  if (!globalAbortController) {
    globalAbortController = new AbortController();
  }
  return globalAbortController.signal;
}