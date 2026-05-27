// services/download.ts
//
// DOWNLOAD SERVICE - Manages audio file downloads for offline playback
// FOLLOWS INTENDED ARCHITECTURE:
//   - Uses expo-file-system legacy API for compatibility
//   - REAL progress tracking from actual download bytes (no simulation)
//   - Optimized for speed with proper headers
//   - Integrates with library store for download state management

// Use legacy API to avoid deprecation warnings
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import { useLibraryStore } from '@/store/library';
import type { DownloadedSongMetadata } from '@/store/library';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DOWNLOADS_DIR = LegacyFileSystem.documentDirectory + 'downloads/';
const TEMP_DIR = LegacyFileSystem.cacheDirectory + 'downloads_temp/';

// Active download tracking
const activeDownloads = new Map<string, {
  cancel: () => void;
  promise: Promise<any>;
  pauseAsync?: () => Promise<any>;
  resumeAsync?: () => Promise<any>;
  downloadResumable?: any;
}>();

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

async function ensureDownloadsDir(): Promise<void> {
  const dirInfo = await LegacyFileSystem.getInfoAsync(DOWNLOADS_DIR);
  if (!dirInfo.exists) {
    await LegacyFileSystem.makeDirectoryAsync(DOWNLOADS_DIR, { intermediates: true });
  }
}

async function ensureTempDir(): Promise<void> {
  const dirInfo = await LegacyFileSystem.getInfoAsync(TEMP_DIR);
  if (!dirInfo.exists) {
    await LegacyFileSystem.makeDirectoryAsync(TEMP_DIR, { intermediates: true });
  }
}

function generateFilename(song: { id: string; title: string; artist: string }): string {
  const safeTitle = song.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
  const safeArtist = song.artist.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  return `${safeArtist}_${safeTitle}_${song.id}.mp3`;
}

function getFileExtension(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const ext = pathname.split('.').pop()?.split('?')[0];
    if (ext && ['mp3', 'm4a', 'aac', 'ogg', 'wav'].includes(ext.toLowerCase())) {
      return ext.toLowerCase();
    }
  } catch {}
  return 'mp3';
}

async function requestMediaLibraryPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[DownloadService] Media library permission not granted');
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[DownloadService] Failed to request media library permissions:', error);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface DownloadSongParams {
  id: string;
  title: string;
  artist: string;
  duration?: number;
  url: string;
  thumbnailUrl?: string;
  quality?: 'low' | 'medium' | 'high' | 'lossless';
}

export interface DownloadProgress {
  downloadId: string;
  songId: string;
  progress: number;
  speed: number;
  estimatedTimeRemaining: number;
  bytesWritten: number;
  bytesTotal: number;
}

export type DownloadProgressCallback = (progress: DownloadProgress) => void;

/**
 * Download a song for offline playback with REAL progress tracking
 * Uses native download resumable with accurate byte-based progress
 */
export async function downloadAndSaveSong(
  song: DownloadSongParams,
  onProgress?: DownloadProgressCallback
): Promise<DownloadedSongMetadata | null> {
  const store = useLibraryStore.getState();
  const downloadId = `${song.id}_${Date.now()}`;
  
  // Check if already downloaded
  if (store.downloadedSongIds.includes(song.id)) {
    console.log(`[DownloadService] Song already downloaded: ${song.title}`);
    return store.songs[song.id] as DownloadedSongMetadata;
  }
  
  // Check if already downloading
  const existingDownload = Object.values(store.activeDownloads).find(d => d.songId === song.id);
  if (existingDownload && existingDownload.status === 'downloading') {
    console.log(`[DownloadService] Song already downloading: ${song.title}`);
    return null;
  }
  
  // Add to active downloads
  store.addActiveDownload({
    id: downloadId,
    songId: song.id,
    title: song.title,
    artist: song.artist,
    thumbnail: song.thumbnailUrl,
  });
  
  try {
    await ensureDownloadsDir();
    await ensureTempDir();
    
    const filename = generateFilename(song);
    const fileExtension = getFileExtension(song.url);
    const finalFilename = filename.replace(/\.\w+$/, `.${fileExtension}`);
    const downloadPath = DOWNLOADS_DIR + finalFilename;
    const tempPath = TEMP_DIR + `temp_${downloadId}.${fileExtension}`;
    
    console.log(`[DownloadService] Starting download: ${song.title} -> ${downloadPath}`);
    
    let lastBytesWritten = 0;
    let lastTimestamp = Date.now();
    let lastProgressReport = 0;
    
    // Create download resumable with REAL progress tracking
    const downloadResumable = LegacyFileSystem.createDownloadResumable(
      song.url,
      tempPath,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
        },
      },
      (downloadProgress) => {
        const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress;
        
        // REAL progress percentage based on actual bytes downloaded
        const progressPercent = totalBytesExpectedToWrite > 0 
          ? totalBytesWritten / totalBytesExpectedToWrite 
          : 0;
        
        // Calculate download speed (bytes per second)
        const now = Date.now();
        const timeDiff = (now - lastTimestamp) / 1000;
        const bytesDiff = totalBytesWritten - lastBytesWritten;
        const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
        
        lastBytesWritten = totalBytesWritten;
        lastTimestamp = now;
        
        // Only report progress every 2% to avoid excessive updates
        const progressPercentInt = Math.floor(progressPercent * 100);
        if (progressPercentInt !== lastProgressReport || progressPercent >= 0.99) {
          lastProgressReport = progressPercentInt;
          
          // Update store with REAL progress
          store.updateActiveDownload(downloadId, {
            progress: progressPercent,
            speed,
            status: 'downloading',
          });
          
          // Callback for UI with REAL data
          if (onProgress) {
            onProgress({
              downloadId,
              songId: song.id,
              progress: progressPercent,
              speed,
              estimatedTimeRemaining: speed > 0 ? (totalBytesExpectedToWrite - totalBytesWritten) / speed : 0,
              bytesWritten: totalBytesWritten,
              bytesTotal: totalBytesExpectedToWrite,
            });
          }
        }
      }
    );
    
    activeDownloads.set(downloadId, {
      cancel: () => {},
      promise: downloadResumable.downloadAsync(),
      pauseAsync: () => downloadResumable.pauseAsync(),
      resumeAsync: () => downloadResumable.resumeAsync(),
      downloadResumable,
    });
    
    const result = await downloadResumable.downloadAsync();
    activeDownloads.delete(downloadId);
    
    if (!result || !result.uri) {
      throw new Error('Download failed - no result URI');
    }
    
    // Move from temp to final location
    const finalPath = DOWNLOADS_DIR + finalFilename;
    await LegacyFileSystem.moveAsync({ from: result.uri, to: finalPath });
    
    const fileInfo = await LegacyFileSystem.getInfoAsync(finalPath);
    const fileSize = fileInfo.exists ? fileInfo.size : 0;
    
    // Metadata based on quality
    let bitrate = 128;
    let sampleRate = 44100;
    let container = 'mp3';
    let codec = 'mp3';
    
    if (song.quality === 'high') {
      bitrate = 320;
    } else if (song.quality === 'medium') {
      bitrate = 192;
    } else if (song.quality === 'low') {
      bitrate = 96;
    } else if (song.quality === 'lossless') {
      bitrate = 1411;
      codec = 'flac';
    }
    
    // Optional: Save to media library
    let savedToMediaLibrary = false;
    let mediaLibraryAssetId: string | undefined;
    
    try {
      const hasPermission = await requestMediaLibraryPermissions();
      if (hasPermission) {
        const asset = await MediaLibrary.createAssetAsync(finalPath);
        mediaLibraryAssetId = asset.id;
        savedToMediaLibrary = true;
        console.log(`[DownloadService] Saved to media library: ${asset.id}`);
      }
    } catch (mediaError) {
      console.warn('[DownloadService] Failed to save to media library:', mediaError);
    }
    
    // Create downloaded song metadata with ALL required fields
    const now = new Date().toISOString();
    const downloadedSong = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      thumbnail: song.thumbnailUrl,
      url: finalPath,
      duration: song.duration || 0,
      isDownloaded: true,
      isFavorite: false,
      playCount: 0,
      skipCount: 0,
      dateAdded: now,
      dateModified: now,
      source: 'downloaded' as const,
      localTrackUri: finalPath,
      localArtworkUri: song.thumbnailUrl || '',
      downloadDate: now,
      downloadQuality: song.quality || 'high',
      fileSize,
      container,
      codec,
      bitrate,
      sampleRate,
      offlineAvailable: true,
    };
    
    // Update store - this will create the song if it doesn't exist
    store.addDownload(song.id, downloadedSong);
    store.updateActiveDownload(downloadId, { status: 'completed', progress: 1 });
    
    // Clean up active download after delay
    setTimeout(() => {
      store.removeActiveDownload(downloadId);
    }, 3000);
    
    console.log(`[DownloadService] Download complete: ${song.title} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
    return downloadedSong as DownloadedSongMetadata;
    
  } catch (error: any) {
    console.error(`[DownloadService] Download failed for ${song.title}:`, error);
    store.updateActiveDownload(downloadId, { 
      status: 'failed', 
      error: error?.message || 'Download failed' 
    });
    
    // Clean up after delay
    setTimeout(() => {
      store.removeActiveDownload(downloadId);
    }, 5000);
    
    return null;
  }
}

/**
 * Pause an active download
 */
export async function pauseDownload(downloadId: string): Promise<boolean> {
  const download = activeDownloads.get(downloadId);
  if (!download) {
    console.warn(`[DownloadService] No active download found: ${downloadId}`);
    return false;
  }
  
  try {
    if (download.pauseAsync) {
      await download.pauseAsync();
    }
    const store = useLibraryStore.getState();
    store.updateActiveDownload(downloadId, { status: 'paused' });
    console.log(`[DownloadService] Download paused: ${downloadId}`);
    return true;
  } catch (error) {
    console.error(`[DownloadService] Failed to pause download:`, error);
    return false;
  }
}

/**
 * Resume a paused download
 */
export async function resumeDownload(downloadId: string): Promise<boolean> {
  const download = activeDownloads.get(downloadId);
  if (!download) {
    console.warn(`[DownloadService] No active download found: ${downloadId}`);
    return false;
  }
  
  try {
    if (download.resumeAsync) {
      await download.resumeAsync();
    }
    const store = useLibraryStore.getState();
    store.updateActiveDownload(downloadId, { status: 'downloading' });
    console.log(`[DownloadService] Download resumed: ${downloadId}`);
    return true;
  } catch (error) {
    console.error(`[DownloadService] Failed to resume download:`, error);
    return false;
  }
}

/**
 * Cancel an active download
 */
export async function cancelDownload(downloadId: string): Promise<boolean> {
  const download = activeDownloads.get(downloadId);
  if (!download) {
    console.warn(`[DownloadService] No active download found: ${downloadId}`);
    return false;
  }
  
  try {
    const store = useLibraryStore.getState();
    const downloadInfo = store.activeDownloads[downloadId];
    if (downloadInfo) {
      const tempPath = TEMP_DIR + `temp_${downloadId}.mp3`;
      const tempInfo = await LegacyFileSystem.getInfoAsync(tempPath);
      if (tempInfo.exists) {
        await LegacyFileSystem.deleteAsync(tempPath);
      }
    }
    
    if (download.downloadResumable) {
      await download.downloadResumable.pauseAsync();
    }
    
    activeDownloads.delete(downloadId);
    store.removeActiveDownload(downloadId);
    console.log(`[DownloadService] Download cancelled: ${downloadId}`);
    return true;
  } catch (error) {
    console.error(`[DownloadService] Failed to cancel download:`, error);
    return false;
  }
}

/**
 * Delete a downloaded song from storage
 */
export async function deleteDownloadedSong(songId: string): Promise<boolean> {
  const store = useLibraryStore.getState();
  const song = store.songs[songId];
  
  if (!song || !song.isDownloaded) {
    console.warn(`[DownloadService] Song not downloaded: ${songId}`);
    return false;
  }
  
  try {
    // Delete file
    if (song.localTrackUri) {
      const fileInfo = await LegacyFileSystem.getInfoAsync(song.localTrackUri);
      if (fileInfo.exists) {
        await LegacyFileSystem.deleteAsync(song.localTrackUri);
      }
    }
    
    // Delete artwork if separate
    if (song.localArtworkUri && song.localArtworkUri !== song.localTrackUri) {
      const artworkInfo = await LegacyFileSystem.getInfoAsync(song.localArtworkUri);
      if (artworkInfo.exists) {
        await LegacyFileSystem.deleteAsync(song.localArtworkUri);
      }
    }
    
    // Remove from store
    store.removeDownload(songId);
    console.log(`[DownloadService] Deleted downloaded song: ${song.title}`);
    return true;
  } catch (error) {
    console.error(`[DownloadService] Failed to delete downloaded song:`, error);
    return false;
  }
}

/**
 * Get all downloaded songs file info
 */
export async function getDownloadedFilesInfo(): Promise<Array<{ id: string; uri: string; size: number; exists: boolean }>> {
  const store = useLibraryStore.getState();
  const results = [];
  
  for (const songId of store.downloadedSongIds) {
    const song = store.songs[songId];
    if (song?.localTrackUri) {
      try {
        const info = await LegacyFileSystem.getInfoAsync(song.localTrackUri);
        results.push({
          id: songId,
          uri: song.localTrackUri,
          size: info.exists ? info.size : 0,
          exists: info.exists,
        });
      } catch {
        results.push({
          id: songId,
          uri: song.localTrackUri,
          size: 0,
          exists: false,
        });
      }
    }
  }
  
  return results;
}

/**
 * Clean up orphaned download files
 */
export async function cleanupOrphanedDownloads(): Promise<number> {
  try {
    await ensureDownloadsDir();
    const files = await LegacyFileSystem.readDirectoryAsync(DOWNLOADS_DIR);
    const store = useLibraryStore.getState();
    let deletedCount = 0;
    
    for (const file of files) {
      const isOrphaned = !store.downloadedSongIds.some(songId => {
        const song = store.songs[songId];
        return song?.localTrackUri?.includes(file);
      });
      
      if (isOrphaned) {
        const filePath = DOWNLOADS_DIR + file;
        await LegacyFileSystem.deleteAsync(filePath);
        deletedCount++;
        console.log(`[DownloadService] Deleted orphaned file: ${file}`);
      }
    }
    
    return deletedCount;
  } catch (error) {
    console.error('[DownloadService] Failed to cleanup orphaned downloads:', error);
    return 0;
  }
}

/**
 * Get total download size
 */
export async function getTotalDownloadSize(): Promise<number> {
  const files = await getDownloadedFilesInfo();
  return files.reduce((total, file) => total + (file.exists ? file.size : 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook to manage download state for a song
 */
export function useSongDownload(songId: string) {
  const isDownloaded = useLibraryStore((s) => s.downloadedSongIds.includes(songId));
  const activeDownloadsList = useLibraryStore((s) => Object.values(s.activeDownloads));
  const download = activeDownloadsList.find(d => d.songId === songId);
  
  const isDownloading = download?.status === 'downloading';
  const downloadProgress = download?.progress ?? 0;
  const downloadSpeed = download?.speed ?? 0;
  const downloadStatus = download?.status ?? null;
  
  return {
    isDownloaded,
    isDownloading,
    downloadProgress,
    downloadSpeed,
    downloadStatus,
  };
}