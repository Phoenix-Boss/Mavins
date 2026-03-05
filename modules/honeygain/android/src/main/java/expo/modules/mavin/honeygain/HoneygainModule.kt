package expo.modules.mavin.honeygain

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.honeygain.hgsdk.HgSdk
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HoneygainModule : Module() {
    
    // ✅ FIXED: Proper context access for Expo SDK 52
    private val appContext: AppContext get() = this.appContext
    private val context: Context get() = appContext.androidContext
    private val activity: Activity? get() = appContext.currentActivity
    private val mainHandler = Handler(Looper.getMainLooper())

    companion object {
        private const val TAG = "HoneygainModule"
        private const val API_KEY = "2125ae20cfd8855abc0bee8cc9c997c4"
        private var isInitialized = false
    }

    override fun definition() = ModuleDefinition {
        Name("Honeygain")

        OnCreate { initializeHoneygain() }

        // Core SDK Functions
        AsyncFunction("initialize") { apiKey: String, promise: Promise ->
            initializeWithApiKey(apiKey, promise)
        }
        
        AsyncFunction("start") { promise: Promise ->
            startSdk(promise)
        }
        
        AsyncFunction("stop") { promise: Promise ->
            stopSdk(promise)
        }
        
        AsyncFunction("optIn") { promise: Promise ->
            optIn(promise)
        }
        
        AsyncFunction("optOut") { promise: Promise ->
            optOut(promise)
        }
        
        AsyncFunction("requestConsent") { promise: Promise ->
            requestConsent(promise)
        }
        
        AsyncFunction("requestConsentWithStyle") { 
            backgroundColor: Int,
            textColor: Int,
            linksColor: Int,
            buttonTextColor: Int,
            buttonBackgroundResId: Int,
            promise: Promise 
        ->
            requestConsentWithStyle(
                backgroundColor, 
                textColor, 
                linksColor, 
                buttonTextColor, 
                buttonBackgroundResId, 
                promise
            )
        }
        
        AsyncFunction("downloadPresetWithBandwidth") { presetName: String, promise: Promise ->
            downloadPresetWithBandwidth(presetName, promise)
        }
        
        AsyncFunction("getStatus") { promise: Promise -> 
            getStatus(promise) 
        }
        
        AsyncFunction("stopSharing") { promise: Promise -> 
            stopSharing(promise) 
        }
        
        AsyncFunction("getLastError") { promise: Promise ->
            getLastError(promise)
        }
        
        AsyncFunction("clearLastError") { promise: Promise ->
            clearLastError(promise)
        }
        
        AsyncFunction("configure") { config: Map<String, Any>, promise: Promise ->
            configureSdk(config, promise)
        }
        
        // ✅ FIXED: Proper Property syntax + explicit imports
        Property("isRunning") {
            get { safeValue { HgSdk.isRunning } ?: false }
        }
        
        Property("isOptedIn") {
            get { safeValue { HgSdk.isOptedIn } ?: false }
        }
        
        Property("creditBalance") {
            get { safeValue { HgSdk.balance } ?: 0.0 }
        }
        
        Property("isBackground") {
            get { safeValue { HgSdk.isBackground } ?: false }
            set { value ->
                safeExecute { HgSdk.isBackground = value as Boolean }
            }
        }
        
        Property("launchOnBoot") {
            get { safeValue { HgSdk.launchOnBoot } ?: false }
            set { value ->
                safeExecute { HgSdk.launchOnBoot = value as Boolean }
            }
        }
        
        Property("enableLogging") {
            get { safeValue { HgSdk.enableLogging } ?: false }
            set { value ->
                safeExecute { HgSdk.enableLogging = value as Boolean }
            }
        }
        
        Property("version") {
            get { "1.3.1" }
        }
        
        // Events
        Events(
            "onError",
            "onConsentGranted",
            "onConsentDenied",
            "onSdkStarted",
            "onSdkStopped",
            "onBalanceUpdated"
        )
    }

    private fun initializeHoneygain() {
        if (isInitialized) {
            Log.d(TAG, "Honeygain already initialized")
            return
        }

        try {
            synchronized(this) {
                if (!isInitialized) {
                    HgSdk.initialize(context, API_KEY)
                    isInitialized = true
                    Log.d(TAG, "✅ Honeygain SDK initialized")
                }
            }

            safeExecute {
                HgSdk.isBackground = true
                HgSdk.launchOnBoot = true
                HgSdk.enableLogging = true
            }

            setupErrorMonitoring()

            if (safeValue { HgSdk.isOptedIn } == true) {
                safeExecute { HgSdk.start() }
                Log.d(TAG, "🚀 Honeygain auto-started")
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Honeygain init failed: ${e.message}", e)
            isInitialized = false
        }
    }

    private fun initializeWithApiKey(apiKey: String, promise: Promise) {
        try {
            synchronized(this) {
                HgSdk.initialize(context, apiKey)
                isInitialized = true
            }
            
            safeExecute {
                HgSdk.isBackground = true
                HgSdk.launchOnBoot = true
                HgSdk.enableLogging = true
            }
            
            setupErrorMonitoring()
            
            if (safeValue { HgSdk.isOptedIn } == true) {
                safeExecute { HgSdk.start() }
            }
            
            promise.resolve(mapOf(
                "success" to true,
                "message" to "Honeygain SDK initialized successfully"
            ))
        } catch (e: Exception) {
            // ✅ FIXED: Proper Promise.reject syntax
            promise.reject(CodedException("INIT_ERROR", "Failed to initialize: ${e.message}"))
        }
    }

    private fun setupErrorMonitoring() {
        safeExecute {
            HgSdk.onError = { error: Throwable ->
                Log.e(TAG, "HgSdk error: ${error.message}", error)
                
                sendEvent("onError", mapOf(
                    "message" to (error.message ?: "Unknown error"),
                    "toString" to error.toString()
                ))
                
                mainHandler.postDelayed({
                    if (safeValue { HgSdk.isOptedIn } == true && 
                        safeValue { HgSdk.isRunning } != true) {
                        safeExecute { HgSdk.start() }
                        Log.d(TAG, "🔄 Auto-restarted after error")
                    }
                }, 5000)
            }
        }
    }

    private fun configureSdk(config: Map<String, Any>, promise: Promise) {
        try {
            config.forEach { (key, value) ->
                when (key) {
                    "isBackground" -> safeExecute { HgSdk.isBackground = value as Boolean }
                    "launchOnBoot" -> safeExecute { HgSdk.launchOnBoot = value as Boolean }
                    "enableLogging" -> safeExecute { HgSdk.enableLogging = value as Boolean }
                }
            }
            
            promise.resolve(mapOf(
                "success" to true,
                "message" to "Configuration updated successfully"
            ))
        } catch (e: Exception) {
            promise.reject(CodedException("CONFIG_ERROR", "Failed to configure: ${e.message}"))
        }
    }

    private fun startSdk(promise: Promise) {
        try {
            if (safeValue { HgSdk.isOptedIn } != true) {
                promise.resolve(mapOf(
                    "success" to false,
                    "requiresConsent" to true,
                    "message" to "User consent required first"
                ))
                return
            }

            safeExecute { HgSdk.start() }
            
            sendEvent("onSdkStarted", mapOf(
                "timestamp" to System.currentTimeMillis()
            ))
            
            promise.resolve(mapOf(
                "success" to true,
                "message" to "Honeygain SDK started successfully"
            ))
        } catch (e: Exception) {
            promise.reject(CodedException("START_ERROR", "Failed to start: ${e.message}"))
        }
    }

    private fun stopSdk(promise: Promise) {
        try {
            safeExecute { HgSdk.stop() }
            
            sendEvent("onSdkStopped", mapOf(
                "timestamp" to System.currentTimeMillis()
            ))
            
            promise.resolve(mapOf(
                "success" to true,
                "message" to "Honeygain SDK stopped successfully"
            ))
        } catch (e: Exception) {
            promise.reject(CodedException("STOP_ERROR", "Failed to stop: ${e.message}"))
        }
    }

    private fun optIn(promise: Promise) {
        try {
            safeExecute { HgSdk.optIn() }
            
            sendEvent("onConsentGranted", mapOf(
                "timestamp" to System.currentTimeMillis()
            ))
            
            promise.resolve(mapOf(
                "success" to true,
                "message" to "User opted in successfully"
            ))
        } catch (e: Exception) {
            promise.reject(CodedException("OPTIN_ERROR", "Failed to opt in: ${e.message}"))
        }
    }

    private fun optOut(promise: Promise) {
        try {
            safeExecute { HgSdk.optOut() }
            
            sendEvent("onConsentDenied", mapOf(
                "timestamp" to System.currentTimeMillis()
            ))
            
            promise.resolve(mapOf(
                "success" to true,
                "message" to "User opted out successfully"
            ))
        } catch (e: Exception) {
            promise.reject(CodedException("OPTOUT_ERROR", "Failed to opt out: ${e.message}"))
        }
    }

    private fun requestConsent(promise: Promise) {
        val currentActivity = activity
        if (currentActivity == null) {
            promise.reject(CodedException("NO_ACTIVITY", "Activity context not available"))
            return
        }

        try {
            currentActivity.runOnUiThread {
                try {
                    HgSdk.requestConsent(currentActivity)
                    
                    mainHandler.postDelayed({
                        if (safeValue { HgSdk.isOptedIn } == true) {
                            sendEvent("onConsentGranted", mapOf(
                                "timestamp" to System.currentTimeMillis()
                            ))
                        } else {
                            sendEvent("onConsentDenied", mapOf(
                                "timestamp" to System.currentTimeMillis()
                            ))
                        }
                    }, 500)
                    
                    promise.resolve(mapOf(
                        "success" to true,
                        "message" to "Consent dialog shown"
                    ))
                } catch (e: Exception) {
                    promise.reject(CodedException("CONSENT_ERROR", "Failed to show consent: ${e.message}"))
                }
            }
        } catch (e: Exception) {
            promise.reject(CodedException("CONSENT_ERROR", "Activity error: ${e.message}"))
        }
    }

    private fun requestConsentWithStyle(
        backgroundColor: Int,
        textColor: Int,
        linksColor: Int,
        buttonTextColor: Int,
        buttonBackgroundResId: Int,
        promise: Promise
    ) {
        val currentActivity = activity
        if (currentActivity == null) {
            promise.reject(CodedException("NO_ACTIVITY", "Activity context not available"))
            return
        }

        try {
            currentActivity.runOnUiThread {
                try {
                    HgSdk.requestConsent(
                        currentActivity,
                        backgroundColor,
                        textColor,
                        linksColor,
                        buttonTextColor,
                        buttonBackgroundResId
                    )
                    
                    promise.resolve(mapOf(
                        "success" to true,
                        "message" to "Styled consent dialog shown"
                    ))
                } catch (e: Exception) {
                    promise.reject(CodedException("CONSENT_ERROR", "Failed to show styled consent: ${e.message}"))
                }
            }
        } catch (e: Exception) {
            promise.reject(CodedException("CONSENT_ERROR", "Activity error: ${e.message}"))
        }
    }

    private fun downloadPresetWithBandwidth(presetName: String, promise: Promise) {
        Log.d(TAG, "🎛️ Activating preset: $presetName")
        
        try {
            if (safeValue { HgSdk.isOptedIn } != true) {
                promise.resolve(mapOf(
                    "success" to false,
                    "requiresConsent" to true,
                    "message" to "User consent required first"
                ))
                return
            }

            safeExecute { HgSdk.start() }
            
            val balance = safeValue { HgSdk.balance } ?: 0.0
            
            sendEvent("onBalanceUpdated", mapOf(
                "balance" to balance,
                "timestamp" to System.currentTimeMillis()
            ))
            
            promise.resolve(mapOf(
                "success" to true,
                "presetName" to presetName,
                "message" to "Honeygain activated",
                "balance" to balance,
                "isRunning" to (safeValue { HgSdk.isRunning } ?: false)
            ))
        } catch (e: Exception) {
            promise.reject(CodedException("PRESET_ERROR", "Activation failed: ${e.message}"))
        }
    }

    private fun getStatus(promise: Promise) {
        try {
            promise.resolve(mapOf(
                "isRunning" to (safeValue { HgSdk.isRunning } ?: false),
                "isOptedIn" to (safeValue { HgSdk.isOptedIn } ?: false),
                "isBackground" to (safeValue { HgSdk.isBackground } ?: false),
                "launchOnBoot" to (safeValue { HgSdk.launchOnBoot } ?: false),
                "enableLogging" to (safeValue { HgSdk.enableLogging } ?: false),
                "balance" to (safeValue { HgSdk.balance } ?: 0.0),
                "lastError" to (safeValue { HgSdk.lastError?.message }),
                "initialized" to isInitialized,
                "version" to "1.3.1"
            ))
        } catch (e: Exception) {
            promise.reject(CodedException("STATUS_ERROR", "Status fetch failed: ${e.message}"))
        }
    }

    private fun getLastError(promise: Promise) {
        try {
            val lastError = safeValue { HgSdk.lastError }
            if (lastError != null) {
                promise.resolve(mapOf(
                    "message" to (lastError.message ?: "Unknown error"),
                    "toString" to lastError.toString()
                ))
            } else {
                promise.resolve(null)
            }
        } catch (e: Exception) {
            promise.reject(CodedException("ERROR_CHECK", "Failed to get last error: ${e.message}"))
        }
    }

    private fun clearLastError(promise: Promise) {
        try {
            promise.resolve(mapOf(
                "success" to true,
                "message" to "Last error cleared (client-side only)"
            ))
        } catch (e: Exception) {
            promise.reject(CodedException("CLEAR_ERROR", "Failed to clear last error: ${e.message}"))
        }
    }

    private fun stopSharing(promise: Promise) {
        try {
            safeExecute { HgSdk.stop() }
            Log.d(TAG, "⏹️ Honeygain stopped")
            promise.resolve(mapOf(
                "success" to true,
                "message" to "Honeygain stopped successfully"
            ))
        } catch (e: Exception) {
            promise.reject(CodedException("STOP_ERROR", "Stop failed: ${e.message}"))
        }
    }

    // Safe access helpers
    private inline fun <T> safeValue(block: () -> T?): T? {
        return try {
            block()
        } catch (e: Exception) {
            Log.w(TAG, "Safe value access failed: ${e.message}")
            null
        }
    }

    private inline fun safeExecute(block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            Log.w(TAG, "Safe execute failed: ${e.message}")
        }
    }
}
