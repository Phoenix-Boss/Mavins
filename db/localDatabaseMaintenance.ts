// db/localDatabaseMaintenance.ts
import { getDatabase, deleteExpiredSnapshots, getAllAvailableFolders, getWatchedFolderIds, getUnvalidatedTracks, updateTrackValidationStatus } from './localDatabase';
import * as FileSystem from 'expo-file-system/next';

let isMaintenanceRunning = false;
let isValidationRunning = false;

export async function runMaintenance(): Promise<void> {
  const db = getDatabase();
  if (!db || isMaintenanceRunning) return;
  
  isMaintenanceRunning = true;

  try {
    await db.execAsync('PRAGMA optimize;');
    console.log('[DBMaintenance] Optimized database');
    
    await deleteExpiredSnapshots();
    console.log('[DBMaintenance] Cleaned expired snapshots');
    
    await removeOrphanedTracks();
    console.log('[DBMaintenance] Removed orphaned tracks');
    
    await rebuildIndexes();
    console.log('[DBMaintenance] Rebuilt indexes');
    
    await cleanupOldAvailableFolders();
    console.log('[DBMaintenance] Cleaned old available folders');
    
    // Run silent validation in background (don't await)
    setTimeout(() => {
      validateAllUnvalidatedTracks().catch(() => {});
    }, 1000);
    
  } catch (error) {
    console.error('[DBMaintenance] Maintenance failed:', error);
  } finally {
    isMaintenanceRunning = false;
  }
}

async function removeOrphanedTracks(): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  await db.execAsync(`
    DELETE FROM album_tracks 
    WHERE album_id NOT IN (SELECT album_id FROM watched_albums);
  `);
}

async function rebuildIndexes(): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  await db.execAsync('REINDEX;');
}

async function cleanupOldAvailableFolders(): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  await db.runAsync(
    `DELETE FROM available_folders WHERE last_seen < ? AND user_selected = 0;`,
    thirtyDaysAgo
  );
}

// Validate a single file URI
async function validateSingleFileUri(fileUri: string, folderPath?: string): Promise<{ uri: string; isValid: boolean }> {
  if (!fileUri || fileUri.length === 0) {
    return { uri: fileUri, isValid: false };
  }
  
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
    // File doesn't exist, continue to repair
  }
  
  // Try to repair by searching in the folder
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
              return { uri: fullPath, isValid: true };
            }
          } catch (e) {
            continue;
          }
        }
      }
    } catch (error) {
      // Silently continue
    }
  }
  
  return { uri: fileUri, isValid: false };
}

// Validate all unvalidated tracks in the database
export async function validateAllUnvalidatedTracks(): Promise<{ total: number; validated: number; repaired: number; failed: number }> {
  const db = getDatabase();
  if (!db || isValidationRunning) {
    return { total: 0, validated: 0, repaired: 0, failed: 0 };
  }
  
  isValidationRunning = true;
  let validated = 0;
  let repaired = 0;
  let failed = 0;
  
  try {
    const unvalidatedTracks = await getUnvalidatedTracks();
    const total = unvalidatedTracks.length;
    
    if (total === 0) {
      console.log('[DBMaintenance] No unvalidated tracks found');
      return { total: 0, validated: 0, repaired: 0, failed: 0 };
    }
    
    console.log(`[DBMaintenance] Validating ${total} tracks in background...`);
    
    for (const track of unvalidatedTracks) {
      // Get folder path for this track's album
      const folder = await db.getFirstAsync<{ folder_path: string }>(
        `SELECT folder_path FROM available_folders WHERE folder_id = ?;`, track.album_id
      );
      
      const result = await validateSingleFileUri(track.file_uri, folder?.folder_path);
      
      // Update the track with the validated URI and status
      if (result.uri !== track.file_uri) {
        // URI was repaired
        await db.runAsync(
          `UPDATE album_tracks SET file_uri = ?, is_validated = ? WHERE track_id = ?;`,
          result.uri,
          result.isValid ? 1 : 0,
          track.track_id
        );
        if (result.isValid) {
          repaired++;
        } else {
          failed++;
        }
      } else {
        // URI unchanged, just update validation status
        await updateTrackValidationStatus(track.track_id, result.isValid);
        if (result.isValid) {
          validated++;
        } else {
          failed++;
        }
      }
    }
    
    console.log(`[DBMaintenance] Validation complete: ${validated} valid, ${repaired} repaired, ${failed} failed`);
    
    return { total, validated, repaired, failed };
    
  } catch (error) {
    console.error('[DBMaintenance] Track validation failed:', error);
    return { total: 0, validated: 0, repaired: 0, failed: 0 };
  } finally {
    isValidationRunning = false;
  }
}

// Validate a specific album's tracks
export async function validateAlbumTracks(album_id: string): Promise<{ total: number; validated: number; repaired: number }> {
  const db = getDatabase();
  if (!db) return { total: 0, validated: 0, repaired: 0 };
  
  let validated = 0;
  let repaired = 0;
  
  try {
    const tracks = await db.getAllAsync<{ track_id: string; file_uri: string }>(
      `SELECT track_id, file_uri FROM album_tracks WHERE album_id = ? AND is_validated = 0;`,
      album_id
    );
    
    const total = tracks.length;
    if (total === 0) return { total: 0, validated: 0, repaired: 0 };
    
    // Get folder path
    const folder = await db.getFirstAsync<{ folder_path: string }>(
      `SELECT folder_path FROM available_folders WHERE folder_id = ?;`, album_id
    );
    
    for (const track of tracks) {
      const result = await validateSingleFileUri(track.file_uri, folder?.folder_path);
      
      await db.runAsync(
        `UPDATE album_tracks SET file_uri = ?, is_validated = ? WHERE track_id = ?;`,
        result.uri,
        result.isValid ? 1 : 0,
        track.track_id
      );
      
      if (result.uri !== track.file_uri && result.isValid) {
        repaired++;
      } else if (result.isValid) {
        validated++;
      }
    }
    
    console.log(`[DBMaintenance] Album ${album_id} validation: ${validated} valid, ${repaired} repaired`);
    
    return { total, validated, repaired };
    
  } catch (error) {
    console.error(`[DBMaintenance] Failed to validate album ${album_id}:`, error);
    return { total: 0, validated: 0, repaired: 0 };
  }
}

export async function vacuumDatabase(): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  try {
    await db.execAsync('VACUUM;');
    console.log('[DBMaintenance] Vacuum completed');
  } catch (error) {
    console.error('[DBMaintenance] Vacuum failed:', error);
  }
}

export async function checkDatabaseIntegrity(): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;
  try {
    const result = await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check;');
    const isOk = result?.integrity_check === 'ok';
    if (isOk) {
      console.log('[DBMaintenance] Database integrity check passed');
    } else {
      console.error('[DBMaintenance] Database integrity check failed:', result?.integrity_check);
    }
    return isOk;
  } catch (error) {
    console.error('[DBMaintenance] Integrity check failed:', error);
    return false;
  }
}

// Run a full validation pass on all tracks
export async function runFullValidation(): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  
  console.log('[DBMaintenance] Starting full validation of all tracks...');
  
  try {
    // Reset all validation flags
    await db.runAsync(`UPDATE album_tracks SET is_validated = 0;`);
    console.log('[DBMaintenance] Reset validation flags');
    
    // Run validation
    const result = await validateAllUnvalidatedTracks();
    console.log(`[DBMaintenance] Full validation complete: ${result.validated} valid, ${result.repaired} repaired, ${result.failed} failed`);
    
  } catch (error) {
    console.error('[DBMaintenance] Full validation failed:', error);
  }
}

export async function scheduleMaintenance(): Promise<void> {
  // Run critical maintenance first
  await runMaintenance();
  
  // Schedule background validation after a delay
  setTimeout(async () => {
    await validateAllUnvalidatedTracks();
  }, 5000);
  
  console.log('[DBMaintenance] Scheduled maintenance completed');
}

// Run quick maintenance (for app startup - faster)
export async function runQuickMaintenance(): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  
  try {
    await db.execAsync('PRAGMA optimize;');
    await deleteExpiredSnapshots();
    await removeOrphanedTracks();
    console.log('[DBMaintenance] Quick maintenance completed');
  } catch (error) {
    console.error('[DBMaintenance] Quick maintenance failed:', error);
  }
}

// Get validation statistics
export async function getValidationStats(): Promise<{ total: number; validated: number; unvalidated: number; percentage: number }> {
  const db = getDatabase();
  if (!db) return { total: 0, validated: 0, unvalidated: 0, percentage: 0 };
  
  try {
    const total = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM album_tracks;`);
    const validated = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM album_tracks WHERE is_validated = 1;`);
    
    const totalCount = total?.count || 0;
    const validatedCount = validated?.count || 0;
    
    return {
      total: totalCount,
      validated: validatedCount,
      unvalidated: totalCount - validatedCount,
      percentage: totalCount > 0 ? (validatedCount / totalCount) * 100 : 0
    };
  } catch (error) {
    console.error('[DBMaintenance] Failed to get validation stats:', error);
    return { total: 0, validated: 0, unvalidated: 0, percentage: 0 };
  }
}