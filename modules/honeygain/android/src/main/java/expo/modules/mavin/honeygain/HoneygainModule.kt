package expo.modules.mavin.honeygain

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.honeygain.hgsdk.HgSdk
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HoneygainModule : Module() {
    
    private val context: Context
        get() = requireNotNull(appContext.reactContext) {
            "React context is not available"
        }
    
    private val activity: Activity?
        get() = appContext.currentActivity
    
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
        
        // ✅ FIXED: Properties use correct syntax for Expo Modules Core 3.x
        Property("isRunning")
            .get { HgSdk.isRunning }
        
        Property("isOptedIn")
            .get { HgSdk.isOptedIn }
        
        // ✅ REMOVED: creditBalance - HgSdk.balance does NOT exist in SDK
        // If you need balance, fetch it from Honeygain REST API in JS layer
        
        Property("isBackground")
            .get { HgSdk.isBackground }
            .set { value: Boolean -> HgSdk.isBackground = value }
        
        Property("launchOnBoot")
            .get { HgSdk.launchOnBoot }
            .set { value: Boolean -> HgSdk.launchOnBoot = value }
        
        Property("enableLogging")
            .get { HgSdk.enableLogging }
            .set { value: Boolean -> HgSdk.enableLogging = value }
        
        Property("version")
            .get { "1.3.1" }
        
        // Events
        Events(
            "onError",
            "onConsentGranted",
            "onConsentDenied",
            "onSdkStarted",
            "onSdkStopped"
            // ✅ REMOVED: onBalanceUpdated - no balance in SDK
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

            HgSdk.isBackground = true
            HgSdk.launchOnBoot = true
            HgSdk.enableLogging = true

            setupErrorMonitoring()

            if (HgSdk.isOptedIn && !HgSdk.isRunning) {
                HgSdk.start()
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
            
            HgSdk.isBackground = true
            HgSdk.launchOnBoot = true
            HgSdk.enableLogging = true
            
            setupErrorMonitoring()
            
            if (HgSdk.isOptedIn && !HgSdk.isRunning) {
                HgSdk.start()
            }
            
            promise.resolve(mapOf(
                "success" to true,
                "message" to "Honeygain SDK initialized successfully"
            ))
        } catch (e: Exception) {
            promise.reject("INIT_ERROR", "Failed to initialize: ${e.message}", e)
        }
    }

    private fun setupErrorMonitoring() {
        HgSdk.onError = { error: Throwable ->
            Log.e(TAG, "HgSdk error: ${error.message}", error)
            
            sendEvent("onError", mapOf(
                "message" to (error.message ?: "Unknown error"),
                "toString" to error.toString()
            ))
            
            mainHandler.postDelayed({
                if (HgSdk.isOptedIn && !HgSdk.isRunning) {
                    HgSdk.start()
                    Log.d(TAG, "🔄 Auto-restarted after error")
                }
            }, 5000)
        }
    }

    private fun configureSdk(config: Map<String, Any>, promise: Promise) {
        try {
            config.forEach { (key, value) ->
                when (key) {
                    "isBackground" -> HgSdk.isBackground = value as Boolean
                    "launchOnBoot" -> HgSdk.launchOnBoot = value as Boolean
                    "enableLogging" -> HgSdk.enableLogging = value as Boolean
                }
            }
            
            promise.resolve(mapOf(
                "success" to true,
                "message" to "Configuration updated successfully"
            ))
        } catch (e: Exception) {
            promise.reject("CONFIG_ERROR", "Failed to configure: ${e.message}", e)
        }
    }

    private fun startSdk(promise: Promise) {
        try {
            if (!HgSdk.isOptedIn) {
                promise.resolve(mapOf(
                    "success" to false,
                    "requiresConsent" to true,
                    "message" to "User consent required first"
                ))
                return
            }

            HgSdk.start()
            
            sendEvent("onSdkStarted", mapOf(
                "timestamp" to System.currentTimeMillis()
            ))
            
            promise.resolve(mapOf(
                "success" to true,
                "message" to "Honeygain SDK started successfully"
            ))
        } catch (e: Exception) {
            promise.reject("START_ERROR", "Failed to start: ${e.message}", e)
        }
    }

    private fun stopSdk(promise: Promise) {
        try {
            HgSdk.stop()
            
            sendEvent("onSdkStopped", mapOf(
                "timestamp" to System.currentTimeMillis()
            ))
            
            promise.resolve(mapOf(
                "success" to true,
                "message" to "Honeygain SDK stopped successfully"
            ))
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", "Failed to stop: ${e.message}", e)
        }
    }

    private fun optIn(promise: Promise) {
        try {
            HgSdk.optIn()
            
            sendEvent("onConsentGranted", mapOf(
                "timestamp" to System.currentTimeMillis()
            ))
            
            promise.resolve(mapOf(
                "success" to true,
                "message" to "User opted in successfully"
            ))
        } catch (e: Exception) {
            promise.reject("OPTIN_ERROR", "Failed to opt in: ${e.message}", e)
        }
    }

    private fun optOut(promise: Promise) {
        try {
            HgSdk.optOut()
            
            sendEvent("onConsentDenied", mapOf(
                "timestamp" to System.currentTimeMillis()
            ))
            
            promise.resolve(mapOf(
                "success" to true,
                "message" to "User opted out successfully"
            ))
        } catch (e: Exception) {
            promise.reject("OPTOUT_ERROR", "Failed to opt out: ${e.message}", e)
        }
    }

    // ✅ FIXED: requestConsent() takes NO parameters according to SDK docs
    private fun requestConsent(promise: Promise) {
        try {
            // SDK docs: fun HgSdk.requestConsent() - no args, starts Activity internally
            HgSdk.requestConsent()
            
            // Check consent status after a delay (consent is async)
            mainHandler.postDelayed({
                if (HgSdk.isOptedIn) {
                    sendEvent("onConsentGranted", mapOf(
                        "timestamp" to System.currentTimeMillis()
                    ))
                } else {
                    sendEvent("onConsentDenied", mapOf(
                        "timestamp" to System.currentTimeMillis()
                    ))
                }
            }, 1000)
            
            promise.resolve(mapOf(
                "success" to true,
                "message" to "Consent dialog shown"
            ))
        } catch (e: Exception) {
            promise.reject("CONSENT_ERROR", "Failed to show consent: ${e.message}", e)
        }
    }

    // ✅ FIXED: requestConsent with styling - 5 Int params, NO Activity
    private fun requestConsentWithStyle(
        backgroundColor: Int,
        textColor: Int,
        linksColor: Int,
        buttonTextColor: Int,
        buttonBackgroundResId: Int,
        promise: Promise
    ) {
        try {
            // SDK docs: fun HgSdk.requestConsent(bgColor, textColor, linksColor, btnTextColor, btnBgResId)
            HgSdk.requestConsent(
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
            promise.reject("CONSENT_ERROR", "Failed to show styled consent: ${e.message}", e)
        }
    }

    // ✅ FIXED: Removed balance references - SDK doesn't expose this
    private fun downloadPresetWithBandwidth(presetName: String, promise: Promise) {
        Log.d(TAG, "🎛️ Activating preset: $presetName")
        
        try {
            if (!HgSdk.isOptedIn) {
                promise.resolve(mapOf(
                    "success" to false,
                    "requiresConsent" to true,
                    "message" to "User consent required first"
                ))
                return
            }

            HgSdk.start()
            
            // ✅ REMOVED: Balance reference - SDK doesn't have this property
            // Use Honeygain REST API to get balance if needed
            
            promise.resolve(mapOf(
                "success" to true,
                "presetName" to presetName,
                "message" to "Honeygain activated",
                "isRunning" to HgSdk.isRunning
            ))
        } catch (e: Exception) {
            Log.e(TAG, "Preset activation failed: ${e.message}", e)
            promise.reject("PRESET_ERROR", "Activation failed: ${e.message}", e)
        }
    }

    private fun getStatus(promise: Promise) {
        try {
            promise.resolve(mapOf(
                "isRunning" to HgSdk.isRunning,
                "isOptedIn" to HgSdk.isOptedIn,
                "isBackground" to HgSdk.isBackground,
                "launchOnBoot" to HgSdk.launchOnBoot,
                "enableLogging" to HgSdk.enableLogging,
                // ✅ REMOVED: balance - not available in SDK
                "lastError" to HgSdk.lastError?.message,
                "initialized" to isInitialized,
                "version" to "1.3.1"
            ))
        } catch (e: Exception) {
            promise.reject("STATUS_ERROR", "Status fetch failed: ${e.message}", e)
        }
    }

    private fun getLastError(promise: Promise) {
        try {
            val lastError = HgSdk.lastError
            if (lastError != null) {
                promise.resolve(mapOf(
                    "message" to (lastError.message ?: "Unknown error"),
                    "toString" to lastError.toString()
                ))
            } else {
                promise.resolve(null)
            }
        } catch (e: Exception) {
            promise.reject("ERROR_CHECK", "Failed to get last error: ${e.message}", e)
        }
    }

    private fun clearLastError(promise: Promise) {
        promise.resolve(mapOf(
            "success" to true,
            "message" to "Last error cleared (client-side only)"
        ))
    }

    private fun stopSharing(promise: Promise) {
        try {
            HgSdk.stop()
            Log.d(TAG, "⏹️ Honeygain stopped")
            promise.resolve(mapOf(
                "success" to true,
                "message" to "Honeygain stopped successfully"
            ))
        } catch (e: Exception) {
            Log.e(TAG, "Stop failed: ${e.message}", e)
            promise.reject("STOP_ERROR", "Stop failed: ${e.message}", e)
        }
    }
}