// utils/localFileObserver.ts
import * as FileSystem from 'expo-file-system/legacy';
import { mediaStoreManager } from './localMediaStoreManager';
import { localErrorHandler, LocalMusicErrorType } from './localErrorHandler';

type FileChangeCallback = (path: string, type: 'added' | 'modified' | 'deleted') => void;

class LocalFileObserver {
  private static instance: LocalFileObserver;
  private watchers: Map<string, { interval: NodeJS.Timeout; lastSnapshot: Map<string, number> }> = new Map();
  private callbacks: FileChangeCallback[] = [];
  
  private constructor() {}
  
  static getInstance(): LocalFileObserver {
    if (!LocalFileObserver.instance) {
      LocalFileObserver.instance = new LocalFileObserver();
    }
    return LocalFileObserver.instance;
  }
  
  addCallback(callback: FileChangeCallback) {
    this.callbacks.push(callback);
  }
  
  removeCallback(callback: FileChangeCallback) {
    const index = this.callbacks.indexOf(callback);
    if (index !== -1) this.callbacks.splice(index, 1);
  }
  
  private notify(path: string, type: 'added' | 'modified' | 'deleted') {
    this.callbacks.forEach(cb => cb(path, type));
  }
  
  async watchFolder(folderPath: string) {
    if (this.watchers.has(folderPath)) {
      return;
    }
    
    try {
      const lastSnapshot = new Map<string, number>();
      const items = await (await (new Directory(folderPath)).list()).map(item => item.name);
      
      for (const item of items) {
        const itemPath = `${folderPath}/${item}`;
        const stat = await (await (new File(itemPath)).exists());
        if (stat.exists) {
          lastSnapshot.set(itemPath, stat.modificationTime || 0);
        }
      }
      
      const interval = setInterval(async () => {
        try {
          const currentItems = await (await (new Directory(folderPath)).list()).map(item => item.name);
          const currentSnapshot = new Map<string, number>();
          
          for (const item of currentItems) {
            const itemPath = `${folderPath}/${item}`;
            const stat = await (await (new File(itemPath)).exists());
            if (stat.exists) {
              currentSnapshot.set(itemPath, stat.modificationTime || 0);
            }
          }
          
          // Check for added/modified
          for (const [path, mtime] of currentSnapshot) {
            const oldMtime = lastSnapshot.get(path);
            if (!oldMtime) {
              this.notify(path, 'added');
            } else if (oldMtime !== mtime) {
              this.notify(path, 'modified');
            }
          }
          
          // Check for deleted
          for (const [path] of lastSnapshot) {
            if (!currentSnapshot.has(path)) {
              this.notify(path, 'deleted');
            }
          }
          
          // Update snapshot
          lastSnapshot.clear();
          for (const [path, mtime] of currentSnapshot) {
            lastSnapshot.set(path, mtime);
          }
        } catch (error) {
          console.error('[FileObserver] Scan error:', error);
        }
      }, 5000);
      
      this.watchers.set(folderPath, { interval, lastSnapshot });
    } catch (error) {
      console.error(`[FileObserver] Failed to watch ${folderPath}:`, error);
    }
  }
  
  unwatchFolder(folderPath: string) {
    const watcher = this.watchers.get(folderPath);
    if (watcher) {
      clearInterval(watcher.interval);
      this.watchers.delete(folderPath);
    }
  }
  
  unwatchAll() {
    for (const [path, watcher] of this.watchers) {
      clearInterval(watcher.interval);
    }
    this.watchers.clear();
  }
}

export const localFileObserver = LocalFileObserver.getInstance();