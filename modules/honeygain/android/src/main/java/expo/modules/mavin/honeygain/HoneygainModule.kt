/**
 * HoneygainModule.kt
 * package expo.modules.mavin.honeygain
 *
 * Expo Module wrapping the Pawns SDK (app.pawns:android-pawns-sdk:1.8.1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  REQUIRED AndroidManifest.xml additions (copy into your manifest or inject
 *  via the Expo config plugin — see withPawns.js):
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  <!-- Internet + network-state permissions -->
 *  <uses-permission android:name="android.permission.INTERNET" />
 *  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
 *
 *  <!-- Foreground-service permission (API 28+) -->
 *  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
 *
 *  <!-- Foreground service type: specialUse (Android 14 / API 34+) -->
 *  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
 *
 *  <!-- Battery-optimisation bypass (requested at runtime) -->
 *  <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
 *
 *  <!-- Boot-complete receiver -->
 *  <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
 *
 *  Inside <application …>:
 *
 *  <!-- Foreground service declaration -->
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
 *  <!-- Optional background-service declaration (only if using BACKGROUND type) -->
 *  <service
 *      android:name="com.pawns.sdk.internal.service.PeerServiceBackground"
 *      android:exported="false" />
 *
 *  <!-- Notification channel name shown in Android Settings → App info → Notifications -->
 *  <meta-data
 *      android:name="com.pawns.sdk.pawns_service_channel_name"
 *      android:value="@string/pawns_channel_name" />
 *
 *  <!-- Boot-complete receiver -->
 *  <receiver
 *      android:name=".PawnsBootReceiver"
 *      android:exported="false">
 *      <intent-filter>
 *          <action android:name="android.intent.action.BOOT_COMPLETED" />
 *      </intent-filter>
 *  </receiver>
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  build.gradle (module) — required dependency:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  // settings.gradle (project root) — add JitPack:
 *  dependencyResolutionManagement {
 *      repositories {
 *          maven { url = uri("https://jitpack.io") }
 *      }
 *  }
 *
 *  // module/build.gradle dependencies block:
 *  implementation("app.pawns:android-pawns-sdk:1.8.1")
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Application class — initialize the Pawns SDK in Application.onCreate():
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  class MainApplication : Application(), ReactApplication {
 *      override fun onCreate() {
 *          super.onCreate()
 *          // Build without ServiceConfig — module supplies the notification dynamically
 *          Pawns.Builder(this)
 *              .apiKey(BuildConfig.PAWNS_API_KEY)  // or read from your secrets mechanism
 *              .serviceType(ServiceType.FOREGROUND)
 *              .build()
 *      }
 *  }
 *
 *  Alternatively, if you want the JS layer to supply the API key (no Application class
 *  change needed), the initialize() function in this module will call Pawns.Builder
 *  directly when the SDK has not yet been initialised.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Consent event logging:
 * ─────────────────────────────────────────────────────────────────────────────
 *  Every opt-in, opt-out, and requestConsent result is appended to a JSON array
 *  stored in SharedPreferences under key "consent_log". Each entry:
 *    { "type": "opt_in"|"opt_out"|"consent_granted"|"consent_denied",
 *      "timestamp": <epoch-ms>,
 *      "source": "programmatic"|"sdk_ui" }
 *  Entries older than 24 months are pruned on each write.
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
         * from the same channel and icon logic without duplicating code.
         *
         * @param context    Application/base context.
         * @param title      Notification content title.
         * @param body       Notification content text.
         * @param iconName   Drawable resource name (no path / no extension).
         *                   Falls back to the generic notification icon if not found.
         */
        fun buildNotification(
            context: Context,
            title: String,
            body: String,
            iconName: String
        ): Notification {
            ensureNotificationChannel(context)

            val iconRes = resolveDrawableResource(context, iconName)

            // Tap the notification → open the launcher activity
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
         * Creates the notification channel on API 26+. Safe to call repeatedly;
         * the system ignores duplicate channel registrations.
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
         * Falls back to android.R.drawable.ic_dialog_info if the name is not found.
         */
        fun resolveDrawableResource(context: Context, iconName: String): Int {
            val id = context.resources.getIdentifier(
                iconName, "drawable", context.packageName
            )
            return if (id != 0) id else android.R.drawable.ic_dialog_info
        }

        /**
         * Appends a consent event to the persistent log and prunes entries older
         * than 24 months. Thread-safe via SharedPreferences synchronised commit.
         *
         * @param context   Application/base context.
         * @param type      Event type string: "opt_in" | "opt_out" | "consent_granted" | "consent_denied".
         * @param source    Origin: "programmatic" | "sdk_ui".
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

                // Prune entries older than 24 months
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

    /** Last error text surfaced to the JS layer via getLastError(). */
    private var lastError: String? = null

    /** Current notification configuration, updated each time JS supplies values. */
    private var currentNotifTitle = DEFAULT_NOTIF_TITLE
    private var currentNotifBody  = DEFAULT_NOTIF_BODY
    private var currentNotifIcon  = DEFAULT_NOTIF_ICON
    private var currentNotifId    = NOTIFICATION_ID

    /** Whether the JS layer has called initialize() at least once. */
    private var jsInitialized = false

    /**
     * Coroutine scope tied to this module's lifetime.
     * Cancelled in onDestroy to prevent leaks.
     */
    private val moduleScope = CoroutineScope(Dispatchers.Main + Job())

    /**
     * Tracks previous RUNNING state so we only fire onSdkStarted once per
     * transition from non-running → running.
     */
    private var wasRunning = false

    /**
     * SDK-provided PawnsServiceListener.
     * Registered in startServiceStateObserver and unregistered in onDestroy.
     */
    private val pawnsListener = object : PawnsServiceListener {
        override fun onStateChange(state: ServiceState) {
            handleStateChange(state)
        }
    }

    // ─── Activity-result launcher for the SDK consent screen ─────────────────

    private var consentActivityLauncher: ActivityResultLauncher<Intent>? = null
    private var pendingConsentPromise: Promise? = null

    // ─── Internal helpers ─────────────────────────────────────────────────────

    /**
     * Applies any non-null notification options supplied from JS, persisting
     * them in SharedPreferences so the boot receiver can restore them.
     */
    private fun applyNotifOptions(options: Map<String, Any?>) {
        (options["notificationTitle"] as? String)?.let { currentNotifTitle = it }
        (options["notificationBody"]  as? String)?.let { currentNotifBody  = it }
        (options["notificationIcon"]  as? String)?.let { currentNotifIcon  = it }
        (options["notificationId"]    as? Number)?.let { currentNotifId    = it.toInt() }

        // Persist for boot receiver
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply {
            putString(PREF_NOTIF_TITLE, currentNotifTitle)
            putString(PREF_NOTIF_BODY,  currentNotifBody)
            putString(PREF_NOTIF_ICON,  currentNotifIcon)
            putInt(PREF_NOTIF_ID,       currentNotifId)
            apply()
        }
    }

    /** Builds a Notification from the current in-memory configuration. */
    private fun buildCurrentNotification(): Notification =
        buildNotification(context, currentNotifTitle, currentNotifBody, currentNotifIcon)

    /**
     * Handles every service state change from both listener and coroutine paths.
     */
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
     * Registers the PawnsServiceListener and launches a coroutine collector
     * as a belt-and-suspenders approach (listener for immediate callbacks,
     * StateFlow for reliability across configuration changes).
     */
    private fun startServiceStateObserver() {
        try {
            Pawns.getInstance().registerListener(pawnsListener)
        } catch (e: Exception) {
            Log.w(TAG, "Could not register PawnsServiceListener: ${e.message}")
        }

        moduleScope.launch {
            try {
                Pawns.getInstance().getServiceState().collectLatest { state ->
                    handleStateChange(state)
                }
            } catch (e: Exception) {
                Log.w(TAG, "State-flow collection ended: ${e.message}")
            }
        }
    }

    /**
     * Ensures the Pawns SDK singleton is initialised. If Application.onCreate()
     * already called Pawns.Builder, this is a no-op (the getInstance() call
     * below will succeed). If not (e.g. the app hasn't set up a custom Application
     * class), we initialise the SDK here with the supplied API key.
     *
     * @param apiKey  The API key from the JS layer.
     */
    private fun ensureSdkInitialized(apiKey: String) {
        try {
            // If SDK is already initialised this will not throw
            Pawns.getInstance()
        } catch (e: Exception) {
            // SDK not yet initialised — build it now
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

        // ── Events ───────────────────────────────────────────────────────────

        Events(
            EVENT_SDK_STARTED,
            EVENT_SDK_STOPPED,
            EVENT_CONSENT_GRANTED,
            EVENT_CONSENT_DENIED,
            EVENT_ERROR
        )

        // ── Lifecycle ────────────────────────────────────────────────────────

        /**
         * Register the activity-result launcher for the SDK consent screen.
         * Must be done in OnCreate so we have a valid ComponentActivity reference
         * before any async function is called.
         */
        OnCreate {
            val activity = appContext.currentActivity ?: return@OnCreate
            consentActivityLauncher = activity.registerForActivityResult(
                ActivityResultContracts.StartActivityForResult()
            ) { result ->
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
         *
         * options shape (all fields optional):
         *   notificationTitle: string   — e.g. "Mavin is running"
         *   notificationBody:  string   — e.g. "Sharing bandwidth to earn rewards"
         *   notificationIcon:  string   — drawable name, e.g. "ic_stat_mavin"
         *   notificationId:    number   — stable integer ID (default: 9901)
         *
         * If the Pawns SDK has not been initialised in Application.onCreate(), this
         * function initialises it using the supplied apiKey.
         */
        AsyncFunction("initialize") { apiKey: String, options: Map<String, Any?>?, promise: Promise ->
            try {
                if (options != null) applyNotifOptions(options)

                ensureSdkInitialized(apiKey)
                jsInitialized = true
                startServiceStateObserver()

                // Snapshot current running state in case the service was already started
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
         * Builds a fully custom Notification from JS-supplied (or previously
         * stored) title / body / icon and calls:
         *   Pawns.getInstance().startSharing(context, notification, notificationId)
         *
         * Any option supplied here overrides what was set in initialize().
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
         *
         * Custom-UI consent path: call this when YOUR consent UI has collected consent.
         * Fires onConsentGranted event and logs the event.
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
         *
         * Revokes consent and stops sharing. Fires onConsentDenied event and logs the event.
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
         * Launches the SDK-provided consent Activity.
         * Resolution is deferred until the Activity returns a result.
         *
         * RESULT_OK  → consent granted  → fires onConsentGranted event
         * otherwise  → consent declined → fires onConsentDenied event
         *
         * Note: The SDK sets consentGiven internally when the user accepts via its UI.
         * Do NOT call setConsentGiven() after this — it would double-set.
         */
        AsyncFunction("requestConsent") { promise: Promise ->
            try {
                val launcher = consentActivityLauncher
                if (launcher == null) {
                    promise.reject(
                        "CONSENT_ERROR",
                        "Activity result launcher not ready. Ensure the module is " +
                            "attached to an Activity before calling requestConsent().",
                        null
                    )
                    return@AsyncFunction
                }

                if (Pawns.getInstance().isConsentGiven()) {
                    // Already consented — resolve immediately without launching UI
                    promise.resolve(mapOf("success" to true, "consentGranted" to true))
                    return@AsyncFunction
                }

                pendingConsentPromise = promise
                val consentIntent = Pawns.getInstance().getConsentIntent(context)
                launcher.launch(consentIntent)
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
         *     serviceState:   String,   // "IDLE"|"STARTING"|"RUNNING"|"STOPPING"|"STOPPED"|"ERROR"
         *     initialized:    Boolean,
         *     notification: {
         *         title: String,
         *         body:  String,
         *         icon:  String,
         *         id:    Number
         *     }
         *   }
         *
         * Also exposes legacy-compatible aliases:
         *   isOptedIn   = isConsentGiven
         *   isBackground = false  (module always uses FOREGROUND service)
         *   launchOnBoot = true if consent is given (boot receiver auto-starts)
         *   enableLogging = false (use Android logcat for debug logging)
         */
        AsyncFunction("getStatus") { promise: Promise ->
            try {
                val stateSnapshot = Pawns.getInstance().getServiceStateSnapshot()
                val consentGiven  = Pawns.getInstance().isConsentGiven()
                promise.resolve(
                    mapOf(
                        // Primary fields
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
                        // Legacy-compatible aliases for callers that used Honeygain API
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
         *
         * Returns the full 24-month consent event log. Intended for compliance
         * reporting and internal audit purposes only — do not expose in UI.
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
         *
         * Opens the system battery-optimisation exemption dialog for this app.
         * On Android < M this is a no-op (exempt by default).
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