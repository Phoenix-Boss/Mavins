package expo.modules.autoeqengine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * AutoEQModule — stub entry point for the mavin-eq local module.
 *
 * The actual MavinPlayer native implementation lives in the mavin-engine module
 * (expo.modules.mavinplayer.MavinPlayerModule). This file exists solely to
 * satisfy the Expo autolinking requirement declared in expo-module.config.json.
 *
 * No functions are registered here — all JS calls go through MavinPlayerModule
 * via requireNativeModule("MavinPlayer") in MavinPlayerNative.ts.
 */
class AutoEQModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("AutoEQModule")
    }
}