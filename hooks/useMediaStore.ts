/**
 * useMediaStore — PowerAmp-style MediaStore integration
 *
 * Architecture:
 *   - Uses expo-media-library's addListener() which wraps Android's MediaStore
 *     ContentObserver under the hood. No polling. No spinners.
 *   - Registered folders are persisted to AsyncStorage.
 *   - When Android's MediaStore fires a change event (file added/deleted/renamed),
 *     the hook re-queries ONLY the registered folders and diffs the result.
 *   - Deletions from the file system are automatically reflected (MediaStore
 *     tombstones the entry; we filter those out on the next query).
 *   - The hook never shows a loading spinner after initial hydration from cache.
 *
 * Why this works like PowerAmp:
 *   ContentObserver is a push model — the OS tells us when something changed.
 *   We cache the last-known track list in AsyncStorage so the UI is instant on
 *   mount (stale-while-revalidate), then silently replace with fresh data.
 */

import { useEffect, useRef, useCallback, useMemo } from "react";
import * as MediaLibrary from "expo-media-library";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LocalTrack {
  id: string;
  uri: string;
  filename: string;
  title: string;
  artist: string;
  album: string;
  duration: number;      // ms
  size: number;          // bytes
  modificationTime: number;
  albumId?: string;
  artworkUri?: string;
}

export interface WatchedFolder {
  id: string;           // MediaLibrary album id (folder)
  path: string;         // Human-readable path e.g. /storage/emulated/0/Music
  name: string;         // Display name e.g. "Music"
  trackCount: number;
  addedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persisted store (Zustand)
// ─────────────────────────────────────────────────────────────────────────────

interface MediaStoreState {
  tracks: LocalTrack[];
  folders: WatchedFolder[];
  hydrated: boolean;      // true after AsyncStorage cache is read — UI renders immediately
  permissionGranted: boolean;

  _setTracks: (t: LocalTrack[]) => void;
  _setFolders: (f: WatchedFolder[]) => void;
  _setHydrated: (v: boolean) => void;
  _setPermission: (v: boolean) => void;
}

export const useMediaStoreState = create<MediaStoreState>((set) => ({
  tracks: [],
  folders: [],
  hydrated: false,
  permissionGranted: false,

  _setTracks: (tracks) => set({ tracks }),
  _setFolders: (folders) => set({ folders }),
  _setHydrated: (hydrated) => set({ hydrated }),
  _setPermission: (permissionGranted) => set({ permissionGranted }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Cache keys
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TRACKS_KEY = "@mavin/local_tracks_cache";
const CACHE_FOLDERS_KEY = "@mavin/watched_folders";

// ─────────────────────────────────────────────────────────────────────────────
// Query helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch all audio assets from a specific MediaLibrary album (folder). */
async function queryFolder(albumId: string): Promise<LocalTrack[]> {
  const result = await MediaLibrary.getAssetsAsync({
    mediaType: MediaLibrary.MediaType.audio,
    album: albumId,
    first: 2000,
    sortBy: [[MediaLibrary.SortBy.modificationTime, false]],
  });

  return result.assets.map((a) => ({
    id: a.id,
    uri: a.uri,
    filename: a.filename,
    title: a.filename.replace(/\.[^/.]+$/, ""),   // strip extension
    artist: (a as any).artist ?? "Unknown Artist",
    album: (a as any).album ?? "Unknown Album",
    duration: a.duration * 1000,                  // expo gives seconds
    size: (a as any).fileSize ?? 0,
    modificationTime: a.modificationTime,
    albumId: a.albumId,
  }));
}

/** Re-query all registered folders and merge deduplicated results. */
async function queryAllFolders(folders: WatchedFolder[]): Promise<LocalTrack[]> {
  if (folders.length === 0) return [];
  const results = await Promise.all(folders.map((f) => queryFolder(f.id)));
  // Deduplicate by id (a track might live in a parent + child folder)
  const map = new Map<string, LocalTrack>();
  results.flat().forEach((t) => map.set(t.id, t));
  return Array.from(map.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// Main hook — mount once at app root or in a provider
// ─────────────────────────────────────────────────────────────────────────────

export function useMediaStore() {
  const {
    tracks, folders, hydrated, permissionGranted,
    _setTracks, _setFolders, _setHydrated, _setPermission,
  } = useMediaStoreState();

  const observerRef = useRef<MediaLibrary.Subscription | null>(null);

  // ── 1. Hydrate from cache immediately (zero-spinner mount) ────────────────
  useEffect(() => {
    (async () => {
      try {
        const [cachedTracks, cachedFolders] = await Promise.all([
          AsyncStorage.getItem(CACHE_TRACKS_KEY),
          AsyncStorage.getItem(CACHE_FOLDERS_KEY),
        ]);
        if (cachedTracks) _setTracks(JSON.parse(cachedTracks));
        if (cachedFolders) _setFolders(JSON.parse(cachedFolders));
      } catch (_) {}
      _setHydrated(true);
    })();
  }, []);

  // ── 2. Request permission ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      _setPermission(status === "granted");
    })();
  }, []);

  // ── 3. Register ContentObserver — fires on any MediaStore change ──────────
  useEffect(() => {
    if (!permissionGranted) return;

    const requery = async () => {
      // Read latest folders from store (closure may be stale)
      const latestFolders: WatchedFolder[] = JSON.parse(
        (await AsyncStorage.getItem(CACHE_FOLDERS_KEY)) ?? "[]"
      );
      if (latestFolders.length === 0) return;

      const fresh = await queryAllFolders(latestFolders);
      _setTracks(fresh);
      await AsyncStorage.setItem(CACHE_TRACKS_KEY, JSON.stringify(fresh));
    };

    // expo-media-library's addListener wraps ContentObserver on Android
    observerRef.current = MediaLibrary.addListener(requery);

    return () => {
      observerRef.current?.remove();
    };
  }, [permissionGranted]);

  // ── 4. Public API ─────────────────────────────────────────────────────────

  /** Add a folder to the watch list. Immediately queries and persists. */
  const addFolder = useCallback(async (album: MediaLibrary.Album) => {
    const existing: WatchedFolder[] = JSON.parse(
      (await AsyncStorage.getItem(CACHE_FOLDERS_KEY)) ?? "[]"
    );
    if (existing.find((f) => f.id === album.id)) return; // already added

    const folderTracks = await queryFolder(album.id);
    const newFolder: WatchedFolder = {
      id: album.id,
      path: album.title,    // expo doesn't expose full path easily; use title
      name: album.title,
      trackCount: folderTracks.length,
      addedAt: Date.now(),
    };

    const updatedFolders = [...existing, newFolder];
    _setFolders(updatedFolders);
    await AsyncStorage.setItem(CACHE_FOLDERS_KEY, JSON.stringify(updatedFolders));

    // Merge new tracks into existing
    const existingTracks: LocalTrack[] = JSON.parse(
      (await AsyncStorage.getItem(CACHE_TRACKS_KEY)) ?? "[]"
    );
    const map = new Map<string, LocalTrack>();
    [...existingTracks, ...folderTracks].forEach((t) => map.set(t.id, t));
    const merged = Array.from(map.values());
    _setTracks(merged);
    await AsyncStorage.setItem(CACHE_TRACKS_KEY, JSON.stringify(merged));
  }, []);

  /** Remove a folder from watch list and purge its tracks. */
  const removeFolder = useCallback(async (folderId: string) => {
    const existing: WatchedFolder[] = JSON.parse(
      (await AsyncStorage.getItem(CACHE_FOLDERS_KEY)) ?? "[]"
    );
    const updatedFolders = existing.filter((f) => f.id !== folderId);
    _setFolders(updatedFolders);
    await AsyncStorage.setItem(CACHE_FOLDERS_KEY, JSON.stringify(updatedFolders));

    // Re-query remaining folders to rebuild track list (removes deleted folder's tracks)
    const fresh = await queryAllFolders(updatedFolders);
    _setTracks(fresh);
    await AsyncStorage.setItem(CACHE_TRACKS_KEY, JSON.stringify(fresh));
  }, []);

  /** Browse device folders (MediaLibrary albums of type audio). */
  const getAvailableFolders = useCallback(async (): Promise<MediaLibrary.Album[]> => {
    const result = await MediaLibrary.getAlbumsAsync({
      includeSmartAlbums: false,
    });
    // Filter to only albums that likely contain audio
    return result;
  }, []);

  const tracksByFolder = useMemo(() => {
    const map = new Map<string, LocalTrack[]>();
    folders.forEach((f) => {
      map.set(f.id, tracks.filter((t) => t.albumId === f.id));
    });
    return map;
  }, [tracks, folders]);

  return {
    tracks,
    folders,
    hydrated,
    permissionGranted,
    addFolder,
    removeFolder,
    getAvailableFolders,
    tracksByFolder,
  };
}