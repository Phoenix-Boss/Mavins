package expo.modules.autoeqengine

import expo.modules.kotlin.Package

/**
 * AutoEQPackage
 *
 * Registers AutoEQModule with Expo's module system.
 * Expo's auto-discovery will find this via the expo-module.config.json.
 */
class AutoEQPackage : Package {
  override fun createModules() = listOf(AutoEQModule())
}
