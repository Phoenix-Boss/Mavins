package expo.modules.mavinplayer

import android.content.Context
import android.view.SurfaceView
import android.view.ViewGroup
import android.widget.FrameLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.views.ViewManagerDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val TAG = "MavinPlayerVideoViewManager"

/**
 * MavinPlayerVideoView - Native video surface component for NewPlayer.
 *
 * This component attaches a SurfaceView to the existing NewPlayer ExoPlayer instance.
 * It provides NO UI controls - only the video frames. All controls (play/pause, seek,
 * speed, etc.) are handled by React Native custom UI components via MavinPlayer methods.
 *
 * The video surface attaches when the component is mounted and detaches when unmounted.
 * The ExoPlayer continues playing audio-only when the surface is detached.
 *
 * Usage in React Native:
 *   <MavinPlayerVideoView
 *     style={{ flex: 1 }}
 *     contentFit="cover"
 *     allowsPictureInPicture={true}
 *   />
 */
class MavinPlayerVideoView(context: Context, appContext: AppContext) :
    ExpoView(context, appContext) {

    private val moduleScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var surfaceView: SurfaceView? = null
    private var isSurfaceAttached = false
    private var contentFitMode: String = "cover"
    private var allowsPip: Boolean = true

    // Event dispatchers for React Native callbacks
    private val onFirstFrameRender by EventDispatcher()
    private val onPictureInPictureStart by EventDispatcher()
    private val onPictureInPictureStop by EventDispatcher()

    // Container for the video surface
    private val container = FrameLayout(context).apply {
        layoutParams = LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
    }

    init {
        addView(container)
        attachSurface()
    }

    private fun attachSurface() {
        if (isSurfaceAttached) return

        moduleScope.launch {
            // Wait for ExoPlayer to be ready
            var attempts = 0
            var exoPlayer = MavinPlayerModule.getExoPlayerForSurface()
            while (exoPlayer == null && attempts < 20) {
                delay(100)
                exoPlayer = MavinPlayerModule.getExoPlayerForSurface()
                attempts++
            }

            if (exoPlayer == null) {
                android.util.Log.w(TAG, "ExoPlayer not available after waiting")
                return@launch
            }

            // Create and attach SurfaceView
            surfaceView = SurfaceView(context).apply {
                layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                holder.addCallback(object : android.view.SurfaceHolder.Callback {
                    override fun surfaceCreated(holder: android.view.SurfaceHolder) {
                        android.util.Log.d(TAG, "Surface created")
                        exoPlayer.setVideoSurfaceHolder(holder)
                        isSurfaceAttached = true
                        onFirstFrameRender(mapOf("surfaceReady" to true))
                    }

                    override fun surfaceChanged(
                        holder: android.view.SurfaceHolder,
                        format: Int,
                        width: Int,
                        height: Int
                    ) {
                        android.util.Log.d(TAG, "Surface changed: ${width}x${height}")
                        applyContentFit()
                    }

                    override fun surfaceDestroyed(holder: android.view.SurfaceHolder) {
                        android.util.Log.d(TAG, "Surface destroyed")
                        // Clear video surface but keep player playing audio-only
                        exoPlayer.clearVideoSurface()
                        isSurfaceAttached = false
                    }
                })
            }

            container.addView(surfaceView)
            android.util.Log.i(TAG, "Video surface attached to ExoPlayer")
        }
    }

    private fun detachSurface() {
        surfaceView?.let { view ->
            container.removeView(view)
            surfaceView = null
        }
        isSurfaceAttached = false
        android.util.Log.d(TAG, "Video surface detached")
    }

    private fun applyContentFit() {
        surfaceView?.let { view ->
            val layoutParams = view.layoutParams as? FrameLayout.LayoutParams
            if (layoutParams != null) {
                when (contentFitMode) {
                    "cover" -> {
                        layoutParams.width = ViewGroup.LayoutParams.MATCH_PARENT
                        layoutParams.height = ViewGroup.LayoutParams.MATCH_PARENT
                    }
                    "contain" -> {
                        layoutParams.width = ViewGroup.LayoutParams.WRAP_CONTENT
                        layoutParams.height = ViewGroup.LayoutParams.WRAP_CONTENT
                    }
                    "stretch" -> {
                        layoutParams.width = ViewGroup.LayoutParams.MATCH_PARENT
                        layoutParams.height = ViewGroup.LayoutParams.MATCH_PARENT
                    }
                }
                view.layoutParams = layoutParams
            }
        }
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        detachSurface()
    }

    // Property setters for React Native props
    fun setContentFit(fit: String) {
        contentFitMode = fit
        applyContentFit()
        android.util.Log.d(TAG, "Content fit mode: $fit")
    }

    fun setAllowsPictureInPicture(allows: Boolean) {
        allowsPip = allows
        android.util.Log.d(TAG, "Picture in picture allowed: $allows")
    }
}

/**
 * ViewManager for MavinPlayerVideoView - registers the native component with expo-modules-core.
 * This class must be referenced in MavinPlayerModule.kt's View() block.
 */
class MavinPlayerVideoViewManager {
    companion object {
        fun define(): ViewManagerDefinition {
            return ViewManagerDefinition(
                viewFactory = { context, appContext ->
                    MavinPlayerVideoView(context, appContext)
                },
                props = mapOf(
                    "contentFit" to { view: MavinPlayerVideoView, value: String ->
                        view.setContentFit(value)
                    },
                    "allowsPictureInPicture" to { view: MavinPlayerVideoView, value: Boolean ->
                        view.setAllowsPictureInPicture(value)
                    }
                ),
                events = mapOf(
                    "onFirstFrameRender" to { view: MavinPlayerVideoView ->
                        view.onFirstFrameRender
                    },
                    "onPictureInPictureStart" to { view: MavinPlayerVideoView ->
                        view.onPictureInPictureStart
                    },
                    "onPictureInPictureStop" to { view: MavinPlayerVideoView ->
                        view.onPictureInPictureStop
                    }
                )
            )
        }
    }
}