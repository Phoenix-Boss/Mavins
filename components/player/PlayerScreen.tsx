// components/player/PlayerScreen.tsx
/**
 * PlayerScreen — Route entry point for the player
 *
 * This screen is a thin shell. It does NOT own the player UI — that lives in
 * PlayerContent (pre-mounted by PlayerProvider).
 */

import React, { useCallback } from "react";
import { useRouter } from "expo-router";

import PlayerContent from "./playerContent";

export default function PlayerScreen() {
  const router = useRouter();

  const handleDismiss = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  return (
    <PlayerContent
      onMinimize={handleDismiss}
      onClose={handleDismiss}
      isExpanded={true}
    />
  );
}