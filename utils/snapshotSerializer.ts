// utils/snapshotSerializer.ts
import { FolderItem, FolderSnapshotData } from './folderSnapshotManager';

// Compress snapshot data for storage
export function serializeSnapshot(snapshot: FolderSnapshotData): string {
  // Compress by using shorter property names
  const compressed = {
    i: snapshot.items.map(item => ({
      n: item.name,
      p: item.path,
      d: item.isDirectory ? 1 : 0,
      s: item.size,
      m: item.lastModified,
      e: item.extension,
      c: item.childCount
    })),
    f: snapshot.totalFiles,
    l: snapshot.totalFolders,
    t: snapshot.scannedAt
  };
  
  return JSON.stringify(compressed);
}

// Decompress snapshot data from storage
export function deserializeSnapshot(serialized: string): FolderSnapshotData | null {
  try {
    const parsed = JSON.parse(serialized);
    
    return {
      items: parsed.i.map((item: any) => ({
        name: item.n,
        path: item.p,
        isDirectory: item.d === 1,
        size: item.s,
        lastModified: item.m,
        extension: item.e,
        childCount: item.c
      })),
      totalFiles: parsed.f,
      totalFolders: parsed.l,
      scannedAt: parsed.t
    };
  } catch (error) {
    console.error('[SnapshotSerializer] Failed to deserialize:', error);
    return null;
  }
}

// Calculate size of serialized snapshot
export function getSerializedSize(snapshot: FolderSnapshotData): number {
  const serialized = serializeSnapshot(snapshot);
  return new Blob([serialized]).size;
}

// Merge two snapshots (preserve most recent)
export function mergeSnapshots(
  oldSnapshot: FolderSnapshotData,
  newSnapshot: FolderSnapshotData
): FolderSnapshotData {
  if (newSnapshot.scannedAt > oldSnapshot.scannedAt) {
    return newSnapshot;
  }
  return oldSnapshot;
}

// Get difference between two snapshots
export function getSnapshotDiff(
  oldSnapshot: FolderSnapshotData,
  newSnapshot: FolderSnapshotData
): {
  added: string[];
  removed: string[];
  modified: string[];
} {
  const oldPaths = new Set(oldSnapshot.items.map(i => i.path));
  const newPaths = new Set(newSnapshot.items.map(i => i.path));
  
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  
  // Find added and modified
  for (const newItem of newSnapshot.items) {
    if (!oldPaths.has(newItem.path)) {
      added.push(newItem.path);
    } else {
      const oldItem = oldSnapshot.items.find(i => i.path === newItem.path);
      if (oldItem && oldItem.lastModified !== newItem.lastModified) {
        modified.push(newItem.path);
      }
    }
  }
  
  // Find removed
  for (const oldItem of oldSnapshot.items) {
    if (!newPaths.has(oldItem.path)) {
      removed.push(oldItem.path);
    }
  }
  
  return { added, removed, modified };
}