// hooks/useScrollLogic.ts
import { useCallback } from 'react';
import { useGlobalUIState } from '@/contexts/GlobalUIStateContext';
import { useSharedValue, useAnimatedReaction } from 'react-native-reanimated';

interface ScrollLogicConfig {
  scrollThreshold?: number;
}

export const useScrollLogic = (config: ScrollLogicConfig = {}) => {
  const { isMusicPlaying, tabsVisible } = useGlobalUIState();
  
  const { scrollThreshold = 50 } = config;

  // ==================== SHARED VALUES ====================
  // Only need music state since tabs are fixed
  const isMusicPlayingValue = useSharedValue(isMusicPlaying);
  const tabsVisibleValue = useSharedValue(tabsVisible);

  // ==================== SYNC JS → NATIVE ====================
  useAnimatedReaction(
    () => isMusicPlaying,
    (playing) => {
      isMusicPlayingValue.value = playing;
    },
    [isMusicPlaying]
  );

  useAnimatedReaction(
    () => tabsVisible,
    (visible) => {
      tabsVisibleValue.value = visible;
    },
    [tabsVisible]
  );

  // ==================== RETURN VALUES ====================
  return {
    // ========== SHARED VALUES ==========
    isMusicPlayingValue,
    tabsVisibleValue,
    
    // ========== CONFIG VALUES ==========
    scrollThreshold,
    
    // ========== JS STATE ==========
    isMusicPlaying,
    tabsVisible,
  };
};
