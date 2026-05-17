/**
 * PawnsBootReceiver.kt
 * package expo.modules.mavin.honeygain
 *
 * BroadcastReceiver that auto-restarts Pawns bandwidth sharing after device reboot.
 *
 * Conditions for auto-restart:
 *   1. The user has previously given consent (Pawns.getInstance().isConsentGiven() == true).
 *   2. The SDK was already initialised at some point (i.e. the Application class called
 *      Pawns.Builder, or the module's initialize() was called before reboot).
 *
 * The notification is reconstructed from values persisted in SharedPreferences by
 * HoneygainModule.applyNotifOptions(). If no values are stored, the defaults embedded
 * in HoneygainModule.companion are used.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  AndroidManifest.xml registration (already listed in HoneygainModule.kt header):
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  <receiver
 *      android:name=".PawnsBootReceiver"
 *      android:exported="false">
 *      <intent-filter>
 *          <action android:name="android.intent.action.BOOT_COMPLETED" />
 *      </intent-filter>
 *  </receiver>
 *
 *  NOTE: The fully-qualified class name in the manifest must match this file's
 *  package. If your app package differs from the module package, use the full
 *  class name: "expo.modules.mavin.honeygain.PawnsBootReceiver".
 */

package expo.modules.mavin.honeygain

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.pawns.sdk.Pawns

class PawnsBootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "PawnsBootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return

        Log.d(TAG, "BOOT_COMPLETED received — checking Pawns SDK consent state")

        try {
            // If the SDK is not yet initialised (e.g. Application.onCreate() hasn't run
            // yet at this broadcast delivery point), getInstance() will throw.
            // In that case there is nothing we can restart — the foreground service will
            // be started normally when the user next opens the app.
            val pawns = Pawns.getInstance()

            if (!pawns.isConsentGiven()) {
                Log.d(TAG, "Consent not given — skipping auto-restart")
                return
            }

            // Restore notification config that was last persisted by HoneygainModule
            val prefs = context.getSharedPreferences(
                HoneygainModule.PREFS_NAME,
                Context.MODE_PRIVATE
            )

            val title   = prefs.getString(HoneygainModule.PREF_NOTIF_TITLE, "Running in background")
                ?: "Running in background"
            val body    = prefs.getString(HoneygainModule.PREF_NOTIF_BODY,  "Sharing bandwidth…")
                ?: "Sharing bandwidth…"
            val icon    = prefs.getString(HoneygainModule.PREF_NOTIF_ICON,  "ic_notification")
                ?: "ic_notification"
            val notifId = prefs.getInt(HoneygainModule.PREF_NOTIF_ID, HoneygainModule.NOTIFICATION_ID)

            Log.d(TAG, "Restarting Pawns sharing — notifId=$notifId title='$title'")

            val notification = HoneygainModule.buildNotification(context, title, body, icon)
            pawns.startSharing(context, notification, notifId)

            Log.d(TAG, "Pawns sharing restarted successfully after boot")
        } catch (e: Exception) {
            // SDK not initialised yet — this is acceptable; the app will start sharing
            // normally when the user opens it next.
            Log.w(TAG, "Could not restart Pawns after boot: ${e.message}")
        }
    }
}