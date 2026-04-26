package com.doublesymmetry.trackplayer

import android.os.PowerManager
import androidx.annotation.MainThread
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/**
 * Drop-in replacement for the old HeadlessJsMediaService.
 * Extends MediaLibraryService (which is what MusicService actually needs)
 * and provides reactContext, acquireWakeLockNow, sWakeLock, and
 * headless-task lifecycle helpers that MusicService calls.
 */
@UnstableApi
abstract class HeadlessJsMediaService : MediaLibraryService() {

    // ── React context ─────────────────────────────────────────────────────
    val reactContext: ReactContext?
        get() = try {
            (application as? ReactApplication)
                ?.reactHost
                ?.currentReactContext
        } catch (e: Exception) {
            null
        }

    // ── Wake lock ─────────────────────────────────────────────────────────
    companion object {
        @JvmField
        var sWakeLock: PowerManager.WakeLock? = null

        @JvmStatic
        fun acquireWakeLockNow(service: HeadlessJsMediaService) {
            if (sWakeLock == null || sWakeLock?.isHeld == false) {
                val pm = service.getSystemService(POWER_SERVICE) as PowerManager
                sWakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "MavinPlayer::WakeLock"
                ).also { it.acquire(10 * 60 * 1000L) }
            }
        }
    }

    // ── Headless task lifecycle ───────────────────────────────────────────
    open fun getTaskConfig(intent: android.content.Intent?): HeadlessJsTaskConfig? = null

    open fun onHeadlessJsTaskFinish(taskId: Int) {}

    override fun onStartCommand(
        intent: android.content.Intent?,
        flags: Int,
        startId: Int
    ): Int {
        val config = getTaskConfig(intent)
        if (config != null) {
            startTask(config)
        }
        return START_STICKY
    }

    private fun startTask(config: HeadlessJsTaskConfig) {
        val reactCtx = reactContext ?: return
        val taskContext = HeadlessJsTaskContext.getInstance(reactCtx)
        taskContext.addTaskEventListener(object :
            HeadlessJsTaskContext.HeadlessJsTaskEventListener {
            override fun onHeadlessJsTaskStart(taskId: Int) {}
            override fun onHeadlessJsTaskFinish(taskId: Int) {
                taskContext.removeTaskEventListener(this)
                this@HeadlessJsMediaService.onHeadlessJsTaskFinish(taskId)
            }
        })
        taskContext.startTask(config)
    }

    // ── Notification (required by MediaLibraryService) ────────────────────
    override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) {
        super.onUpdateNotification(session, startInForegroundRequired)
    }
}
