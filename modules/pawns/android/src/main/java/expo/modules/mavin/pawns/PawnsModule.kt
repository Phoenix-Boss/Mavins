package expo.modules.mavin.pawns

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.pawns.sdk.common.dto.ServiceState
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

// ─── What changed from the original ──────────────────────────────────────────
//
// 1. Removed Pawns.Builder call from initialize().
//    The SDK is now built in MainApplication.onCreate() before anything else
//    runs, so calling Builder again here is redundant and risks resetting SDK
//    state mid-session.
//
// 2. Removed ensureChannel() and all NotificationChannel / NotificationManager
//    imports. The module manifest declares:
//      <meta-data android:name="com.pawns.sdk.pawns_service_channel_name" .../>
//    so the SDK owns channel creation. Our manual channel was a duplicate.
//
// 3. initialize() now simply confirms the SDK singleton already exists, marks
//    the module as initialised, and subscribes to state changes. It still
//    accepts the apiKey argument from JS so the call-site in EarningsConsentGate
//    does not need to change.
//
// 4. isRunning in getStatus() now returns true for both Running AND LowBattery,
//    because the service is active and sharing in both states.
//
// 5. Removed unused companion object constants that were only needed for the
//    manual channel (NOTIFICATION_ID, CHANNEL_ID, CHANNEL_NAME, PREFS_NAME,
//    PREF_NOTIF_*). resolveIcon is also gone — icon resolution now lives solely
//    in MainApplication.
//
// ─────────────────────────────────────────────────────────────────────────────

class PawnsModule : Module() {

    companion object {
        private const val TAG = "PawnsModule"
    }

    private var initialized        = false
    private var lastError: String? = null
    private var stateJob: Job?     = null
    private val scope              = CoroutineScope(Dispatchers.Main)

    override fun definition() = ModuleDefinition {

        Name("PawnsModule")

        Events("onSdkStarted", "onSdkStopped", "onConsentGranted", "onConsentDenied", "onError")

        // initialize() — SDK is already built in MainApplication.onCreate().
        // This call's job is to confirm the singleton is live, mark the module
        // as ready, and wire up the state-change event subscription.
        // The apiKey param is accepted but not used here; it is kept so the
        // JS call-site (EarningsConsentGate) requires no changes.
        AsyncFunction("initialize") { _: String, promise: Promise ->
            try {
                // Calling getInstance() will throw if Builder was never called.
                // That would only happen if Application.onCreate() failed, in
                // which case we surface the error to JS gracefully.
                Pawns.getInstance()
                initialized = true
                subscribeStateChanges()
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                lastError = e.message
                promise.reject("INIT_ERROR", e.message ?: "SDK not initialised", e)
            }
        }

        AsyncFunction("start") { promise: Promise ->
            try {
                val ctx = appContext.reactContext!!
                Pawns.getInstance().startSharing(ctx)
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                lastError = e.message
                promise.reject("START_ERROR", e.message ?: "error", e)
            }
        }

        AsyncFunction("stop") { promise: Promise ->
            try {
                val ctx = appContext.reactContext!!
                Pawns.getInstance().stopSharing(ctx)
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                lastError = e.message
                promise.reject("STOP_ERROR", e.message ?: "error", e)
            }
        }

        AsyncFunction("optIn") { promise: Promise ->
            try {
                Pawns.getInstance().setConsentGiven(true)
                sendEvent("onConsentGranted", mapOf("timestamp" to System.currentTimeMillis()))
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                lastError = e.message
                promise.reject("OPTIN_ERROR", e.message ?: "error", e)
            }
        }

        AsyncFunction("optOut") { promise: Promise ->
            try {
                val ctx = appContext.reactContext!!
                Pawns.getInstance().stopSharing(ctx)
                Pawns.getInstance().setConsentGiven(false)
                sendEvent("onConsentDenied", mapOf("timestamp" to System.currentTimeMillis()))
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                lastError = e.message
                promise.reject("OPTOUT_ERROR", e.message ?: "error", e)
            }
        }

        AsyncFunction("getStatus") { promise: Promise ->
            try {
                val state   = Pawns.getInstance().getServiceStateSnapshot()
                val consent = Pawns.getInstance().isConsentGiven()

                // LowBattery is still an active sharing state — the service is
                // running and connected, just throttled. Original code returned
                // false for isRunning in this state, which was incorrect.
                val isRunning = state is ServiceState.Launched.Running ||
                                state is ServiceState.Launched.LowBattery

                val stateName = when (state) {
                    is ServiceState.Off                 -> "STOPPED"
                    is ServiceState.On                  -> "STARTING"
                    is ServiceState.Launched.Running    -> "RUNNING"
                    is ServiceState.Launched.LowBattery -> "LOW_BATTERY"
                    is ServiceState.Launched.Error      -> "ERROR"
                    else                                -> "UNKNOWN"
                }

                promise.resolve(mapOf(
                    "isRunning"      to isRunning,
                    "isConsentGiven" to consent,
                    "serviceState"   to stateName,
                    "initialized"    to initialized,
                    "lastError"      to lastError
                ))
            } catch (e: Exception) {
                lastError = e.message
                promise.reject("STATUS_ERROR", e.message ?: "error", e)
            }
        }

        AsyncFunction("getLastError") { promise: Promise ->
            promise.resolve(lastError)
        }

        AsyncFunction("configure") { _: Map<String, Any>?, promise: Promise ->
            promise.resolve(mapOf("success" to true))
        }

        AsyncFunction("requestBatteryOptimisation") { promise: Promise ->
            try {
                val ctx = appContext.reactContext!!
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val pm = ctx.getSystemService(android.os.PowerManager::class.java)
                    if (pm != null && !pm.isIgnoringBatteryOptimizations(ctx.packageName)) {
                        ctx.startActivity(
                            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                                data  = Uri.parse("package:${ctx.packageName}")
                                flags = Intent.FLAG_ACTIVITY_NEW_TASK
                            }
                        )
                    }
                }
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                promise.reject("BATTERY_ERROR", e.message ?: "error", e)
            }
        }

        OnDestroy {
            stateJob?.cancel()
            scope.cancel()
        }
    }

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
                            // Service is still active and sharing — fire onSdkStarted
                            // so JS-side status reflects running correctly.
                            sendEvent("onSdkStarted", mapOf("timestamp" to System.currentTimeMillis()))
                        }
                        is ServiceState.Launched.Error -> {
                            lastError = state.error.toString()
                            sendEvent("onError", mapOf(
                                "message"   to lastError,
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