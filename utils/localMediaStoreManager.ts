// utils/localMediaStoreManager.ts - Update validateFileUri to use /next
import * as MediaLibrary from 'expo-media-library';
import { file } from 'expo-file-system/next';
import { Platform } from 'react-native';
import {
  addWatchedAlbum,
  removeWatchedAlbum,
  addTracks,
  deleteTracksByAlbum,
  updateAlbumTrackCount,
  getAllWatchedAlbums,
  getTracksByAlbum,
  saveAvailableFolders,
  getAllAvailableFolders,
  updateFolderUserSelected,
  getWatchedFolderIds,
  hasAvailableFolders,
  deleteOldFolders,
  getUserSelectedFolders,
  updateTrackValidationStatus,
  type LocalTrack,
  type WatchedAlbum,
  type AvailableFolder
} from '@/db/localDatabase';
import { cacheArtworkFromUri } from './artworkCache';
import { normalizeLocalUri } from '@/libs/playerSetup';

export interface AlbumInfo {
  id: string;
  title: string;
  artworkUri: string | null;
  assetCount: number;
  isWatched?: boolean;
}

// Queue for background indexing
let indexingQueue: string[] = [];
let isIndexing = false;
let isFullScanInProgress = false;
let initialScanDone = false;

class LocalMediaStoreManager {
  private static instance: LocalMediaStoreManager;
  private permissionGranted: boolean = false;

  private constructor() {}

  static getInstance(): LocalMediaStoreManager {
    if (!LocalMediaStoreManager.instance) {
      LocalMediaStoreManager.instance = new LocalMediaStoreManager();
    }
    return LocalMediaStoreManager.instance;
  }

  async hasPermission(): Promise<boolean> {
    const { status } = await MediaLibrary.getPermissionsAsync();
    this.permissionGranted = status === 'granted';
    return this.permissionGranted;
  }

  async requestPermissions(): Promise<boolean> {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    this.permissionGranted = status === 'granted';
    return this.permissionGranted;
  }

  // Validate a single file URI - UPDATED to use expo-file-system/next
  private async validateFileUri(uri: string): Promise<boolean> {
    if (!uri || uri.length === 0) {
      return false;
    }
    
    // content:// URIs from MediaStore are always considered valid
    // They will be handled correctly by expo-audio
    if (uri.startsWith('content://')) {
      return true;
    }
    
    // For file:// URIs, convert to path and check if file exists
    if (uri.startsWith('file://')) {
      try {
        const filePath = uri.substring(7);
        const audioFile = file(filePath);
        const exists = await audioFile.exists();
        if (exists) {
          const stats = await audioFile.stat();
          return stats.size > 0;
        }
        return false;
      } catch (error) {
        return false;
      }
    }
    
    // For absolute paths, check if file exists
    if (uri.startsWith('/')) {
      try {
        const audioFile = file(uri);
        const exists = await audioFile.exists();
        if (exists) {
          const stats = await audioFile.stat();
          return stats.size > 0;
        }
        return false;
      } catch (error) {
        return false;
      }
    }
    
    return false;
  }

  // Rest of the file remains the same...
  async getAvailableAlbums(forceRefresh: boolean = false): Promise<AlbumInfo[]> {
    if (!forceRefresh && await hasAvailableFolders()) {
      const cachedFolders = await getAllAvailableFolders();
      const userSelectedIds = await getWatchedFolderIds();
      const selectedSet = new Set(userSelectedIds);
      
      return cachedFolders.map(folder => ({
        id: folder.folder_id,
        title: folder.folder_name,
        artworkUri: folder.artwork_uri,
        assetCount: folder.track_count,
        isWatched: selectedSet.has(folder.folder_id)
      }));
    }
    
    return await this.scanAndStoreAllAlbums();
  }

  async scanAndStoreAllAlbums(): Promise<AlbumInfo[]> {
    if (isFullScanInProgress) {
      console.log('[MediaStoreManager] Scan already in progress, waiting...');
      await new Promise<void>(resolve => {
        const checkInterval = setInterval(() => {
          if (!isFullScanInProgress) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
      return await this.getAvailableAlbums(false);
    }
    
    isFullScanInProgress = true;
    console.log('[MediaStoreManager] Starting full scan of ALL audio folders...');
    
    try {
      const hasPermission = await this.hasPermission();
      if (!hasPermission) {
        const granted = await this.requestPermissions();
        if (!granted) {
          console.log('[MediaStoreManager] Permission denied');
          return [];
        }
      }
      
      const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: false });
      console.log(`[MediaStoreManager] Found ${albums.length} total albums`);
      
      const allAudioFolders: Omit<AvailableFolder, 'created_at'>[] = [];
      const albumInfoList: AlbumInfo[] = [];
      
      for (let i = 0; i < albums.length; i++) {
        const album = albums[i];
        
        try {
          const assets = await MediaLibrary.getAssetsAsync({
            album: album.id,
            first: 1,
            mediaType: ['audio']
          });
          
          if (assets.assets.length > 0) {
            const allAssets = await MediaLibrary.getAssetsAsync({
              album: album.id,
              mediaType: ['audio']
            });
            
            const trackCount = allAssets.totalCount;
            
            allAudioFolders.push({
              folder_id: album.id,
              folder_name: album.title,
              folder_path: album.id,
              track_count: trackCount,
              artwork_uri: null,
              is_watched: 1,
              user_selected: 0,
              last_seen: Date.now()
            });
            
            albumInfoList.push({
              id: album.id,
              title: album.title,
              artworkUri: null,
              assetCount: trackCount,
              isWatched: false
            });
            
            console.log(`[MediaStoreManager] [${i + 1}/${albums.length}] Added: ${album.title} (${trackCount} tracks)`);
          }
        } catch (error) {
          console.warn(`[MediaStoreManager] Failed to check album ${album.title}:`, error);
        }
      }
      
      if (allAudioFolders.length > 0) {
        await saveAvailableFolders(allAudioFolders);
        console.log(`[MediaStoreManager] Saved ${allAudioFolders.length} audio folders to database`);
      }
      
      console.log(`[MediaStoreManager] Full scan complete: ${albumInfoList.length} folders found`);
      initialScanDone = true;
      
      return albumInfoList;
    } catch (error) {
      console.error('[MediaStoreManager] Full scan failed:', error);
      return [];
    } finally {
      isFullScanInProgress = false;
    }
  }

  async getUserSelectedFolders(): Promise<AvailableFolder[]> {
    return await getUserSelectedFolders();
  }

  async toggleUserSelected(folderId: string, selected: boolean): Promise<void> {
    await updateFolderUserSelected(folderId, selected ? 1 : 0);
    
    if (selected) {
      const folder = (await getAllAvailableFolders()).find(f => f.folder_id === folderId);
      if (folder) {
        await addWatchedAlbum(folderId, folder.folder_name, folder.artwork_uri);
      }
    } else {
      await removeWatchedAlbum(folderId);
    }
  }

  async refreshAlbumsInBackground(): Promise<void> {
    if (isFullScanInProgress) {
      console.log('[MediaStoreManager] Scan already in progress');
      return;
    }
    
    isFullScanInProgress = true;
    try {
      console.log('[MediaStoreManager] Background refresh started');
      
      const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: false });
      const existingFolders = await getAllAvailableFolders();
      const existingIds = new Set(existingFolders.map(f => f.folder_id));
      
      const newFolders: Omit<AvailableFolder, 'created_at'>[] = [];
      
      for (const album of albums) {
        if (!existingIds.has(album.id)) {
          const assets = await MediaLibrary.getAssetsAsync({
            album: album.id,
            first: 1,
            mediaType: ['audio']
          });
          
          if (assets.assets.length > 0) {
            const allAssets = await MediaLibrary.getAssetsAsync({
              album: album.id,
              mediaType: ['audio']
            });
            
            newFolders.push({
              folder_id: album.id,
              folder_name: album.title,
              folder_path: album.id,
              track_count: allAssets.totalCount,
              artwork_uri: null,
              is_watched: 1,
              user_selected: 0,
              last_seen: Date.now()
            });
          }
        }
      }
      
      if (newFolders.length > 0) {
        await saveAvailableFolders(newFolders);
        console.log(`[MediaStoreManager] Added ${newFolders.length} new folders`);
      }
      
      console.log('[MediaStoreManager] Background refresh completed');
    } catch (error) {
      console.error('[MediaStoreManager] Background refresh failed:', error);
    } finally {
      isFullScanInProgress = false;
    }
  }

  async getAlbumTracks(albumId: string): Promise<MediaLibrary.Asset[]> {
    const allTracks: MediaLibrary.Asset[] = [];
    let hasNextPage = true;
    let after: string | undefined = undefined;
    
    while (hasNextPage) {
      const result = await MediaLibrary.getAssetsAsync({
        album: albumId,
        mediaType: MediaLibrary.MediaType.audio,
        first: 200,
        after,
        sortBy: [[MediaLibrary.SortBy.default, false]]
      });
      
      allTracks.push(...result.assets);
      hasNextPage = result.hasNextPage;
      after = result.endCursor;
    }
    
    return allTracks;
  }

  async addWatchedAlbumWithTracksInBackground(
    albumId: string,
    albumName: string,
    albumArtworkUri: string | null
  ): Promise<void> {
    await this.toggleUserSelected(albumId, true);
    indexingQueue.push(albumId);
    this.processIndexingQueue();
  }

  async removeWatchedAlbum(albumId: string): Promise<void> {
    await this.toggleUserSelected(albumId, false);
    await deleteTracksByAlbum(albumId);
  }

  private async processIndexingQueue(): Promise<void> {
    if (isIndexing || indexingQueue.length === 0) return;
    
    isIndexing = true;
    const albumId = indexingQueue.shift()!;
    
    try {
      const album = (await getAllWatchedAlbums()).find(a => a.album_id === albumId);
      if (!album) return;
      
      const tracks = await this.getAlbumTracks(albumId);
      const localTracks: Omit<LocalTrack, 'added_to_library'>[] = [];
      let validatedCount = 0;
      let invalidCount = 0;
      
      console.log(`[MediaStoreManager] Indexing ${tracks.length} tracks for ${album.album_name}...`);
      
      for (const asset of tracks) {
        let cachedArtworkPath: string | null = null;
        const rawUri = asset.uri;
        
        const normalizedUri = normalizeLocalUri(rawUri);
        const isValid = await this.validateFileUri(normalizedUri);
        
        if (isValid) {
          validatedCount++;
        } else {
          invalidCount++;
          console.warn(`[MediaStoreManager] Invalid file URI for ${asset.filename}: ${normalizedUri}`);
        }
        
        const artworkUri = (asset as any).artworkUri || (asset as any).albumArtUri || null;
        if (artworkUri) {
          cachedArtworkPath = await cacheArtworkFromUri(artworkUri, asset.id);
        }
        
        let title = (asset as any).filename?.replace(/\.[^/.]+$/, '') || 'Unknown';
        let artist = (asset as any).artist || 'Unknown Artist';
        
        if ((artist === 'Unknown Artist' || !artist) && title.includes(' - ')) {
          const parts = title.split(' - ');
          if (parts.length >= 2) {
            artist = parts[0];
            title = parts.slice(1).join(' - ');
          }
        }
        
        localTracks.push({
          track_id: asset.id,
          album_id: albumId,
          title: title.trim(),
          artist: artist === 'Unknown Artist' ? 'Upcoming Artist' : artist.trim(),
          album: album.album_name,
          duration: Math.floor(asset.duration * 1000) || 180000,
          artwork_uri: artworkUri,
          cached_artwork_path: cachedArtworkPath,
          file_uri: normalizedUri,
          last_modified: asset.modificationTime || Date.now(),
          is_valid: isValid ? 1 : 0
        });
      }
      
      if (localTracks.length > 0) {
        await addTracks(localTracks);
        await updateAlbumTrackCount(albumId, localTracks.length);
        
        for (const track of localTracks) {
          await updateTrackValidationStatus(track.track_id, track.is_valid === 1);
        }
      }
      
      console.log(`[MediaStoreManager] Indexed ${localTracks.length} tracks for ${album.album_name} (${validatedCount} valid, ${invalidCount} invalid)`);
    } catch (error) {
      console.error('[MediaStoreManager] Background indexing failed:', error);
    } finally {
      isIndexing = false;
      this.processIndexingQueue();
    }
  }

  async getWatchedAlbums(): Promise<WatchedAlbum[]> {
    return await getAllWatchedAlbums();
  }

  async getAlbumLocalTracks(albumId: string): Promise<LocalTrack[]> {
    return await getTracksByAlbum(albumId);
  }
}

export const mediaStoreManager = LocalMediaStoreManager.getInstance();