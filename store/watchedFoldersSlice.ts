// store/watchedFoldersSlice.ts
import { useLocalMusicStore } from './localMusicStore';

export interface WatchedFolder {
  id: string;
  path: string;
  name: string;
  dateAdded: number;
  lastScan: number;
  trackCount: number;
}

export const useWatchedFolders = () => 
  useLocalMusicStore((state) => state.watchedFolders);

export const useWatchedFolderById = (id: string) =>
  useLocalMusicStore((state) => state.watchedFolders.find((f) => f.id === id));

export const useIsFolderWatched = (path: string) =>
  useLocalMusicStore((state) => state.watchedFolders.some((f) => f.path === path));

export const useWatchedFoldersCount = () =>
  useLocalMusicStore((state) => state.watchedFolders.length);

export const useTotalLocalTracks = () =>
  useLocalMusicStore((state) => 
    state.watchedFolders.reduce((sum, folder) => sum + folder.trackCount, 0)
  );

export const useAddWatchedFolder = () => 
  useLocalMusicStore((state) => state.addWatchedFolder);

export const useRemoveWatchedFolder = () => 
  useLocalMusicStore((state) => state.removeWatchedFolder);

export const useClearAllWatchedFolders = () => 
  useLocalMusicStore((state) => state.clearAllWatchedFolders);

export const useUpdateWatchedFolderScan = () => 
  useLocalMusicStore((state) => state.updateWatchedFolderScan);