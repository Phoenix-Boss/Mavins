// utils/folderSnapshotManager.ts
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import {
  saveFolderSnapshot,
  getFolderSnapshot,
  deleteExpiredSnapshots as deleteExpiredSnapshotsFromDB
} from '@/db/localDatabase';

export interface FolderItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  lastModified?: number;
  extension?: string;
  childCount?: number;
}

export interface FolderSnapshotData {
  items: FolderItem[];
  totalFiles: number;
  totalFolders: number;
  scannedAt: number;
}

const HIDDEN_FOLDERS = [
  '.expo', 'SQLite', 'cache', 'NoBackup', '._', '.DS_Store',
  'android', 'Android', 'obb', 'data', 'Media', 'media',
  'com.mavins.player', 'expo', 'Expo', 'tmp', 'temp', 'caches', 'lib', 'libs'
];

function convertUriToPath(uri: string): string {
  if (uri.startsWith('file://')) return uri.replace('file://', '');
  return uri;
}

async function isPathAccessible(path: string): Promise<boolean> {
  try {
    const rawPath = convertUriToPath(path);
    const invalidPatterns = ['.expo', 'SQLite', 'cache', 'NoBackup', 'com.mavins.player', '/data/user/', '/data/data/'];
    for (const pattern of invalidPatterns) {
      if (rawPath.includes(pattern)) return false;
    }
    const info = await (await (new File(rawPath)).exists());
    return info.exists;
  } catch { return false; }
}

export async function getInitialRootPath(): Promise<string> {
  const userStoragePaths = [
    '/storage/emulated/0', '/sdcard', '/storage/FFFF-FFFF',
    '/storage/extSdCard', '/storage/ExternalStorage', '/mnt/sdcard', '/mnt/media_rw'
  ];

  for (const path of userStoragePaths) {
    if (await isPathAccessible(path)) {
      console.log(`[SnapshotManager] Using root path: ${path}`);
      return path;
    }
  }

  const musicPaths = ['/storage/emulated/0/Music', '/sdcard/Music'];
  for (const path of musicPaths) {
    if (await isPathAccessible(path)) return path;
  }

  console.warn('[SnapshotManager] No accessible storage found');
  return '';
}

export async function generateFolderHash(items: FolderItem[]): Promise<string> {
  const dataToHash = items
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(item => `${item.path}|${item.lastModified || 0}|${item.size || 0}`)
    .join(';');
  return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, dataToHash);
}

export async function loadFolderSnapshot(path: string): Promise<FolderSnapshotData | null> {
  if (!path || path === '/') return null;
  try {
    const snapshot = await getFolderSnapshot(path);
    if (snapshot) {
      console.log(`[SnapshotManager] Loaded snapshot for ${path}, hash: ${snapshot.contentHash.substring(0, 8)}`);
      return snapshot.snapshotData;
    }
    return null;
  } catch (error) {
    console.error(`[SnapshotManager] Failed to load snapshot:`, error);
    return null;
  }
}

export async function saveFolderSnapshotFromData(
  path: string,
  items: FolderItem[],
  totalFiles: number,
  totalFolders: number
): Promise<void> {
  if (!path || path === '/') return;
  try {
    const contentHash = await generateFolderHash(items);
    const snapshotData: FolderSnapshotData = { items, totalFiles, totalFolders, scannedAt: Date.now() };
    await saveFolderSnapshot(path, contentHash, snapshotData);
    console.log(`[SnapshotManager] Saved snapshot for ${path}, hash: ${contentHash.substring(0, 8)}`);
  } catch (error) {
    console.error(`[SnapshotManager] Failed to save snapshot:`, error);
  }
}

export function isSnapshotFresh(snapshot: FolderSnapshotData): boolean {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  return Date.now() - snapshot.scannedAt < SIX_HOURS;
}

export async function cleanupExpiredSnapshots(): Promise<void> {
  try {
    await deleteExpiredSnapshotsFromDB();
    console.log('[SnapshotManager] Cleaned expired snapshots');
  } catch (error) {
    console.error('[SnapshotManager] Failed to clean expired snapshots:', error);
  }
}

export async function buildSnapshotFromScan(path: string): Promise<{ items: FolderItem[]; totalFiles: number; totalFolders: number }> {
  if (!path || path === '/') return { items: [], totalFiles: 0, totalFolders: 0 };

  try {
    const items: FolderItem[] = [];
    let totalFiles = 0, totalFolders = 0;
    const rawPath = convertUriToPath(path);
    const fileInfo = await (await (new Directory(rawPath)).list()).map(item => item.name);

    for (const name of fileInfo) {
      if (HIDDEN_FOLDERS.some(hidden => name === hidden || name.startsWith('.'))) continue;

      const itemPath = `${rawPath}/${name}`;
      const stat = await (await (new File(itemPath)).exists());

      if (stat.exists) {
        const isDirectory = stat.isDirectory || false;
        const item: FolderItem = { name, path: itemPath, isDirectory };

        if (!isDirectory) {
          totalFiles++;
          const fileStat = stat as any;
          item.size = fileStat.size || 0;
          item.lastModified = fileStat.modificationTime || 0;
          item.extension = name.split('.').pop()?.toLowerCase();
        } else {
          totalFolders++;
          try {
            const childContents = await (await (new Directory(itemPath)).list()).map(item => item.name);
            item.childCount = childContents.length;
          } catch { item.childCount = 0; }
        }
        items.push(item);
      }
    }

    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { items, totalFiles, totalFolders };
  } catch (error) {
    console.error(`[SnapshotManager] Failed to scan ${path}:`, error);
    return { items: [], totalFiles: 0, totalFolders: 0 };
  }
}

export async function getFolderContents(
  path: string,
  forceFresh: boolean = false
): Promise<{ items: FolderItem[]; totalFiles: number; totalFolders: number; fromCache: boolean }> {
  if (!path || path === '/') {
    const validRoot = await getInitialRootPath();
    if (!validRoot) return { items: [], totalFiles: 0, totalFolders: 0, fromCache: false };
    return getFolderContents(validRoot, forceFresh);
  }

  if (!forceFresh) {
    const cachedSnapshot = await loadFolderSnapshot(path);
    if (cachedSnapshot && isSnapshotFresh(cachedSnapshot)) {
      return {
        items: cachedSnapshot.items,
        totalFiles: cachedSnapshot.totalFiles,
        totalFolders: cachedSnapshot.totalFolders,
        fromCache: true
      };
    }
  }

  const scanResult = await buildSnapshotFromScan(path);
  await saveFolderSnapshotFromData(path, scanResult.items, scanResult.totalFiles, scanResult.totalFolders);

  return { ...scanResult, fromCache: false };
}

export async function preloadCommonSnapshots(): Promise<void> {
  const commonPaths = ['/storage/emulated/0/Music', '/storage/emulated/0/Download', '/sdcard/Music', '/sdcard/Download'];
  for (const path of commonPaths) {
    if (path) {
      try {
        const exists = await (await (new File(path)).exists());
        if (exists.exists) await getFolderContents(path, false);
      } catch (error) {
        console.warn(`[SnapshotManager] Failed to preload ${path}:`, error);
      }
    }
  }
}