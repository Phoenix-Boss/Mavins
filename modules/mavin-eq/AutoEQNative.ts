import { requireNativeModule } from "expo-modules-core";
import type { AutoEQNativeModule } from "./types";

const AutoEQNative = requireNativeModule<AutoEQNativeModule>("AutoEQModule");

export default AutoEQNative;