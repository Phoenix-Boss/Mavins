// modules/mavin-media-session/android/src/main/kotlin/expo/modules/maviniMediasession/MavinMediaSessionModule.kt
//
// Rewrites:
//  • Replaced DeviceEventManagerModule (React Native bridge) with Expo Modules
//    Core sendEvent() — the correct pattern for Expo native modules.
//  • Events are declared via Events("name1", "name2", ...) in the definition.
//  • Metadata duration coerced safely from any numeric JS type.
//  • AsyncFunction for setMetadata (Glide runs off JS thread).
//  • No more bridge / reactContext / WritableMap needed.

package expo.modules.maviniMediasession

import android.os.Bundle
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MavinMediaSessionModule : Module() {
  private var mediaSessionManager: MediaSessionManager? = null

  override fun definition() = ModuleDefinition {
    Name("MavinMediaSession")

    // ── Events sent to JS ────────────────────────────────────────────────────
    // JS side subscribes with: module.addListener("onPlay") etc.
    Events(
      "onPlay",
      "onPause",
      "onStop",
      "onSkipToNext",
      "onSkipToPrevious",
      "onSeekTo",
    )

    // ── Lifecycle ────────────────────────────────────────────────────────────

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      mediaSessionManager = MediaSessionManager(context) { event, data ->
        // sendEvent is the Expo Modules Core way — no bridge needed.
        val payload: Map<String, Any?> = if (data != null) bundleToMap(data) else emptyMap()
        sendEvent(event, payload)
      }
    }

    OnDestroy {
      mediaSessionManager?.release()
      mediaSessionManager = null
    }

    // ── Functions ────────────────────────────────────────────────────────────

    // AsyncFunction so Glide artwork loading runs off the JS thread.
    AsyncFunction("setMetadata") { metadata: Map<String, Any?> ->
      val title      = metadata["title"]      as? String ?: ""
      val artist     = metadata["artist"]     as? String ?: ""
      val album      = metadata["album"]      as? String
      val artworkUrl = metadata["artworkUrl"] as? String
      val trackId    = metadata["trackId"]    as? String ?: ""
      // JS bridge always sends numbers as Double; guard against Int/Long too.
      val duration: Long = when (val d = metadata["duration"]) {
        is Double -> d.toLong()
        is Long   -> d
        is Int    -> d.toLong()
        else      -> 0L
      }
      mediaSessionManager?.setMetadata(title, artist, album, artworkUrl, duration, trackId)
    }

    Function("setPlaybackState") { state: String, position: Double, speed: Double ->
      mediaSessionManager?.setPlaybackState(state, position.toLong(), speed.toFloat())
    }

    Function("updatePosition") { position: Double, duration: Double ->
      mediaSessionManager?.updatePosition(position.toLong(), duration.toLong())
    }

    Function("setHeadlessPlayback") { enabled: Boolean ->
      mediaSessionManager?.setHeadlessEnabled(enabled)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Convert a flat Bundle into a plain Map that sendEvent() can serialise. */
  private fun bundleToMap(bundle: Bundle): Map<String, Any?> =
    bundle.keySet().associateWith { key ->
      when (val v = bundle.get(key)) {
        is Long    -> v.toDouble() // JS has no Long; use Double
        is Int     -> v
        is Boolean -> v
        is String  -> v
        is Double  -> v
        is Float   -> v.toDouble()
        else       -> null
      }
    }
}