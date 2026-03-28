import { requireNativeModule } from "expo-modules-core";
import type { AutoEQNativeModule } from "./types";

const AutoEQNative = requireNativeModule("AutoEQModule");

console.log("[mavin-eq] AutoEQNative module loaded:", !!AutoEQNative);
console.log("[mavin-eq] Available methods:", Object.keys(AutoEQNative || {}).filter(k => typeof AutoEQNative[k] === "function"));

export default AutoEQNative as AutoEQNativeModule;