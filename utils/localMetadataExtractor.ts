// utils/localMetadataExtractor.ts
import { file } from 'expo-file-system/next';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';

export interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  duration: number;
  artworkPath?: string;
  fileSize: number;
  lastModified: number;
  bitrate?: number;
  sampleRate?: number;
}

// Extract metadata from audio file
export async function extractMetadataFromFile(filePath: string): Promise<AudioMetadata> {
  const audioFile = file(filePath);
  const stat = await audioFile.stat();
  const lastModified = stat.modified ? new Date(stat.modified).getTime() : 0;
  const fileSize = stat.size || 0;
  
  let title: string | undefined;
  let artist: string | undefined;
  let album: string | undefined;
  let duration = 0;
  let artworkPath: string | undefined;
  let bitrate: number | undefined;
  let sampleRate: number | undefined;
  
  // Try to extract metadata using MediaLibrary
  try {
    if (Platform.OS === 'android') {
      // Extract from filename as fallback
      const fileName = filePath.split('/').pop() || '';
      const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
      
      // Try to parse "Artist - Title" pattern
      if (fileNameWithoutExt.includes(' - ')) {
        const parts = fileNameWithoutExt.split(' - ');
        artist = parts[0];
        title = parts.slice(1).join(' - ');
      } else {
        title = fileNameWithoutExt;
      }
    } else {
      // iOS - use MediaLibrary
      const asset = await MediaLibrary.getAssetInfoAsync(filePath as any);
      if (asset) {
        title = asset.filename?.replace(/\.[^/.]+$/, '');
        duration = asset.duration || 0;
      }
    }
  } catch (error) {
    console.warn(`[MetadataExtractor] MediaLibrary extraction failed for ${filePath}:`, error);
  }
  
  // Fallback: extract from filename
  if (!title && !artist) {
    const fileName = filePath.split('/').pop() || '';
    const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
    
    if (fileNameWithoutExt.includes(' - ')) {
      const parts = fileNameWithoutExt.split(' - ');
      artist = parts[0];
      title = parts.slice(1).join(' - ');
    } else {
      title = fileNameWithoutExt;
    }
  }
  
  // Estimate duration from file size (very rough, better to use actual extraction)
  // For MP3 at 128kbps, approximate: duration ≈ fileSize / 16
  if (duration === 0 && fileSize > 0) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext === 'mp3') {
      duration = Math.floor(fileSize / 16000);
    }
  }
  
  // Bitrate estimation
  if (duration > 0 && fileSize > 0) {
    bitrate = Math.floor((fileSize * 8) / duration / 1000);
  }
  
  return {
    title,
    artist,
    album,
    duration,
    artworkPath,
    fileSize,
    lastModified,
    bitrate,
    sampleRate
  };
}

// Extract artwork from audio file (simplified)
export async function extractArtworkFromFile(filePath: string): Promise<string | null> {
  // This would require a native module to extract embedded artwork
  // For now, return null - artwork will be generated from folder or placeholder
  return null;
}

// Generate artwork hash from file path
export function generateArtworkHash(filePath: string): string {
  // Simple hash for caching
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    const char = filePath.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `artwork_${Math.abs(hash)}.jpg`;
}