// mavin-player/index.ts
// This module exports the native player module.
// All access from app code must go through libs/playerSetup.ts — never import
// this file directly in route/layout modules (breaks Fast Refresh).
import { requireNativeModule } from 'expo-modules-core';

export const MavinPlayer = requireNativeModule('MavinPlayer');
export default MavinPlayer;