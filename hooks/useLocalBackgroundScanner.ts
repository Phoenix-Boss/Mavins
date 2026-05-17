// hooks/useLocalBackgroundScanner.ts
import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus, InteractionManager } from 'react-native';
import { useLocalMusicStore } from '@/store/localMusicStore';
import { getAllTracks, getTracksByAlbum, type LocalTrack } from '@/db/localDatabase';

export function useLocalBackgroundScanner() {
  const { watchedFolders, updateWatchedFolderScan, setScanning, setScanProgress, setCurrentScanningFolder } = useLocalMusicStore();
  const isScanningRef = useRef(false);
  const cancelledRef = useRef(false);
  
  const refreshAllFolderTrackCounts = useCallback(async () => {
    if (isScanningRef.current || watchedFolders.length === 0) return;
    
    isScanningRef.current = true;
    cancelledRef.current = false;
    
    for (let i = 0; i < watchedFolders.length; i++) {
      if (cancelledRef.current) break;
      
      const folder = watchedFolders[i];
      const tracks = await getTracksByAlbum(folder.id);
      updateWatchedFolderScan(folder.id, tracks.length, Date.now());
    }
    
    isScanningRef.current = false;
  }, [watchedFolders, updateWatchedFolderScan]);
  
  const cancelScan = useCallback(() => {
    cancelledRef.current = true;
    isScanningRef.current = false;
  }, []);
  
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        InteractionManager.runAfterInteractions(() => {
          refreshAllFolderTrackCounts();
        });
      }
    });
    
    return () => {
      subscription.remove();
      cancelScan();
    };
  }, [refreshAllFolderTrackCounts, cancelScan]);
  
  return {
    refreshAllFolderTrackCounts,
    cancelScan,
    isScanning: isScanningRef.current,
  };
}
