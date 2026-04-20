// app/(tabs)/_layout.tsx  ← this file lives at: app/(tabs)/_layout.tsx
//
// TABS LAYOUT — defines the bottom tab navigator only.
//
// Rules:
//   - NO useFonts here — fonts are loaded once in app/_layout.tsx (root)
//   - NO providers here — all providers live in app/_layout.tsx (root)
//   - NO player setup here — already done in app/_layout.tsx (root)
//   - This file is purely structural: which tabs exist and how they look

import React from 'react';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveTrack } from 'react-native-track-player';

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — matches the rest of the app palette
// ─────────────────────────────────────────────────────────────────────────────

const GOLD   = '#D4AF37';
const DIM    = '#444444';
const BG     = '#000000';
const BORDER = 'rgba(212,175,55,0.15)';

// ─────────────────────────────────────────────────────────────────────────────
// TabsLayout
// ─────────────────────────────────────────────────────────────────────────────

export default function TabsLayout() {
  const insets     = useSafeAreaInsets();
  const activeTrack = useActiveTrack();

  // When the floating player is visible the tab bar needs extra bottom space
  // so content isn't hidden behind both the floating player and the tab bar.
  const floatingPlayerHeight = activeTrack ? 72 : 0;
  const tabBarHeight = 56 + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: GOLD,
        tabBarInactiveTintColor: DIM,
        tabBarStyle: {
          backgroundColor: BG,
          borderTopColor: BORDER,
          borderTopWidth: 0.5,
          height: tabBarHeight,
          paddingBottom: insets.bottom,
          paddingTop: 6,
          // Lift the tab bar above the floating player when music is playing
          marginBottom: floatingPlayerHeight,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.3,
          marginBottom: Platform.OS === 'android' ? 4 : 0,
        },
        tabBarIconStyle: {
          marginTop: 2,
        },
      }}
    >
      {/* ── Home ─────────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'home' : 'home-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />

      {/* ── Library ──────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'music-box-multiple' : 'music-box-multiple-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />

      {/* ── Settings ─────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'settings' : 'settings-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}