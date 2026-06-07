package expo.modules.mavin.pawns

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.pawns.sdk.common.sdk.Pawns

// ─── What changed from the original ──────────────────────────────────────────
//
// 1. Removed Pawns.Builder call entirely.
//    Application.onCreate() always runs before any BroadcastReceiver in the
//    same process, so the SDK singleton is already built and configured by the
//    time onReceive() is called. Rebuilding it here was redundant and
//    potentially reset internal SDK state.
//
// 2. Removed ensureChannel() call.
//    The module manifest meta-data tag delegates channel ownership to the SDK.
//
// 3. Removed all ServiceConfig / ServiceType / icon / title / body resolution.
//    All of that now lives solely in MainApplication.initPawns().
//
// 4. The receiver is now a thin, focused component: check boot intent →
//    check consent → start sharing. Nothing more.
//
// Note: this receiver is a secondary safety net. The primary mechanism is the
// sticky foreground service restarting the process, which triggers
// Application.onCreate() and calls startSharing() directly if consent is set.
// The boot receiver covers the edge case where the service was not running at
// the time of reboot (e.g. user had manually stopped it then rebooted).
//
// ─────────────────────────────────────────────────────────────────────────────

class PawnsBootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "PawnsBootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return

        Log.d(TAG, "BOOT_COMPLETED received")

        try {
            // SDK is already initialised by Application.onCreate() which runs
            // before this receiver. Just check consent and start sharing.
            val pawns = Pawns.getInstance()

            if (!pawns.isConsentGiven()) {
                Log.d(TAG, "No consent — skipping boot restart")
                return
            }

            pawns.startSharing(context.applicationContext)
            Log.d(TAG, "Pawns sharing restarted after boot")

        } catch (e: Exception) {
            // If getInstance() throws, the Application class failed to build
            // the SDK — nothing we can do here without the Builder config.
            Log.w(TAG, "Boot restart failed: ${e.message}")
        }
    }
}