// libs/playerSetup.ts
//
// Thin ready-state module.
//
// Audio.setAudioModeAsync is called ONLY in _layout.tsx (initPlayer).
// This module exists so any code that needs to check "is the player ready?"
// has a single place to ask — without duplicating audio setup logic.
//
// DO NOT call Audio.setAudioModeAsync here. _layout.tsx owns that.

let _isReady = false;

/** Called by _layout.tsx after Audio.setAudioModeAsync succeeds. */
export function markPlayerReady(): void {
  _isReady = true;
}

/** Called by _layout.tsx on hard reset or unmount (rare). */
export function markPlayerNotReady(): void {
  _isReady = false;
}

/** Returns true once _layout.tsx has finished audio session setup. */
export function isPlayerReady(): boolean {
  return _isReady;
}