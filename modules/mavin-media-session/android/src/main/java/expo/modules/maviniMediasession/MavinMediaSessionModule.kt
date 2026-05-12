// modules/mavin-media-session/android/src/main/kotlin/expo/modules/maviniMediasession/MavinMediaSessionModule.kt
//
// CHANGES vs original:
//  • metadata.getDouble("duration") → metadata.getLong("duration") so
//    millisecond values don't lose precision through Double.
//  • setMetadata uses AsyncFunction so Glide can be called off the main thread.
//  • setPlaybackState / updatePosition kept as synchronous Function (they
//    don't do I/O so AsyncFunction is not needed).
//  • DeviceEventManagerModule.RCTDeviceEventEmitter emitting is preserved —
//    the JS index.ts still subscribes to those events via NativeEventEmitter.

package expo.modules.maviniMediasession

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.os.Bundle
import com.facebook.react.modules.core.DeviceEventManagerModule

class MavinMediaSessionModule : Module() {
  private var mediaSessionManager: MediaSessionManager? = null

  override fun definition() = ModuleDefinition {
    Name("MavinMediaSession")

    // ── Lifecycle ────────────────────────────────────────────────────────────

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      mediaSessionManager = MediaSessionManager(context) { event, data ->
        // Forward native callbacks back to JS via RCTDeviceEventEmitter.
        // The JS-side NativeEventEmitter listens on these exact event names.
        appContext.reactContext
          ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          ?.emit(event, data?.let { bundleToWritableMap(it) })
      }
    }

    OnDestroy {
      mediaSessionManager?.release()
      mediaSessionManager = null
    }

    // ── Functions ────────────────────────────────────────────────────────────

    // AsyncFunction so Glide (called inside setMetadata for artwork) runs on
    // a background thread and doesn't block the JS thread.
    AsyncFunction("setMetadata") { metadata: Map<String, Any?> ->
      val title      = metadata["title"]      as? String ?: ""
      val artist     = metadata["artist"]     as? String ?: ""
      val album      = metadata["album"]      as? String
      val artworkUrl = metadata["artworkUrl"] as? String
      val trackId    = metadata["trackId"]    as? String ?: ""
      // duration arrives as Double from JS (React Native bridge) — convert to
      // Long millis without going through intermediate float imprecision.
      val duration   = when (val d = metadata["duration"]) {
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

  private fun bundleToWritableMap(bundle: Bundle): com.facebook.react.bridge.WritableMap {
    val map = com.facebook.react.bridge.Arguments.createMap()
    bundle.keySet().forEach { key ->
      when (val value = bundle.get(key)) {
        is Long    -> map.putDouble(key, value.toDouble()) // JS only has number
        is Int     -> map.putInt(key, value)
        is Boolean -> map.putBoolean(key, value)
        is String  -> map.putString(key, value)
        is Double  -> map.putDouble(key, value)
        else       -> map.putNull(key)
      }
    }
    return map
  }
}