// src/services/api/request/get.ts
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CookieManager from '@preeternal/react-native-cookie-manager'; 
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';
import { Platform } from 'react-native';
import packageJson from '../../../package.json';

export interface ApiRequestParams {
  url: string;
  params?: Record<string, any>;
  isWithSelfId?: boolean;
  isWithSelfToken?: boolean;
  isWithSelfLanguage?: boolean;
  page?: number;
  limit?: number;
  order?: string;
  onSuccess?: (response: AxiosResponse) => Promise<any> | any;
  onError?: (error: any) => Promise<void> | void;
  onComplete?: () => Promise<void> | void;
}

const APP_VERSION = packageJson.version || '1.0.0';
const GUEST_TOKEN = 'guest';

// YouTube API keys for rotation
const YOUTUBE_KEYS = [
  'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w', // Android Music
  'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', // Web
  'AIzaSyBAETezhkwP0ZWA02RsqT1zuOpxFpe0pIw', // iOS Music
  'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc', // Android
  'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30', // Web alt
  'AIzaSyDCU8hByM-4DrUqRUxtonOvJ5XGZa7a4tU', // TV
];

const snakeCase = (str: string): string => {
  return str?.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
};

export default async function getRequest<T = any>({
  url,
  params = {},
  isWithSelfId = false,
  isWithSelfToken = false,
  isWithSelfLanguage = false,
  page,
  limit,
  order,
  onSuccess,
  onError,
  onComplete,
}: ApiRequestParams): Promise<T | undefined> {
  const startTime = Date.now();

  try {
    // ============================================
    // 1. Get ALL device context using expo-device
    // ============================================
    
    // AsyncStorage items
    const profileId = await AsyncStorage.getItem('profile_id').catch(() => null);
    const token = await AsyncStorage.getItem('token').catch(() => null);
    const language = await AsyncStorage.getItem('language').catch(() => null);
    const soundCloudClientId = await AsyncStorage.getItem('soundcloud_client_id').catch(() => null);
    
    // Device info from expo-device (synchronous - no promises!)
    const deviceId = Device.osInternalBuildId ?? 'unknown-device-id';
    const systemName = Device.osName ?? Platform.OS;
    const systemVersion = Device.osVersion ?? String(Platform.Version ?? '1.0');
    const model = Device.modelName ?? 'Unknown';
    const brand = Device.brand ?? 'Unknown';
    
    // User agent from expo-constants
    const userAgent = Constants.expoConfig?.name 
      ? `${Constants.expoConfig.name}/${APP_VERSION} (${Platform.OS} ${systemVersion}; ${model})`
      : Platform.select({
          ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
          android: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
          default: 'Mozilla/5.0 (Unknown)'
        });
    
    // Network info (still async)
    let netInfo = { 
      type: 'unknown' as const, 
      isConnected: true, 
      isInternetReachable: true, 
      isConnectionExpensive: false,
      carrier: null
    };
    try {
      const networkInfo = await NetInfo.fetch();
      if (networkInfo) netInfo = networkInfo;
    } catch (e) {
      console.warn('Failed to get netInfo:', e);
    }

    // ============================================
    // 2. Extract domain for cookies
    // ============================================
    let domain = '';
    try {
      domain = new URL(url).hostname;
    } catch (e) {
      console.warn('Invalid URL:', url);
    }

    // ============================================
    // 3. Get REAL cookies for this domain
    // ============================================
    let cookies: Record<string, any> = {};
    let cookieString = '';
    
    if (domain) {
      try {
        // Get native cookies
        const nativeCookies = await CookieManager.get(domain, false).catch(() => ({}));
        
        // Get WebKit cookies for iOS
        let webKitCookies = {};
        if (Platform.OS === 'ios') {
          webKitCookies = await CookieManager.get(domain, true).catch(() => ({}));
        }
        
        cookies = {
          ...nativeCookies,
          ...webKitCookies
        };
        
        cookieString = Object.values(cookies)
          .map((cookie: any) => `${cookie.name}=${cookie.value}`)
          .join('; ');
          
        console.log(`   🍪 Found ${Object.keys(cookies).length} cookies for ${domain}`);
      } catch (e) {
        console.warn('Failed to get cookies:', e);
      }
    }

    // ============================================
    // 4. Build params with all context
    // ============================================
    const paramsData: Record<string, any> = {
      ...params,
      ...(isWithSelfId && profileId && { profile_id: profileId }),
      ...(isWithSelfToken && {
        token: token || GUEST_TOKEN,
      }),
      ...(isWithSelfLanguage && language && { language }),
      ...(page && { page }),
      ...(limit && { limit }),
      ...(order && { order: snakeCase(order) }),
      version: APP_VERSION,
    };

    // ============================================
    // 5. Handle source-specific modifications
    // ============================================
    let finalUrl = url;
    let finalParams = paramsData;

    if (url.includes('soundcloud.com') && !url.includes('client_id') && soundCloudClientId) {
      finalParams = { ...finalParams, client_id: soundCloudClientId };
    }

    // YouTube key rotation
    if (url.includes('youtube.com/youtubei') || url.includes('youtubei/v1')) {
      const keyIndex = (url.length + Date.now()) % YOUTUBE_KEYS.length;
      finalParams = {
        ...finalParams,
        key: YOUTUBE_KEYS[keyIndex],
      };
    }

    // ============================================
    // 6. Build REAL device headers
    // ============================================
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      
      'X-Device-ID': deviceId,
      'X-Device-Model': model,
      'X-Device-Brand': brand,
      'X-OS': `${systemName} ${systemVersion}`,
      
      ...(netInfo?.type && { 'X-Network-Type': netInfo.type }),
      ...(netInfo?.carrier && { 'X-Network-Carrier': netInfo.carrier }),
      'X-Connection-Expensive': String(netInfo?.isConnectionExpensive || false),
      
      'Accept': 'application/json',
      'Accept-Language': language || 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      
      'X-App-Version': APP_VERSION,
      'X-App-Platform': Platform.OS,
      
      ...(cookieString && { 'Cookie': cookieString }),
    };

    // ============================================
    // 7. Add authentication if available
    // ============================================
    if (url.includes('spotify.com') && token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // ============================================
    // 8. Log request details for debugging
    // ============================================
    console.log(`\n🌐 REQUEST to ${domain}:`);
    console.log(`   Method: GET`);
    console.log(`   Path: ${finalUrl.split('?')[0]}`);
    console.log(`   Cookies: ${Object.keys(cookies).length} present`);
    console.log(`   Device: ${model} (${systemName} ${systemVersion})`);
    console.log(`   Network: ${netInfo?.type || 'unknown'}${netInfo?.carrier ? ` via ${netInfo.carrier}` : ''}`);

    // ============================================
    // 9. Make the request with Axios
    // ============================================
    const config: AxiosRequestConfig = {
      url: finalUrl,
      method: 'GET',
      params: finalParams,
      headers,
      timeout: 15000,
      validateStatus: (status) => status < 500,
      withCredentials: true,
      maxRedirects: 5,
    };

    const response = await axios.request(config);
    const responseTime = Date.now() - startTime;

    // ============================================
    // 10. Save any new cookies from response
    // ============================================
    if (domain && response.headers['set-cookie']) {
      try {
        const setCookieHeader = response.headers['set-cookie'];
        if (Array.isArray(setCookieHeader)) {
          for (const cookieStr of setCookieHeader) {
            await CookieManager.setFromResponse(domain, cookieStr).catch(() => {});
          }
        } else if (typeof setCookieHeader === 'string') {
          await CookieManager.setFromResponse(domain, setCookieHeader).catch(() => {});
        }
        console.log(`   🍪 Saved ${Array.isArray(setCookieHeader) ? setCookieHeader.length : 1} new cookies`);
      } catch (e) {
        console.warn('Failed to save cookies:', e);
      }
    }

    console.log(`✅ Response (${responseTime}ms): ${response.status}`);

    // ============================================
    // 11. Handle success callback
    // ============================================
    if (onSuccess) {
      return await onSuccess(response);
    }

    return response.data;
    
  } catch (error: any) {
    console.error(`❌ Request failed after ${Date.now() - startTime}ms:`, error?.message || error);

    if (onError) {
      await onError(error);
    } else {
      throw error;
    }
  } finally {
    if (onComplete) {
      await onComplete();
    }
  }
}