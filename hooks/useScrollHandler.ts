// hooks/useScrollHandler.ts
import { useScrollAnimations } from './useScrollAnimations';
import {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';

interface ScrollHandlerConfig {
  headerHeight: number;
  hideThreshold?: number; // Minimum scroll distance before hiding
  showThreshold?: number; // Minimum scroll distance before showing
  onScrollDirectionChange?: (direction: 'up' | 'down', isScrolling: boolean) => void;
}

export const useScrollHandler = (config: ScrollHandlerConfig) => {
  const { 
    headerHeight, 
    hideThreshold = 50,
    showThreshold = 10,
    onScrollDirectionChange 
  } = config;

  // Get animations for header
  const animations = useScrollAnimations({ useSpring: true });

  // ==================== SCROLL TRACKING ====================
  const lastScrollY = useSharedValue(0);
  const lastDirection = useSharedValue<'up' | 'down' | null>(null);
  const isScrolling = useSharedValue(false);
  const scrollStartY = useSharedValue(0);

  // ==================== SCROLL HANDLER WORKLET ====================
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';

      // ============ EXTRACT VALUES ============
      const currentY = event.contentOffset.y;
      const diff = currentY - lastScrollY.value;
      const absDiff = Math.abs(diff);
      
      // ============ TRACK SCROLL START ============
      if (!isScrolling.value && absDiff > 2) {
        isScrolling.value = true;
        scrollStartY.value = lastScrollY.value;
      }
      
      // ============ MIN SCROLL THRESHOLD ============
      const MIN_SCROLL = 5;
      if (absDiff < MIN_SCROLL) {
        lastScrollY.value = currentY;
        return;
      }

      // ============ DIRECTION ============
      const direction = diff > 0 ? 'down' : 'up';
      
      // Only trigger on direction change
      const directionChanged = lastDirection.value !== direction;
      
      if (directionChanged) {
        lastDirection.value = direction;

        // ============ HEADER LOGIC ============
        // Hide header on scroll down, show on scroll up
        const isHeaderHidden = animations.isHeaderHidden.value;
        const shouldHide = direction === 'down' && !isHeaderHidden && currentY > hideThreshold;
        const shouldShow = direction === 'up' && isHeaderHidden && currentY > showThreshold;

        if (shouldHide) {
          animations.slideHeader(true, headerHeight);
        } else if (shouldShow) {
          animations.slideHeader(false, headerHeight);
        }

        // ============ CALLBACK FOR TAB BAR ============
        if (onScrollDirectionChange) {
          // Run on JS thread for external callbacks
          const { runOnJS } = require('react-native-reanimated');
          runOnJS(onScrollDirectionChange)(direction, true);
        }
      }
      
      lastScrollY.value = currentY;
    },

    onBeginDrag: () => {
      'worklet';
      // Reset direction tracking on each new gesture
      lastDirection.value = null;
      isScrolling.value = true;
      scrollStartY.value = lastScrollY.value;
    },

    onEndDrag: () => {
      'worklet';
      // Don't immediately set scrolling to false, wait for momentum
    },

    onMomentumEnd: () => {
      'worklet';
      isScrolling.value = false;
      
      // Notify that scrolling has stopped
      if (onScrollDirectionChange) {
        const { runOnJS } = require('react-native-reanimated');
        runOnJS(onScrollDirectionChange)(lastDirection.value === 'up' ? 'up' : 'down', false);
      }
    },
  });

  // ==================== MANUAL CONTROL FUNCTIONS ====================
  
  const showHeader = (animated: boolean = true) => {
    'worklet';
    animations.slideHeader(false, headerHeight, animated);
  };

  const hideHeader = (animated: boolean = true) => {
    'worklet';
    animations.slideHeader(true, headerHeight, animated);
  };

  const toggleHeader = (animated: boolean = true) => {
    'worklet';
    animations.toggleHeader(headerHeight, animated);
  };

  const resetHeader = (animated: boolean = true) => {
    'worklet';
    animations.resetHeader(animated);
  };

  // ==================== RETURN VALUES ====================
  return {
    scrollHandler,
    headerTranslateY: animations.headerTranslateY,
    isHeaderHidden: animations.isHeaderHidden,
    isScrolling: animations.isScrolling,
    isAnimating: animations.isAnimating,
    
    // Manual controls
    showHeader,
    hideHeader,
    toggleHeader,
    resetHeader,
    
    // Direct animation access (for advanced use)
    animations,
  };
};
