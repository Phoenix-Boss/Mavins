/**
 * storage.ts
 *
 * Drop-in AsyncStorage wrapper that mimics the MMKV synchronous API surface
 * used across the app (getString / set / delete).
 *
 * NOTE: AsyncStorage is async — callers that previously used the synchronous
 * MMKV API (getString / set) must await the async versions provided here.
 * MessageModal.tsx has been updated accordingly.
 *
 * Swap back to MMKV once the native module is properly linked in the dev build:
 *   import { MMKV } from 'react-native-mmkv';
 *   export const storage = new MMKV();
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const storage = {
  getString: async (key: string): Promise<string | null> => {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },

  set: async (key: string, value: string): Promise<void> => {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // silently fail — non-critical storage
    }
  },

  delete: async (key: string): Promise<void> => {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // silently fail
    }
  },
};