/**
 * This file defines the layout for the `library` tab's nested stack navigator.
 * It configures the screens that are part of the library flow:
 *   - index:        Main library hub (Playlists · Albums · Artists · Songs · Downloads)
 *   - favorites:    Liked / saved songs
 *   - downloads:    Offline-downloaded tracks with progress
 *   - [playlistName]: Individual playlist detail, dynamically named
 */

import { Stack } from "expo-router";

/**
 * `LibraryStackLayout` component.
 * Configures the stack navigator for the library tab, hiding headers for all screens.
 */
export default function LibraryStackLayout() {
  return (
    <Stack>
      {/* Main library screen — Playlists / Albums / Artists / Songs / Downloads tabs */}
      <Stack.Screen name="index" options={{ headerShown: false }} />

      {/* Favourites screen — songs the user has hearted */}
      <Stack.Screen name="favorites" options={{ headerShown: false }} />

      {/* Downloads screen — offline tracks + active download progress */}
      <Stack.Screen name="downloads" options={{ headerShown: false }} />

      {/* Individual playlist detail screen, dynamically named by `playlistName` param */}
      <Stack.Screen
        name="[playlistName]"
        options={{ headerShown: false }}
      />
    </Stack>
  );
}