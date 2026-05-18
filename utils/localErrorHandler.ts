// utils/localErrorHandler.ts - CONVERTED TO expo-file-system/next
import { Alert, Platform } from 'react-native';
import { file } from 'expo-file-system/next';
import { initLocalDatabase, clearAllLocalData } from '@/db/localDatabase';
import { clearArtworkCache } from './artworkCache';

export enum LocalMusicErrorType {
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  CORRUPTED_FILE = 'CORRUPTED_FILE',
  DATABASE_CORRUPTED = 'DATABASE_CORRUPTED',
  STORAGE_FULL = 'STORAGE_FULL',
  SD_CARD_REMOVED = 'SD_CARD_REMOVED',
  SCAN_CANCELLED = 'SCAN_CANCELLED',
  UNKNOWN = 'UNKNOWN',
}

export interface LocalMusicError {
  type: LocalMusicErrorType;
  message: string;
  originalError?: Error;
  context?: Record<string, any>;
}

class LocalErrorHandler {
  private static instance: LocalErrorHandler;
  private errorListeners: ((error: LocalMusicError) => void)[] = [];
  
  private constructor() {}
  
  static getInstance(): LocalErrorHandler {
    if (!LocalErrorHandler.instance) {
      LocalErrorHandler.instance = new LocalErrorHandler();
    }
    return LocalErrorHandler.instance;
  }
  
  addListener(listener: (error: LocalMusicError) => void) {
    this.errorListeners.push(listener);
  }
  
  removeListener(listener: (error: LocalMusicError) => void) {
    const index = this.errorListeners.indexOf(listener);
    if (index !== -1) this.errorListeners.splice(index, 1);
  }
  
  private notify(error: LocalMusicError) {
    this.errorListeners.forEach(listener => listener(error));
  }
  
  async handlePermissionDenied(): Promise<boolean> {
    if (Platform.OS === 'android') {
      Alert.alert(
        'Storage Permission Required',
        'Mavin needs access to your storage to find music files. Please grant permission in settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => {
            // This would require linking to settings
          } },
        ]
      );
    }
    
    const error: LocalMusicError = {
      type: LocalMusicErrorType.PERMISSION_DENIED,
      message: 'Storage permission not granted',
    };
    this.notify(error);
    return false;
  }
  
  async handleFileNotFound(filePath: string): Promise<void> {
    const error: LocalMusicError = {
      type: LocalMusicErrorType.FILE_NOT_FOUND,
      message: `File not found: ${filePath}`,
      context: { filePath },
    };
    this.notify(error);
  }
  
  async handleCorruptedFile(filePath: string): Promise<void> {
    const error: LocalMusicError = {
      type: LocalMusicErrorType.CORRUPTED_FILE,
      message: `Skipping corrupted file: ${filePath}`,
      context: { filePath },
    };
    this.notify(error);
  }
  
  async handleDatabaseCorruption(): Promise<void> {
    const error: LocalMusicError = {
      type: LocalMusicErrorType.DATABASE_CORRUPTED,
      message: 'Local music database corrupted, rebuilding...',
    };
    this.notify(error);
    
    try {
      await clearAllLocalData();
      await initLocalDatabase();
    } catch (rebuildError) {
      console.error('[ErrorHandler] Failed to rebuild database:', rebuildError);
    }
  }
  
  async handleStorageFull(requiredBytes: number): Promise<boolean> {
    try {
      const testFile = file('/storage/emulated/0');
      const freeSpace = await testFile.getFreeSpace();
      
      if (freeSpace < requiredBytes) {
        const error: LocalMusicError = {
          type: LocalMusicErrorType.STORAGE_FULL,
          message: `Insufficient storage. Need ${Math.ceil(requiredBytes / 1024 / 1024)}MB`,
          context: { requiredBytes, freeSpace },
        };
        this.notify(error);
        
        Alert.alert(
          'Storage Full',
          'Not enough space for artwork cache. Clear cache or free up space.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Clear Cache', onPress: () => clearArtworkCache() },
          ]
        );
        return false;
      }
    } catch (error) {
      console.error('[ErrorHandler] Failed to check storage:', error);
    }
    return true;
  }
  
  async handleSDCardRemoval(): Promise<void> {
    const error: LocalMusicError = {
      type: LocalMusicErrorType.SD_CARD_REMOVED,
      message: 'SD Card was removed. Pausing scans.',
    };
    this.notify(error);
  }
  
  handleScanCancelled(): void {
    const error: LocalMusicError = {
      type: LocalMusicErrorType.SCAN_CANCELLED,
      message: 'Scan was cancelled',
    };
    this.notify(error);
  }
  
  handleUnknownError(originalError: Error, context?: Record<string, any>): void {
    const error: LocalMusicError = {
      type: LocalMusicErrorType.UNKNOWN,
      message: originalError.message || 'An unknown error occurred',
      originalError,
      context,
    };
    this.notify(error);
    console.error('[ErrorHandler] Unknown error:', originalError, context);
  }
}

export const localErrorHandler = LocalErrorHandler.getInstance();