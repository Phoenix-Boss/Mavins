package expo.modules.mavin.pawns

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.pawns.sdk.common.dto.ServiceConfig
import com.pawns.sdk.common.dto.ServiceType
import com.pawns.sdk.common.sdk.Pawns

class PawnsBootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG     = "PawnsBootReceiver"
        private const val API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZGsiOnRydWUsImV4cCI6MjA4NzQ1MTMwNywianRpIjoiMDFLSkNEWVhYRFNZMTNTRUNDNkZFSlpERjEiLCJpYXQiOjE3NzIwOTEzMDcsInN1YiI6IjAxS0hCOFJaTk41SzIzVjU0VFdXMjZQS1I3In0.aOLBU8O1n_wHDne6VUOijQLHZuM5-EYTj05Sh9TgmQ0"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        Log.d(TAG, "BOOT_COMPLETED — initializing Pawns SDK")
        try {
            val ctx      = context.applicationContext
            val iconRes  = ctx.resources.getIdentifier("ic_stat_mavin", "drawable", ctx.packageName)
                .takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info
            val titleRes = ctx.resources.getIdentifier("pawns_service_title", "string", ctx.packageName)
                .takeIf { it != 0 } ?: android.R.string.ok
            val bodyRes  = ctx.resources.getIdentifier("pawns_service_body", "string", ctx.packageName)
                .takeIf { it != 0 } ?: android.R.string.cancel

            Pawns.Builder(ctx)
                .apiKey(API_KEY)
                .serviceConfig(ServiceConfig(title = titleRes, body = bodyRes, smallIcon = iconRes))
                .serviceType(ServiceType.FOREGROUND)
                .build()

            val pawns = Pawns.getInstance()
            if (!pawns.isConsentGiven()) {
                Log.d(TAG, "No consent — skipping")
                return
            }

            pawns.startSharing(ctx)
            Log.d(TAG, "Pawns restarted after boot")
        } catch (e: Exception) {
            Log.w(TAG, "Boot restart failed: ${e.message}")
        }
    }
}