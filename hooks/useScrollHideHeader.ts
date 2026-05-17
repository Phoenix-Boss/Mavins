// @/hooks/useScrollHideHeader.ts

import { useCallback } from 'react';
import {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  useAnimatedScrollHandler,
  withTiming,
  runOnJS,
  useAnimatedReaction,
  cancelAnimation,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface UseScrollHideHeaderConfig {
  headerHeight?: number;
  scrollThreshold?: number;
  animationDuration?: number;
  onHeaderVisibilityChange?: (isHidden: boolean) => void;
}

/**
 * ENTERPRISE-GRADE Custom hook for scroll-driven header hiding.
 * 
 * Features:
 * - Smooth 60fps hide/show on scroll direction
 * - UI-thread animation (Reanimated) - zero JS jank
 * - Direction-based triggers (not just scroll position)
 * - Header slides immediately on scroll intent
 * - Memory-efficient shared values
 * - Optional visibility change callbacks
 * 
 * Usage:
 * const { headerStyle, scrollHandler } = useScrollHideHeader({
 *   headerHeight: 80,
 *   onHeaderVisibilityChange: (hidden) => console.log('Header hidden:', hidden)
 * });
 * 
 * <Animated.View style={[styles.header, headerStyle]} />
 * <Animated.ScrollView 
 *   onScroll={scrollHandler} 
 *   scrollEventThrottle={1}
 * />
 */
export const useScrollHideHeader = (config: UseScrollHideHeaderConfig = {}) => {
  const { top } = useSafeAreaInsets();
  
  // Configuration with defaults
  const {
    headerHeight = 80,
    scrollThreshold = 50,
    animationDuration = 250,
    onHeaderVisibilityChange,
  } = config;

  // ==================== NATIVE SHARED VALUES ====================
  // All animation logic lives here - ZERO JS during scroll
  
  const scrollY = useSharedValue(0);
  const lastScrollY = useSharedValue(0);
  const headerTranslateY = useSharedValue(0);
  const isHeaderHidden = useSharedValue(false);
  const lastDirection = useSharedValue<'up' | 'down' | null>(null);
  
  // ==================== JS CALLBACKS ====================
  const handleHeaderVisibilityChange = useCallback((hidden: boolean) => {
    if (onHeaderVisibilityChange) {
      onHeaderVisibilityChange(hidden);
    }
  }, [onHeaderVisibilityChange]);

  // ==================== NATIVE ANIMATION WORKLETS ====================
  const animateHeader = useCallback((hide: boolean) => {
    'worklet';
    
    // Cancel any ongoing animation
    cancelAnimation(headerTranslateY);
    
    // Animate with smooth timing
    const targetY = hide ? -(headerHeight + top) : 0;
    
    headerTranslateY.value = withTiming(
      targetY,
      { duration: animationDuration }
    );
    
    // Update hidden state
    isHeaderHidden.value = hide;
    
    // Notify JS if callback exists
    if (handleHeaderVisibilityChange) {
      runOnJS(handleHeaderVisibilityChange)(hide);
    }
  }, [headerHeight, top, animationDuration]);

  // ==================== SCROLL HANDLER ====================
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      
      const currentY = event.contentOffset.y;
      const diff = currentY - lastScrollY.value;
      
      // Update tracking
      scrollY.value = currentY;
      lastScrollY.value = currentY;
      
      // Only process significant movement
      if (Math.abs(diff) < scrollThreshold) {
        return;
      }
      
      // Determine direction
      const direction = diff > 0 ? 'down' : 'up';
      
      // Prevent repeat triggers
      if (lastDirection.value === direction) {
        return;
      }
      lastDirection.value = direction;
      
      // ============ HEADER LOGIC ============
      // Hide on scroll down, show on scroll up
      if (direction === 'down' && !isHeaderHidden.value) {
        animateHeader(true);
      } else if (direction === 'up' && isHeaderHidden.value) {
        animateHeader(false);
      }
    },
    
    onBeginDrag: () => {
      'worklet';
      // Reset direction tracking on new gesture
      lastDirection.value = null;
    },
    
    onEndDrag: () => {
      'worklet';
      // Optional: Add momentum or snap logic here
    },
  });

  // ==================== ANIMATED STYLES ====================
  const headerStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: headerTranslateY.value }],
    };
  }, [headerHeight, top]);

  // ==================== ADDITIONAL FEATURES ====================
  // Optional: Manually show/hide header
  
  const showHeader = useCallback(() => {
    'worklet';
    animateHeader(false);
  }, [animateHeader]);

  const hideHeader = useCallback(() => {
    'worklet';
    animateHeader(true);
  }, [animateHeader]);

  const toggleHeader = useCallback(() => {
    'worklet';
    animateHeader(!isHeaderHidden.value);
  }, [animateHeader, isHeaderHidden.value]);

  // ==================== RETURN VALUES ====================
  return {
    // Primary values
    headerStyle,     // Apply to your Animated.View header
    scrollHandler,   // Pass to Animated.ScrollView onScroll
    
    // Animation values
    scrollY,         // Current scroll position (shared value)
    headerTranslateY, // Current header translateY (shared value)
    isHeaderHidden,  // Boolean if header is hidden (shared value)
    
    // Manual controls (worklet functions)
    showHeader,
    hideHeader,
    toggleHeader,
    
    // Configuration info
    config: {
      headerHeight,
      scrollThreshold,
      animationDuration,
      safeAreaTop: top,
    },
  };
};
