// libs/DeviceManager.ts

import { supabase } from '@/libs/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

interface DevicePool {
  totalDevices: number;
  seededDevices: number;
  realDevices: number;
  onlineActive: number;
  onlinePassive: number;
  offlineActive: number;
  offlinePassive: number;
  dormant: number;
  newDevices: number;
  segments: Record<string, number>;
}

interface DeviceSegment {
  name: string;
  icon: string;
  description: string;
  percentage: number;
  color: string;
}

class DeviceManager {
  private static instance: DeviceManager;
  private deviceId: string | null = null;
  private cachedPool: DevicePool | null = null;
  private poolCacheTime: number = 0;
  private readonly CACHE_TTL = 60000; // 1 minute

  // Industry standard segment definitions with real-world names
  private readonly SEGMENT_DEFINITIONS: Record<string, DeviceSegment> = {
    'Engaged_Listeners': {
      name: 'Engaged Listeners',
      icon: '🔥',
      description: 'Currently active, highly engaged users',
      percentage: 0.25,
      color: '#FF6B35',
    },
    'Passive_Scrollers': {
      name: 'Passive Scrollers',
      icon: '👀',
      description: 'Online but passive, need nudging',
      percentage: 0.20,
      color: '#FFB347',
    },
    'Power_Users': {
      name: 'Power Users',
      icon: '📱',
      description: 'Offline but will engage when online',
      percentage: 0.20,
      color: '#4ECDC4',
    },
    'Occasional_Listeners': {
      name: 'Occasional Listeners',
      icon: '💤',
      description: 'Rarely engage, need re-engagement',
      percentage: 0.15,
      color: '#A78BFA',
    },
    'Sleepers': {
      name: 'Sleepers',
      icon: '🌙',
      description: 'Inactive but have the app installed',
      percentage: 0.10,
      color: '#6B7280',
    },
    'Newcomers': {
      name: 'Newcomers',
      icon: '🌟',
      description: 'Recently onboarded users',
      percentage: 0.10,
      color: '#34D399',
    },
  };

  private constructor() {}

  static getInstance(): DeviceManager {
    if (!DeviceManager.instance) {
      DeviceManager.instance = new DeviceManager();
    }
    return DeviceManager.instance;
  }

  // ─── Get or create device ID ──────────────────────────────────────────────
  async getDeviceId(): Promise<string> {
    if (this.deviceId) return this.deviceId;
    
    try {
      let id = await AsyncStorage.getItem('@device_id');
      if (!id) {
        id = 'real_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        await AsyncStorage.setItem('@device_id', id);
      }
      this.deviceId = id;
      return id;
    } catch {
      if (!this.deviceId) {
        this.deviceId = 'real_' + Math.random().toString(36).substring(2, 15);
      }
      return this.deviceId;
    }
  }

  // ─── Register real device ─────────────────────────────────────────────────
  async registerRealDevice(region: string = 'Global'): Promise<boolean> {
    try {
      const deviceId = await this.getDeviceId();
      const now = new Date().toISOString();

      const { error } = await supabase
        .from('real_devices')
        .upsert({
          device_id: deviceId,
          region: region,
          segment: 'Engaged_Listeners',
          last_seen: now,
          is_online: true,
          is_active: true,
          updated_at: now,
        }, {
          onConflict: 'device_id',
        });

      if (error) {
        console.error('Failed to register real device:', error);
        return false;
      }

      console.log(`📱 Real device registered: ${deviceId} in ${region}`);
      return true;
    } catch (err) {
      console.error('Failed to register real device:', err);
      return false;
    }
  }

  // ─── Update device online status ──────────────────────────────────────────
  async updateDeviceStatus(deviceId: string, isOnline: boolean): Promise<void> {
    try {
      const now = new Date().toISOString();
      
      await supabase
        .from('real_devices')
        .update({
          is_online: isOnline,
          last_seen: now,
          updated_at: now,
        })
        .eq('device_id', deviceId);
    } catch (err) {
      console.error('Failed to update device status:', err);
    }
  }

  // ─── Get device segment definitions ──────────────────────────────────────

  getSegmentDefinitions(): Record<string, DeviceSegment> {
    return this.SEGMENT_DEFINITIONS;
  }

  // ─── Get segment display info ─────────────────────────────────────────────

  getSegmentInfo(segment: string): DeviceSegment | null {
    return this.SEGMENT_DEFINITIONS[segment] || null;
  }

  // ─── Get device pool with industry standard naming ───────────────────────

  async getDevicePool(quickPickId?: string): Promise<DevicePool> {
    try {
      if (this.cachedPool && (Date.now() - this.poolCacheTime) < this.CACHE_TTL) {
        return this.cachedPool;
      }

      // Get seeded devices count
      const { count: seededCount, error: seededError } = await supabase
        .from('seeded_devices_pool')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      if (seededError) {
        console.error('Failed to get seeded devices:', seededError);
        return this.getFallbackPool();
      }

      // Get real devices count
      const { count: realCount, error: realError } = await supabase
        .from('real_devices')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      if (realError) {
        console.error('Failed to get real devices:', realError);
        return this.getFallbackPool();
      }

      // Get segment distribution
      const { data: segmentData, error: segmentError } = await supabase
        .from('seeded_devices_pool')
        .select('segment, COUNT(*) as count')
        .eq('is_active', true)
        .groupBy('segment');

      if (segmentError) {
        console.error('Failed to get segment distribution:', segmentError);
        return this.getFallbackPool();
      }

      const segments: Record<string, number> = {};
      const segmentCounts: Record<string, number> = {
        'Engaged_Listeners': 0,
        'Passive_Scrollers': 0,
        'Power_Users': 0,
        'Occasional_Listeners': 0,
        'Sleepers': 0,
        'Newcomers': 0,
      };

      segmentData?.forEach(row => {
        const segment = row.segment || 'Engaged_Listeners';
        const count = Number(row.count) || 0;
        segments[segment] = count;
        if (segmentCounts[segment] !== undefined) {
          segmentCounts[segment] = count;
        }
      });

      const totalDevices = (seededCount || 0) + (realCount || 0);

      const pool: DevicePool = {
        totalDevices: totalDevices || 3000,
        seededDevices: seededCount || 0,
        realDevices: realCount || 0,
        onlineActive: segmentCounts['Engaged_Listeners'] || 0,
        onlinePassive: segmentCounts['Passive_Scrollers'] || 0,
        offlineActive: segmentCounts['Power_Users'] || 0,
        offlinePassive: segmentCounts['Occasional_Listeners'] || 0,
        dormant: segmentCounts['Sleepers'] || 0,
        newDevices: segmentCounts['Newcomers'] || 0,
        segments: segments,
      };

      this.cachedPool = pool;
      this.poolCacheTime = Date.now();

      // Log with industry standard names
      console.log(`📊 Device Pool:`);
      console.log(`   Total: ${pool.totalDevices}`);
      console.log(`   🔥 Engaged Listeners: ${pool.onlineActive}`);
      console.log(`   👀 Passive Scrollers: ${pool.onlinePassive}`);
      console.log(`   📱 Power Users: ${pool.offlineActive}`);
      console.log(`   💤 Occasional Listeners: ${pool.offlinePassive}`);
      console.log(`   🌙 Sleepers: ${pool.dormant}`);
      console.log(`   🌟 Newcomers: ${pool.newDevices}`);

      return pool;
    } catch (err) {
      console.error('Failed to get device pool:', err);
      return this.getFallbackPool();
    }
  }

  private getFallbackPool(): DevicePool {
    return {
      totalDevices: 3000,
      seededDevices: 3000,
      realDevices: 0,
      onlineActive: 750,
      onlinePassive: 600,
      offlineActive: 600,
      offlinePassive: 450,
      dormant: 300,
      newDevices: 300,
      segments: {
        'Engaged_Listeners': 750,
        'Passive_Scrollers': 600,
        'Power_Users': 600,
        'Occasional_Listeners': 450,
        'Sleepers': 300,
        'Newcomers': 300,
      },
    };
  }
}

// ============================================================
// EXPORT - SINGLE INSTANCE
// ============================================================

const deviceManagerInstance = DeviceManager.getInstance();
export default deviceManagerInstance;