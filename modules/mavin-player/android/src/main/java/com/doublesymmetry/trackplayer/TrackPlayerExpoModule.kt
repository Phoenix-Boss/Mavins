package com.doublesymmetry.trackplayer

import com.doublesymmetry.trackplayer.module.MusicModule
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import expo.modules.kotlin.Promise as ExpoPromise
import com.facebook.react.bridge.Promise as RNPromise
import com.facebook.react.bridge.WritableMap

class TrackPlayerExpoModule : Module() {

  private val reactContext: ReactApplicationContext
    get() = appContext.reactContext as ReactApplicationContext

  private val musicModule: MusicModule by lazy {
    MusicModule(reactContext).also { it.initialize() }
  }

  override fun definition() = ModuleDefinition {
    Name("TrackPlayer")

    // ── Player setup ──────────────────────────────────────────────────
    AsyncFunction("setupPlayer") { options: Map<String, Any?>?, promise: ExpoPromise ->
      val map = options?.let { Arguments.makeNativeMap(it as Map<String, Any>) }
      musicModule.setupPlayer(map, promise.toRN())
    }

    AsyncFunction("updateOptions") { options: Map<String, Any?>?, promise: ExpoPromise ->
      val map = options?.let { Arguments.makeNativeMap(it as Map<String, Any>) }
      musicModule.updateOptions(map, promise.toRN())
    }

    // ── Queue management ──────────────────────────────────────────────
    AsyncFunction("add") { tracks: List<Map<String, Any?>>, insertBeforeIndex: Int?, promise: ExpoPromise ->
      val array = Arguments.makeNativeArray(tracks as List<Any>)
      musicModule.add(array, insertBeforeIndex?.toDouble(), promise.toRN())
    }

    AsyncFunction("load") { track: Map<String, Any?>, promise: ExpoPromise ->
      val map = Arguments.makeNativeMap(track as Map<String, Any>)
      musicModule.load(map, promise.toRN())
    }

    AsyncFunction("move") { fromIndex: Int, toIndex: Int, promise: ExpoPromise ->
      musicModule.move(fromIndex.toDouble(), toIndex.toDouble(), promise.toRN())
    }

    AsyncFunction("remove") { indexes: List<Int>, promise: ExpoPromise ->
      val array = Arguments.makeNativeArray(indexes as List<Any>)
      musicModule.remove(array, promise.toRN())
    }

    AsyncFunction("removeUpcomingTracks") { promise: ExpoPromise ->
      musicModule.removeUpcomingTracks(promise.toRN())
    }

    AsyncFunction("setQueue") { tracks: List<Map<String, Any?>>, promise: ExpoPromise ->
      val array = Arguments.makeNativeArray(tracks as List<Any>)
      musicModule.setQueue(array, promise.toRN())
    }

    AsyncFunction("getQueue") { promise: ExpoPromise ->
      musicModule.getQueue(promise.toRN())
    }

    AsyncFunction("getTrack") { index: Int, promise: ExpoPromise ->
      musicModule.getTrack(index.toDouble(), promise.toRN())
    }

    AsyncFunction("getActiveTrack") { promise: ExpoPromise ->
      musicModule.getActiveTrack(promise.toRN())
    }

    AsyncFunction("getActiveTrackIndex") { promise: ExpoPromise ->
      musicModule.getActiveTrackIndex(promise.toRN())
    }

    AsyncFunction("updateMetadataForTrack") { index: Int, metadata: Map<String, Any?>, promise: ExpoPromise ->
      val map = Arguments.makeNativeMap(metadata as Map<String, Any>)
      musicModule.updateMetadataForTrack(index.toDouble(), map, promise.toRN())
    }

    AsyncFunction("updateNowPlayingMetadata") { metadata: Map<String, Any?>, promise: ExpoPromise ->
      val map = Arguments.makeNativeMap(metadata as Map<String, Any>)
      musicModule.updateNowPlayingMetadata(map, promise.toRN())
    }

    // ── Playback controls ─────────────────────────────────────────────
    AsyncFunction("play") { promise: ExpoPromise ->
      musicModule.play(promise.toRN())
    }

    AsyncFunction("pause") { promise: ExpoPromise ->
      musicModule.pause(promise.toRN())
    }

    AsyncFunction("stop") { promise: ExpoPromise ->
      musicModule.stop(promise.toRN())
    }

    AsyncFunction("reset") { promise: ExpoPromise ->
      musicModule.reset(promise.toRN())
    }

    AsyncFunction("retry") { promise: ExpoPromise ->
      musicModule.retry(promise.toRN())
    }

    AsyncFunction("seekTo") { position: Double, promise: ExpoPromise ->
      musicModule.seekTo(position, promise.toRN())
    }

    AsyncFunction("seekBy") { offset: Double, promise: ExpoPromise ->
      musicModule.seekBy(offset, promise.toRN())
    }

    AsyncFunction("skip") { index: Int, initialPosition: Double?, promise: ExpoPromise ->
      musicModule.skip(index.toDouble(), initialPosition, promise.toRN())
    }

    AsyncFunction("skipToNext") { initialPosition: Double?, promise: ExpoPromise ->
      musicModule.skipToNext(initialPosition, promise.toRN())
    }

    AsyncFunction("skipToPrevious") { initialPosition: Double?, promise: ExpoPromise ->
      musicModule.skipToPrevious(initialPosition, promise.toRN())
    }

    // ── State & progress ──────────────────────────────────────────────
    AsyncFunction("getProgress") { promise: ExpoPromise ->
      musicModule.getProgress(promise.toRN())
    }

    AsyncFunction("getPlaybackState") { promise: ExpoPromise ->
      musicModule.getPlaybackState(promise.toRN())
    }

    // ── Volume / Rate / Repeat ────────────────────────────────────────
    AsyncFunction("setVolume") { level: Double, promise: ExpoPromise ->
      musicModule.setVolume(level, promise.toRN())
    }

    AsyncFunction("getVolume") { promise: ExpoPromise ->
      musicModule.getVolume(promise.toRN())
    }

    AsyncFunction("setRate") { rate: Double, promise: ExpoPromise ->
      musicModule.setRate(rate, promise.toRN())
    }

    AsyncFunction("getRate") { promise: ExpoPromise ->
      musicModule.getRate(promise.toRN())
    }

    AsyncFunction("setRepeatMode") { mode: Int, promise: ExpoPromise ->
      musicModule.setRepeatMode(mode.toDouble(), promise.toRN())
    }

    AsyncFunction("getRepeatMode") { promise: ExpoPromise ->
      musicModule.getRepeatMode(promise.toRN())
    }

    AsyncFunction("setPlayWhenReady") { playWhenReady: Boolean, promise: ExpoPromise ->
      musicModule.setPlayWhenReady(playWhenReady, promise.toRN())
    }

    AsyncFunction("getPlayWhenReady") { promise: ExpoPromise ->
      musicModule.getPlayWhenReady(promise.toRN())
    }

    // ── Wake lock ─────────────────────────────────────────────────────
    AsyncFunction("acquireWakeLock") { promise: ExpoPromise ->
      musicModule.acquireWakeLock(promise.toRN())
    }

    AsyncFunction("abandonWakeLock") { promise: ExpoPromise ->
      musicModule.abandonWakeLock(promise.toRN())
    }

    AsyncFunction("validateOnStartCommandIntent") { promise: ExpoPromise ->
      musicModule.validateOnStartCommandIntent(promise.toRN())
    }

    // ── Event listeners (no-op, events flow via RN event emitter) ─────
    Function("addListener") { _: String -> }
    Function("removeListeners") { _: Int -> }

    // ── Constants ─────────────────────────────────────────────────────
    Constants {
      musicModule.getTypedExportedConstants()
    }
  }
}

// Converts an Expo promise to the RN Promise interface MusicModule expects
private fun ExpoPromise.toRN(): RNPromise = object : RNPromise {
  override fun resolve(value: Any?) = this@toRN.resolve(value)
  override fun reject(code: String, message: String?, e: Throwable?) =
    this@toRN.reject(code, message ?: "", e)
  override fun reject(code: String, e: Throwable?) =
    this@toRN.reject(code, e?.message ?: "", e)
  override fun reject(code: String, message: String?) =
    this@toRN.reject(code, message ?: "", null)
  override fun reject(e: Throwable?) =
    this@toRN.reject("error", e?.message ?: "", e)
  override fun reject(
    code: String, message: String?,
    userInfo: WritableMap?, e: Throwable?
  ) = this@toRN.reject(code, message ?: "", e)
}