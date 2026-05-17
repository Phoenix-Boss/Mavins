// hooks/useImmersiveMode.ts
import { useEffect, useRef } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { setStatusBarHidden } from 'expo-status-bar';

interface ImmersiveModeOptions {
  /**
   * Whether to hide the status bar (default: true)
   */
  hideStatusBar?: boolean;
  
  /**
   * Whether to hide the navigation bar (Android only, default: true)
   */
  hideNavigationBar?: boolean;
  
  /**
   * Delay in ms before re-hiding navigation bar after user interaction (Android only)
   * Set to 0 to disable auto re-hide (default: 2000)
   */
  autoHideDelay?: number;
  
  /**
   * Whether to show bars when app goes to background (default: false)
   */
  showOnBackground?: boolean;
}

/**
 * Hook to create a true fullscreen immersive experience
 * Hides both status bar and bottom navigation bar on user's device
 */
export const useImmersiveMode = (options: ImmersiveModeOptions = {}) => {
  const {
    hideStatusBar = true,
    hideNavigationBar = true,
    autoHideDelay = 2000,
    showOnBackground = false,
  } = options;

  const autoHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isNavigationBarVisibleRef = useRef(false);

  // Clear auto-hide timeout
  const clearAutoHideTimeout = () => {
    if (autoHideTimeoutRef.current) {
      clearTimeout(autoHideTimeoutRef.current);
      autoHideTimeoutRef.current = null;
    }
  };

  // Hide navigation bar (Android only)
  const hideNavigationBarAndroid = async () => {
    if (Platform.OS !== 'android' || !hideNavigationBar) return;
    
    try {
      await NavigationBar.setVisibilityAsync('hidden');
      isNavigationBarVisibleRef.current = false;
    } catch (error) {
      console.warn('Failed to hide navigation bar:', error);
    }
  };

  // Show navigation bar (Android only)
  const showNavigationBarAndroid = async () => {
    if (Platform.OS !== 'android' || !hideNavigationBar) return;
    
    try {
      await NavigationBar.setVisibilityAsync('visible');
      isNavigationBarVisibleRef.current = true;
    } catch (error) {
      console.warn('Failed to show navigation bar:', error);
    }
  };

  // Setup Android navigation bar configuration
  const setupAndroidNavigationBar = async () => {
    if (Platform.OS !== 'android' || !hideNavigationBar) return;

    try {
      // Set navigation bar position to absolute to prevent layout shifts
      await NavigationBar.setPositionAsync('absolute');
      
      // Set behavior to overlay-swipe - bars appear temporarily when swiped
      await NavigationBar.setBehaviorAsync('overlay-swipe');
      
      // Set transparent background for smoother visuals
      await NavigationBar.setBackgroundColorAsync('#00000000');
      
      // Set button colors to match theme (optional)
      // await NavigationBar.setButtonStyleAsync('light'); // or 'dark'
      
      // Initially hide the navigation bar
      await hideNavigationBarAndroid();
      
      // Add visibility listener to auto-hide when user shows it
      const subscription = NavigationBar.addVisibilityListener(({ visibility }) => {
        if (visibility === 'visible' && !isNavigationBarVisibleRef.current) {
          // User swiped to show the bar, schedule auto-hide
          if (autoHideDelay > 0) {
            clearAutoHideTimeout();
            autoHideTimeoutRef.current = setTimeout(() => {
              hideNavigationBarAndroid();
              clearAutoHideTimeout();
            }, autoHideDelay);
          }
        } else if (visibility === 'hidden') {
          clearAutoHideTimeout();
          isNavigationBarVisibleRef.current = false;
        }
      });
      
      return subscription;
    } catch (error) {
      console.warn('Failed to setup Android navigation bar:', error);
      return null;
    }
  };

  // Hide status bar
  const setupStatusBar = () => {
    if (!hideStatusBar) return;
    
    try {
      // Hide status bar with fade animation
      setStatusBarHidden(true, 'none');
    } catch (error) {
      console.warn('Failed to hide status bar:', error);
    }
  };

  // Show status bar
  const showStatusBar = () => {
    if (!hideStatusBar) return;
    
    try {
      setStatusBarHidden(false, 'slide');
    } catch (error) {
      console.warn('Failed to show status bar:', error);
    }
  };

  // Reset to normal mode (show all bars)
  const resetToNormalMode = async () => {
    clearAutoHideTimeout();
    
    if (hideStatusBar) {
      showStatusBar();
    }
    
    if (Platform.OS === 'android' && hideNavigationBar) {
      await showNavigationBarAndroid();
      await NavigationBar.setBehaviorAsync('inset-touch');
      await NavigationBar.setPositionAsync('relative');
    }
  };

  useEffect(() => {
    let visibilitySubscription: { remove: () => void } | null = null;
    
    // Setup immersive mode on mount
    const setupImmersiveMode = async () => {
      // Hide status bar
      setupStatusBar();
      
      // Setup Android navigation bar
      if (Platform.OS === 'android' && hideNavigationBar) {
        visibilitySubscription = await setupAndroidNavigationBar();
      }
    };
    
    setupImmersiveMode();

    // Handle app state changes (foreground/background)
    const appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // App came to foreground - re-enter immersive mode
        setupStatusBar();
        if (Platform.OS === 'android' && hideNavigationBar) {
          hideNavigationBarAndroid();
        }
      } else if (nextAppState === 'background' && showOnBackground) {
        // App went to background - optionally show bars
        if (Platform.OS === 'android' && hideNavigationBar) {
          showNavigationBarAndroid();
        }
      }
    });

    // Cleanup on unmount
    return () => {
      appStateSubscription.remove();
      if (visibilitySubscription) {
        visibilitySubscription.remove();
      }
      clearAutoHideTimeout();
      
      // Optional: Reset to normal mode when component unmounts
      // Uncomment if you want to restore bars when app is closed
      // resetToNormalMode();
    };
  }, []); // Run once on mount

  // Return useful methods for manual control
  return {
    /**
     * Manually hide navigation bar (Android only)
     */
    hideNavigationBar: hideNavigationBarAndroid,
    
    /**
     * Manually show navigation bar (Android only)
     */
    showNavigationBar: showNavigationBarAndroid,
    
    /**
     * Manually hide status bar
     */
    hideStatusBar: setupStatusBar,
    
    /**
     * Manually show status bar
     */
    showStatusBar,
    
    /**
     * Reset to normal mode (show all bars)
     */
    resetToNormalMode,
  };
};
