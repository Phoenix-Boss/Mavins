// hooks/useLocalFileWatcher.ts
import { useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useLocalMusicStore } from '@/store/localMusicStore';
import { getAllTracks, getTracksByAlbum, type LocalTrack } from '@/db/localDatabase';

export function useLocalFileWatcher() {
  const { watchedFolders, updateWatchedFolderScan } = useLocalMusicStore();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const checkAllFolders = useCallback(async () => {
    for (const folder of watchedFolders) {
      const tracks = await getTracksByAlbum(folder.id);
      updateWatchedFolderScan(folder.id, tracks.length, Date.now());
    }
  }, [watchedFolders, updateWatchedFolderScan]);
  
  const startWatching = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(checkAllFolders, 30000);
  }, [checkAllFolders]);
  
  const stopWatching = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);
  
  useEffect(() => {
    if (watchedFolders.length > 0) {
      startWatching();
    }
    
    return () => {
      stopWatching();
    };
  }, [watchedFolders, startWatching, stopWatching]);
  
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        checkAllFolders();
      }
    });
    
    return () => subscription.remove();
  }, [checkAllFolders]);
  
  return { startWatching, stopWatching, checkAllFolders };
}
