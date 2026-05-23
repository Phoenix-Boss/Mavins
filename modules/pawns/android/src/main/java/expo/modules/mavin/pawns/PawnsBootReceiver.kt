package expo.modules.mavin.pawns

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.pawns.sdk.Pawns
import com.pawns.sdk.ServiceConfig
import com.pawns.sdk.ServiceType

class PawnsBootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG     = "PawnsBootReceiver"
        private const val API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZGsiOnRydWUsImV4cCI6MjA4NzQ1MTMwNywianRpIjoiMDFLSkNEWVhYRFNZMTNTRUNDNkZFSlpERjEiLCJpYXQiOjE3NzIwOTEzMDcsInN1YiI6IjAxS0hCOFJaTk41SzIzVjU0VFdXMjZQS1I3In0.aOLBU8O1n_wHDne6VUOijQLHZuM5-EYTj05Sh9TgmQ0"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        Log.d(TAG, "BOOT_COMPLETED � initializing Pawns SDK")
        try {
            val ctx     = context.applicationContext
            val iconRes = ctx.resources.getIdentifier("ic_stat_mavin", "drawable", ctx.packageName)
                .takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info
            val titleRes = ctx.resources.getIdentifier("pawns_service_title", "string", ctx.packageName)
                .takeIf { it != 0 } ?: android.R.string.ok
            val bodyRes = ctx.resources.getIdentifier("pawns_service_body", "string", ctx.packageName)
                .takeIf { it != 0 } ?: android.R.string.cancel

            Pawns.Builder(ctx)
                .apiKey(API_KEY)
                .serviceConfig(ServiceConfig(title = titleRes, body = bodyRes, smallIcon = iconRes))
                .serviceType(ServiceType.FOREGROUND)
                .build()

            val pawns = Pawns.getInstance()
            if (!pawns.isConsentGiven()) { Log.d(TAG, "No consent � skipping"); return }

            val prefs   = context.getSharedPreferences(PawnsModule.PREFS_NAME, Context.MODE_PRIVATE)
            val title   = prefs.getString(PawnsModule.PREF_NOTIF_TITLE, "Running in background") ?: "Running in background"
            val body    = prefs.getString(PawnsModule.PREF_NOTIF_BODY,  "Sharing bandwidth�")    ?: "Sharing bandwidth�"
            val icon    = prefs.getString(PawnsModule.PREF_NOTIF_ICON,  "ic_notification")        ?: "ic_notification"
            val notifId = prefs.getInt(PawnsModule.PREF_NOTIF_ID, PawnsModule.NOTIFICATION_ID)

            pawns.startSharing(ctx, PawnsModule.buildNotification(ctx, title, body, icon), notifId)
            Log.d(TAG, "Pawns restarted after boot")
        } catch (e: Exception) {
            Log.w(TAG, "Boot restart failed: ${e.message}")
        }
    }
}
