// app/(player)/_layout.tsx
//
// SPOTIFY-STYLE TRANSPARENT OVERLAY — compositor chain:
//
//  app/_layout.tsx → Stack.Screen name="(player)"
//    presentation:  'transparentModal'  ← keeps (tabs) rendered & visible behind
//    animation:     'none'              ← no React Navigation compositor involvement
//    contentStyle:  { backgroundColor: 'transparent' }
//
//  This inner NativeStack must ALSO be fully transparent — any backgroundColor
//  here adds an opaque compositor layer visible during swipe-down.
//
//  IMPORTANT: `cardStyle` does NOT exist on NativeStackNavigationOptions.
//  Expo Router uses NativeStack by default. Only `contentStyle` is valid.
//  The ONLY visual fill is PlayerContent's LinearGradient.

import { Stack } from 'expo-router';

export default function PlayerLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'none',
        gestureEnabled: false,
        contentStyle: { backgroundColor: 'transparent' },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          headerShown: false,
          animation: 'none',
          gestureEnabled: false,
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
    </Stack>
  );
}