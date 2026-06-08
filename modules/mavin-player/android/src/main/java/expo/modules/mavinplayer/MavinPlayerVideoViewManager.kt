package expo.modules.mavinplayer

import android.content.Context
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

// ─── What changed from the previous version ───────────────────────────────────
//
// 1. Removed the separate MavinPlayerVideoViewManager companion class entirely.
//    The previous version tried to define a ViewManagerDefinition via a
//    companion class with a custom define() method. That API does not exist in
//    expo-modules-core. The correct pattern is:
//      - MavinPlayerVideoView extends ExpoView (this file, unchanged)
//      - MavinPlayerModule registers it via View(MavinPlayerVideoView::class) { ... }
//        with Prop() and Events() blocks inside the module definition DSL
//    The View() block in MavinPlayerModule.kt is the sole registration point.
//
// 2. Event dispatchers changed from private to internal.
//    The previous version declared onFirstFrameRender, onPictureInPictureStart,
//    and onPictureInPictureStop as private. The View() DSL in MavinPlayerModule
//    needs to reference them via the Events() block — which requires them to be
//    accessible. Internal visibility is the correct scope: accessible within the
//    same module (mavin-player), not exposed to outside modules.
//
// 3. All other logic is unchanged:
//    - SurfaceView attaches to the live ExoPlayer via MavinPlayerModule.getExoPlayerForSurface()
//    - Polls up to 20 times × 100ms waiting for ExoPlayer to be ready
//    - Detaches cleanly on onDetachedFromWindow() — audio continues, only video stops
//    - applyContentFit() adjusts layout for cover / contain / stretch
//    - setAllowsPictureInPicture() stores the flag (PiP handled at Activity level)
//
// ─────────────────────────────────────────────────────────────────────────────

private const val TAG = "MavinPlayerVideoView"

/**
 * MavinPlayerVideoView — native video surface component for NewPlayer.
 *
 * Attaches a SurfaceView to the existing NewPlayer ExoPlayer instance when mounted.
 * Provides NO UI controls — only video frame rendering. All controls (play/pause,
 * seek, speed) are handled by React Native custom UI via MavinPlayer JS methods.
 *
 * Registered with expo-modules-core via the View() block in MavinPlayerModule.
 *
 * Usage in React Native:
 *   <MavinPlayerVideoView
 *     style={{ flex: 1 }}
 *     contentFit="cover"
 *     allowsPictureInPicture={true}
 *     onFirstFrameRender={(e) => console.log('surface ready', e.surfaceReady)}
 *   />
 */
class MavinPlayerVideoView(context: Context, appContext: AppContext) :
    ExpoView(context, appContext) {

    private val moduleScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var surfaceView: SurfaceView? = null
    private var isSurfaceAttached = false
    private var contentFitMode: String = "cover"
    private var allowsPip: Boolean = true

    // ── Event dispatchers ─────────────────────────────────────────────────────
    //
    // Declared as internal so the View() DSL in MavinPlayerModule can reference
    // them in its Events() block. Previously private — caused build errors.

    internal val onFirstFrameRender by EventDispatcher()
    internal val onPictureInPictureStart by EventDispatcher()
    internal val onPictureInPictureStop by EventDispatcher()

    // ── Layout container ──────────────────────────────────────────────────────

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

    // ── Surface lifecycle ─────────────────────────────────────────────────────

    private fun attachSurface() {
        if (isSurfaceAttached) return

        moduleScope.launch {
            // Poll for ExoPlayer — it may not be ready immediately if loadAndPlay()
            // hasn't been called yet. 20 × 100ms = 2 seconds maximum wait.
            var attempts = 0
            var exoPlayer = MavinPlayerModule.getExoPlayerForSurface()
            while (exoPlayer == null && attempts < 20) {
                delay(100)
                exoPlayer = MavinPlayerModule.getExoPlayerForSurface()
                attempts++
            }

            if (exoPlayer == null) {
                android.util.Log.w(TAG, "ExoPlayer not available after ${attempts * 100}ms — " +
                    "surface attachment skipped")
                return@launch
            }

            surfaceView = SurfaceView(context).apply {
                layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                holder.addCallback(object : android.view.SurfaceHolder.Callback {
                    override fun surfaceCreated(holder: android.view.SurfaceHolder) {
                        android.util.Log.d(TAG, "Surface created — attaching to ExoPlayer")
                        exoPlayer.setVideoSurfaceHolder(holder)
                        isSurfaceAttached = true
                        // Notify JS that the surface is ready for video frames.
                        onFirstFrameRender(mapOf("surfaceReady" to true))
                    }

                    override fun surfaceChanged(
                        holder: android.view.SurfaceHolder,
                        format: Int,
                        width: Int,
                        height: Int
                    ) {
                        android.util.Log.d(TAG, "Surface changed: ${width}×${height}")
                        applyContentFit()
                    }

                    override fun surfaceDestroyed(holder: android.view.SurfaceHolder) {
                        android.util.Log.d(TAG, "Surface destroyed — clearing video surface")
                        // Clear video rendering but keep audio playing.
                        // ExoPlayer continues playing audio-only after this.
                        exoPlayer.clearVideoSurface()
                        isSurfaceAttached = false
                    }
                })
            }

            container.addView(surfaceView)
            android.util.Log.i(TAG, "Video surface attached to ExoPlayer successfully")
        }
    }

    private fun detachSurface() {
        surfaceView?.let { view ->
            container.removeView(view)
            surfaceView = null
        }
        isSurfaceAttached = false
        android.util.Log.d(TAG, "Video surface detached — audio-only continues")
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        detachSurface()
    }

    // ── Content fit ───────────────────────────────────────────────────────────

    private fun applyContentFit() {
        val view = surfaceView ?: return
        val lp = view.layoutParams as? FrameLayout.LayoutParams ?: return
        when (contentFitMode) {
            "contain" -> {
                lp.width  = ViewGroup.LayoutParams.WRAP_CONTENT
                lp.height = ViewGroup.LayoutParams.WRAP_CONTENT
            }
            // "cover" and "stretch" both fill the container.
            // True aspect-ratio-aware cover scaling requires a custom SurfaceView subclass
            // or AspectRatioFrameLayout — add later if needed.
            else -> {
                lp.width  = ViewGroup.LayoutParams.MATCH_PARENT
                lp.height = ViewGroup.LayoutParams.MATCH_PARENT
            }
        }
        view.layoutParams = lp
    }

    // ── React Native prop setters ─────────────────────────────────────────────
    //
    // Called by the Prop() blocks in MavinPlayerModule's View() DSL.

    fun setContentFit(fit: String) {
        contentFitMode = fit
        applyContentFit()
        android.util.Log.d(TAG, "contentFit set to: $fit")
    }

    fun setAllowsPictureInPicture(allows: Boolean) {
        allowsPip = allows
        android.util.Log.d(TAG, "allowsPictureInPicture set to: $allows")
        // PiP is handled at the Activity level via enterPictureInPictureMode().
        // This flag is stored here so the parent activity can query it if needed.
    }
}