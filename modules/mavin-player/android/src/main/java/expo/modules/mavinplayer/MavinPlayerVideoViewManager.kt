package expo.modules.mavinplayer

import android.view.SurfaceView
import android.view.ViewGroup
import android.widget.FrameLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

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
class MavinPlayerVideoView(context: android.content.Context, appContext: AppContext) :
    ExpoView(context, appContext) {

    private val moduleScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var surfaceView: SurfaceView? = null
    private var isSurfaceAttached = false

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
                android.util.Log.w("MavinPlayerVideoView", "ExoPlayer not available after waiting")
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
                        android.util.Log.d("MavinPlayerVideoView", "Surface created")
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
                        android.util.Log.d("MavinPlayerVideoView", "Surface changed: ${width}x${height}")
                    }

                    override fun surfaceDestroyed(holder: android.view.SurfaceHolder) {
                        android.util.Log.d("MavinPlayerVideoView", "Surface destroyed")
                        // Clear video surface but keep player playing audio-only
                        exoPlayer.clearVideoSurface()
                        isSurfaceAttached = false
                    }
                })
            }

            container.addView(surfaceView)
            android.util.Log.i("MavinPlayerVideoView", "Video surface attached to ExoPlayer")
        }
    }

    private fun detachSurface() {
        surfaceView?.let { view ->
            container.removeView(view)
            surfaceView = null
        }
        isSurfaceAttached = false
        android.util.Log.d("MavinPlayerVideoView", "Video surface detached")
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        detachSurface()
    }

    // Property setters for React Native props
    fun setContentFit(fit: String) {
        // Content fit mode - applied when surface is available
        // Values: "cover", "contain", "stretch"
        android.util.Log.d("MavinPlayerVideoView", "Content fit mode: $fit")
        // The actual ExoPlayer view scaling is handled by the SurfaceView layout
        // This property can be expanded to adjust layout parameters
    }

    fun setAllowsPictureInPicture(allows: Boolean) {
        android.util.Log.d("MavinPlayerVideoView", "Picture in picture allowed: $allows")
        // PiP is handled at the Activity level; this property informs the component
    }
}