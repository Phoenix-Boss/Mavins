package expo.modules.mavin.pawns

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.pawns.sdk.common.dto.ServiceConfig
import com.pawns.sdk.common.dto.ServiceState
import com.pawns.sdk.common.dto.ServiceType
import com.pawns.sdk.common.sdk.Pawns
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class PawnsModule : Module() {

    companion object {
        private const val TAG = "PawnsModule"
        private const val PREFS_NAME = "pawns_prefs"
        private const val KEY_API_KEY = "api_key"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_NAME = "device_name"
    }

    private var initialized = false
    private var lastError: String? = null
    private var stateJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.Main)

    override fun definition() = ModuleDefinition {

        Name("PawnsModule")

        Events("onSdkStarted", "onSdkStopped", "onConsentGranted", "onConsentDenied", "onError")

        // ─── INITIALIZE ──────────────────────────────────────────────────────────
        // Per integration guide: Initialize(deviceID, deviceName)
        // Updated to accept apiKey, deviceID, and deviceName
        AsyncFunction("initialize") { 
            apiKey: String, 
            deviceID: String, 
            deviceName: String, 
            promise: Promise ->
            try {
                val ctx = appContext.reactContext!!
                
                // ─── STORE CREDENTIALS FOR BOOT RECEIVER ──────────────────────
                val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                prefs.edit().apply {
                    putString(KEY_API_KEY, apiKey)
                    putString(KEY_DEVICE_ID, deviceID)
                    putString(KEY_DEVICE_NAME, deviceName)
                    apply()
                }
                Log.d(TAG, "Credentials stored - Device: $deviceID, Name: $deviceName")
                
                // ─── RESOURCE IDs ───────────────────────────────────────────────
                val iconRes = ctx.resources.getIdentifier("ic_stat_mavin", "drawable", ctx.packageName)
                    .takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info
                
                val titleRes = ctx.resources.getIdentifier("pawns_service_title", "string", ctx.packageName)
                    .takeIf { it != 0 } ?: android.R.string.ok
                
                val bodyRes = ctx.resources.getIdentifier("pawns_service_body", "string", ctx.packageName)
                    .takeIf { it != 0 } ?: android.R.string.cancel

                // ─── BUILD SDK ───────────────────────────────────────────────────
                // Per integration guide: Pass deviceID and deviceName
                Pawns.Builder(ctx)
                    .apiKey(apiKey)
                    .deviceId(deviceID)
                    .deviceName(deviceName)
                    .serviceConfig(ServiceConfig(
                        title = titleRes,
                        body = bodyRes,
                        smallIcon = iconRes
                    ))
                    .serviceType(ServiceType.FOREGROUND)
                    .build()
                    
                initialized = true
                subscribeStateChanges()
                promise.resolve(mapOf("success" to true))
                
            } catch (e: Exception) {
                lastError = e.message
                Log.e(TAG, "Initialization failed: ${e.message}", e)
                promise.reject("INIT_ERROR", e.message ?: "SDK not initialised", e)
            }
        }

        // ─── START ──────────────────────────────────────────────────────────────
        AsyncFunction("start") { promise: Promise ->
            try {
                val ctx = appContext.reactContext!!
                Pawns.getInstance().startSharing(ctx)
                Log.d(TAG, "Sharing started")
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                lastError = e.message
                Log.e(TAG, "Start failed: ${e.message}", e)
                promise.reject("START_ERROR", e.message ?: "error", e)
            }
        }

        // ─── STOP ───────────────────────────────────────────────────────────────
        AsyncFunction("stop") { promise: Promise ->
            try {
                val ctx = appContext.reactContext!!
                Pawns.getInstance().stopSharing(ctx)
                Log.d(TAG, "Sharing stopped")
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                lastError = e.message
                Log.e(TAG, "Stop failed: ${e.message}", e)
                promise.reject("STOP_ERROR", e.message ?: "error", e)
            }
        }

        // ─── OPT IN ─────────────────────────────────────────────────────────────
        AsyncFunction("optIn") { promise: Promise ->
            try {
                Pawns.getInstance().setConsentGiven(true)
                sendEvent("onConsentGranted", mapOf("timestamp" to System.currentTimeMillis()))
                Log.d(TAG, "Consent granted")
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                lastError = e.message
                Log.e(TAG, "OptIn failed: ${e.message}", e)
                promise.reject("OPTIN_ERROR", e.message ?: "error", e)
            }
        }

        // ─── OPT OUT ────────────────────────────────────────────────────────────
        AsyncFunction("optOut") { promise: Promise ->
            try {
                val ctx = appContext.reactContext!!
                Pawns.getInstance().stopSharing(ctx)
                Pawns.getInstance().setConsentGiven(false)
                sendEvent("onConsentDenied", mapOf("timestamp" to System.currentTimeMillis()))
                Log.d(TAG, "Consent denied")
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                lastError = e.message
                Log.e(TAG, "OptOut failed: ${e.message}", e)
                promise.reject("OPTOUT_ERROR", e.message ?: "error", e)
            }
        }

        // ─── GET STATUS ─────────────────────────────────────────────────────────
        AsyncFunction("getStatus") { promise: Promise ->
            try {
                val pawns = Pawns.getInstance()
                val state = pawns.getServiceStateSnapshot()
                val consent = pawns.isConsentGiven()
                
                val isRunning = state is ServiceState.Launched.Running ||
                                state is ServiceState.Launched.LowBattery
                
                val stateName = when (state) {
                    is ServiceState.Off -> "STOPPED"
                    is ServiceState.On -> "STARTING"
                    is ServiceState.Launched.Running -> "RUNNING"
                    is ServiceState.Launched.LowBattery -> "LOW_BATTERY"
                    is ServiceState.Launched.Error -> "ERROR"
                    else -> "UNKNOWN"
                }
                
                promise.resolve(mapOf(
                    "isRunning" to isRunning,
                    "isConsentGiven" to consent,
                    "serviceState" to stateName,
                    "initialized" to initialized,
                    "lastError" to lastError
                ))
            } catch (e: Exception) {
                lastError = e.message
                Log.e(TAG, "GetStatus failed: ${e.message}", e)
                promise.reject("STATUS_ERROR", e.message ?: "error", e)
            }
        }

        // ─── GET LAST ERROR ────────────────────────────────────────────────────
        AsyncFunction("getLastError") { promise: Promise ->
            promise.resolve(lastError)
        }

        // ─── CONFIGURE ─────────────────────────────────────────────────────────
        // Note: This is a no-op as per the integration guide's pattern.
        // If configuration is needed, implement here.
        AsyncFunction("configure") { _: Map<String, Any>?, promise: Promise ->
            promise.resolve(mapOf("success" to true))
        }

        // ─── REQUEST BATTERY OPTIMISATION ─────────────────────────────────────
        AsyncFunction("requestBatteryOptimisation") { promise: Promise ->
            try {
                val ctx = appContext.reactContext!!
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val pm = ctx.getSystemService(android.os.PowerManager::class.java)
                    if (pm != null && !pm.isIgnoringBatteryOptimizations(ctx.packageName)) {
                        ctx.startActivity(
                            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                                data = Uri.parse("package:${ctx.packageName}")
                                flags = Intent.FLAG_ACTIVITY_NEW_TASK
                            }
                        )
                    }
                }
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                Log.e(TAG, "Battery optimisation request failed: ${e.message}", e)
                promise.reject("BATTERY_ERROR", e.message ?: "error", e)
            }
        }

        OnDestroy {
            stateJob?.cancel()
            scope.cancel()
            Log.d(TAG, "Module destroyed")
        }
    }

    // ─── SUBSCRIBE TO STATE CHANGES ─────────────────────────────────────────
    // Matches the callback pattern from the integration guide
    private fun subscribeStateChanges() {
        stateJob?.cancel()
        stateJob = scope.launch {
            try {
                Pawns.getInstance().getServiceState().collectLatest { state ->
                    when (state) {
                        is ServiceState.Launched.Running -> {
                            sendEvent("onSdkStarted", mapOf("timestamp" to System.currentTimeMillis()))
                        }
                        is ServiceState.Launched.LowBattery -> {
                            sendEvent("onSdkStarted", mapOf("timestamp" to System.currentTimeMillis()))
                        }
                        is ServiceState.Launched.Error -> {
                            lastError = state.error.toString()
                            sendEvent("onError", mapOf(
                                "message" to lastError,
                                "timestamp" to System.currentTimeMillis()
                            ))
                        }
                        is ServiceState.Off -> {
                            sendEvent("onSdkStopped", mapOf("timestamp" to System.currentTimeMillis()))
                        }
                        else -> {}
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "State flow ended: ${e.message}")
            }
        }
    }
}