/**
 * PawnsBootReceiver.kt
 * package expo.modules.mavin.honeygain
 *
 * BroadcastReceiver that auto-restarts Pawns bandwidth sharing after device reboot.
 *
 * Conditions for auto-restart:
 *   1. The user has previously given consent (Pawns.getInstance().isConsentGiven() == true).
 *   2. The SDK is initialized in this receiver (since app process may not have run yet).
 *
 * The notification is reconstructed from values persisted in SharedPreferences by
 * HoneygainModule.applyNotifOptions(). If no values are stored, the defaults embedded
 * in HoneygainModule.companion are used.
 *
 * AndroidManifest.xml registration:
 *
 *  <receiver
 *      android:name="expo.modules.mavin.honeygain.PawnsBootReceiver"
 *      android:exported="false">
 *      <intent-filter>
 *          <action android:name="android.intent.action.BOOT_COMPLETED" />
 *      </intent-filter>
 *  </receiver>
 */

package expo.modules.mavin.honeygain

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.pawns.sdk.Pawns
import com.pawns.sdk.ServiceConfig
import com.pawns.sdk.ServiceType

class PawnsBootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "PawnsBootReceiver"
        
        // Same API key from index.ts — required for SDK initialization after reboot
        // when the JS layer has not yet run.
        private const val API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZGsiOnRydWUsImV4cCI6MjA4NzQ1MTMwNywianRpIjoiMDFLSkNEWVhYRFNZMTNTRUNDNkZFSlpERjEiLCJpYXQiOjE3NzIwOTEzMDcsInN1YiI6IjAxS0hCOFJaTk41SzIzVjU0VFdXMjZQS1I3In0.aOLBU8O1n_wHDne6VUOijQLHZuM5-EYTj05Sh9TgmQ0"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return

        Log.d(TAG, "BOOT_COMPLETED received — initializing Pawns SDK and checking consent")

        try {
            val appContext = context.applicationContext

            // Initialize SDK first (getInstance() will fail if not initialized)
            val titleRes = appContext.resources.getIdentifier(
                "pawns_service_title", "string", appContext.packageName
            ).takeIf { it != 0 } ?: android.R.string.ok

            val bodyRes = appContext.resources.getIdentifier(
                "pawns_service_body", "string", appContext.packageName
            ).takeIf { it != 0 } ?: android.R.string.cancel

            val iconRes = appContext.resources.getIdentifier(
                "ic_stat_mavin", "drawable", appContext.packageName
            ).takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info

            val serviceConfig = ServiceConfig(
                title = titleRes,
                body = bodyRes,
                smallIcon = iconRes
            )

            Pawns.Builder(appContext)
                .apiKey(API_KEY)
                .serviceConfig(serviceConfig)
                .serviceType(ServiceType.FOREGROUND)
                .build()

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
            Log.w(TAG, "Could not restart Pawns after boot: ${e.message}")
        }
    }
}