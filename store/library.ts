// store/library.ts
//
// Library state — Zustand + MMKV (react-native-mmkv)
//
// Why this over Redux + redux-persist:
//   • MMKV is 30× faster than AsyncStorage — synchronous reads, no await
//   • Zustand needs zero Provider boilerplate — hooks work anywhere
//   • Immer middleware gives the same mutating reducer style as RTK
//   • Same ergonomics as before: selector hooks are drop-in replacements
//
// Architecture:
//   useLibraryStore (Zustand + MMKV)  → offline / local state
//   TanStack Query                    → streaming / server state (unchanged)
//
// Selector hooks keep all existing component code working unchanged:
//   useFavorites()         → { songs, albums, artists, playlists, favoriteTracks }
//   useDownloadedTracks()  → DownloadedSongMetadata[]
//   useActiveDownloads()   → ActiveDownload[]
//   usePlaylists()         → Record<string, Playlist | SmartPlaylist>
//   ... etc.

import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/shallow';
import { MMKV } from 'react-native-mmkv';

// ─────────────────────────────────────────────────────────────────────────────
// MMKV storage adapter for Zustand persist middleware
// ─────────────────────────────────────────────────────────────────────────────

const mmkv = new MMKV({ id: 'mavin-library' });

const mmkvStorage: StateStorage = {
  getItem: (key) => mmkv.getString(key) ?? null,
  setItem: (key, value) => mmkv.set(key, value),
  removeItem: (key) => mmkv.delete(key),
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Artist {
  id: string;
  name: string;
  thumbnail?: string;
  coverImage?: string;
  bio?: string;
  followers: number;
  monthlyListeners: number;
  genres: string[];
  isFollowed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Album {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  thumbnail?: string;
  coverImage?: string;
  year: number;
  trackCount: number;
  duration: number;
  genre: string;
  isSaved: boolean;
  releaseDate: string;
  recordLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  thumbnail?: string;
  url: string;
  duration: number;
  trackNumber?: number;
  discNumber?: number;
  genre?: string;
  releaseYear?: number;
  bitrate?: number;
  sampleRate?: number;
  fileSize?: number;
  format?: string;
  isDownloaded: boolean;
  isFavorite: boolean;
  playCount: number;
  skipCount: number;
  lastPlayed?: string;
  dateAdded: string;
  dateModified: string;
  lyrics?: string;
  composer?: string;
  copyright?: string;
  localUri?: string;
  localArtworkUri?: string;
  localTrackUri?: string;
  localMetadata?: {
    container: string;
    codec: string;
    channels: number;
    bitsPerSample?: number;
    bitrate: number;
    sampleRate: number;
    duration: number;
    album?: string;
    artist?: string;
    title?: string;
    picture?: string;
  };
  streamUrl?: string;
  streamQuality?: {
    low?: string;
    medium?: string;
    high?: string;
    lossless?: string;
  };
  source: 'streaming' | 'local' | 'downloaded';
}

export interface DownloadedSongMetadata extends Song {
  localTrackUri: string;
  localArtworkUri: string;
  downloadDate: string;
  downloadQuality: 'low' | 'medium' | 'high' | 'lossless';
  fileSize: number;
  container: string;
  codec: string;
  bitrate: number;
  sampleRate: number;
  offlineAvailable: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  thumbnail?: string;
  coverImage?: string;
  trackIds: string[];
  trackCount: number;
  duration: number;
  createdBy: 'user' | 'system' | 'shared';
  userId?: string;
  isPublic: boolean;
  isCollaborative: boolean;
  followers: number;
  createdAt: string;
  updatedAt: string;
  lastPlayed?: string;
  color?: string;
}

export interface SmartPlaylistRule {
  field:
    | 'title' | 'artist' | 'album' | 'genre' | 'year'
    | 'playCount' | 'dateAdded' | 'duration' | 'bitrate'
    | 'isFavorite' | 'isDownloaded';
  operator:
    | 'contains' | 'equals' | 'startsWith' | 'endsWith'
    | 'greaterThan' | 'lessThan' | 'between' | 'inLast' | 'not';
  value: string | number | boolean | [number, number];
}

export interface SmartPlaylist extends Playlist {
  isSmartPlaylist: true;
  rules: SmartPlaylistRule[];
  matchType: 'all' | 'any';
  autoUpdate: boolean;
  lastUpdated: string;
}

export interface Folder {
  id: string;
  name: string;
  path: string;
  trackIds: string[];
  subFolderIds: string[];
  parentFolderId?: string;
  trackCount: number;
  duration: number;
  dateModified: string;
}

export interface Genre {
  id: string;
  name: string;
  trackIds: string[];
  artistIds: string[];
  albumIds: string[];
  thumbnail?: string;
  trackCount: number;
  duration: number;
}

export interface PlayHistoryItem {
  songId: string;
  song: Song;
  playedAt: string;
  playedDuration: number;
  completed: boolean;
  source: 'streaming' | 'local' | 'downloaded';
}

export interface ActiveDownload {
  id: string;
  songId: string;
  title: string;
  artist: string;
  thumbnail?: string;
  progress: number;
  speed: number;
  estimatedTimeRemaining: number;
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'failed';
  error?: string;
}

export interface LibrarySettings {
  showLocalFiles: boolean;
  showStreaming: boolean;
  downloadQuality: 'low' | 'medium' | 'high' | 'lossless';
  streamingQuality: 'low' | 'medium' | 'high' | 'lossless';
  offlineMode: boolean;
  syncOverCellular: boolean;
  autoDownloadFavorites: boolean;
  smartPlaylists: boolean;
  folderStructure: 'flat' | 'hierarchical';
  sorting: 'az' | 'za' | 'dateAdded' | 'dateModified' | 'artist' | 'album' | 'year' | 'duration';
  grouping: 'none' | 'album' | 'artist' | 'folder' | 'genre' | 'year';
}

// ─────────────────────────────────────────────────────────────────────────────
// Store state + actions interface
// ─────────────────────────────────────────────────────────────────────────────

interface LibraryState {
  songs: Record<string, Song>;
  artists: Record<string, Artist>;
  albums: Record<string, Album>;
  playlists: Record<string, Playlist | SmartPlaylist>;
  folders: Record<string, Folder>;
  genres: Record<string, Genre>;

  songIds: string[];
  artistIds: string[];
  albumIds: string[];
  playlistIds: string[];
  folderIds: string[];
  genreIds: string[];

  favoriteSongIds: string[];
  favoriteAlbumIds: string[];
  favoriteArtistIds: string[];
  favoritePlaylistIds: string[];

  downloadedSongIds: string[];
  downloadedAlbumIds: string[];
  downloadedPlaylistIds: string[];

  // Runtime only — not persisted
  activeDownloads: Record<string, ActiveDownload>;

  playHistory: PlayHistoryItem[];
  recentlyPlayedSongIds: string[];
  mostPlayedSongIds: string[];

  isScanning: boolean;
  scanProgress: number;
  lastScanTime?: string;
  totalLocalTracks: number;

  settings: LibrarySettings;

  loading: Record<'songs' | 'artists' | 'albums' | 'playlists' | 'folders' | 'genres', boolean>;
}

interface LibraryActions {
  // Songs
  addSongs: (songs: Song[]) => void;
  updateSong: (id: string, updates: Partial<Song>) => void;
  removeSong: (id: string) => void;
  // Artists
  addArtists: (artists: Artist[]) => void;
  updateArtist: (id: string, updates: Partial<Artist>) => void;
  followArtist: (id: string) => void;
  unfollowArtist: (id: string) => void;
  // Albums
  addAlbums: (albums: Album[]) => void;
  updateAlbum: (id: string, updates: Partial<Album>) => void;
  saveAlbum: (id: string) => void;
  unsaveAlbum: (id: string) => void;
  // Playlists
  addPlaylist: (playlist: Playlist | SmartPlaylist) => void;
  updatePlaylist: (id: string, updates: Partial<Playlist>) => void;
  deletePlaylist: (id: string) => void;
  addTrackToPlaylist: (playlistId: string, songId: string) => void;
  removeTrackFromPlaylist: (playlistId: string, songId: string) => void;
  reorderPlaylistTracks: (playlistId: string, fromIndex: number, toIndex: number) => void;
  // Folders
  addFolder: (folder: Folder) => void;
  updateFolder: (id: string, updates: Partial<Folder>) => void;
  scanFolder: (folderId: string, trackIds: string[]) => void;
  // Genres
  addGenre: (genre: Genre) => void;
  updateGenre: (id: string, updates: Partial<Genre>) => void;
  // Favourites
  addFavorite: (type: 'song' | 'album' | 'artist' | 'playlist', id: string) => void;
  removeFavorite: (type: 'song' | 'album' | 'artist' | 'playlist', id: string) => void;
  toggleFavoriteSong: (id: string) => void;
  // Downloads
  addDownload: (songId: string, metadata: Partial<DownloadedSongMetadata>) => void;
  removeDownload: (songId: string) => void;
  // Active downloads
  addActiveDownload: (d: Omit<ActiveDownload, 'progress' | 'speed' | 'estimatedTimeRemaining' | 'status'>) => void;
  updateActiveDownload: (id: string, updates: Partial<ActiveDownload>) => void;
  removeActiveDownload: (id: string) => void;
  // History
  addToPlayHistory: (item: PlayHistoryItem) => void;
  clearPlayHistory: () => void;
  // Local scan
  importLocalSongs: (payload: { songs: Song[]; folders?: Folder[]; genres?: Genre[] }) => void;
  setScanning: (value: boolean) => void;
  setScanProgress: (value: number) => void;
  setLastScanTime: (value: string) => void;
  setTotalLocalTracks: (value: number) => void;
  // Settings & loading
  updateSettings: (updates: Partial<LibrarySettings>) => void;
  setLoading: (key: keyof LibraryState['loading'], value: boolean) => void;
  // Reset
  clearLibrary: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial state
// ─────────────────────────────────────────────────────────────────────────────

const initialState: LibraryState = {
  songs: {}, artists: {}, albums: {}, playlists: {}, folders: {}, genres: {},
  songIds: [], artistIds: [], albumIds: [], playlistIds: [], folderIds: [], genreIds: [],
  favoriteSongIds: [], favoriteAlbumIds: [], favoriteArtistIds: [], favoritePlaylistIds: [],
  downloadedSongIds: [], downloadedAlbumIds: [], downloadedPlaylistIds: [],
  activeDownloads: {},
  playHistory: [], recentlyPlayedSongIds: [], mostPlayedSongIds: [],
  isScanning: false, scanProgress: 0, totalLocalTracks: 0,
  settings: {
    showLocalFiles: true, showStreaming: true,
    downloadQuality: 'high', streamingQuality: 'high',
    offlineMode: false, syncOverCellular: false,
    autoDownloadFavorites: false, smartPlaylists: true,
    folderStructure: 'hierarchical', sorting: 'az', grouping: 'none',
  },
  loading: { songs: false, artists: false, albums: false, playlists: false, folders: false, genres: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

function rebuildMostPlayed(state: LibraryState) {
  state.mostPlayedSongIds = Object.values(state.songs)
    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
    .slice(0, 50)
    .map((s) => s.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useLibraryStore = create<LibraryState & LibraryActions>()(
  persist(
    immer((set) => ({
      ...initialState,

      // ── Songs ──────────────────────────────────────────────────────────────
      addSongs: (songs) => set((s) => {
        songs.forEach((song) => {
          s.songs[song.id] = song;
          if (!s.songIds.includes(song.id)) s.songIds.push(song.id);
        });
      }),
      updateSong: (id, updates) => set((s) => {
        if (s.songs[id]) Object.assign(s.songs[id], updates);
      }),
      removeSong: (id) => set((s) => {
        delete s.songs[id];
        s.songIds = s.songIds.filter((x) => x !== id);
        s.favoriteSongIds = s.favoriteSongIds.filter((x) => x !== id);
        s.downloadedSongIds = s.downloadedSongIds.filter((x) => x !== id);
        s.recentlyPlayedSongIds = s.recentlyPlayedSongIds.filter((x) => x !== id);
        s.mostPlayedSongIds = s.mostPlayedSongIds.filter((x) => x !== id);
      }),

      // ── Artists ────────────────────────────────────────────────────────────
      addArtists: (artists) => set((s) => {
        artists.forEach((a) => {
          s.artists[a.id] = a;
          if (!s.artistIds.includes(a.id)) s.artistIds.push(a.id);
        });
      }),
      updateArtist: (id, updates) => set((s) => {
        if (s.artists[id]) Object.assign(s.artists[id], updates);
      }),
      followArtist: (id) => set((s) => {
        if (s.artists[id]) s.artists[id].isFollowed = true;
        if (!s.favoriteArtistIds.includes(id)) s.favoriteArtistIds.unshift(id);
      }),
      unfollowArtist: (id) => set((s) => {
        if (s.artists[id]) s.artists[id].isFollowed = false;
        s.favoriteArtistIds = s.favoriteArtistIds.filter((x) => x !== id);
      }),

      // ── Albums ─────────────────────────────────────────────────────────────
      addAlbums: (albums) => set((s) => {
        albums.forEach((a) => {
          s.albums[a.id] = a;
          if (!s.albumIds.includes(a.id)) s.albumIds.push(a.id);
        });
      }),
      updateAlbum: (id, updates) => set((s) => {
        if (s.albums[id]) Object.assign(s.albums[id], updates);
      }),
      saveAlbum: (id) => set((s) => {
        if (s.albums[id]) s.albums[id].isSaved = true;
        if (!s.favoriteAlbumIds.includes(id)) s.favoriteAlbumIds.unshift(id);
      }),
      unsaveAlbum: (id) => set((s) => {
        if (s.albums[id]) s.albums[id].isSaved = false;
        s.favoriteAlbumIds = s.favoriteAlbumIds.filter((x) => x !== id);
      }),

      // ── Playlists ──────────────────────────────────────────────────────────
      addPlaylist: (playlist) => set((s) => {
        s.playlists[playlist.id] = playlist;
        if (!s.playlistIds.includes(playlist.id)) s.playlistIds.push(playlist.id);
      }),
      updatePlaylist: (id, updates) => set((s) => {
        if (s.playlists[id]) {
          Object.assign(s.playlists[id], updates);
          s.playlists[id].updatedAt = new Date().toISOString();
        }
      }),
      deletePlaylist: (id) => set((s) => {
        delete s.playlists[id];
        s.playlistIds = s.playlistIds.filter((x) => x !== id);
        s.favoritePlaylistIds = s.favoritePlaylistIds.filter((x) => x !== id);
      }),
      addTrackToPlaylist: (playlistId, songId) => set((s) => {
        const pl = s.playlists[playlistId];
        if (!pl || pl.trackIds.includes(songId)) return;
        pl.trackIds.push(songId);
        pl.trackCount = pl.trackIds.length;
        if (s.songs[songId]) pl.duration += s.songs[songId].duration;
        pl.updatedAt = new Date().toISOString();
      }),
      removeTrackFromPlaylist: (playlistId, songId) => set((s) => {
        const pl = s.playlists[playlistId];
        if (!pl) return;
        const idx = pl.trackIds.indexOf(songId);
        if (idx === -1) return;
        if (s.songs[songId]) pl.duration = Math.max(0, pl.duration - s.songs[songId].duration);
        pl.trackIds.splice(idx, 1);
        pl.trackCount = pl.trackIds.length;
        pl.updatedAt = new Date().toISOString();
      }),
      reorderPlaylistTracks: (playlistId, fromIndex, toIndex) => set((s) => {
        const pl = s.playlists[playlistId];
        if (!pl) return;
        const [moved] = pl.trackIds.splice(fromIndex, 1);
        pl.trackIds.splice(toIndex, 0, moved);
        pl.updatedAt = new Date().toISOString();
      }),

      // ── Folders ────────────────────────────────────────────────────────────
      addFolder: (folder) => set((s) => {
        s.folders[folder.id] = folder;
        if (!s.folderIds.includes(folder.id)) s.folderIds.push(folder.id);
      }),
      updateFolder: (id, updates) => set((s) => {
        if (s.folders[id]) Object.assign(s.folders[id], updates);
      }),
      scanFolder: (folderId, trackIds) => set((s) => {
        if (!s.folders[folderId]) return;
        s.folders[folderId].trackIds = trackIds;
        s.folders[folderId].trackCount = trackIds.length;
        let dur = 0;
        trackIds.forEach((tid) => { if (s.songs[tid]) dur += s.songs[tid].duration; });
        s.folders[folderId].duration = dur;
        s.folders[folderId].dateModified = new Date().toISOString();
      }),

      // ── Genres ─────────────────────────────────────────────────────────────
      addGenre: (genre) => set((s) => {
        s.genres[genre.id] = genre;
        if (!s.genreIds.includes(genre.id)) s.genreIds.push(genre.id);
      }),
      updateGenre: (id, updates) => set((s) => {
        if (s.genres[id]) Object.assign(s.genres[id], updates);
      }),

      // ── Favourites ─────────────────────────────────────────────────────────
      addFavorite: (type, id) => set((s) => {
        if (type === 'song') {
          if (!s.favoriteSongIds.includes(id)) s.favoriteSongIds.unshift(id);
          if (s.songs[id]) s.songs[id].isFavorite = true;
        } else if (type === 'album') {
          if (!s.favoriteAlbumIds.includes(id)) s.favoriteAlbumIds.unshift(id);
          if (s.albums[id]) s.albums[id].isSaved = true;
        } else if (type === 'artist') {
          if (!s.favoriteArtistIds.includes(id)) s.favoriteArtistIds.unshift(id);
          if (s.artists[id]) s.artists[id].isFollowed = true;
        } else {
          if (!s.favoritePlaylistIds.includes(id)) s.favoritePlaylistIds.unshift(id);
        }
      }),
      removeFavorite: (type, id) => set((s) => {
        if (type === 'song') {
          s.favoriteSongIds = s.favoriteSongIds.filter((x) => x !== id);
          if (s.songs[id]) s.songs[id].isFavorite = false;
        } else if (type === 'album') {
          s.favoriteAlbumIds = s.favoriteAlbumIds.filter((x) => x !== id);
          if (s.albums[id]) s.albums[id].isSaved = false;
        } else if (type === 'artist') {
          s.favoriteArtistIds = s.favoriteArtistIds.filter((x) => x !== id);
          if (s.artists[id]) s.artists[id].isFollowed = false;
        } else {
          s.favoritePlaylistIds = s.favoritePlaylistIds.filter((x) => x !== id);
        }
      }),
      toggleFavoriteSong: (id) => set((s) => {
        if (!s.songs[id]) return;
        const isFav = s.songs[id].isFavorite;
        s.songs[id].isFavorite = !isFav;
        if (isFav) {
          s.favoriteSongIds = s.favoriteSongIds.filter((x) => x !== id);
        } else {
          if (!s.favoriteSongIds.includes(id)) s.favoriteSongIds.unshift(id);
        }
      }),

      // ── Downloads ──────────────────────────────────────────────────────────
      addDownload: (songId, metadata) => set((s) => {
        if (!s.downloadedSongIds.includes(songId)) s.downloadedSongIds.unshift(songId);
        if (s.songs[songId]) {
          s.songs[songId].isDownloaded = true;
          s.songs[songId].source = 'downloaded';
          Object.assign(s.songs[songId], metadata);
        }
      }),
      removeDownload: (songId) => set((s) => {
        s.downloadedSongIds = s.downloadedSongIds.filter((x) => x !== songId);
        if (s.songs[songId]) {
          s.songs[songId].isDownloaded = false;
          s.songs[songId].source = 'streaming';
          s.songs[songId].localUri = undefined;
          s.songs[songId].localTrackUri = undefined;
          s.songs[songId].localArtworkUri = undefined;
          s.songs[songId].localMetadata = undefined;
        }
      }),

      // ── Active downloads (runtime — not persisted) ─────────────────────────
      addActiveDownload: (d) => set((s) => {
        s.activeDownloads[d.id] = { ...d, progress: 0, speed: 0, estimatedTimeRemaining: 0, status: 'pending' };
      }),
      updateActiveDownload: (id, updates) => set((s) => {
        if (s.activeDownloads[id]) Object.assign(s.activeDownloads[id], updates);
      }),
      removeActiveDownload: (id) => set((s) => { delete s.activeDownloads[id]; }),

      // ── History ────────────────────────────────────────────────────────────
      addToPlayHistory: (item) => set((s) => {
        s.playHistory.unshift(item);
        if (s.playHistory.length > 100) s.playHistory.pop();
        const idx = s.recentlyPlayedSongIds.indexOf(item.songId);
        if (idx !== -1) s.recentlyPlayedSongIds.splice(idx, 1);
        s.recentlyPlayedSongIds.unshift(item.songId);
        if (s.recentlyPlayedSongIds.length > 50) s.recentlyPlayedSongIds.pop();
        if (s.songs[item.songId]) {
          s.songs[item.songId].playCount = (s.songs[item.songId].playCount || 0) + 1;
          s.songs[item.songId].lastPlayed = new Date().toISOString();
          rebuildMostPlayed(s);
        }
      }),
      clearPlayHistory: () => set((s) => {
        s.playHistory = [];
        s.recentlyPlayedSongIds = [];
      }),

      // ── Local scan ─────────────────────────────────────────────────────────
      importLocalSongs: ({ songs, folders = [], genres = [] }) => set((s) => {
        songs.forEach((song) => {
          const local = { ...song, source: 'local' as const };
          s.songs[local.id] = local;
          if (!s.songIds.includes(local.id)) s.songIds.push(local.id);
        });
        folders.forEach((folder) => {
          s.folders[folder.id] = folder;
          if (!s.folderIds.includes(folder.id)) s.folderIds.push(folder.id);
        });
        genres.forEach((genre) => {
          if (s.genres[genre.id]) {
            genre.trackIds.forEach((tid) => {
              if (!s.genres[genre.id].trackIds.includes(tid)) s.genres[genre.id].trackIds.push(tid);
            });
            s.genres[genre.id].trackCount = s.genres[genre.id].trackIds.length;
          } else {
            s.genres[genre.id] = genre;
            if (!s.genreIds.includes(genre.id)) s.genreIds.push(genre.id);
          }
        });
        s.totalLocalTracks = songs.length;
        s.lastScanTime = new Date().toISOString();
      }),
      setScanning: (value) => set((s) => { s.isScanning = value; if (!value) s.scanProgress = 0; }),
      setScanProgress: (value) => set((s) => { s.scanProgress = Math.min(100, Math.max(0, value)); }),
      setLastScanTime: (value) => set((s) => { s.lastScanTime = value; }),
      setTotalLocalTracks: (value) => set((s) => { s.totalLocalTracks = value; }),

      // ── Settings & loading ─────────────────────────────────────────────────
      updateSettings: (updates) => set((s) => { Object.assign(s.settings, updates); }),
      setLoading: (key, value) => set((s) => { s.loading[key] = value; }),

      // ── Reset ──────────────────────────────────────────────────────────────
      clearLibrary: () => set(() => ({ ...initialState })),
    })),
    {
      name: 'mavin-library',
      storage: createJSONStorage(() => mmkvStorage),
      // Exclude runtime-only fields from persistence
      partialize: (state) => {
        const { activeDownloads, isScanning, scanProgress, loading, ...persisted } = state;
        return persisted;
      },
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// Selector hooks
//
// RULE: any selector that returns a DERIVED array or plain-object literal
//       MUST use useShallow(). Without it, the selector produces a new
//       reference every render → Zustand sees it as "changed" → re-render
//       → new reference → infinite loop ("Maximum update depth exceeded").
//
// useShallow does a one-level structural comparison:
//   - For arrays:  compares each element by reference (===)
//   - For objects: compares each value by reference (===)
//
// Selectors that return a PRIMITIVE (string, number, boolean) or the RAW
// stored reference itself (s.songs, s.playlists) are safe without useShallow.
// ─────────────────────────────────────────────────────────────────────────────

// ── Songs ─────────────────────────────────────────────────────────────────────
// Raw record — stable reference, no useShallow needed
export const useSongs = () => useLibraryStore((s) => s.songs);
// Primitive arrays of IDs — useShallow so we only re-render when IDs change
export const useSongIds = () => useLibraryStore(useShallow((s) => s.songIds));
// Single item — primitive lookup, stable if the item object doesn't change
export const useSong = (id: string) => useLibraryStore((s) => s.songs[id]);
// Derived Song[] — MUST use useShallow
export const useAllSongsList = () =>
  useLibraryStore(useShallow((s) => s.songIds.map((id) => s.songs[id]).filter(Boolean) as Song[]));
export const useLocalSongs = () =>
  useLibraryStore(useShallow((s) => Object.values(s.songs).filter((x) => x.source === 'local') as Song[]));

// ── Artists ───────────────────────────────────────────────────────────────────
export const useArtists = () => useLibraryStore((s) => s.artists);
export const useArtistIds = () => useLibraryStore(useShallow((s) => s.artistIds));
export const useArtist = (id: string) => useLibraryStore((s) => s.artists[id]);
export const useFollowedArtists = () =>
  useLibraryStore(useShallow((s) => s.favoriteArtistIds.map((id) => s.artists[id]).filter(Boolean) as Artist[]));

// ── Albums ────────────────────────────────────────────────────────────────────
export const useAlbums = () => useLibraryStore((s) => s.albums);
export const useAlbumIds = () => useLibraryStore(useShallow((s) => s.albumIds));
export const useAlbum = (id: string) => useLibraryStore((s) => s.albums[id]);
export const useSavedAlbums = () =>
  useLibraryStore(useShallow((s) => s.favoriteAlbumIds.map((id) => s.albums[id]).filter(Boolean) as Album[]));

// ── Playlists ─────────────────────────────────────────────────────────────────
export const usePlaylists = () => useLibraryStore((s) => s.playlists);
export const usePlaylistIds = () => useLibraryStore(useShallow((s) => s.playlistIds));
export const usePlaylist = (id: string) => useLibraryStore((s) => s.playlists[id]);
export const useUserPlaylists = () =>
  useLibraryStore(useShallow((s) => Object.values(s.playlists).filter((p) => p.createdBy === 'user') as Playlist[]));
export const useSmartPlaylists = () =>
  useLibraryStore(useShallow((s) =>
    Object.values(s.playlists).filter((p): p is SmartPlaylist => (p as SmartPlaylist).isSmartPlaylist === true),
  ));
export const usePlaylistTracks = (playlistId: string) =>
  useLibraryStore(useShallow((s) => {
    const pl = s.playlists[playlistId];
    return pl ? (pl.trackIds.map((id) => s.songs[id]).filter(Boolean) as Song[]) : ([] as Song[]);
  }));

// ── Folders ───────────────────────────────────────────────────────────────────
export const useFolders = () => useLibraryStore((s) => s.folders);
export const useFolderIds = () => useLibraryStore(useShallow((s) => s.folderIds));
export const useFolder = (id: string) => useLibraryStore((s) => s.folders[id]);
export const useFolderTracks = (folderId: string) =>
  useLibraryStore(useShallow((s) => {
    const f = s.folders[folderId];
    return f ? (f.trackIds.map((id) => s.songs[id]).filter(Boolean) as Song[]) : ([] as Song[]);
  }));

// ── Genres ────────────────────────────────────────────────────────────────────
export const useGenres = () => useLibraryStore((s) => s.genres);
export const useGenreIds = () => useLibraryStore(useShallow((s) => s.genreIds));
export const useGenre = (id: string) => useLibraryStore((s) => s.genres[id]);

// ── Favourites ────────────────────────────────────────────────────────────────
//
// useFavorites() returns:
//   { songs, albums, artists, playlists, favoriteTracks, toggleFavoriteTrack }
//
// - favoriteTracks  = alias for songs (backward-compat with all existing UI)
// - toggleFavoriteTrack = action used by useTrackPlayerFavorite
//
// Each derived array is selected individually with useShallow so that
// updating one collection doesn't cause unrelated hooks to re-render.

export const useFavorites = () => {
  const songs = useLibraryStore(
    useShallow((s) => s.favoriteSongIds.map((id) => s.songs[id]).filter(Boolean) as Song[]),
  );
  const albums = useLibraryStore(
    useShallow((s) => s.favoriteAlbumIds.map((id) => s.albums[id]).filter(Boolean) as Album[]),
  );
  const artists = useLibraryStore(
    useShallow((s) => s.favoriteArtistIds.map((id) => s.artists[id]).filter(Boolean) as Artist[]),
  );
  const playlists = useLibraryStore(
    useShallow((s) =>
      s.favoritePlaylistIds.map((id) => s.playlists[id]).filter(Boolean) as (Playlist | SmartPlaylist)[],
    ),
  );
  // toggleFavoriteTrack — action from the store, stable reference, no useShallow
  const toggleFavoriteTrack = useLibraryStore((s) => s.toggleFavoriteSong);

  return { songs, albums, artists, playlists, favoriteTracks: songs, toggleFavoriteTrack };
};

// Raw ID array — useShallow because it's an array
export const useFavoriteSongIds = () => useLibraryStore(useShallow((s) => s.favoriteSongIds));

// Convenience: is a specific song ID currently favourited? Returns a boolean — no useShallow needed
export const useIsSongFavorite = (id: string) =>
  useLibraryStore((s) => s.favoriteSongIds.includes(id));

// ── Downloads ─────────────────────────────────────────────────────────────────
export const useDownloadedTracks = () =>
  useLibraryStore(useShallow((s) =>
    s.downloadedSongIds.map((id) => s.songs[id]).filter(Boolean) as DownloadedSongMetadata[],
  ));
export const useDownloadedAlbums = () =>
  useLibraryStore(useShallow((s) =>
    s.downloadedAlbumIds.map((id) => s.albums[id]).filter(Boolean) as Album[],
  ));
export const useDownloadedPlaylists = () =>
  useLibraryStore(useShallow((s) =>
    s.downloadedPlaylistIds.map((id) => s.playlists[id]).filter(Boolean) as (Playlist | SmartPlaylist)[],
  ));

// ── Active downloads ──────────────────────────────────────────────────────────
export const useActiveDownloads = () =>
  useLibraryStore(useShallow((s) => Object.values(s.activeDownloads)));

// ── History ───────────────────────────────────────────────────────────────────
// playHistory is a large array stored directly — useShallow compares items
export const usePlayHistory = () => useLibraryStore(useShallow((s) => s.playHistory));
export const useRecentlyPlayed = (limit?: number) =>
  useLibraryStore(useShallow((s) => {
    const songs = s.recentlyPlayedSongIds.map((id) => s.songs[id]).filter(Boolean) as Song[];
    return limit ? songs.slice(0, limit) : songs;
  }));
export const useMostPlayed = (limit?: number) =>
  useLibraryStore(useShallow((s) => {
    const songs = s.mostPlayedSongIds.map((id) => s.songs[id]).filter(Boolean) as Song[];
    return limit ? songs.slice(0, limit) : songs;
  }));

// ── Scan status ───────────────────────────────────────────────────────────────
// Returns a plain-object literal — MUST use useShallow
export const useScanStatus = () =>
  useLibraryStore(useShallow((s) => ({
    isScanning: s.isScanning,
    scanProgress: s.scanProgress,
    lastScanTime: s.lastScanTime,
    totalLocalTracks: s.totalLocalTracks,
  })));

// ── Settings ──────────────────────────────────────────────────────────────────
// s.settings is the stored object reference — stable between renders unless
// updateSettings() is called, so no useShallow needed here
export const useLibrarySettings = () => useLibraryStore((s) => s.settings);

// ── Stats ─────────────────────────────────────────────────────────────────────
// Returns a plain-object literal with computed values — MUST use useShallow
export const useLibraryStats = () =>
  useLibraryStore(useShallow((s) => ({
    totalSongs: s.songIds.length,
    totalArtists: s.artistIds.length,
    totalAlbums: s.albumIds.length,
    totalPlaylists: s.playlistIds.length,
    totalFolders: s.folderIds.length,
    totalGenres: s.genreIds.length,
    totalDownloads: s.downloadedSongIds.length,
    totalFavorites: s.favoriteSongIds.length,
    totalLocalTracks: s.totalLocalTracks,
    totalPlayHistory: s.playHistory.length,
    totalDuration: Object.values(s.songs).reduce((acc, song) => acc + (song?.duration || 0), 0),
  })));

// ── Loading flags ─────────────────────────────────────────────────────────────
// Returns a primitive boolean — no useShallow needed
export const useLibraryLoading = (key: keyof LibraryState['loading']) =>
  useLibraryStore((s) => s.loading[key]);

// ─────────────────────────────────────────────────────────────────────────────
// Smart playlist evaluator (pure — usable outside components)
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateSmartPlaylist(
  rules: SmartPlaylistRule[],
  matchType: 'all' | 'any',
  songs: Record<string, Song>,
): Song[] {
  return Object.values(songs).filter((song) => {
    const results = rules.map((rule) => matchRule(rule, song));
    return matchType === 'all' ? results.every(Boolean) : results.some(Boolean);
  });
}

function matchRule(rule: SmartPlaylistRule, song: Song): boolean {
  const raw = (song as any)[rule.field];
  const val = rule.value;
  switch (rule.operator) {
    case 'contains':    return String(raw ?? '').toLowerCase().includes(String(val).toLowerCase());
    case 'equals':      return raw === val;
    case 'startsWith':  return String(raw ?? '').toLowerCase().startsWith(String(val).toLowerCase());
    case 'endsWith':    return String(raw ?? '').toLowerCase().endsWith(String(val).toLowerCase());
    case 'greaterThan': return Number(raw) > Number(val);
    case 'lessThan':    return Number(raw) < Number(val);
    case 'between': {   const [lo, hi] = val as [number, number]; return Number(raw) >= lo && Number(raw) <= hi; }
    case 'inLast':      return raw ? new Date(raw).getTime() >= Date.now() - Number(val) * 86_400_000 : false;
    case 'not':         return raw !== val;
    default:            return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Async local scan (call from settings or onboarding — not from a hook)
// ─────────────────────────────────────────────────────────────────────────────

export async function scanLocalLibrary(): Promise<void> {
  const store = useLibraryStore.getState();
  try {
    const MediaLibrary = await import('expo-media-library');
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') throw new Error('Media library permission not granted');

    store.setScanning(true);
    store.setScanProgress(0);

    const songs: Song[] = [];
    let after: string | undefined;
    let total = 0;

    do {
      const page = await MediaLibrary.getAssetsAsync({
        mediaType: MediaLibrary.MediaType.audio,
        first: 200,
        after,
        sortBy: MediaLibrary.SortBy.default,
      });
      total = page.totalCount;
      store.setTotalLocalTracks(total);
      for (const asset of page.assets) {
        songs.push({
          id: `local_${asset.id}`,
          title: asset.filename.replace(/\.[^/.]+$/, ''),
          artist: 'Unknown Artist',
          album: 'Unknown Album',
          thumbnail: undefined,
          url: asset.uri,
          localUri: asset.uri,
          localTrackUri: asset.uri,
          duration: asset.duration,
          isDownloaded: false,
          isFavorite: false,
          playCount: 0,
          skipCount: 0,
          dateAdded: new Date(asset.creationTime).toISOString(),
          dateModified: new Date(asset.modificationTime).toISOString(),
          source: 'local',
        });
      }
      store.setScanProgress(Math.round((songs.length / (total || 1)) * 100));
      after = page.hasNextPage ? page.endCursor : undefined;
    } while (after);

    store.importLocalSongs({ songs });
    store.setLastScanTime(new Date().toISOString());
  } finally {
    store.setScanning(false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// initializeLibrary — called from _layout.tsx after TrackPlayer.setupPlayer().
// MMKV rehydrates synchronously on the JS thread so the store already has
// persisted state by the time any component mounts. This is an extension
// point for any additional async bootstrap work.
// ─────────────────────────────────────────────────────────────────────────────

export async function initializeLibrary(): Promise<void> {
  // MMKV persistence is already applied synchronously before this runs.
  // Add async startup work here if needed, e.g.:
  //   const { downloadedSongIds, songs } = useLibraryStore.getState();
  //   await pruneStaleDownloadPaths(downloadedSongIds, songs);
  return Promise.resolve();
}