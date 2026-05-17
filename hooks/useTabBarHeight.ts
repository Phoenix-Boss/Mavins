// hooks/useTabBarHeight.ts
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform } from 'react-native';

export const useTabBarHeight = () => {
  const insets = useSafeAreaInsets();
  
  // Tab bar height from (player)/_layout.tsx
  const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 65 : 55;
  const BOTTOM_PADDING = Platform.OS === 'ios' ? 25 : 8;
  
  return {
    tabBarHeight: TAB_BAR_HEIGHT,
    bottomPadding: BOTTOM_PADDING,
    // Add gap for shadow visibility (mini player pops out from above tab bar)
    totalHeight: TAB_BAR_HEIGHT + 12, // 12px gap for shadow to be visible
    // For positioning elements above tab bar with shadow
    shadowOffset: Platform.OS === 'ios' ? -6 : -4,
    shadowRadius: Platform.OS === 'ios' ? 12 : 10,
    shadowOpacity: 0.25,
  };
};
