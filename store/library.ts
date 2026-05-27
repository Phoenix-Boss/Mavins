// store/library.ts
//
// Library state — Zustand + MMKV (react-native-mmkv)
//
// Why this over Redux + redux-persist:
//   • MMKV is 30× faster than AsyncStorage — synchronous reads, no await
//   • Zustand needs zero Provider boilerplate — hooks work anywhere
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
import { useShallow } from 'zustand/shallow';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Safe import for MediaLibrary - will be loaded dynamically
let MediaLibrary: any = null;

// ─────────────────────────────────────────────────────────────────────────────
// AsyncStorage adapter for Zustand persist middleware
// ─────────────────────────────────────────────────────────────────────────────

const mmkvStorage: StateStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
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

function buildMostPlayed(songs: Record<string, Song>): string[] {
  return Object.values(songs)
    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
    .slice(0, 50)
    .map((s) => s.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Store (plain Zustand v5 — no immer dependency)
// ─────────────────────────────────────────────────────────────────────────────

export const useLibraryStore = create<LibraryState & LibraryActions>()(
  persist(
    (set) => ({
      ...initialState,

      // ── Songs ──────────────────────────────────────────────────────────────
      addSongs: (songs) => set((s) => {
        const nextSongs = { ...s.songs };
        const nextIds = [...s.songIds];
        songs.forEach((song) => {
          nextSongs[song.id] = song;
          if (!nextIds.includes(song.id)) nextIds.push(song.id);
        });
        return { songs: nextSongs, songIds: nextIds };
      }),

      updateSong: (id, updates) => set((s) => {
        if (!s.songs[id]) return {};
        return { songs: { ...s.songs, [id]: { ...s.songs[id], ...updates } } };
      }),

      removeSong: (id) => set((s) => {
        const nextSongs = { ...s.songs };
        delete nextSongs[id];
        return {
          songs: nextSongs,
          songIds: s.songIds.filter((x) => x !== id),
          favoriteSongIds: s.favoriteSongIds.filter((x) => x !== id),
          downloadedSongIds: s.downloadedSongIds.filter((x) => x !== id),
          recentlyPlayedSongIds: s.recentlyPlayedSongIds.filter((x) => x !== id),
          mostPlayedSongIds: s.mostPlayedSongIds.filter((x) => x !== id),
        };
      }),

      // ── Artists ────────────────────────────────────────────────────────────
      addArtists: (artists) => set((s) => {
        const nextArtists = { ...s.artists };
        const nextIds = [...s.artistIds];
        artists.forEach((a) => {
          nextArtists[a.id] = a;
          if (!nextIds.includes(a.id)) nextIds.push(a.id);
        });
        return { artists: nextArtists, artistIds: nextIds };
      }),

      updateArtist: (id, updates) => set((s) => {
        if (!s.artists[id]) return {};
        return { artists: { ...s.artists, [id]: { ...s.artists[id], ...updates } } };
      }),

      followArtist: (id) => set((s) => {
        const nextArtists = s.artists[id]
          ? { ...s.artists, [id]: { ...s.artists[id], isFollowed: true } }
          : s.artists;
        const nextFavArtistIds = s.favoriteArtistIds.includes(id)
          ? s.favoriteArtistIds
          : [id, ...s.favoriteArtistIds];
        return { artists: nextArtists, favoriteArtistIds: nextFavArtistIds };
      }),

      unfollowArtist: (id) => set((s) => {
        const nextArtists = s.artists[id]
          ? { ...s.artists, [id]: { ...s.artists[id], isFollowed: false } }
          : s.artists;
        return {
          artists: nextArtists,
          favoriteArtistIds: s.favoriteArtistIds.filter((x) => x !== id),
        };
      }),

      // ── Albums ─────────────────────────────────────────────────────────────
      addAlbums: (albums) => set((s) => {
        const nextAlbums = { ...s.albums };
        const nextIds = [...s.albumIds];
        albums.forEach((a) => {
          nextAlbums[a.id] = a;
          if (!nextIds.includes(a.id)) nextIds.push(a.id);
        });
        return { albums: nextAlbums, albumIds: nextIds };
      }),

      updateAlbum: (id, updates) => set((s) => {
        if (!s.albums[id]) return {};
        return { albums: { ...s.albums, [id]: { ...s.albums[id], ...updates } } };
      }),

      saveAlbum: (id) => set((s) => {
        const nextAlbums = s.albums[id]
          ? { ...s.albums, [id]: { ...s.albums[id], isSaved: true } }
          : s.albums;
        const nextFavAlbumIds = s.favoriteAlbumIds.includes(id)
          ? s.favoriteAlbumIds
          : [id, ...s.favoriteAlbumIds];
        return { albums: nextAlbums, favoriteAlbumIds: nextFavAlbumIds };
      }),

      unsaveAlbum: (id) => set((s) => {
        const nextAlbums = s.albums[id]
          ? { ...s.albums, [id]: { ...s.albums[id], isSaved: false } }
          : s.albums;
        return {
          albums: nextAlbums,
          favoriteAlbumIds: s.favoriteAlbumIds.filter((x) => x !== id),
        };
      }),

      // ── Playlists ──────────────────────────────────────────────────────────
      addPlaylist: (playlist) => set((s) => {
        const nextIds = s.playlistIds.includes(playlist.id)
          ? s.playlistIds
          : [...s.playlistIds, playlist.id];
        return {
          playlists: { ...s.playlists, [playlist.id]: playlist },
          playlistIds: nextIds,
        };
      }),

      updatePlaylist: (id, updates) => set((s) => {
        if (!s.playlists[id]) return {};
        return {
          playlists: {
            ...s.playlists,
            [id]: { ...s.playlists[id], ...updates, updatedAt: new Date().toISOString() },
          },
        };
      }),

      deletePlaylist: (id) => set((s) => {
        const nextPlaylists = { ...s.playlists };
        delete nextPlaylists[id];
        return {
          playlists: nextPlaylists,
          playlistIds: s.playlistIds.filter((x) => x !== id),
          favoritePlaylistIds: s.favoritePlaylistIds.filter((x) => x !== id),
        };
      }),

      addTrackToPlaylist: (playlistId, songId) => set((s) => {
        const pl = s.playlists[playlistId];
        if (!pl || pl.trackIds.includes(songId)) return {};
        const songDuration = s.songs[songId]?.duration ?? 0;
        const nextTrackIds = [...pl.trackIds, songId];
        return {
          playlists: {
            ...s.playlists,
            [playlistId]: {
              ...pl,
              trackIds: nextTrackIds,
              trackCount: nextTrackIds.length,
              duration: pl.duration + songDuration,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      }),

      removeTrackFromPlaylist: (playlistId, songId) => set((s) => {
        const pl = s.playlists[playlistId];
        if (!pl) return {};
        const idx = pl.trackIds.indexOf(songId);
        if (idx === -1) return {};
        const songDuration = s.songs[songId]?.duration ?? 0;
        const nextTrackIds = pl.trackIds.filter((_, i) => i !== idx);
        return {
          playlists: {
            ...s.playlists,
            [playlistId]: {
              ...pl,
              trackIds: nextTrackIds,
              trackCount: nextTrackIds.length,
              duration: Math.max(0, pl.duration - songDuration),
              updatedAt: new Date().toISOString(),
            },
          },
        };
      }),

      reorderPlaylistTracks: (playlistId, fromIndex, toIndex) => set((s) => {
        const pl = s.playlists[playlistId];
        if (!pl) return {};
        const nextTrackIds = [...pl.trackIds];
        const [moved] = nextTrackIds.splice(fromIndex, 1);
        nextTrackIds.splice(toIndex, 0, moved);
        return {
          playlists: {
            ...s.playlists,
            [playlistId]: { ...pl, trackIds: nextTrackIds, updatedAt: new Date().toISOString() },
          },
        };
      }),

      // ── Folders ────────────────────────────────────────────────────────────
      addFolder: (folder) => set((s) => {
        const nextIds = s.folderIds.includes(folder.id)
          ? s.folderIds
          : [...s.folderIds, folder.id];
        return {
          folders: { ...s.folders, [folder.id]: folder },
          folderIds: nextIds,
        };
      }),

      updateFolder: (id, updates) => set((s) => {
        if (!s.folders[id]) return {};
        return { folders: { ...s.folders, [id]: { ...s.folders[id], ...updates } } };
      }),

      scanFolder: (folderId, trackIds) => set((s) => {
        if (!s.folders[folderId]) return {};
        let dur = 0;
        trackIds.forEach((tid) => { if (s.songs[tid]) dur += s.songs[tid].duration; });
        return {
          folders: {
            ...s.folders,
            [folderId]: {
              ...s.folders[folderId],
              trackIds,
              trackCount: trackIds.length,
              duration: dur,
              dateModified: new Date().toISOString(),
            },
          },
        };
      }),

      // ── Genres ─────────────────────────────────────────────────────────────
      addGenre: (genre) => set((s) => {
        const nextIds = s.genreIds.includes(genre.id)
          ? s.genreIds
          : [...s.genreIds, genre.id];
        return {
          genres: { ...s.genres, [genre.id]: genre },
          genreIds: nextIds,
        };
      }),

      updateGenre: (id, updates) => set((s) => {
        if (!s.genres[id]) return {};
        return { genres: { ...s.genres, [id]: { ...s.genres[id], ...updates } } };
      }),

      // ── Favourites ─────────────────────────────────────────────────────────
      addFavorite: (type, id) => set((s) => {
        if (type === 'song') {
          return {
            favoriteSongIds: s.favoriteSongIds.includes(id)
              ? s.favoriteSongIds
              : [id, ...s.favoriteSongIds],
            songs: s.songs[id]
              ? { ...s.songs, [id]: { ...s.songs[id], isFavorite: true } }
              : s.songs,
          };
        }
        if (type === 'album') {
          return {
            favoriteAlbumIds: s.favoriteAlbumIds.includes(id)
              ? s.favoriteAlbumIds
              : [id, ...s.favoriteAlbumIds],
            albums: s.albums[id]
              ? { ...s.albums, [id]: { ...s.albums[id], isSaved: true } }
              : s.albums,
          };
        }
        if (type === 'artist') {
          return {
            favoriteArtistIds: s.favoriteArtistIds.includes(id)
              ? s.favoriteArtistIds
              : [id, ...s.favoriteArtistIds],
            artists: s.artists[id]
              ? { ...s.artists, [id]: { ...s.artists[id], isFollowed: true } }
              : s.artists,
          };
        }
        // playlist
        return {
          favoritePlaylistIds: s.favoritePlaylistIds.includes(id)
            ? s.favoritePlaylistIds
            : [id, ...s.favoritePlaylistIds],
        };
      }),

      removeFavorite: (type, id) => set((s) => {
        if (type === 'song') {
          return {
            favoriteSongIds: s.favoriteSongIds.filter((x) => x !== id),
            songs: s.songs[id]
              ? { ...s.songs, [id]: { ...s.songs[id], isFavorite: false } }
              : s.songs,
          };
        }
        if (type === 'album') {
          return {
            favoriteAlbumIds: s.favoriteAlbumIds.filter((x) => x !== id),
            albums: s.albums[id]
              ? { ...s.albums, [id]: { ...s.albums[id], isSaved: false } }
              : s.albums,
          };
        }
        if (type === 'artist') {
          return {
            favoriteArtistIds: s.favoriteArtistIds.filter((x) => x !== id),
            artists: s.artists[id]
              ? { ...s.artists, [id]: { ...s.artists[id], isFollowed: false } }
              : s.artists,
          };
        }
        // playlist
        return {
          favoritePlaylistIds: s.favoritePlaylistIds.filter((x) => x !== id),
        };
      }),

      toggleFavoriteSong: (id) => set((s) => {
        if (!s.songs[id]) return {};
        const isFav = s.songs[id].isFavorite;
        return {
          songs: { ...s.songs, [id]: { ...s.songs[id], isFavorite: !isFav } },
          favoriteSongIds: isFav
            ? s.favoriteSongIds.filter((x) => x !== id)
            : s.favoriteSongIds.includes(id)
              ? s.favoriteSongIds
              : [id, ...s.favoriteSongIds],
        };
      }),

      // ── Downloads (FIXED: Creates song if it doesn't exist) ─────────────────
      addDownload: (songId, metadata) => set((s) => {
        const nextIds = s.downloadedSongIds.includes(songId)
          ? s.downloadedSongIds
          : [songId, ...s.downloadedSongIds];
        
        let nextSongs = { ...s.songs };
        
        if (s.songs[songId]) {
          // Update existing song
          nextSongs[songId] = {
            ...s.songs[songId],
            isDownloaded: true,
            source: 'downloaded' as const,
            ...metadata,
          };
        } else {
          // CREATE NEW SONG ENTRY (FIX: This was missing)
          const now = new Date().toISOString();
          nextSongs[songId] = {
            id: songId,
            title: (metadata as any).title || 'Unknown Title',
            artist: (metadata as any).artist || 'Unknown Artist',
            url: (metadata as any).url || (metadata as any).localTrackUri || '',
            duration: (metadata as any).duration || 0,
            thumbnail: (metadata as any).thumbnail || (metadata as any).localArtworkUri,
            isDownloaded: true,
            isFavorite: false,
            playCount: 0,
            skipCount: 0,
            dateAdded: now,
            dateModified: now,
            source: 'downloaded',
            localTrackUri: (metadata as any).localTrackUri,
            localArtworkUri: (metadata as any).localArtworkUri,
            fileSize: (metadata as any).fileSize,
            bitrate: (metadata as any).bitrate,
            sampleRate: (metadata as any).sampleRate,
            container: (metadata as any).container,
            codec: (metadata as any).codec,
            downloadDate: (metadata as any).downloadDate || now,
            downloadQuality: (metadata as any).downloadQuality || 'high',
            offlineAvailable: true,
          };
        }
        
        // Also ensure songId is in songIds array
        const nextSongIds = s.songIds.includes(songId) 
          ? s.songIds 
          : [...s.songIds, songId];
        
        return { 
          downloadedSongIds: nextIds, 
          songs: nextSongs,
          songIds: nextSongIds,
        };
      }),

      removeDownload: (songId) => set((s) => {
        const nextSongs = s.songs[songId]
          ? {
              ...s.songs,
              [songId]: {
                ...s.songs[songId],
                isDownloaded: false,
                source: 'streaming' as const,
                localUri: undefined,
                localTrackUri: undefined,
                localArtworkUri: undefined,
                localMetadata: undefined,
              },
            }
          : s.songs;
        return {
          downloadedSongIds: s.downloadedSongIds.filter((x) => x !== songId),
          songs: nextSongs,
        };
      }),

      // ── Active downloads (runtime — not persisted) ─────────────────────────
      addActiveDownload: (d) => set((s) => ({
        activeDownloads: {
          ...s.activeDownloads,
          [d.id]: { ...d, progress: 0, speed: 0, estimatedTimeRemaining: 0, status: 'pending' },
        },
      })),

      updateActiveDownload: (id, updates) => set((s) => {
        if (!s.activeDownloads[id]) return {};
        return {
          activeDownloads: {
            ...s.activeDownloads,
            [id]: { ...s.activeDownloads[id], ...updates },
          },
        };
      }),

      removeActiveDownload: (id) => set((s) => {
        const next = { ...s.activeDownloads };
        delete next[id];
        return { activeDownloads: next };
      }),

      // ── History ────────────────────────────────────────────────────────────
      addToPlayHistory: (item) => set((s) => {
        // play history (cap 100)
        const nextHistory = [item, ...s.playHistory].slice(0, 100);

        // recently played (cap 50, deduplicated)
        const filtered = s.recentlyPlayedSongIds.filter((x) => x !== item.songId);
        const nextRecent = [item.songId, ...filtered].slice(0, 50);

        // update song play count + lastPlayed
        let nextSongs = s.songs;
        if (s.songs[item.songId]) {
          const song = s.songs[item.songId];
          nextSongs = {
            ...s.songs,
            [item.songId]: {
              ...song,
              playCount: (song.playCount || 0) + 1,
              lastPlayed: new Date().toISOString(),
            },
          };
        }

        // rebuild mostPlayed from updated songs
        const nextMostPlayed = buildMostPlayed(nextSongs);

        return {
          playHistory: nextHistory,
          recentlyPlayedSongIds: nextRecent,
          songs: nextSongs,
          mostPlayedSongIds: nextMostPlayed,
        };
      }),

      clearPlayHistory: () => set(() => ({
        playHistory: [],
        recentlyPlayedSongIds: [],
      })),

      // ── Local scan ─────────────────────────────────────────────────────────
      importLocalSongs: ({ songs, folders = [], genres = [] }) => set((s) => {
        const nextSongs = { ...s.songs };
        const nextSongIds = [...s.songIds];
        songs.forEach((song) => {
          const local = { ...song, source: 'local' as const };
          nextSongs[local.id] = local;
          if (!nextSongIds.includes(local.id)) nextSongIds.push(local.id);
        });

        const nextFolders = { ...s.folders };
        const nextFolderIds = [...s.folderIds];
        folders.forEach((folder) => {
          nextFolders[folder.id] = folder;
          if (!nextFolderIds.includes(folder.id)) nextFolderIds.push(folder.id);
        });

        const nextGenres = { ...s.genres };
        const nextGenreIds = [...s.genreIds];
        genres.forEach((genre) => {
          if (nextGenres[genre.id]) {
            const existing = nextGenres[genre.id];
            const mergedTrackIds = [...existing.trackIds];
            genre.trackIds.forEach((tid) => {
              if (!mergedTrackIds.includes(tid)) mergedTrackIds.push(tid);
            });
            nextGenres[genre.id] = { ...existing, trackIds: mergedTrackIds, trackCount: mergedTrackIds.length };
          } else {
            nextGenres[genre.id] = genre;
            if (!nextGenreIds.includes(genre.id)) nextGenreIds.push(genre.id);
          }
        });

        return {
          songs: nextSongs,
          songIds: nextSongIds,
          folders: nextFolders,
          folderIds: nextFolderIds,
          genres: nextGenres,
          genreIds: nextGenreIds,
          totalLocalTracks: songs.length,
          lastScanTime: new Date().toISOString(),
        };
      }),

      setScanning: (value) => set(() => ({
        isScanning: value,
        ...(value ? {} : { scanProgress: 0 }),
      })),

      setScanProgress: (value) => set(() => ({
        scanProgress: Math.min(100, Math.max(0, value)),
      })),

      setLastScanTime: (value) => set(() => ({ lastScanTime: value })),

      setTotalLocalTracks: (value) => set(() => ({ totalLocalTracks: value })),

      // ── Settings & loading ─────────────────────────────────────────────────
      updateSettings: (updates) => set((s) => ({
        settings: { ...s.settings, ...updates },
      })),

      setLoading: (key, value) => set((s) => ({
        loading: { ...s.loading, [key]: value },
      })),

      // ── Reset ──────────────────────────────────────────────────────────────
      clearLibrary: () => set(() => ({ ...initialState })),
    }),
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
export const useSongs = () => useLibraryStore((s) => s.songs);
export const useSongIds = () => useLibraryStore(useShallow((s) => s.songIds));
export const useSong = (id: string) => useLibraryStore((s) => s.songs[id]);
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
  const toggleFavoriteTrack = useLibraryStore((s) => s.toggleFavoriteSong);

  return { songs, albums, artists, playlists, favoriteTracks: songs, toggleFavoriteTrack };
};

export const useFavoriteSongIds = () => useLibraryStore(useShallow((s) => s.favoriteSongIds));

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

// ── Individual download status ────────────────────────────────────────────────
export const useIsSongDownloaded = (songId: string) =>
  useLibraryStore((s) => s.downloadedSongIds.includes(songId));

export const useIsSongDownloading = (songId: string) =>
  useLibraryStore((s) => {
    const downloads = Object.values(s.activeDownloads);
    return downloads.some((d) => d.songId === songId && d.status !== 'completed');
  });

export const useSongDownloadProgress = (songId: string) =>
  useLibraryStore((s) => {
    const download = Object.values(s.activeDownloads).find((d) => d.songId === songId);
    return download?.progress ?? 0;
  });

export const useActiveDownloadCount = () =>
  useLibraryStore((s) => Object.values(s.activeDownloads).filter((d) => d.status === 'downloading').length);

// ── History ───────────────────────────────────────────────────────────────────
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
export const useScanStatus = () =>
  useLibraryStore(useShallow((s) => ({
    isScanning: s.isScanning,
    scanProgress: s.scanProgress,
    lastScanTime: s.lastScanTime,
    totalLocalTracks: s.totalLocalTracks,
  })));

// ── Settings ──────────────────────────────────────────────────────────────────
export const useLibrarySettings = () => useLibraryStore((s) => s.settings);

// ── Stats ─────────────────────────────────────────────────────────────────────
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

  if (store.isScanning) {
    console.log('Scan already in progress');
    return;
  }

  try {
    const MediaLibraryModule = await import('expo-media-library');
    MediaLibrary = MediaLibraryModule.default || MediaLibraryModule;

    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Media library permission not granted');
    }

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
          artist: asset.artist || 'Unknown Artist',
          album: asset.albumId || 'Unknown Album',
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
    console.log(`Scan completed: ${songs.length} songs found`);

  } catch (error) {
    console.error('Error scanning local library:', error);
    throw error;
  } finally {
    store.setScanning(false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// initializeLibrary — called from _layout.tsx
// ─────────────────────────────────────────────────────────────────────────────

export async function initializeLibrary(): Promise<void> {
  try {
    const state = useLibraryStore.getState();
    console.log(`Library initialized with ${state.songIds.length} songs`);
    return Promise.resolve();
  } catch (error) {
    console.error('Error initializing library:', error);
    return Promise.resolve();
  }
}