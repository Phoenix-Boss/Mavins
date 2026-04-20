// hooks/useScrollHandler.ts
import { useScrollAnimations } from './useScrollAnimations';
import {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';

interface ScrollHandlerConfig {
  headerHeight: number;
}

export const useScrollHandler = (config: ScrollHandlerConfig) => {
  const { headerHeight } = config;

  // Get animations — removed useScrollLogic entirely.
  // useScrollLogic was causing a silent Reanimated worklet crash because
  // it (or its dependencies) were not available / throwing on init.
  const animations = useScrollAnimations();

  // ==================== SCROLL TRACKING ====================
  const lastScrollY = useSharedValue(0);
  const lastDirection = useSharedValue<'up' | 'down' | null>(null);

  // ==================== SCROLL HANDLER WORKLET ====================
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';

      // ============ EXTRACT VALUES ============
      const currentY = event.contentOffset.y;
      const diff = currentY - lastScrollY.value;
      lastScrollY.value = currentY;

      // ============ MIN SCROLL THRESHOLD ============
      const MIN_SCROLL = 10;
      if (Math.abs(diff) < MIN_SCROLL) return;

      // ============ DIRECTION ============
      const direction = diff > 0 ? 'down' : 'up';
      if (lastDirection.value === direction) return;
      lastDirection.value = direction;

      // ============ HEADER LOGIC ============
      // Hide header on scroll down, show on scroll up.
      // Tabs are fixed — only the header animates.
      const isHidden = animations.isHeaderHidden.value;

      if (direction === 'down' && !isHidden) {
        animations.slideHeader(true, headerHeight);
      } else if (direction === 'up' && isHidden) {
        animations.slideHeader(false, headerHeight);
      }
    },

    onBeginDrag: () => {
      'worklet';
      // Reset direction tracking on each new gesture so the first
      // movement of a new drag always triggers the header logic.
      lastDirection.value = null;
    },
  });

  // ==================== RETURN VALUES ====================
  return {
    scrollHandler,
    headerTranslateY: animations.headerTranslateY,
    isHeaderHidden: animations.isHeaderHidden,

    // Manual controls — plain functions so they work as worklets
    showHeader: () => {
      'worklet';
      animations.slideHeader(false, headerHeight);
    },
    hideHeader: () => {
      'worklet';
      animations.slideHeader(true, headerHeight);
    },
  };
};