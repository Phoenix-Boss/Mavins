// hooks/useScrollAnimations.ts
import { useSharedValue, withTiming, cancelAnimation, withSpring, withSequence } from 'react-native-reanimated';

interface AnimationConfig {
  duration?: number;
  springConfig?: {
    damping: number;
    stiffness: number;
  };
  useSpring?: boolean;
}

export const useScrollAnimations = (config: AnimationConfig = {}) => {
  const { 
    duration = 250, 
    useSpring = false,
    springConfig = { damping: 20, stiffness: 300 }
  } = config;

  // ==================== ANIMATION VALUES ====================
  const headerTranslateY = useSharedValue(0);
  const isHeaderHidden = useSharedValue(false);
  const isAnimating = useSharedValue(false);

  // ==================== WORKLET FUNCTIONS ====================
  // IMPORTANT: Must be plain named functions (not useCallback) so Reanimated
  // can correctly inline them as worklets when called from scroll handlers.

  function slideHeader(hide: boolean, headerHeight: number, animated: boolean = true) {
    'worklet';
    if (isAnimating.value) {
      cancelAnimation(headerTranslateY);
    }
    
    isAnimating.value = true;
    const targetValue = hide ? -headerHeight : 0;
    
    if (animated) {
      if (useSpring) {
        headerTranslateY.value = withSpring(targetValue, springConfig, () => {
          isAnimating.value = false;
        });
      } else {
        headerTranslateY.value = withTiming(targetValue, { duration }, () => {
          isAnimating.value = false;
        });
      }
    } else {
      headerTranslateY.value = targetValue;
      isAnimating.value = false;
    }
    
    isHeaderHidden.value = hide;
  }

  function resetHeader(animated: boolean = true) {
    'worklet';
    if (isAnimating.value) {
      cancelAnimation(headerTranslateY);
    }
    
    isAnimating.value = true;
    
    if (animated) {
      if (useSpring) {
        headerTranslateY.value = withSpring(0, springConfig, () => {
          isAnimating.value = false;
        });
      } else {
        headerTranslateY.value = withTiming(0, { duration }, () => {
          isAnimating.value = false;
        });
      }
    } else {
      headerTranslateY.value = 0;
      isAnimating.value = false;
    }
    
    isHeaderHidden.value = false;
  }

  function toggleHeader(headerHeight: number, animated: boolean = true) {
    'worklet';
    slideHeader(!isHeaderHidden.value, headerHeight, animated);
  }

  function bounceHeader(headerHeight: number) {
    'worklet';
    if (isAnimating.value) {
      cancelAnimation(headerTranslateY);
    }
    
    isAnimating.value = true;
    headerTranslateY.value = withSequence(
      withTiming(-headerHeight * 0.3, { duration: 100 }),
      withTiming(0, { duration: 200 }, () => {
        isAnimating.value = false;
      })
    );
    isHeaderHidden.value = false;
  }

  function hideHeaderImmediately(headerHeight: number) {
    'worklet';
    cancelAnimation(headerTranslateY);
    headerTranslateY.value = -headerHeight;
    isHeaderHidden.value = true;
    isAnimating.value = false;
  }

  function showHeaderImmediately() {
    'worklet';
    cancelAnimation(headerTranslateY);
    headerTranslateY.value = 0;
    isHeaderHidden.value = false;
    isAnimating.value = false;
  }

  // ==================== RETURN VALUES ====================
  return {
    // Animation controls
    slideHeader,
    resetHeader,
    toggleHeader,
    bounceHeader,
    hideHeaderImmediately,
    showHeaderImmediately,
    
    // Animation values
    headerTranslateY,
    isHeaderHidden,
    isAnimating,
    
    // Configuration
    animationDuration: duration,
    useSpring,
    springConfig,
  };
};
