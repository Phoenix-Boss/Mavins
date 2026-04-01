// mavin-player/index.ts
// This module exports the native player module
import { requireNativeModule } from 'expo-modules-core';

export const MavinPlayer = requireNativeModule('MavinPlayer');
export default MavinPlayer;