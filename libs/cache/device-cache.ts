// libs/cache/device-cache.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getConfig } from './config'; // ✅ Import function, not static object
import { isExpired, expiryTime } from './utils';
import { DeviceCacheEntry, DeviceStats } from './types';

/**
 * Device Cache - Lives on user's phone
 * Stores recent searches and results with TypeScript
 */
export class DeviceCache {
  private prefix: string;
  private maxItems: number;
  private ttl: number;
  private enabled: boolean;
  
  // In-memory index for performance
  private index: Map<string, DeviceCacheEntry>;
  private accessOrder: string[];

  constructor() {
    console.log('🏗️ DeviceCache constructor starting...');
    
    // ✅ Get config at runtime
    const config = getConfig();
    
    // Add null checks with fallbacks
    if (!config || !config.device) {
      console.error('❌ Config or config.device is undefined! Using fallback values');
      this.prefix = '@mavin_cache_';
      this.maxItems = 100;
      this.ttl = 86400 * 1000; // 24 hours in ms
      this.enabled = true;
    } else {
      console.log('✅ Config.device found:', config.device);
      this.prefix = config.device.storagePrefix;
      this.maxItems = config.device.maxItems;
      this.ttl = config.device.ttlSeconds * 1000; // convert config seconds → ms
      this.enabled = config.device.enabled;
    }
    
    this.index = new Map();
    this.accessOrder = [];
    
    console.log('📱 DeviceCache initialized with:', {
      prefix: this.prefix,
      maxItems: this.maxItems,
      ttl: this.ttl,
      enabled: this.enabled
    });
    
    // Initialize if on device
    if (typeof window !== 'undefined' && window.localStorage) {
      this.init().catch(console.error);
    } else {
      console.log('💻 Running in Node.js environment (skipping AsyncStorage init)');
    }
  }

  /**
   * Initialize cache from storage
   */
  private async init(): Promise<void> {
    try {
      console.log('🔄 Initializing device cache from storage...');
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(k => k.startsWith(this.prefix));
      
      console.log(`📊 Found ${cacheKeys.length} existing cache keys`);
      
      for (const key of cacheKeys) {
        const value = await AsyncStorage.getItem(key);
        if (value) {
          try {
            const entry: DeviceCacheEntry = JSON.parse(value);
            if (!isExpired(entry.expiresAt)) {
              this.index.set(key, entry);
              this.accessOrder.push(key);
            } else {
              // Remove expired
              await AsyncStorage.removeItem(key);
            }
          } catch (e) {
            // Invalid JSON, remove it
            await AsyncStorage.removeItem(key);
          }
        }
      }
      
      // Trim if needed
      await this.trim();
      
      console.log(`✅ Device cache initialized with ${this.index.size} items`);
    } catch (error) {
      console.error('❌ Device cache init error:', error);
    }
  }

  /**
   * Get item from device cache
   */
  public async get<T = any>(key: string): Promise<T | null> {
    if (!this.enabled) {
      console.log('⚠️ Device cache disabled, skipping get');
      return null;
    }
    
    const fullKey = this.prefix + key;
    console.log(`🔍 Getting from cache: ${fullKey}`);
    
    try {
      // Check memory index first
      let entry = this.index.get(fullKey) as DeviceCacheEntry<T> | undefined;
      
      if (!entry) {
        console.log('⏳ Not in memory, checking storage...');
        // Try storage
        const stored = await AsyncStorage.getItem(fullKey);
        if (stored) {
          entry = JSON.parse(stored) as DeviceCacheEntry<T>;
          if (!isExpired(entry.expiresAt)) {
            this.index.set(fullKey, entry as DeviceCacheEntry);
            console.log('✅ Found in storage');
          } else {
            // Expired, remove
            console.log('⏰ Found but expired, removing');
            await AsyncStorage.removeItem(fullKey);
            return null;
          }
        } else {
          console.log('❌ Not found in storage');
          return null;
        }
      } else {
        console.log('✅ Found in memory');
      }
      
      // Update access time
      entry.lastAccessed = Date.now();
      entry.accessCount = (entry.accessCount || 0) + 1;
      
      // Update in memory
      this.index.set(fullKey, entry as DeviceCacheEntry);
      
      // Update access order
      this.updateAccessOrder(fullKey);
      
      // Write back asynchronously
      AsyncStorage.setItem(fullKey, JSON.stringify(entry)).catch(console.error);
      
      return entry.value;
    } catch (error) {
      console.error('❌ Device cache get error:', error);
      return null;
    }
  }

  /**
   * Set item in device cache
   */
  public async set<T = any>(key: string, value: T, customTtl?: number): Promise<boolean> {
    if (!this.enabled) {
      console.log('⚠️ Device cache disabled, skipping set');
      return false;
    }
    
    const fullKey = this.prefix + key;
    const ttl = customTtl || this.ttl;
    
    console.log(`💾 Setting cache: ${fullKey} (TTL: ${ttl}ms)`);
    
    try {
      const entry: DeviceCacheEntry<T> = {
        key: fullKey,
        value,
        createdAt: Date.now(),
        expiresAt: expiryTime(ttl),
        lastAccessed: Date.now(),
        accessCount: 1,
      };
      
      // Trim if needed
      if (this.index.size >= this.maxItems) {
        console.log('⚠️ Cache full, evicting LRU...');
        await this.evictLRU();
      }
      
      // Save to memory
      this.index.set(fullKey, entry as DeviceCacheEntry);
      this.updateAccessOrder(fullKey);
      
      // Save to storage
      await AsyncStorage.setItem(fullKey, JSON.stringify(entry));
      
      console.log('✅ Cache set successful');
      return true;
    } catch (error) {
      console.error('❌ Device cache set error:', error);
      return false;
    }
  }

  /**
   * Set multiple items at once
   */
  public async setMany<T = any>(items: Array<{ key: string; value: T; ttl?: number }>): Promise<boolean> {
    if (!this.enabled || !items.length) {
      console.log('⚠️ Device cache disabled or no items');
      return true;
    }
    
    console.log(`📦 Setting ${items.length} items in cache`);
    
    const entries: Promise<void>[] = [];
    
    for (const { key, value, ttl } of items) {
      const fullKey = this.prefix + key;
      const entry: DeviceCacheEntry<T> = {
        key: fullKey,
        value,
        createdAt: Date.now(),
        expiresAt: expiryTime(ttl || this.ttl),
        lastAccessed: Date.now(),
        accessCount: 1,
      };
      
      this.index.set(fullKey, entry as DeviceCacheEntry);
      this.updateAccessOrder(fullKey);
      entries.push(AsyncStorage.setItem(fullKey, JSON.stringify(entry)));
    }
    
    // Trim if needed
    while (this.index.size > this.maxItems) {
      await this.evictLRU();
    }
    
    try {
      await Promise.all(entries);
      console.log('✅ All items saved successfully');
      return true;
    } catch (error) {
      console.error('❌ Device cache setMany error:', error);
      return false;
    }
  }

  /**
   * Check if key exists and is valid
   */
  public async has(key: string): Promise<boolean> {
    if (!this.enabled) return false;
    
    const fullKey = this.prefix + key;
    
    // Check memory
    if (this.index.has(fullKey)) {
      const entry = this.index.get(fullKey);
      if (entry && !isExpired(entry.expiresAt)) {
        return true;
      }
    }
    
    // Check storage
    try {
      const stored = await AsyncStorage.getItem(fullKey);
      if (stored) {
        const entry: DeviceCacheEntry = JSON.parse(stored);
        if (!isExpired(entry.expiresAt)) {
          return true;
        }
      }
    } catch (e) {
      // Ignore
    }
    
    return false;
  }

  /**
   * Delete item
   */
  public async delete(key: string): Promise<boolean> {
    const fullKey = this.prefix + key;
    console.log(`🗑️ Deleting cache: ${fullKey}`);
    
    this.index.delete(fullKey);
    const orderIndex = this.accessOrder.indexOf(fullKey);
    if (orderIndex > -1) {
      this.accessOrder.splice(orderIndex, 1);
    }
    
    try {
      await AsyncStorage.removeItem(fullKey);
      console.log('✅ Delete successful');
      return true;
    } catch (error) {
      console.error('❌ Device cache delete error:', error);
      return false;
    }
  }

  /**
   * Clear all cache
   */
  public async clear(): Promise<boolean> {
    console.log('🧹 Clearing all device cache');
    
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(k => k.startsWith(this.prefix));
      await AsyncStorage.multiRemove(cacheKeys);
      this.index.clear();
      this.accessOrder = [];
      console.log(`✅ Cleared ${cacheKeys.length} items`);
      return true;
    } catch (error) {
      console.error('❌ Device cache clear error:', error);
      return false;
    }
  }

  /**
   * Update access order (LRU)
   */
  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  /**
   * Evict least recently used
   */
  private async evictLRU(): Promise<void> {
    if (this.accessOrder.length === 0) return;
    
    const lruKey = this.accessOrder.shift();
    if (lruKey) {
      console.log(`♻️ Evicting LRU: ${lruKey}`);
      this.index.delete(lruKey);
      await AsyncStorage.removeItem(lruKey).catch(() => {});
    }
  }

  /**
   * Trim to max size
   */
  private async trim(): Promise<void> {
    while (this.accessOrder.length > this.maxItems) {
      await this.evictLRU();
    }
  }

  /**
   * Get cache stats
   */
  public getStats(): DeviceStats {
    const stats = {
      size: this.index.size,
      maxSize: this.maxItems,
      keys: Array.from(this.index.keys()),
    };
    console.log('📊 Cache stats:', stats);
    return stats;
  }

  /**
   * Get all keys (for debugging)
   */
  public async getAllKeys(): Promise<string[]> {
    const keys = await AsyncStorage.getAllKeys();
    return keys.filter(k => k.startsWith(this.prefix));
  }
}

// Export singleton instance
console.log('🏭 Creating DeviceCache singleton...');
export const deviceCache = new DeviceCache();
console.log('✅ DeviceCache singleton created');
