package expo.modules.mavin.pawns

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.util.Log
import com.pawns.sdk.common.dto.ServiceConfig
import com.pawns.sdk.common.dto.ServiceType
import com.pawns.sdk.common.sdk.Pawns

class PawnsBootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "PawnsBootReceiver"
        private const val PREFS_NAME = "pawns_prefs"
        private const val KEY_API_KEY = "api_key"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_NAME = "device_name"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return

        Log.d(TAG, "BOOT_COMPLETED received")

        try {
            val ctx = context.applicationContext

            // ─── RETRIEVE STORED CREDENTIALS ───────────────────────────────────
            val prefs: SharedPreferences = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val apiKey = prefs.getString(KEY_API_KEY, null)
            val deviceId = prefs.getString(KEY_DEVICE_ID, null)
            val deviceName = prefs.getString(KEY_DEVICE_NAME, null)

            // ─── VALIDATE: Don't start without proper config ──────────────────
            if (apiKey.isNullOrEmpty() || deviceId.isNullOrEmpty()) {
                Log.w(TAG, "No stored API key or device ID — skipping boot restart")
                return
            }

            Log.d(TAG, "Retrieved credentials - Device: $deviceId, Name: $deviceName")

            // ─── RESOURCE IDs ──────────────────────────────────────────────────
            val iconRes = ctx.resources.getIdentifier("ic_stat_mavin", "drawable", ctx.packageName)
                .takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info

            val titleRes = ctx.resources.getIdentifier("pawns_service_title", "string", ctx.packageName)
                .takeIf { it != 0 } ?: android.R.string.ok

            val bodyRes = ctx.resources.getIdentifier("pawns_service_body", "string", ctx.packageName)
                .takeIf { it != 0 } ?: android.R.string.cancel

            // ─── BUILD SDK WITH STORED CREDENTIALS ────────────────────────────
            // NOTE: the Pawns SDK (v1.8.1) has no deviceId/deviceName builder
            // methods — it generates and persists its own device UUID
            // internally (see DeviceIdHelper in the SDK). deviceId/deviceName
            // are still read above for our own prefs validation/logging only.
            Pawns.Builder(ctx)
                .apiKey(apiKey)
                .serviceConfig(ServiceConfig(
                    title = titleRes,
                    body = bodyRes,
                    smallIcon = iconRes
                ))
                .serviceType(ServiceType.FOREGROUND)
                .build()

            val pawns = Pawns.getInstance()

            // ─── CHECK CONSENT BEFORE STARTING ───────────────────────────────
            if (!pawns.isConsentGiven()) {
                Log.d(TAG, "No consent — skipping boot restart")
                return
            }

            // ─── START SHARING ─────────────────────────────────────────────────
            pawns.startSharing(ctx)
            Log.d(TAG, "✅ Pawns sharing restarted after boot for device: $deviceId")

        } catch (e: Exception) {
            Log.e(TAG, "❌ Boot restart failed: ${e.message}", e)
        }
    }
}