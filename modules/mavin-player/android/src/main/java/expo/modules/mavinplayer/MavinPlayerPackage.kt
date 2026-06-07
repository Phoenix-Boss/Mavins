package expo.modules.mavinplayer

import android.view.View
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import java.util.ArrayList

/**
 * MavinPlayerPackage - Registers the MavinPlayer module and video view manager with React Native.
 *
 * This package makes both the MavinPlayerModule (for playback control) and
 * MavinPlayerVideoViewManager (for video surface rendering) available to JavaScript.
 */
class MavinPlayerPackage : ReactPackage, ModulesProvider {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        val modules = ArrayList<NativeModule>()
        // The module is registered via expo-modules-core, so we don't add it here
        return modules
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<View, *>> {
        val viewManagers = ArrayList<ViewManager<View, *>>()
        viewManagers.add(MavinPlayerVideoViewManager())
        return viewManagers
    }

    override fun getModules(): List<Class<out Module>> {
        return listOf(
            MavinPlayerModule::class.java
        )
    }
}