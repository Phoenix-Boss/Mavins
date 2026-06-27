// services/PilotService.ts
import { Pilot, type FindOptions, type Point } from 'expo-pilot';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PILOT_READY_KEY = '@mavin_pilot_ready';

export interface UIElement {
  text?: string;
  resourceId?: string;
  className?: string;
  bounds?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

export class PilotService {
  private static instance: PilotService;
  private isReady: boolean = false;

  private constructor() {}

  static getInstance(): PilotService {
    if (!PilotService.instance) {
      PilotService.instance = new PilotService();
    }
    return PilotService.instance;
  }

  async initialize(): Promise<boolean> {
    try {
      if (this.isReady) return true;
      
      await Pilot.initialize();
      this.isReady = true;
      await AsyncStorage.setItem(PILOT_READY_KEY, 'true');
      console.log('[PilotService] Initialized');
      return true;
    } catch (error) {
      console.error('[PilotService] Initialization failed:', error);
      return false;
    }
  }

  async isInitialized(): Promise<boolean> {
    if (this.isReady) return true;
    const stored = await AsyncStorage.getItem(PILOT_READY_KEY);
    return stored === 'true';
  }

  // ----- Core Actions -----

  async tapElement(
    text?: string, 
    resourceId?: string, 
    className?: string
  ): Promise<boolean> {
    try {
      if (!this.isReady) throw new Error('Pilot not initialized');
      
      const options: FindOptions = {};
      if (text) options.text = text;
      if (resourceId) options.resourceId = resourceId;
      if (className) options.className = className;
      
      const result = await Pilot.findElement(options);
      if (result) {
        await Pilot.tapElement(result);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[PilotService] tapElement error:', error);
      return false;
    }
  }

  async tapCoordinate(x: number, y: number): Promise<boolean> {
    try {
      if (!this.isReady) throw new Error('Pilot not initialized');
      await Pilot.tap(x, y);
      return true;
    } catch (error) {
      console.error('[PilotService] tapCoordinate error:', error);
      return false;
    }
  }

  async typeText(text: string, target?: string): Promise<boolean> {
    try {
      if (!this.isReady) throw new Error('Pilot not initialized');
      
      if (target) {
        // Find and focus target element first
        const element = await Pilot.findElement({ text: target });
        if (element) {
          await Pilot.tapElement(element);
        }
      }
      
      await Pilot.type(text);
      return true;
    } catch (error) {
      console.error('[PilotService] typeText error:', error);
      return false;
    }
  }

  async swipe(
    startX: number, 
    startY: number, 
    endX: number, 
    endY: number, 
    duration: number = 300
  ): Promise<boolean> {
    try {
      if (!this.isReady) throw new Error('Pilot not initialized');
      await Pilot.swipe(startX, startY, endX, endY, duration);
      return true;
    } catch (error) {
      console.error('[PilotService] swipe error:', error);
      return false;
    }
  }

  async scroll(direction: 'up' | 'down' | 'left' | 'right', steps: number = 10): Promise<boolean> {
    try {
      if (!this.isReady) throw new Error('Pilot not initialized');
      await Pilot.scroll(direction, steps);
      return true;
    } catch (error) {
      console.error('[PilotService] scroll error:', error);
      return false;
    }
  }

  async navigateBack(): Promise<boolean> {
    try {
      if (!this.isReady) throw new Error('Pilot not initialized');
      await Pilot.navigateBack();
      return true;
    } catch (error) {
      console.error('[PilotService] navigateBack error:', error);
      return false;
    }
  }

  async launchApp(packageName: string): Promise<boolean> {
    try {
      if (!this.isReady) throw new Error('Pilot not initialized');
      await Pilot.launchApp(packageName);
      return true;
    } catch (error) {
      console.error('[PilotService] launchApp error:', error);
      return false;
    }
  }

  // ----- Advanced Features -----

  async waitForElement(
    options: FindOptions, 
    timeout: number = 5000
  ): Promise<any | null> {
    try {
      if (!this.isReady) throw new Error('Pilot not initialized');
      return await Pilot.waitForElement(options, timeout);
    } catch (error) {
      console.error('[PilotService] waitForElement error:', error);
      return null;
    }
  }

  async getScreenState(): Promise<UIElement[]> {
    try {
      if (!this.isReady) throw new Error('Pilot not initialized');
      const snapshot = await Pilot.getSnapshot();
      return snapshot.map(node => ({
        text: node.text,
        resourceId: node.resourceId,
        className: node.className,
        bounds: node.bounds,
      }));
    } catch (error) {
      console.error('[PilotService] getScreenState error:', error);
      return [];
    }
  }

  async findElement(options: FindOptions): Promise<any | null> {
    try {
      if (!this.isReady) throw new Error('Pilot not initialized');
      return await Pilot.findElement(options);
    } catch (error) {
      console.error('[PilotService] findElement error:', error);
      return null;
    }
  }

  async screenshot(): Promise<string | null> {
    try {
      if (!this.isReady) throw new Error('Pilot not initialized');
      return await Pilot.takeScreenshot();
    } catch (error) {
      console.error('[PilotService] screenshot error:', error);
      return null;
    }
  }

  // ----- Media Playback Helpers -----

  async controlPlayback(action: 'play' | 'pause' | 'next' | 'previous'): Promise<boolean> {
    try {
      const mediaButtonMap = {
        play: ['Play', '▶', '播放'],
        pause: ['Pause', '⏸', '暂停'],
        next: ['Next', '⏭', '下一首'],
        previous: ['Previous', '⏮', '上一首'],
      };

      const labels = mediaButtonMap[action];
      for (const label of labels) {
        const success = await this.tapElement(label);
        if (success) return true;
      }
      
      // Fallback: Try resource IDs
      const resourceIds = [
        'com.android.systemui:id/media_play_button',
        'com.android.systemui:id/media_pause_button',
        'android:id/play',
        'android:id/pause',
      ];
      
      for (const id of resourceIds) {
        const success = await this.tapElement(undefined, id);
        if (success) return true;
      }
      
      return false;
    } catch (error) {
      console.error('[PilotService] controlPlayback error:', error);
      return false;
    }
  }

  async getCurrentTrack(): Promise<{ title: string; artist: string } | null> {
    try {
      if (!this.isReady) throw new Error('Pilot not initialized');
      
      const snapshot = await Pilot.getSnapshot();
      
      // Try to find title
      const titleElement = snapshot.find(
        node => node.className?.includes('TextView') && 
                 node.text && 
                 node.text.length > 0 &&
                 node.text.length < 100
      );
      
      // Try to find artist (secondary text)
      const artistElement = snapshot.find(
        node => node.className?.includes('TextView') && 
                 node.text && 
                 node.text.length > 0 &&
                 node.text.length < 50 &&
                 node !== titleElement
      );
      
      return {
        title: titleElement?.text || 'Unknown Track',
        artist: artistElement?.text || 'Unknown Artist',
      };
    } catch (error) {
      console.error('[PilotService] getCurrentTrack error:', error);
      return null;
    }
  }

  // ----- Gesture Helpers -----

  async gesturePlayPause(): Promise<boolean> {
    // Double tap center of screen to toggle playback
    const { width, height } = await Pilot.getScreenSize();
    return await this.tapCoordinate(width / 2, height / 2);
  }

  async gestureNext(): Promise<boolean> {
    // Swipe left to skip forward
    const { width, height } = await Pilot.getScreenSize();
    return await this.swipe(width * 0.8, height / 2, width * 0.2, height / 2, 200);
  }

  async gesturePrevious(): Promise<boolean> {
    // Swipe right to skip backward
    const { width, height } = await Pilot.getScreenSize();
    return await this.swipe(width * 0.2, height / 2, width * 0.8, height / 2, 200);
  }

  async gestureVolumeUp(): Promise<boolean> {
    // Swipe up on right side
    const { width, height } = await Pilot.getScreenSize();
    return await this.swipe(width * 0.9, height * 0.7, width * 0.9, height * 0.3, 300);
  }

  async gestureVolumeDown(): Promise<boolean> {
    // Swipe down on right side
    const { width, height } = await Pilot.getScreenSize();
    return await this.swipe(width * 0.9, height * 0.3, width * 0.9, height * 0.7, 300);
  }
}