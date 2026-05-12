// app/(player)/_layout.tsx
//
// PLAYER ROUTE GROUP LAYOUT
//
// This layout wraps ALL screens within the (player) route group.
// This is effectively the main app layout for authenticated/player-enabled screens.
//
// Screens in this group:
//   - index.tsx (Home screen with integrated player overlay)
//   - library/ (User's music library - has its own nested layout)
//   - search/ (Search and discovery - has its own nested layout)
//   - settings.tsx (App settings and preferences)
//
// ARCHITECTURE NOTE:
//   The global player overlay (mini/expanded) is provided by PlayerOverlayProvider
//   in the root _layout.tsx. This layout does NOT create its own player components.
//   Instead, it provides a container for screen content while the global overlay
//   handles all player UI rendering.
//
//   This separation ensures the player overlay persists across ALL screens in this group:
//   home, library, search, and settings - maintaining playback continuity everywhere.
//
//   Library and search have their own nested layouts for internal navigation.
//   Settings is a single screen with no nested navigation.

import { Stack } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

export default function PlayerLayout() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#000000' },
          navigationBarColor: '#000000',
          statusBarStyle: 'light',
          statusBarTranslucent: true,
          statusBarBackgroundColor: 'transparent',
        }}
      >
        {/* Home screen - main view with integrated player overlay */}
        <Stack.Screen 
          name="index" 
          options={{
            title: 'Home',
          }}
        />
        
        {/* Library folder - contains its own nested Stack navigator */}
        <Stack.Screen 
          name="library" 
          options={{
            title: 'Library',
          }}
        />
        
        {/* Search folder - contains its own nested Stack navigator */}
        <Stack.Screen 
          name="search" 
          options={{
            title: 'Search',
          }}
        />
        
        {/* Settings screen - single screen, no nested navigation */}
        <Stack.Screen 
          name="settings" 
          options={{
            title: 'Settings',
            animation: 'slide_from_right',
          }}
        />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
});