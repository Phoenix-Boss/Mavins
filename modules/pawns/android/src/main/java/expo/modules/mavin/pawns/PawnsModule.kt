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
        private const val API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZGsiOnRydWUsImV4cCI6MjA4NzQ1MTMwNywianRpIjoiMDFLSkNEWVhYRFNZMTNTRUNDNkZFSlpERjEiLCJpYXQiOjE3NzIwOTEzMDcsInN1YiI6IjAxS0hCOFJaTk41SzIzVjU0VFdXMjZQS1I3In0.aOLBU8O1n_wHDne6VUOijQLHZuM5-EYTj05Sh9TgmQ0"
    }

    private var initialized = false
    private var lastError: String? = null
    private var stateJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.Main)

    override fun definition() = ModuleDefinition {

        Name("PawnsModule")

        Events("onSdkStarted", "onSdkStopped", "onConsentGranted", "onConsentDenied", "onError")

        AsyncFunction("initialize") { apiKey: String, promise: Promise ->
            try {
                val ctx = appContext.reactContext!!
                
                val iconRes = ctx.resources.getIdentifier("ic_stat_mavin", "drawable", ctx.packageName)
                    .takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info
                
                val titleRes = ctx.resources.getIdentifier("pawns_service_title", "string", ctx.packageName)
                    .takeIf { it != 0 } ?: android.R.string.ok
                
                val bodyRes = ctx.resources.getIdentifier("pawns_service_body", "string", ctx.packageName)
                    .takeIf { it != 0 } ?: android.R.string.cancel

                Pawns.Builder(ctx)
                    .apiKey(apiKey)
                    .serviceConfig(ServiceConfig(title = titleRes, body = bodyRes, smallIcon = iconRes))
                    .serviceType(ServiceType.FOREGROUND)
                    .build()
                    
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
                val state = Pawns.getInstance().getServiceStateSnapshot()
                val consent = Pawns.getInstance().isConsentGiven()
                
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
                                data = Uri.parse("package:${ctx.packageName}")
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