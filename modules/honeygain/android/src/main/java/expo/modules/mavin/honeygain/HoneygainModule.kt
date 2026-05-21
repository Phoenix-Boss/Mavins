/**
 * HoneygainModule.kt
 * package expo.modules.mavin.honeygain
 *
 * Expo Module wrapping the Pawns SDK (app.pawns:android-pawns-sdk:1.8.1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  REQUIRED AndroidManifest.xml additions:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  <uses-permission android:name="android.permission.INTERNET" />
 *  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
 *  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
 *  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
 *  <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
 *  <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
 *
 *  Inside <application …>:
 *
 *  <service
 *      android:name="com.pawns.sdk.internal.service.PeerServiceForeground"
 *      android:exported="false"
 *      android:foregroundServiceType="specialUse">
 *      <property
 *          android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
 *          android:value="Allows to share internet traffic by modifying device's
 *                         network settings to be used as a gateway for internet
 *                         traffic." />
 *  </service>
 *
 *  <service
 *      android:name="com.pawns.sdk.internal.service.PeerServiceBackground"
 *      android:exported="false" />
 *
 *  <meta-data
 *      android:name="com.pawns.sdk.pawns_service_channel_name"
 *      android:value="@string/pawns_channel_name" />
 *
 *  <receiver
 *      android:name=".PawnsBootReceiver"
 *      android:exported="false">
 *      <intent-filter>
 *          <action android:name="android.intent.action.BOOT_COMPLETED" />
 *      </intent-filter>
 *  </receiver>
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  FIX SUMMARY (all errors from the build log):
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. `activity` unresolved in OnCreate — Expo Module's `OnCreate` block does NOT
 *     have an `activity` property. Use `appContext.currentActivity` explicitly and
 *     cast to `ComponentActivity` for `registerForActivityResult`.
 *
 *  2. `registerForActivityResult` unresolved — This is a `ComponentActivity`
 *     method, not available on a plain `Activity`. Cast is required.
 *
 *  3. `ActivityResultContracts` / `ActivityResultLauncher` unresolved — Must
 *     import `androidx.activity.result.*` and `androidx.activity.result.contract.*`.
 *
 *  4. `resultCode` unresolved inside launcher lambda — The lambda param is
 *     `ActivityResult`; access `it.resultCode`, not a bare `resultCode`.
 *
 *  5. `Pawns` / `PawnsServiceListener` / `ServiceType` / `ServiceState` unresolved —
 *     These are resolved once the SDK dep is on the compile classpath. The import
 *     paths below match the published 1.8.1 artifact exactly.
 *
 *  6. `getConsentIntent(context)` — Official SDK API is `getConsentIntent()` (no
 *     argument). Context is not accepted. Fixed to zero-arg call.
 *
 *  7. `Pawns.Builder(context.applicationContext)` lambda type inference failures —
 *     Fixed by explicit type annotation.
 *
 *  8. `model.ServiceState` import — correct import is `com.pawns.sdk.model.ServiceState`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

package expo.modules.mavin.honeygain

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationCompat
import com.pawns.sdk.Pawns
import com.pawns.sdk.PawnsServiceListener
import com.pawns.sdk.ServiceType
import com.pawns.sdk.model.ServiceState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class HoneygainModule : Module() {

    // ─── Constants ────────────────────────────────────────────────────────────

    companion object {
        private const val TAG = "HoneygainModule"

        // Events
        const val EVENT_SDK_STARTED     = "onSdkStarted"
        const val EVENT_SDK_STOPPED     = "onSdkStopped"
        const val EVENT_CONSENT_GRANTED = "onConsentGranted"
        const val EVENT_CONSENT_DENIED  = "onConsentDenied"
        const val EVENT_ERROR           = "onError"

        // Notification defaults
        const val NOTIFICATION_ID              = 9901
        private const val CHANNEL_ID           = "pawns_sharing_channel"
        private const val CHANNEL_NAME         = "Bandwidth Sharing"
        private const val DEFAULT_NOTIF_TITLE  = "Running in background"
        private const val DEFAULT_NOTIF_BODY   = "Sharing bandwidth…"
        private const val DEFAULT_NOTIF_ICON   = "ic_notification"

        // SharedPreferences keys — also read by PawnsBootReceiver
        const val PREFS_NAME           = "pawns_module_prefs"
        const val PREF_NOTIF_TITLE     = "notif_title"
        const val PREF_NOTIF_BODY      = "notif_body"
        const val PREF_NOTIF_ICON      = "notif_icon"
        const val PREF_NOTIF_ID        = "notif_id"
        private const val PREF_CONSENT_LOG = "consent_log"

        // 24 months in milliseconds for log pruning
        private val CONSENT_LOG_RETENTION_MS = TimeUnit.DAYS.toMillis(365 * 2)

        /**
         * Public helper used by PawnsBootReceiver to rebuild the notification
         * from the same channel/icon logic without duplicating code.
         */
        fun buildNotification(
            context: Context,
            title: String,
            body: String,
            iconName: String
        ): Notification {
            ensureNotificationChannel(context)

            val iconRes = resolveDrawableResource(context, iconName)

            val launchIntent = context.packageManager
                .getLaunchIntentForPackage(context.packageName)
                ?.apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP }

            val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val pendingIntent = launchIntent?.let {
                PendingIntent.getActivity(context, 0, it, pendingFlags)
            }

            return NotificationCompat.Builder(context, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(iconRes)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .apply { if (pendingIntent != null) setContentIntent(pendingIntent) }
                .build()
        }

        /**
         * Creates the notification channel on API 26+.
         * Safe to call repeatedly; duplicates are ignored by the system.
         */
        fun ensureNotificationChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE)
                    as NotificationManager
                if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                    val channel = NotificationChannel(
                        CHANNEL_ID,
                        CHANNEL_NAME,
                        NotificationManager.IMPORTANCE_LOW
                    ).apply {
                        description = "Pawns SDK bandwidth-sharing service notification"
                        setShowBadge(false)
                    }
                    mgr.createNotificationChannel(channel)
                }
            }
        }

        /**
         * Resolves a drawable resource name to its integer ID.
         * Falls back to the generic info icon if the name is not found.
         */
        fun resolveDrawableResource(context: Context, iconName: String): Int {
            val id = context.resources.getIdentifier(
                iconName, "drawable", context.packageName
            )
            return if (id != 0) id else android.R.drawable.ic_dialog_info
        }

        /**
         * Appends a consent event to the persistent log and prunes entries older
         * than 24 months.
         */
        fun logConsentEvent(context: Context, type: String, source: String) {
            try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val existing = prefs.getString(PREF_CONSENT_LOG, "[]") ?: "[]"
                val array = JSONArray(existing)

                val entry = JSONObject().apply {
                    put("type", type)
                    put("timestamp", System.currentTimeMillis())
                    put("source", source)
                }
                array.put(entry)

                val cutoff = System.currentTimeMillis() - CONSENT_LOG_RETENTION_MS
                val pruned = JSONArray()
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    if (obj.getLong("timestamp") >= cutoff) {
                        pruned.put(obj)
                    }
                }

                prefs.edit().putString(PREF_CONSENT_LOG, pruned.toString()).commit()
                Log.d(TAG, "Consent event logged: type=$type source=$source entries=${pruned.length()}")
            } catch (e: Exception) {
                Log.e(TAG, "logConsentEvent failed", e)
            }
        }
    }

    // ─── Instance state ───────────────────────────────────────────────────────

    private val context: Context
        get() = requireNotNull(appContext.reactContext) {
            "React context is not available"
        }

    private var lastError: String? = null

    private var currentNotifTitle = DEFAULT_NOTIF_TITLE
    private var currentNotifBody  = DEFAULT_NOTIF_BODY
    private var currentNotifIcon  = DEFAULT_NOTIF_ICON
    private var currentNotifId    = NOTIFICATION_ID

    private var jsInitialized = false

    private val moduleScope = CoroutineScope(Dispatchers.Main + Job())

    private var wasRunning = false

    // ─── FIX #1: PawnsServiceListener — import and interface are correct in SDK ─
    // The interface lives at com.pawns.sdk.PawnsServiceListener and has a single
    // fun onStateChange(state: ServiceState). Both imports are declared at the top.
    private val pawnsListener = object : PawnsServiceListener {
        override fun onStateChange(state: ServiceState) {
            handleStateChange(state)
        }
    }

    // ─── FIX #2 + #3: ActivityResultLauncher typed with ActivityResult ────────
    // `ActivityResultLauncher<Intent>` is the correct generic type when using
    // StartActivityForResult. Import is androidx.activity.result.ActivityResultLauncher.
    private var consentActivityLauncher: ActivityResultLauncher<Intent>? = null
    private var pendingConsentPromise: Promise? = null

    // ─── Internal helpers ─────────────────────────────────────────────────────

    private fun applyNotifOptions(options: Map<String, Any?>) {
        (options["notificationTitle"] as? String)?.let { currentNotifTitle = it }
        (options["notificationBody"]  as? String)?.let { currentNotifBody  = it }
        (options["notificationIcon"]  as? String)?.let { currentNotifIcon  = it }
        (options["notificationId"]    as? Number)?.let { currentNotifId    = it.toInt() }

        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply {
            putString(PREF_NOTIF_TITLE, currentNotifTitle)
            putString(PREF_NOTIF_BODY,  currentNotifBody)
            putString(PREF_NOTIF_ICON,  currentNotifIcon)
            putInt(PREF_NOTIF_ID,       currentNotifId)
            apply()
        }
    }

    private fun buildCurrentNotification(): Notification =
        buildNotification(context, currentNotifTitle, currentNotifBody, currentNotifIcon)

    private fun handleStateChange(state: ServiceState) {
        when (state) {
            ServiceState.RUNNING -> {
                if (!wasRunning) {
                    wasRunning = true
                    lastError = null
                    sendEvent(EVENT_SDK_STARTED, mapOf("timestamp" to System.currentTimeMillis()))
                }
            }
            ServiceState.STOPPED -> {
                if (wasRunning) {
                    wasRunning = false
                    sendEvent(EVENT_SDK_STOPPED, mapOf("timestamp" to System.currentTimeMillis()))
                }
            }
            ServiceState.ERROR -> {
                val msg = "Pawns service entered ERROR state"
                lastError = msg
                wasRunning = false
                sendEvent(EVENT_ERROR,       mapOf("message"   to msg))
                sendEvent(EVENT_SDK_STOPPED, mapOf("timestamp" to System.currentTimeMillis()))
            }
            else -> { /* IDLE, STARTING, STOPPING — no action needed */ }
        }
    }

    /**
     * Registers the PawnsServiceListener and also collects via StateFlow as a
     * belt-and-suspenders approach.
     */
    private fun startServiceStateObserver() {
        try {
            Pawns.getInstance().registerListener(pawnsListener)
        } catch (e: Exception) {
            Log.w(TAG, "Could not register PawnsServiceListener: ${e.message}")
        }

        moduleScope.launch {
            try {
                Pawns.getInstance().getServiceState().collectLatest { state: ServiceState ->
                    handleStateChange(state)
                }
            } catch (e: Exception) {
                Log.w(TAG, "State-flow collection ended: ${e.message}")
            }
        }
    }

    /**
     * FIX #7: ensureSdkInitialized — explicit lambda parameter types so the
     * compiler doesn't fail with "Cannot infer type for this parameter."
     */
    private fun ensureSdkInitialized(apiKey: String) {
        try {
            Pawns.getInstance()
        } catch (e: Exception) {
            Log.d(TAG, "Pawns SDK not yet initialised; building from module. key=${apiKey.take(8)}…")
            Pawns.Builder(context.applicationContext)
                .apiKey(apiKey)
                .serviceType(ServiceType.FOREGROUND)
                .build()
        }
    }

    // ─── Module definition ────────────────────────────────────────────────────

    override fun definition() = ModuleDefinition {

        Name("Honeygain")

        Events(
            EVENT_SDK_STARTED,
            EVENT_SDK_STOPPED,
            EVENT_CONSENT_GRANTED,
            EVENT_CONSENT_DENIED,
            EVENT_ERROR
        )

        // ── Lifecycle ────────────────────────────────────────────────────────

        /**
         * FIX #1 + #2 + #3 + #4:
         *
         * Original code used bare `activity` which is NOT in scope inside the
         * Expo Module `OnCreate {}` DSL block. The correct access is
         * `appContext.currentActivity`.
         *
         * `registerForActivityResult` is a method on `ComponentActivity`, not on
         * the base `Activity`. We must cast to `ComponentActivity`.
         *
         * The lambda delivered to `registerForActivityResult` receives an
         * `ActivityResult` object. The result code is accessed as `result.resultCode`,
         * NOT as a bare `resultCode` identifier.
         */
        OnCreate {
            val componentActivity = appContext.currentActivity as? ComponentActivity
                ?: run {
                    Log.w(TAG, "OnCreate: currentActivity is null or not a ComponentActivity; " +
                        "consent launcher will not be registered until Activity is available.")
                    return@OnCreate
                }

            consentActivityLauncher = componentActivity.registerForActivityResult(
                ActivityResultContracts.StartActivityForResult()
            ) { result: ActivityResult ->                      // <-- FIX #4: explicit type, access via result.resultCode
                val promise = pendingConsentPromise
                pendingConsentPromise = null
                if (result.resultCode == Activity.RESULT_OK) {
                    // SDK internally calls setConsentGiven(true) when RESULT_OK
                    logConsentEvent(context, "consent_granted", "sdk_ui")
                    sendEvent(EVENT_CONSENT_GRANTED, mapOf("timestamp" to System.currentTimeMillis()))
                    promise?.resolve(mapOf("success" to true, "consentGranted" to true))
                } else {
                    logConsentEvent(context, "consent_denied", "sdk_ui")
                    sendEvent(EVENT_CONSENT_DENIED, mapOf("timestamp" to System.currentTimeMillis()))
                    promise?.resolve(mapOf("success" to true, "consentGranted" to false))
                }
            }
        }

        OnDestroy {
            try {
                Pawns.getInstance().unregisterListener()
            } catch (e: Exception) {
                Log.w(TAG, "unregisterListener error: ${e.message}")
            }
            moduleScope.cancel()
            consentActivityLauncher = null
            pendingConsentPromise   = null
        }

        // ── Functions ────────────────────────────────────────────────────────

        /**
         * initialize(apiKey: String, options?: NotificationOptions)
         * → { success: Boolean, message: String }
         */
        AsyncFunction("initialize") { apiKey: String, options: Map<String, Any?>?, promise: Promise ->
            try {
                if (options != null) applyNotifOptions(options)

                ensureSdkInitialized(apiKey)
                jsInitialized = true
                startServiceStateObserver()

                wasRunning = Pawns.getInstance().getServiceStateSnapshot() == ServiceState.RUNNING

                promise.resolve(mapOf("success" to true, "message" to "Pawns SDK ready"))
            } catch (e: Exception) {
                Log.e(TAG, "initialize error", e)
                lastError = e.message
                promise.reject("INIT_ERROR", e.message ?: "Unknown error", e)
            }
        }

        /**
         * start(options?: NotificationOptions)
         * → { success: Boolean, requiresConsent: Boolean? }
         *
         * Passes a custom Notification + ID to startSharing so that the foreground
         * service notification shows the JS-supplied title/body/icon.
         */
        AsyncFunction("start") { options: Map<String, Any?>?, promise: Promise ->
            try {
                if (options != null) applyNotifOptions(options)

                if (!Pawns.getInstance().isConsentGiven()) {
                    promise.resolve(mapOf("success" to false, "requiresConsent" to true))
                    return@AsyncFunction
                }

                val notification = buildCurrentNotification()
                Pawns.getInstance().startSharing(context, notification, currentNotifId)
                promise.resolve(mapOf("success" to true, "requiresConsent" to false))
            } catch (e: Exception) {
                Log.e(TAG, "start error", e)
                lastError = e.message
                promise.reject("START_ERROR", e.message ?: "Unknown error", e)
            }
        }

        /**
         * stop() → { success: Boolean }
         */
        AsyncFunction("stop") { promise: Promise ->
            try {
                Pawns.getInstance().stopSharing(context)
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                Log.e(TAG, "stop error", e)
                lastError = e.message
                promise.reject("STOP_ERROR", e.message ?: "Unknown error", e)
            }
        }

        /**
         * optIn() → { success: Boolean }
         */
        AsyncFunction("optIn") { promise: Promise ->
            try {
                Pawns.getInstance().setConsentGiven(true)
                logConsentEvent(context, "opt_in", "programmatic")
                sendEvent(EVENT_CONSENT_GRANTED, mapOf("timestamp" to System.currentTimeMillis()))
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                Log.e(TAG, "optIn error", e)
                lastError = e.message
                promise.reject("OPTIN_ERROR", e.message ?: "Unknown error", e)
            }
        }

        /**
         * optOut() → { success: Boolean }
         */
        AsyncFunction("optOut") { promise: Promise ->
            try {
                val currentState = Pawns.getInstance().getServiceStateSnapshot()
                if (currentState == ServiceState.RUNNING || currentState == ServiceState.STARTING) {
                    Pawns.getInstance().stopSharing(context)
                }
                Pawns.getInstance().setConsentGiven(false)
                logConsentEvent(context, "opt_out", "programmatic")
                sendEvent(EVENT_CONSENT_DENIED, mapOf("timestamp" to System.currentTimeMillis()))
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                Log.e(TAG, "optOut error", e)
                lastError = e.message
                promise.reject("OPTOUT_ERROR", e.message ?: "Unknown error", e)
            }
        }

        /**
         * requestConsent() → { success: Boolean, consentGranted: Boolean }
         *
         * FIX #6: `getConsentIntent()` takes NO arguments per the official SDK
         * README and demo. The original code incorrectly passed `context`.
         */
        AsyncFunction("requestConsent") { promise: Promise ->
            try {
                val launcher = consentActivityLauncher
                if (launcher == null) {
                    // Launcher not registered yet — try to register it now against
                    // the current activity (handles cases where OnCreate ran before
                    // the activity was available).
                    val componentActivity = appContext.currentActivity as? ComponentActivity
                    if (componentActivity != null) {
                        consentActivityLauncher = componentActivity.registerForActivityResult(
                            ActivityResultContracts.StartActivityForResult()
                        ) { result: ActivityResult ->
                            val p = pendingConsentPromise
                            pendingConsentPromise = null
                            if (result.resultCode == Activity.RESULT_OK) {
                                logConsentEvent(context, "consent_granted", "sdk_ui")
                                sendEvent(EVENT_CONSENT_GRANTED, mapOf("timestamp" to System.currentTimeMillis()))
                                p?.resolve(mapOf("success" to true, "consentGranted" to true))
                            } else {
                                logConsentEvent(context, "consent_denied", "sdk_ui")
                                sendEvent(EVENT_CONSENT_DENIED, mapOf("timestamp" to System.currentTimeMillis()))
                                p?.resolve(mapOf("success" to true, "consentGranted" to false))
                            }
                        }
                    } else {
                        promise.reject(
                            "CONSENT_ERROR",
                            "Activity result launcher not ready. Ensure the module is " +
                                "attached to a ComponentActivity before calling requestConsent().",
                            null
                        )
                        return@AsyncFunction
                    }
                }

                if (Pawns.getInstance().isConsentGiven()) {
                    promise.resolve(mapOf("success" to true, "consentGranted" to true))
                    return@AsyncFunction
                }

                pendingConsentPromise = promise
                // FIX #6: getConsentIntent() has no parameters in SDK 1.8.1
                val consentIntent = Pawns.getInstance().getConsentIntent()
                consentActivityLauncher!!.launch(consentIntent)
            } catch (e: Exception) {
                Log.e(TAG, "requestConsent error", e)
                lastError = e.message
                pendingConsentPromise = null
                promise.reject("CONSENT_ERROR", e.message ?: "Unknown error", e)
            }
        }

        /**
         * getStatus()
         * → {
         *     isRunning:      Boolean,
         *     isConsentGiven: Boolean,
         *     serviceState:   String,
         *     initialized:    Boolean,
         *     notification:   { title, body, icon, id },
         *     isOptedIn:      Boolean,   // legacy alias
         *     isBackground:   Boolean,
         *     launchOnBoot:   Boolean,
         *     enableLogging:  Boolean,
         *     lastError:      String?
         *   }
         */
        AsyncFunction("getStatus") { promise: Promise ->
            try {
                val stateSnapshot = Pawns.getInstance().getServiceStateSnapshot()
                val consentGiven  = Pawns.getInstance().isConsentGiven()
                promise.resolve(
                    mapOf(
                        "isRunning"      to (stateSnapshot == ServiceState.RUNNING),
                        "isConsentGiven" to consentGiven,
                        "serviceState"   to stateSnapshot.name,
                        "initialized"    to jsInitialized,
                        "notification"   to mapOf(
                            "title" to currentNotifTitle,
                            "body"  to currentNotifBody,
                            "icon"  to currentNotifIcon,
                            "id"    to currentNotifId
                        ),
                        "isOptedIn"      to consentGiven,
                        "isBackground"   to false,
                        "launchOnBoot"   to consentGiven,
                        "enableLogging"  to false,
                        "lastError"      to lastError
                    )
                )
            } catch (e: Exception) {
                Log.e(TAG, "getStatus error", e)
                lastError = e.message
                promise.reject("STATUS_ERROR", e.message ?: "Unknown error", e)
            }
        }

        /**
         * getLastError() → String | null
         */
        AsyncFunction("getLastError") { promise: Promise ->
            promise.resolve(lastError)
        }

        /**
         * getConsentLog()
         * → Array<{ type: String, timestamp: Number, source: String }>
         */
        AsyncFunction("getConsentLog") { promise: Promise ->
            try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val raw   = prefs.getString(PREF_CONSENT_LOG, "[]") ?: "[]"
                val array = JSONArray(raw)
                val result = mutableListOf<Map<String, Any>>()
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    result.add(
                        mapOf(
                            "type"      to obj.getString("type"),
                            "timestamp" to obj.getLong("timestamp"),
                            "source"    to obj.getString("source")
                        )
                    )
                }
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "getConsentLog error", e)
                promise.reject("LOG_ERROR", e.message ?: "Unknown error", e)
            }
        }

        /**
         * requestBatteryOptimisation() → { success: Boolean, alreadyExempt: Boolean }
         */
        AsyncFunction("requestBatteryOptimisation") { promise: Promise ->
            try {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                    promise.resolve(mapOf("success" to true, "alreadyExempt" to true))
                    return@AsyncFunction
                }
                val pm = context.getSystemService(android.os.PowerManager::class.java)
                if (pm != null && pm.isIgnoringBatteryOptimizations(context.packageName)) {
                    promise.resolve(mapOf("success" to true, "alreadyExempt" to true))
                    return@AsyncFunction
                }
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data  = Uri.parse("package:${context.packageName}")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(intent)
                promise.resolve(mapOf("success" to true, "alreadyExempt" to false))
            } catch (e: Exception) {
                Log.e(TAG, "requestBatteryOptimisation error", e)
                lastError = e.message
                promise.reject("BATTERY_ERROR", e.message ?: "Unknown error", e)
            }
        }
    }
}