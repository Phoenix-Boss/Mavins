// store/localMusicStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SelectedFolder {
  path: string;
  name: string;
  selectedAt: number;
}

export interface WatchedFolderItem {
  id: string;
  path: string;
  name: string;
  dateAdded: number;
  lastScan: number;
  trackCount: number;
}

interface LocalMusicState {
  watchedFolders: WatchedFolderItem[];
  selectedFolders: SelectedFolder[];
  isFolderBrowserOpen: boolean;
  currentBrowserPath: string | null;
  defaultView: 'normal' | 'local';
  isScanning: boolean;
  currentScanProgress: number;
  currentScanningFolder: string | null;
}

interface LocalMusicActions {
  addWatchedFolder: (folder: WatchedFolderItem) => void;
  removeWatchedFolder: (folderId: string) => void;
  clearAllWatchedFolders: () => void;
  updateWatchedFolderScan: (folderId: string, trackCount: number, lastScan: number) => void;
  addSelectedFolder: (folder: SelectedFolder) => void;
  removeSelectedFolder: (folderPath: string) => void;
  clearSelectedFolders: () => void;
  isFolderSelected: (folderPath: string) => boolean;
  getSelectedCount: () => number;
  openFolderBrowser: (initialPath?: string) => void;
  closeFolderBrowser: () => void;
  setCurrentBrowserPath: (path: string | null) => void;
  setDefaultView: (view: 'normal' | 'local') => void;
  setScanning: (isScanning: boolean) => void;
  setScanProgress: (progress: number) => void;
  setCurrentScanningFolder: (folderPath: string | null) => void;
  resetLocalMusic: () => void;
}

type LocalMusicStore = LocalMusicState & LocalMusicActions;

const initialState: LocalMusicState = {
  watchedFolders: [],
  selectedFolders: [],
  isFolderBrowserOpen: false,
  currentBrowserPath: null,
  defaultView: 'normal',
  isScanning: false,
  currentScanProgress: 0,
  currentScanningFolder: null,
};

export const useLocalMusicStore = create<LocalMusicStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      addWatchedFolder: (folder) =>
        set((state) => ({
          watchedFolders: [...state.watchedFolders, folder],
        })),

      removeWatchedFolder: (folderId) =>
        set((state) => ({
          watchedFolders: state.watchedFolders.filter((f) => f.id !== folderId),
        })),

      clearAllWatchedFolders: () =>
        set({ watchedFolders: [] }),

      updateWatchedFolderScan: (folderId, trackCount, lastScan) =>
        set((state) => ({
          watchedFolders: state.watchedFolders.map((f) =>
            f.id === folderId ? { ...f, trackCount, lastScan } : f
          ),
        })),

      addSelectedFolder: (folder) =>
        set((state) => {
          if (state.selectedFolders.some((f) => f.path === folder.path)) return state;
          return { selectedFolders: [...state.selectedFolders, folder] };
        }),

      removeSelectedFolder: (folderPath) =>
        set((state) => ({
          selectedFolders: state.selectedFolders.filter((f) => f.path !== folderPath),
        })),

      clearSelectedFolders: () =>
        set({ selectedFolders: [] }),

      isFolderSelected: (folderPath) => {
        return get().selectedFolders.some((f) => f.path === folderPath);
      },

      getSelectedCount: () => {
        return get().selectedFolders.length;
      },

      openFolderBrowser: (initialPath = '/') =>
        set({
          isFolderBrowserOpen: true,
          currentBrowserPath: initialPath,
          selectedFolders: [],
        }),

      closeFolderBrowser: () =>
        set({
          isFolderBrowserOpen: false,
          currentBrowserPath: null,
          selectedFolders: [],
        }),

      setCurrentBrowserPath: (path) =>
        set({ currentBrowserPath: path }),

      setDefaultView: (view) =>
        set({ defaultView: view }),

      setScanning: (isScanning) =>
        set({ isScanning }),

      setScanProgress: (progress) =>
        set({ currentScanProgress: progress }),

      setCurrentScanningFolder: (folderPath) =>
        set({ currentScanningFolder: folderPath }),

      resetLocalMusic: () =>
        set(initialState),
    }),
    {
      name: 'local-music-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        watchedFolders: state.watchedFolders,
        defaultView: state.defaultView,
      }),
    }
  )
);