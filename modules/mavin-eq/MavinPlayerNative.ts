// mavin-eq/MavinPlayerNative.ts

import { requireNativeModule } from "expo-modules-core";
import type { MavinPlayerNativeModule } from "./types";

const MavinPlayerNative = requireNativeModule("MavinPlayer");

console.log("[mavin-eq] MavinPlayerNative module loaded:", !!MavinPlayerNative);
console.log("[mavin-eq] Available methods:", Object.keys(MavinPlayerNative || {}).filter(k => typeof MavinPlayerNative[k] === "function"));

export default MavinPlayerNative as MavinPlayerNativeModule;