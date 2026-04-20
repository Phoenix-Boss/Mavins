// app/(player)/index.tsx
//
// Pure shell — just mounts PlayerScreen. No Stack.Screen options override
// needed here because _layout.tsx already sets everything correctly for the
// entire (player) group. Adding duplicate options here can cause React Navigation
// to re-apply them mid-animation and produce a flash.

import PlayerScreen from '@/components/player/PlayerScreen';

export default function PlayerPage() {
  return <PlayerScreen />;
}