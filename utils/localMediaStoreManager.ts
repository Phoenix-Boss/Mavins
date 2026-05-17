// utils/localMediaStoreManager.ts
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
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

  // Get available albums for folder browser - returns ALL folders from DB instantly
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

  // Scan ALL audio folders from MediaStore and store them in DB (called once)
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

  // Get user-selected folders for the library view
  async getUserSelectedFolders(): Promise<AvailableFolder[]> {
    return await getUserSelectedFolders();
  }

  // Toggle user selection for a folder
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

  // Refresh in background - adds new folders without re-scanning existing ones
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
    if (albumId.startsWith('fs_')) {
      return await this.scanFolderForTracks(albumId);
    }
    
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

  async scanFolderForTracks(folderId: string): Promise<MediaLibrary.Asset[]> {
    const folders = await getAllAvailableFolders();
    const folder = folders.find(f => f.folder_id === folderId);
    if (!folder || !folder.folder_path) {
      return [];
    }
    
    const audioExtensions = new Set(['mp3', 'm4a', 'flac', 'wav', 'ogg', 'aac', 'opus']);
    const audioFiles: { path: string; name: string; modified: number }[] = [];
    
    const scanDir = async (dirPath: string, depth: number = 0) => {
      if (depth > 2) return;
      
      try {
        const items = await (await (new Directory(dirPath)).list()).map(item => item.name);
        
        for (const item of items) {
          if (item.startsWith('.')) continue;
          
          const itemPath = `${dirPath}/${item}`;
          try {
            const stat = await (await (new File(itemPath)).exists());
            if (stat.exists) {
              if (stat.isDirectory) {
                await scanDir(itemPath, depth + 1);
              } else {
                const ext = item.split('.').pop()?.toLowerCase();
                if (ext && audioExtensions.has(ext)) {
                  audioFiles.push({
                    path: itemPath,
                    name: item,
                    modified: stat.modificationTime || Date.now()
                  });
                }
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    };
    
    await scanDir(folder.folder_path);
    
    const assets: MediaLibrary.Asset[] = audioFiles.map((file, index) => ({
      id: `fs_${Buffer.from(file.path).toString('base64').substring(0, 32)}`,
      uri: `file://${file.path}`,
      filename: file.name,
      duration: 0,
      mediaType: 'audio',
      modificationTime: file.modified,
      width: 0,
      height: 0,
      creationTime: file.modified,
      albumId: folderId,
      mediaSubtypes: [],
      favorite: false,
      isLivePhoto: false
    } as MediaLibrary.Asset));
    
    return assets;
  }

  // Validate a single file URI - For content:// URIs from MediaStore, they are always valid
  private async validateFileUri(uri: string): Promise<boolean> {
    if (!uri || uri.length === 0) {
      return false;
    }
    
    // content:// URIs from MediaStore are always considered valid
    // They will be handled correctly by expo-audio
    if (uri.startsWith('content://')) {
      return true;
    }
    
    // For file:// URIs, check if file exists
    if (uri.startsWith('file://')) {
      try {
        const filePath = uri.substring(7);
        const info = await (await (new File(filePath)).exists());
        return info.exists && info.size > 0;
      } catch (error) {
        return false;
      }
    }
    
    // For absolute paths, check if file exists
    if (uri.startsWith('/')) {
      try {
        const info = await (await (new File(uri)).exists());
        return info.exists && info.size > 0;
      } catch (error) {
        return false;
      }
    }
    
    return false;
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
      
      console.log(`[MediaStoreManager] Indexing ${tracks.length} tracks for ${album.album_name}...`);
      
      for (const asset of tracks) {
        let cachedArtworkPath: string | null = null;
        const fileUri = asset.uri;
        
        // Validate file URI - content:// URIs are automatically valid
        const isValid = await this.validateFileUri(fileUri);
        
        if (isValid) {
          validatedCount++;
        } else {
          console.warn(`[MediaStoreManager] Invalid file URI for ${asset.filename}: ${fileUri}`);
        }
        
        if (!albumId.startsWith('fs_')) {
          const artworkUri = (asset as any).artworkUri || (asset as any).albumArtUri;
          if (artworkUri) {
            cachedArtworkPath = await cacheArtworkFromUri(artworkUri, asset.id);
          }
        }
        
        let title = (asset as any).filename?.replace(/\.[^/.]+$/, '') || 'Unknown';
        let artist = (asset as any).artist || 'Unknown Artist';
        
        if (albumId.startsWith('fs_') && title.includes(' - ')) {
          const parts = title.split(' - ');
          if (parts.length >= 2) {
            artist = parts[0];
            title = parts.slice(1).join(' - ');
          }
        }
        
        localTracks.push({
          track_id: asset.id,
          album_id: albumId,
          title: title,
          artist: artist === 'Unknown Artist' ? 'Upcoming Artist' : artist,
          album: album.album_name,
          duration: Math.floor(asset.duration * 1000) || 180000,
          artwork_uri: (asset as any).artworkUri || null,
          cached_artwork_path: cachedArtworkPath,
          file_uri: fileUri,
          last_modified: asset.modificationTime
        });
      }
      
      if (localTracks.length > 0) {
        await addTracks(localTracks);
        await updateAlbumTrackCount(albumId, localTracks.length);
      }
      
      console.log(`[MediaStoreManager] Indexed ${localTracks.length} tracks for ${album.album_name} (${validatedCount} valid, ${localTracks.length - validatedCount} invalid)`);
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