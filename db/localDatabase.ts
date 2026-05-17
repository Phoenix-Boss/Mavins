// db/localDatabase.ts
import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/next';

let dbInstance: SQLite.SQLiteDatabase | null = null;
const DATABASE_VERSION = 5; // Incremented version for is_validated column
const DATABASE_NAME = 'mavin_local_music.db';

export interface AvailableFolder {
  folder_id: string;
  folder_name: string;
  folder_path: string;
  track_count: number;
  artwork_uri: string | null;
  is_watched: number;
  user_selected: number;
  last_seen: number;
  created_at: number;
}

export interface WatchedAlbum {
  album_id: string;
  album_name: string;
  album_artwork_uri: string | null;
  track_count: number;
  last_scan: number;
  date_added: number;
}

export interface LocalTrack {
  track_id: string;
  album_id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artwork_uri: string | null;
  cached_artwork_path: string | null;
  file_uri: string;
  last_modified: number;
  added_to_library: number;
  is_validated: number; // 1 = file exists and is playable, 0 = needs validation/repair
}

export interface CacheMetadata {
  cache_key: string;
  file_path: string;
  last_accessed: number;
  file_size: number;
}

export interface FolderSnapshot {
  path: string;
  content_hash: string;
  snapshot_data: string;
  created_at: number;
  expires_at: number;
}

export async function initLocalDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;

  try {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    dbInstance = db;

    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync('PRAGMA synchronous = NORMAL;');
    await db.execAsync('PRAGMA cache_size = -10000;');

    await createTables(db);
    await checkVersion(db);

    console.log('[LocalDatabase] Initialized successfully');
    return db;
  } catch (error) {
    console.error('[LocalDatabase] Failed to initialize:', error);
    throw error;
  }
}

async function createTables(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS available_folders (
      folder_id TEXT PRIMARY KEY,
      folder_name TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      track_count INTEGER DEFAULT 0,
      artwork_uri TEXT,
      is_watched INTEGER DEFAULT 0,
      user_selected INTEGER DEFAULT 0,
      last_seen INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS watched_albums (
      album_id TEXT PRIMARY KEY,
      album_name TEXT NOT NULL,
      album_artwork_uri TEXT,
      track_count INTEGER DEFAULT 0,
      last_scan INTEGER NOT NULL,
      date_added INTEGER NOT NULL
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS album_tracks (
      track_id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      duration INTEGER NOT NULL,
      artwork_uri TEXT,
      cached_artwork_path TEXT,
      file_uri TEXT NOT NULL,
      last_modified INTEGER NOT NULL,
      added_to_library INTEGER NOT NULL,
      is_validated INTEGER DEFAULT 0,
      FOREIGN KEY (album_id) REFERENCES watched_albums (album_id) ON DELETE CASCADE
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS cache_metadata (
      cache_key TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      last_accessed INTEGER NOT NULL,
      file_size INTEGER NOT NULL
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS folder_snapshots (
      path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      snapshot_data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  await createIndexes(db);
}

async function createIndexes(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_available_folders_watched ON available_folders(is_watched);
    CREATE INDEX IF NOT EXISTS idx_available_folders_user_selected ON available_folders(user_selected);
    CREATE INDEX IF NOT EXISTS idx_available_folders_last_seen ON available_folders(last_seen);
    CREATE INDEX IF NOT EXISTS idx_album_tracks_album ON album_tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_album_tracks_artist ON album_tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_album_tracks_title ON album_tracks(title);
    CREATE INDEX IF NOT EXISTS idx_album_tracks_validated ON album_tracks(is_validated);
    CREATE INDEX IF NOT EXISTS idx_watched_albums_date ON watched_albums(date_added);
    CREATE INDEX IF NOT EXISTS idx_cache_last_accessed ON cache_metadata(last_accessed);
    CREATE INDEX IF NOT EXISTS idx_folder_snapshots_expires ON folder_snapshots(expires_at);
  `);
}

async function checkVersion(db: SQLite.SQLiteDatabase) {
  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const currentVersion = result?.user_version || 0;

  if (currentVersion < DATABASE_VERSION) {
    await runMigrations(db, currentVersion);
    await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION};`);
    console.log('[LocalDatabase] Version updated to', DATABASE_VERSION);
  }
}

async function runMigrations(db: SQLite.SQLiteDatabase, fromVersion: number) {
  if (fromVersion < 3) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS available_folders (
        folder_id TEXT PRIMARY KEY,
        folder_name TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        track_count INTEGER DEFAULT 0,
        artwork_uri TEXT,
        is_watched INTEGER DEFAULT 0,
        last_seen INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_available_folders_watched ON available_folders(is_watched);
      CREATE INDEX IF NOT EXISTS idx_available_folders_last_seen ON available_folders(last_seen);
    `);
    
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS folder_snapshots (
        path TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        snapshot_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_folder_snapshots_expires ON folder_snapshots(expires_at);
    `);
  }
  
  if (fromVersion < 4) {
    try {
      const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(available_folders);");
      const columnNames = columns.map(c => c.name);
      
      if (!columnNames.includes('user_selected')) {
        await db.execAsync(`ALTER TABLE available_folders ADD COLUMN user_selected INTEGER DEFAULT 0;`);
        console.log('[LocalDatabase] Added user_selected column');
      }
      
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_available_folders_user_selected ON available_folders(user_selected);
      `);
      
      await db.execAsync(`
        UPDATE available_folders 
        SET user_selected = 1 
        WHERE is_watched = 1;
      `);
      console.log('[LocalDatabase] Updated user_selected for existing watched folders');
    } catch (error) {
      console.warn('[LocalDatabase] Migration warning:', error);
    }
  }
  
  // Migration for version 5 - add is_validated column to album_tracks
  if (fromVersion < 5) {
    try {
      const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(album_tracks);");
      const columnNames = columns.map(c => c.name);
      
      if (!columnNames.includes('is_validated')) {
        await db.execAsync(`ALTER TABLE album_tracks ADD COLUMN is_validated INTEGER DEFAULT 0;`);
        console.log('[LocalDatabase] Added is_validated column to album_tracks');
      }
      
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_album_tracks_validated ON album_tracks(is_validated);
      `);
    } catch (error) {
      console.warn('[LocalDatabase] Migration warning for is_validated:', error);
    }
  }
}

// ==================== Helper to validate and repair file URIs ====================

async function validateAndRepairFileUri(fileUri: string, trackId: string, folderPath?: string): Promise<{ uri: string; isValid: boolean }> {
  // If fileUri is valid and file exists, return it
  if (fileUri && fileUri.length > 0) {
    try {
      // Handle file:// prefix
      let filePath = fileUri;
      if (fileUri.startsWith('file://')) {
        filePath = fileUri.substring(7);
      } else if (fileUri.startsWith('content://')) {
        // content:// URIs are handled by the system, assume valid
        return { uri: fileUri, isValid: true };
      }
      
      const info = await (await (new File(filePath)).exists());
      if (info.exists && info.size > 0) {
        return { uri: fileUri, isValid: true };
      }
    } catch (error) {
      console.warn(`[LocalDatabase] File not found at ${fileUri}, attempting to repair...`);
    }
  }
  
  // Try to repair by searching for the file in the folder
  if (folderPath) {
    try {
      const files = await (await (new Directory(folderPath)).list()).map(item => item.name);
      const audioExtensions = ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'aac', 'opus'];
      
      for (const file of files) {
        const ext = file.split('.').pop()?.toLowerCase();
        if (audioExtensions.includes(ext || '')) {
          const fullPath = `${folderPath}/${file}`;
          try {
            const info = await (await (new File(fullPath)).exists());
            if (info.exists && info.size > 0) {
              console.log(`[LocalDatabase] Repaired file URI for track ${trackId}: ${fullPath}`);
              return { uri: fullPath, isValid: true };
            }
          } catch (e) {
            continue;
          }
        }
      }
    } catch (error) {
      console.warn(`[LocalDatabase] Failed to repair file URI for track ${trackId}:`, error);
    }
  }
  
  return { uri: fileUri || '', isValid: false };
}

// Update validation status for a track
export async function updateTrackValidationStatus(track_id: string, isValid: boolean): Promise<void> {
  const db = await initLocalDatabase();
  await db.runAsync(
    `UPDATE album_tracks SET is_validated = ? WHERE track_id = ?;`,
    isValid ? 1 : 0,
    track_id
  );
}

// Get all unvalidated tracks
export async function getUnvalidatedTracks(): Promise<LocalTrack[]> {
  const db = await initLocalDatabase();
  return await db.getAllAsync<LocalTrack>(
    `SELECT * FROM album_tracks WHERE is_validated = 0;`
  );
}

// ==================== Available Folder Operations ====================

export async function saveAvailableFolders(folders: Omit<AvailableFolder, 'created_at'>[]): Promise<void> {
  const db = await initLocalDatabase();
  const now = Date.now();

  for (const folder of folders) {
    await db.runAsync(
      `INSERT OR REPLACE INTO available_folders 
       (folder_id, folder_name, folder_path, track_count, artwork_uri, is_watched, user_selected, last_seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM available_folders WHERE folder_id = ?), ?));`,
      folder.folder_id, folder.folder_name, folder.folder_path, folder.track_count,
      folder.artwork_uri, folder.is_watched, folder.user_selected || 0, now, folder.folder_id, now
    );
  }
}

export async function getAllAvailableFolders(): Promise<AvailableFolder[]> {
  const db = await initLocalDatabase();
  return await db.getAllAsync<AvailableFolder>(
    `SELECT * FROM available_folders ORDER BY folder_name ASC;`
  );
}

export async function getUserSelectedFolders(): Promise<AvailableFolder[]> {
  const db = await initLocalDatabase();
  return await db.getAllAsync<AvailableFolder>(
    `SELECT * FROM available_folders WHERE user_selected = 1 ORDER BY folder_name ASC;`
  );
}

export async function updateFolderUserSelected(folder_id: string, user_selected: number): Promise<void> {
  const db = await initLocalDatabase();
  await db.runAsync(
    `UPDATE available_folders SET user_selected = ? WHERE folder_id = ?;`,
    user_selected, folder_id
  );
}

export async function updateFolderWatchedStatus(folder_id: string, is_watched: number): Promise<void> {
  const db = await initLocalDatabase();
  await db.runAsync(
    `UPDATE available_folders SET is_watched = ? WHERE folder_id = ?;`,
    is_watched, folder_id
  );
}

export async function getWatchedFolderIds(): Promise<string[]> {
  const db = await initLocalDatabase();
  const results = await db.getAllAsync<{ folder_id: string }>(
    `SELECT folder_id FROM available_folders WHERE user_selected = 1;`
  );
  return results.map(r => r.folder_id);
}

export async function hasAvailableFolders(): Promise<boolean> {
  const db = await initLocalDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM available_folders;`
  );
  return (result?.count || 0) > 0;
}

export async function deleteOldFolders(beforeTimestamp: number): Promise<void> {
  const db = await initLocalDatabase();
  await db.runAsync(
    `DELETE FROM available_folders WHERE last_seen < ? AND user_selected = 0;`,
    beforeTimestamp
  );
}

// ==================== Watched Album Operations ====================

export async function addWatchedAlbum(
  album_id: string,
  album_name: string,
  album_artwork_uri: string | null
): Promise<void> {
  const db = await initLocalDatabase();
  const now = Date.now();

  await updateFolderUserSelected(album_id, 1);

  await db.runAsync(
    `INSERT OR REPLACE INTO watched_albums (album_id, album_name, album_artwork_uri, track_count, last_scan, date_added)
     VALUES (?, ?, ?, ?, ?, ?);`,
    album_id, album_name, album_artwork_uri, 0, now, now
  );
}

export async function removeWatchedAlbum(album_id: string): Promise<void> {
  const db = await initLocalDatabase();
  await updateFolderUserSelected(album_id, 0);
  await db.runAsync(`DELETE FROM watched_albums WHERE album_id = ?;`, album_id);
}

export async function getAllWatchedAlbums(): Promise<WatchedAlbum[]> {
  const db = await initLocalDatabase();
  return await db.getAllAsync<WatchedAlbum>(`SELECT * FROM watched_albums ORDER BY date_added DESC;`);
}

export async function isAlbumWatched(album_id: string): Promise<boolean> {
  const db = await initLocalDatabase();
  const result = await db.getFirstAsync<{ album_id: string }>(
    `SELECT album_id FROM watched_albums WHERE album_id = ?;`, album_id
  );
  return !!result;
}

export async function updateAlbumTrackCount(album_id: string, track_count: number): Promise<void> {
  const db = await initLocalDatabase();
  await db.runAsync(
    `UPDATE watched_albums SET track_count = ?, last_scan = ? WHERE album_id = ?;`,
    track_count, Date.now(), album_id
  );
  
  await db.runAsync(
    `UPDATE available_folders SET track_count = ? WHERE folder_id = ?;`,
    track_count, album_id
  );
}

// ==================== Track Operations with Validation ====================

export async function addTracks(tracks: Omit<LocalTrack, 'added_to_library'>[]): Promise<void> {
  const db = await initLocalDatabase();
  const now = Date.now();

  for (const track of tracks) {
    // Skip tracks without file_uri (can't play them anyway)
    if (!track.file_uri || track.file_uri.length === 0) {
      console.warn('[LocalDatabase] Skipping track with empty file_uri:', track.title);
      continue;
    }
    
    await db.runAsync(
      `INSERT OR REPLACE INTO album_tracks (
        track_id, album_id, title, artist, album, duration, artwork_uri,
        cached_artwork_path, file_uri, last_modified, added_to_library, is_validated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      track.track_id, 
      track.album_id || 'unknown',
      track.title || 'Unknown Track',
      track.artist || 'Upcoming Artist',
      track.album || 'Unknown Album',
      track.duration || 0,
      track.artwork_uri || null,
      track.cached_artwork_path || null,
      track.file_uri,
      track.last_modified || Date.now(),
      now,
      track.is_validated || 0
    );
  }
}

export async function getTracksByAlbum(album_id: string): Promise<LocalTrack[]> {
  const db = await initLocalDatabase();
  const tracks = await db.getAllAsync<LocalTrack>(
    `SELECT * FROM album_tracks WHERE album_id = ? ORDER BY title ASC;`, album_id
  );
  
  // Get folder path for this album to repair URIs if needed
  const folder = await db.getFirstAsync<{ folder_path: string }>(
    `SELECT folder_path FROM available_folders WHERE folder_id = ?;`, album_id
  );
  
  // Validate and repair each track's file_uri
  const validatedTracks = await Promise.all(tracks.map(async (track) => {
    const result = await validateAndRepairFileUri(track.file_uri, track.track_id, folder?.folder_path);
    
    // Update validation status if changed
    if (result.isValid !== (track.is_validated === 1)) {
      await updateTrackValidationStatus(track.track_id, result.isValid);
    }
    
    return {
      ...track,
      file_uri: result.uri,
      title: track.title || 'Unknown Track',
      artist: track.artist || 'Upcoming Artist',
      album: track.album || 'Unknown Album',
      is_validated: result.isValid ? 1 : 0
    };
  }));
  
  return validatedTracks;
}

export async function getAllTracks(): Promise<LocalTrack[]> {
  const db = await initLocalDatabase();
  const tracks = await db.getAllAsync<LocalTrack>(`SELECT * FROM album_tracks ORDER BY title ASC;`);
  
  // Validate and repair each track's file_uri
  const validatedTracks = await Promise.all(tracks.map(async (track) => {
    // Get folder path for this track's album
    const folder = await db.getFirstAsync<{ folder_path: string }>(
      `SELECT folder_path FROM available_folders WHERE folder_id = ?;`, track.album_id
    );
    
    const result = await validateAndRepairFileUri(track.file_uri, track.track_id, folder?.folder_path);
    
    // Update validation status if changed
    if (result.isValid !== (track.is_validated === 1)) {
      await updateTrackValidationStatus(track.track_id, result.isValid);
    }
    
    return {
      ...track,
      file_uri: result.uri,
      title: track.title || 'Unknown Track',
      artist: track.artist || 'Upcoming Artist',
      album: track.album || 'Unknown Album',
      is_validated: result.isValid ? 1 : 0
    };
  }));
  
  return validatedTracks;
}

export async function searchTracks(query: string): Promise<LocalTrack[]> {
  const db = await initLocalDatabase();
  const searchTerm = `%${query}%`;
  const tracks = await db.getAllAsync<LocalTrack>(
    `SELECT * FROM album_tracks WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? ORDER BY title ASC;`,
    searchTerm, searchTerm, searchTerm
  );
  
  // Validate and repair each track's file_uri
  const validatedTracks = await Promise.all(tracks.map(async (track) => {
    const folder = await db.getFirstAsync<{ folder_path: string }>(
      `SELECT folder_path FROM available_folders WHERE folder_id = ?;`, track.album_id
    );
    
    const result = await validateAndRepairFileUri(track.file_uri, track.track_id, folder?.folder_path);
    
    return {
      ...track,
      file_uri: result.uri,
      title: track.title || 'Unknown Track',
      artist: track.artist || 'Upcoming Artist',
      album: track.album || 'Unknown Album',
      is_validated: result.isValid ? 1 : 0
    };
  }));
  
  return validatedTracks;
}

export async function getTrackById(track_id: string): Promise<LocalTrack | null> {
  const db = await initLocalDatabase();
  const track = await db.getFirstAsync<LocalTrack>(
    `SELECT * FROM album_tracks WHERE track_id = ?;`, track_id
  );
  
  if (!track) return null;
  
  // Validate and repair file_uri
  const folder = await db.getFirstAsync<{ folder_path: string }>(
    `SELECT folder_path FROM available_folders WHERE folder_id = ?;`, track.album_id
  );
  
  const result = await validateAndRepairFileUri(track.file_uri, track.track_id, folder?.folder_path);
  
  return {
    ...track,
    file_uri: result.uri,
    title: track.title || 'Unknown Track',
    artist: track.artist || 'Upcoming Artist',
    album: track.album || 'Unknown Album',
    is_validated: result.isValid ? 1 : 0
  };
}

export async function deleteTracksByAlbum(album_id: string): Promise<void> {
  const db = await initLocalDatabase();
  await db.runAsync(`DELETE FROM album_tracks WHERE album_id = ?;`, album_id);
}

export async function getTotalTrackCount(): Promise<number> {
  const db = await initLocalDatabase();
  const result = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM album_tracks;`);
  return result?.count || 0;
}

export async function getValidatedTrackCount(): Promise<number> {
  const db = await initLocalDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM album_tracks WHERE is_validated = 1;`
  );
  return result?.count || 0;
}

// ==================== Folder Snapshot Operations ====================

export async function saveFolderSnapshot(
  path: string,
  contentHash: string,
  snapshotData: any
): Promise<void> {
  const db = await initLocalDatabase();
  const now = Date.now();
  const expiresAt = now + (6 * 60 * 60 * 1000);

  await db.runAsync(
    `INSERT OR REPLACE INTO folder_snapshots (path, content_hash, snapshot_data, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?);`,
    path, contentHash, JSON.stringify(snapshotData), now, expiresAt
  );
}

export async function getFolderSnapshot(path: string): Promise<{ snapshotData: any; contentHash: string } | null> {
  const db = await initLocalDatabase();
  const result = await db.getFirstAsync<{ snapshot_data: string; content_hash: string }>(
    `SELECT snapshot_data, content_hash FROM folder_snapshots WHERE path = ? AND expires_at > ?;`,
    path, Date.now()
  );
  
  if (result) {
    try {
      return {
        snapshotData: JSON.parse(result.snapshot_data),
        contentHash: result.content_hash
      };
    } catch (e) {
      console.error('[LocalDatabase] Failed to parse snapshot data:', e);
      return null;
    }
  }
  return null;
}

export async function deleteExpiredSnapshots(): Promise<void> {
  const db = await initLocalDatabase();
  await db.runAsync(`DELETE FROM folder_snapshots WHERE expires_at <= ?;`, Date.now());
}

// ==================== Cache Metadata Operations ====================

export async function addCacheMetadata(cache_key: string, file_path: string, file_size: number): Promise<void> {
  const db = await initLocalDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO cache_metadata (cache_key, file_path, last_accessed, file_size)
     VALUES (?, ?, ?, ?);`,
    cache_key, file_path, Date.now(), file_size
  );
}

export async function updateCacheAccess(cache_key: string): Promise<void> {
  const db = await initLocalDatabase();
  await db.runAsync(`UPDATE cache_metadata SET last_accessed = ? WHERE cache_key = ?;`, Date.now(), cache_key);
}

export async function removeCacheMetadata(cache_key: string): Promise<void> {
  const db = await initLocalDatabase();
  await db.runAsync(`DELETE FROM cache_metadata WHERE cache_key = ?;`, cache_key);
}

export async function getOldestCacheEntries(limit: number): Promise<CacheMetadata[]> {
  const db = await initLocalDatabase();
  return await db.getAllAsync<CacheMetadata>(
    `SELECT * FROM cache_metadata ORDER BY last_accessed ASC LIMIT ?;`, limit
  );
}

export async function getTotalCacheSize(): Promise<number> {
  const db = await initLocalDatabase();
  const result = await db.getFirstAsync<{ total: number }>(`SELECT SUM(file_size) as total FROM cache_metadata;`);
  return result?.total || 0;
}

export async function getCacheStats(): Promise<{ totalSizeMB: number; totalFiles: number }> {
  const db = await initLocalDatabase();
  const result = await db.getFirstAsync<{ total: number; count: number }>(
    `SELECT SUM(file_size) as total, COUNT(*) as count FROM cache_metadata;`
  );
  return {
    totalSizeMB: (result?.total || 0) / (1024 * 1024),
    totalFiles: result?.count || 0
  };
}

export async function clearAllLocalData(): Promise<void> {
  const db = await initLocalDatabase();
  await db.execAsync(`
    DELETE FROM album_tracks;
    DELETE FROM watched_albums;
    DELETE FROM available_folders;
    DELETE FROM cache_metadata;
    DELETE FROM folder_snapshots;
    VACUUM;
  `);
}

export function getDatabase(): SQLite.SQLiteDatabase | null {
  return dbInstance;
}

export async function resetDatabase(): Promise<void> {
  const db = await initLocalDatabase();
  try {
    await db.execAsync(`
      DROP TABLE IF EXISTS album_tracks;
      DROP TABLE IF EXISTS watched_albums;
      DROP TABLE IF EXISTS available_folders;
      DROP TABLE IF EXISTS cache_metadata;
      DROP TABLE IF EXISTS folder_snapshots;
    `);
    await createTables(db);
    console.log('[LocalDatabase] Reset successfully');
  } catch (error) {
    console.error('[LocalDatabase] Failed to reset:', error);
  }
}