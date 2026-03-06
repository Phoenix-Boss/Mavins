package expo.modules.mavin.honeygain

import android.content.Context
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

    companion object {
        private const val TAG = "HoneygainModule"
        private var isInitialized = false
    }

    override fun definition() = ModuleDefinition {
        Name("Honeygain")

        // Core SDK Functions
        AsyncFunction("initialize") { apiKey: String, promise: Promise ->
            try {
                HgSdk.initialize(context, apiKey)
                isInitialized = true
                
                // Default configuration
                HgSdk.isBackground = true
                HgSdk.launchOnBoot = true
                HgSdk.enableLogging = true
                
                // Setup error monitoring
                HgSdk.onError = { error ->
                    Log.e(TAG, "SDK Error: ${error.message}", error)
                    sendEvent("onError", mapOf(
                        "message" to (error.message ?: "Unknown error")
                    ))
                }
                
                promise.resolve(mapOf(
                    "success" to true,
                    "message" to "SDK initialized"
                ))
            } catch (e: Exception) {
                promise.reject("INIT_ERROR", e.message, e)
            }
        }
        
        AsyncFunction("start") { promise: Promise ->
            try {
                if (!HgSdk.isOptedIn) {
                    promise.resolve(mapOf(
                        "success" to false,
                        "requiresConsent" to true
                    ))
                    return@AsyncFunction
                }
                
                HgSdk.start()
                sendEvent("onSdkStarted", mapOf("timestamp" to System.currentTimeMillis()))
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                promise.reject("START_ERROR", e.message, e)
            }
        }
        
        AsyncFunction("stop") { promise: Promise ->
            try {
                HgSdk.stop()
                sendEvent("onSdkStopped", mapOf("timestamp" to System.currentTimeMillis()))
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                promise.reject("STOP_ERROR", e.message, e)
            }
        }
        
        AsyncFunction("optIn") { promise: Promise ->
            try {
                HgSdk.optIn()
                sendEvent("onConsentGranted", mapOf("timestamp" to System.currentTimeMillis()))
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                promise.reject("OPTIN_ERROR", e.message, e)
            }
        }
        
        AsyncFunction("optOut") { promise: Promise ->
            try {
                HgSdk.optOut()
                sendEvent("onConsentDenied", mapOf("timestamp" to System.currentTimeMillis()))
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                promise.reject("OPTOUT_ERROR", e.message, e)
            }
        }
        
        // ✅ FIXED: No parameters - SDK handles Activity internally
        AsyncFunction("requestConsent") { promise: Promise ->
            try {
                HgSdk.requestConsent()
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                promise.reject("CONSENT_ERROR", e.message, e)
            }
        }
        
        // ✅ FIXED: Only 5 color Ints, no Activity parameter
        AsyncFunction("requestConsentWithStyle") { 
            backgroundColor: Int,
            textColor: Int,
            linksColor: Int,
            buttonTextColor: Int,
            buttonBackgroundResId: Int,
            promise: Promise 
        ->
            try {
                HgSdk.requestConsent(
                    backgroundColor,
                    textColor,
                    linksColor,
                    buttonTextColor,
                    buttonBackgroundResId
                )
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                promise.reject("CONSENT_ERROR", e.message, e)
            }
        }
        
        // ✅ FIXED: Only valid SDK config properties
        AsyncFunction("configure") { config: Map<String, Any>, promise: Promise ->
            try {
                config.forEach { (key, value) ->
                    when (key) {
                        "isBackground" -> HgSdk.isBackground = value as Boolean
                        "launchOnBoot" -> HgSdk.launchOnBoot = value as Boolean
                        "enableLogging" -> HgSdk.enableLogging = value as Boolean
                        else -> Log.w(TAG, "Unknown config key: $key")
                    }
                }
                promise.resolve(mapOf("success" to true))
            } catch (e: Exception) {
                promise.reject("CONFIG_ERROR", e.message, e)
            }
        }
        
        AsyncFunction("getStatus") { promise: Promise ->
            try {
                promise.resolve(mapOf(
                    "isRunning" to HgSdk.isRunning,
                    "isOptedIn" to HgSdk.isOptedIn,
                    "isBackground" to HgSdk.isBackground,
                    "launchOnBoot" to HgSdk.launchOnBoot,
                    "enableLogging" to HgSdk.enableLogging,
                    "lastError" to HgSdk.lastError?.message,
                    "initialized" to isInitialized
                ))
            } catch (e: Exception) {
                promise.reject("STATUS_ERROR", e.message, e)
            }
        }
        
        AsyncFunction("getLastError") { promise: Promise ->
            val error = HgSdk.lastError
            promise.resolve(error?.let { 
                mapOf("message" to (it.message ?: "Unknown")) 
            })
        }
        
        // Properties
        Property("isRunning").get { HgSdk.isRunning }
        Property("isOptedIn").get { HgSdk.isOptedIn }
        Property("isBackground")
            .get { HgSdk.isBackground }
            .set { value: Boolean -> HgSdk.isBackground = value }
        Property("launchOnBoot")
            .get { HgSdk.launchOnBoot }
            .set { value: Boolean -> HgSdk.launchOnBoot = value }
        Property("enableLogging")
            .get { HgSdk.enableLogging }
            .set { value: Boolean -> HgSdk.enableLogging = value }
        
        // Events
        Events("onError", "onConsentGranted", "onConsentDenied", "onSdkStarted", "onSdkStopped")
    }
}