// hooks/useScrollAnimations.ts
import { useSharedValue, withTiming, cancelAnimation } from 'react-native-reanimated';

interface AnimationConfig {
  duration?: number;
}

export const useScrollAnimations = (config: AnimationConfig = {}) => {
  const { duration = 250 } = config;

  // ==================== ANIMATION VALUES ====================
  const headerTranslateY = useSharedValue(0);
  const isHeaderHidden = useSharedValue(false);

  // ==================== WORKLET FUNCTIONS ====================
  // IMPORTANT: Must be plain named functions (not useCallback) so Reanimated
  // can correctly inline them as worklets when called from scroll handlers.
  // Using useCallback with 'worklet' directive causes the directive to be
  // ignored, making these run on the JS thread and causing silent crashes.

  function slideHeader(hide: boolean, headerHeight: number) {
    'worklet';
    cancelAnimation(headerTranslateY);
    headerTranslateY.value = withTiming(hide ? -headerHeight : 0, { duration });
    isHeaderHidden.value = hide;
  }

  function resetHeader() {
    'worklet';
    cancelAnimation(headerTranslateY);
    headerTranslateY.value = withTiming(0, { duration });
    isHeaderHidden.value = false;
  }

  // ==================== RETURN VALUES ====================
  return {
    slideHeader,
    resetHeader,
    headerTranslateY,
    isHeaderHidden,
    animationDuration: duration,
  };
};