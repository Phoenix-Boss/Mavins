// app/(modals)/_layout.tsx
//
// Dedicated layout for all bottom-sheet modals.
// Registered as a group in the root _layout.tsx under the name "(modals)".
//
// Every screen here:
//   • has headerShown: false (handled per-screen or via screenOptions)
//   • slides up as a transparent modal so the dimmed backdrop shows through
//   • can be dismissed by swiping down or tapping the backdrop

import { Stack } from "expo-router";

export default function ModalsLayout() {
  return (
    <Stack
      screenOptions={{
        // ── No native header on any modal ──────────────────────────────────
        headerShown: false,

        // ── Present as a bottom sheet over the current screen ──────────────
        presentation: "transparentModal",
        animation: "slide_from_bottom",
        contentStyle: { backgroundColor: "transparent" },
      }}
    >
      <Stack.Screen name="addToPlaylist" />
      <Stack.Screen name="comments" />
      <Stack.Screen name="createPlaylist" />
      <Stack.Screen name="deletePlaylist" />
      <Stack.Screen name="equalizer" />
      <Stack.Screen name="lyrics" />
      <Stack.Screen name="menu" />
      <Stack.Screen name="premium" />
      <Stack.Screen name="queue" />
      <Stack.Screen name="related" />
    </Stack>
  );
}