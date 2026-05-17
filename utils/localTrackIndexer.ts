// utils/localTrackIndexer.ts
import * as FileSystem from 'expo-file-system/next';
import * as Crypto from 'expo-crypto';
import { addLocalTracks } from '@/db/localDatabase';
import { extractMetadataFromFile } from './localMetadataExtractor';

export interface IndexedTrack {
  id: string;
  file_path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artwork_path: string | null;
  file_size: number;
  last_modified: number;
  folder_id: string;
}

export async function indexFolderTracks(
  folderId: string,
  folderPath: string,
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<IndexedTrack[]> {
  const audioFiles: string[] = [];
  
  const collectAudioFiles = async (dirPath: string) => {
    try {
      const items = await (await (new Directory(dirPath)).list()).map(item => item.name);
      
      for (const item of items) {
        const itemPath = `${dirPath}/${item}`;
        const stat = await (await (new File(itemPath)).exists());
        
        if (stat.exists) {
          if (stat.isDirectory) {
            await collectAudioFiles(itemPath);
          } else {
            const extension = item.split('.').pop()?.toLowerCase();
            const audioExtensions = ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'aac', 'opus'];
            if (audioExtensions.includes(extension || '')) {
              audioFiles.push(itemPath);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[TrackIndexer] Error collecting files:`, error);
    }
  };
  
  await collectAudioFiles(folderPath);
  
  const tracks: IndexedTrack[] = [];
  
  for (let i = 0; i < audioFiles.length; i++) {
    const filePath = audioFiles[i];
    const fileName = filePath.split('/').pop() || 'Unknown';
    
    onProgress?.(i + 1, audioFiles.length, fileName);
    
    try {
      const metadata = await extractMetadataFromFile(filePath);
      const trackId = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        filePath
      );
      
      tracks.push({
        id: trackId,
        file_path: filePath,
        title: metadata.title || fileName.replace(/\.[^/.]+$/, ''),
        artist: metadata.artist || 'Unknown Artist',
        album: metadata.album || 'Unknown Album',
        duration: metadata.duration || 0,
        artwork_path: metadata.artworkPath || null,
        file_size: metadata.fileSize || 0,
        last_modified: metadata.lastModified || Date.now(),
        folder_id: folderId,
      });
    } catch (error) {
      console.error(`[TrackIndexer] Failed to index ${filePath}:`, error);
    }
  }
  
  if (tracks.length > 0) {
    await addLocalTracks(tracks);
  }
  
  return tracks;
}