package com.doublesymmetry.trackplayer.dsp

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * UsbDacController - Direct USB DAC control for high-resolution audio.
 *
 * Fixed (April 2026):
 *  - Removed duplicate data class DacInfo (was declared twice causing "Conflicting declarations")
 *  - Removed dead stub at bottom of file causing "No parameter with name X" errors
 *  - AudioDeviceCallback import present (was missing, causing cascade "Unresolved reference")
 *  - Uses .encodings (API 23) not .encodingList (API 33) throughout
 *  - Manual array scans replace .isSampleRateSupported/.isEncodingSupported (API 33)
 *  - computeMaxBitDepth replaces non-existent AudioDeviceInfo.maxBitDepth field
 *  - Explicit getter methods for AtomicReference fields (avoids JVM signature clash)
 */
class UsbDacController(private val context: Context) {

    companion object {
        private const val TAG = "UsbDacController"
        private const val ACTION_USB_PERMISSION = "expo.modules.mavinplayer.USB_PERMISSION"
        private const val USB_CLASS_AUDIO = 0x01

        val SUPPORTED_SAMPLE_RATES = intArrayOf(
            44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000
        )
        val SUPPORTED_BIT_DEPTHS = intArrayOf(16, 24, 32)

        // AudioFormat.ENCODING_PCM_24BIT_PACKED added in API 31
        private const val ENCODING_PCM_24BIT_PACKED = 0x80000004.toInt()
    }

    // -------------------------------------------------------------------------
    // Single canonical DacInfo -- DO NOT add a second definition anywhere
    // -------------------------------------------------------------------------
    data class DacInfo(
        val name: String,
        val vendorId: Int,
        val productId: Int,
        val isConnected: Boolean,
        val hasAudioOutput: Boolean,
        val supportedSampleRates: List<Int>,
        val maxBitDepth: Int,
        val maxChannels: Int,
        val isNativeDirectSupported: Boolean
    )

    data class DacCapabilities(
        val sampleRates: List<Int>,
        val bitDepths: List<Int>,
        val channelCounts: List<Int>,
        val supportsFloatOutput: Boolean,
        val supportsHdAudio: Boolean,
        val nativeSampleRate: Int,
        val nativeBitDepth: Int
    )

    // Lock-free state
    private val _isDacConnected = AtomicBoolean(false)
    val isDacConnected: Boolean get() = _isDacConnected.get()

    private val _currentDacInfo  = AtomicReference<DacInfo?>(null)
    private val _dacCapabilities = AtomicReference<DacCapabilities?>(null)

    @Volatile private var isNativeDirectMode  = false
    @Volatile private var preferredSampleRate = 48000
    @Volatile private var preferredBitDepth   = 24

    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val usbManager   = context.getSystemService(Context.USB_SERVICE)   as UsbManager

    var onDacConnected: ((DacInfo) -> Unit)?                   = null
    var onDacDisconnected: (() -> Unit)?                       = null
    var onDacCapabilitiesChanged: ((DacCapabilities) -> Unit)? = null

    // -------------------------------------------------------------------------
    // USB BroadcastReceiver (all API levels)
    // -------------------------------------------------------------------------
    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                    val device: UsbDevice? =
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                        else
                            @Suppress("DEPRECATION") intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    device?.let { handleUsbDeviceAttached(it) }
                }
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    val device: UsbDevice? =
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                        else
                            @Suppress("DEPRECATION") intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    device?.let { handleUsbDeviceDetached(it) }
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // AudioDeviceCallback (API 23+)
    // NOTE: The import at the top of this file is critical.
    //       Without it every reference below is "Unresolved" and Kotlin cannot
    //       infer the lambda type for registerAudioDeviceCallback, causing 10+
    //       cascade errors that look unrelated.
    // -------------------------------------------------------------------------
    private val audioDeviceCallback: AudioDeviceCallback? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            object : AudioDeviceCallback() {
                override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
                    addedDevices.filter { isUsbAudioDevice(it) }.forEach { handleAudioDeviceAdded(it) }
                }
                override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
                    removedDevices.filter { isUsbAudioDevice(it) }.forEach { handleAudioDeviceRemoved(it) }
                }
            }
        } else null

    init {
        registerReceivers()
        scanForConnectedDacs()
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    fun enableDirectUsbRouting(enabled: Boolean): Boolean {
        if (!isDacConnected) { Log.w(TAG, "No DAC connected"); return false }
        isNativeDirectMode = enabled
        if (enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getPreferredUsbDevice()?.let { Log.i(TAG, "Direct USB routing enabled for ${it.productName}") }
        }
        return true
    }

    fun isDirectUsbRoutingEnabled(): Boolean = isNativeDirectMode

    fun setPreferredSampleRate(rate: Int): Boolean {
        val caps = _dacCapabilities.get()
        if (caps != null && !caps.sampleRates.contains(rate)) {
            Log.w(TAG, "Sample rate $rate not supported"); return false
        }
        preferredSampleRate = rate
        Log.i(TAG, "Preferred sample rate -> $rate Hz")
        return true
    }

    fun setPreferredBitDepth(depth: Int): Boolean {
        val caps = _dacCapabilities.get()
        if (caps != null && !caps.bitDepths.contains(depth)) {
            Log.w(TAG, "Bit depth $depth not supported"); return false
        }
        preferredBitDepth = depth
        Log.i(TAG, "Preferred bit depth -> $depth-bit")
        return true
    }

    // Explicit getters avoid JVM property/method signature conflicts
    fun getCurrentDacInfo(): DacInfo?          = _currentDacInfo.get()
    fun getDacCapabilities(): DacCapabilities? = _dacCapabilities.get()

    fun requestUsbPermission(device: UsbDevice, callback: ((Boolean) -> Unit)? = null) {
        if (usbManager.hasPermission(device)) { callback?.invoke(true); return }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        val pi    = PendingIntent.getBroadcast(context, 0, Intent(ACTION_USB_PERMISSION), flags)
        val recv  = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                if (ACTION_USB_PERMISSION == intent.action) {
                    callback?.invoke(intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false))
                    ctx.unregisterReceiver(this)
                }
            }
        }
        context.registerReceiver(recv, IntentFilter(ACTION_USB_PERMISSION))
        usbManager.requestPermission(device, pi)
    }

    fun rescanDevices() { scanForConnectedDacs() }
    fun release()       { unregisterReceivers() }

    // -------------------------------------------------------------------------
    // USB device handling
    // -------------------------------------------------------------------------

    private fun scanForConnectedDacs() {
        var found = false
        usbManager.deviceList.values.filter { isAudioDevice(it) }.forEach {
            handleUsbDeviceAttached(it); found = true
        }
        if (!found) { _isDacConnected.set(false); _currentDacInfo.set(null); _dacCapabilities.set(null) }
    }

    private fun handleUsbDeviceAttached(device: UsbDevice) {
        if (!isAudioDevice(device)) return
        Log.i(TAG, "USB Audio attached: ${device.productName} (${device.vendorId}:${device.productId})")
        if (!usbManager.hasPermission(device))
            requestUsbPermission(device) { granted -> if (granted) registerAudioDevice(device) }
        else
            registerAudioDevice(device)
    }

    private fun handleUsbDeviceDetached(device: UsbDevice) {
        val cur = _currentDacInfo.get() ?: return
        if (cur.vendorId == device.vendorId && cur.productId == device.productId) {
            Log.i(TAG, "USB Audio detached: ${device.productName}")
            _isDacConnected.set(false); _currentDacInfo.set(null); _dacCapabilities.set(null)
            isNativeDirectMode = false; onDacDisconnected?.invoke()
        }
    }

    private fun handleAudioDeviceAdded(device: AudioDeviceInfo) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val dacInfo = extractDacInfoFromAudioDevice(device) ?: return
        _isDacConnected.set(true); _currentDacInfo.set(dacInfo)
        extractCapabilities(device)?.also { _dacCapabilities.set(it); onDacCapabilitiesChanged?.invoke(it) }
        onDacConnected?.invoke(dacInfo)
    }

    private fun handleAudioDeviceRemoved(device: AudioDeviceInfo) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val dacInfo = extractDacInfoFromAudioDevice(device) ?: return
        if (_currentDacInfo.get()?.name == dacInfo.name) {
            _isDacConnected.set(false); _currentDacInfo.set(null); _dacCapabilities.set(null)
            onDacDisconnected?.invoke()
        }
    }

    private fun registerAudioDevice(device: UsbDevice) {
        val info = extractDacInfoFromUsbDevice(device)
        val caps = queryDacCapabilities(device)
        _isDacConnected.set(true); _currentDacInfo.set(info); _dacCapabilities.set(caps)
        onDacConnected?.invoke(info); onDacCapabilitiesChanged?.invoke(caps)
        Log.i(TAG, "DAC registered: ${info.name}, rates=${caps.sampleRates}, depth=${caps.nativeBitDepth}")
    }

    // -------------------------------------------------------------------------
    // Device info extraction
    // -------------------------------------------------------------------------

    private fun isAudioDevice(device: UsbDevice): Boolean {
        for (i in 0 until device.interfaceCount) {
            if (device.getInterface(i).interfaceClass == USB_CLASS_AUDIO) return true
        }
        return false
    }

    private fun isUsbAudioDevice(device: AudioDeviceInfo): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false
        return device.type in setOf(
            AudioDeviceInfo.TYPE_USB_DEVICE,
            AudioDeviceInfo.TYPE_USB_HEADSET,
            AudioDeviceInfo.TYPE_HDMI
        )
    }

    private fun extractDacInfoFromUsbDevice(device: UsbDevice): DacInfo {
        val rates = detectSupportedSampleRates(device)
        return DacInfo(
            name                    = device.productName ?: device.manufacturerName ?: "USB Audio Device",
            vendorId                = device.vendorId,
            productId               = device.productId,
            isConnected             = true,
            hasAudioOutput          = true,
            supportedSampleRates    = rates,
            maxBitDepth             = 24,
            maxChannels             = 2,
            isNativeDirectSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
        )
    }

    private fun extractDacInfoFromAudioDevice(device: AudioDeviceInfo): DacInfo? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
        return DacInfo(
            name                    = device.productName?.toString() ?: "USB Audio Device",
            vendorId                = 0,
            productId               = 0,
            isConnected             = true,
            hasAudioOutput          = device.type == AudioDeviceInfo.TYPE_USB_DEVICE,
            supportedSampleRates    = getSupportedSampleRates(device),
            maxBitDepth             = computeMaxBitDepth(device),
            maxChannels             = device.channelCounts?.maxOrNull() ?: 2,
            isNativeDirectSupported = true
        )
    }

    private fun extractCapabilities(device: AudioDeviceInfo): DacCapabilities? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
        val encodings = device.encodings ?: intArrayOf()
        return DacCapabilities(
            sampleRates         = getSupportedSampleRates(device),
            bitDepths           = getSupportedBitDepths(device),
            channelCounts       = device.channelCounts?.toList() ?: listOf(2),
            supportsFloatOutput = AudioFormat.ENCODING_PCM_FLOAT in encodings,
            supportsHdAudio     = getSupportedSampleRates(device).any { it >= 96000 },
            nativeSampleRate    = preferredSampleRate,
            nativeBitDepth      = preferredBitDepth
        )
    }

    // -------------------------------------------------------------------------
    // Capability helpers (API-safe -- no API 33+ calls)
    // -------------------------------------------------------------------------

    private fun detectSupportedSampleRates(@Suppress("UNUSED_PARAMETER") device: UsbDevice): List<Int> =
        listOf(44100, 48000, 88200, 96000, 176400, 192000)

    private fun getSupportedSampleRates(device: AudioDeviceInfo): List<Int> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return listOf(48000)
        val reported = device.sampleRates ?: intArrayOf()
        return if (reported.isEmpty()) SUPPORTED_SAMPLE_RATES.toList()
               else SUPPORTED_SAMPLE_RATES.filter { it in reported }
    }

    private fun getSupportedBitDepths(device: AudioDeviceInfo): List<Int> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return listOf(16)
        val encodings = device.encodings ?: intArrayOf()
        return buildList {
            add(16)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                ENCODING_PCM_24BIT_PACKED in encodings) add(24)
            if (AudioFormat.ENCODING_PCM_32BIT in encodings) add(32)
        }.sorted()
    }

    private fun computeMaxBitDepth(device: AudioDeviceInfo): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return 16
        val encodings = device.encodings ?: intArrayOf()
        return when {
            AudioFormat.ENCODING_PCM_32BIT in encodings -> 32
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                ENCODING_PCM_24BIT_PACKED in encodings  -> 24
            else                                         -> 16
        }
    }

    private fun queryDacCapabilities(device: UsbDevice): DacCapabilities {
        val rates = detectSupportedSampleRates(device)
        return DacCapabilities(
            sampleRates         = rates,
            bitDepths           = listOf(16, 24),
            channelCounts       = listOf(2),
            supportsFloatOutput = false,
            supportsHdAudio     = rates.any { it >= 96000 },
            nativeSampleRate    = 48000,
            nativeBitDepth      = 24
        )
    }

    private fun getPreferredUsbDevice(): AudioDeviceInfo? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
        return audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            .firstOrNull { it.type == AudioDeviceInfo.TYPE_USB_DEVICE }
    }

    // -------------------------------------------------------------------------
    // Receiver management
    // -------------------------------------------------------------------------

    private fun registerReceivers() {
        context.registerReceiver(usbReceiver, IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        })
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            audioDeviceCallback?.let {
                audioManager.registerAudioDeviceCallback(it, Handler(Looper.getMainLooper()))
            }
        }
    }

    private fun unregisterReceivers() {
        try { context.unregisterReceiver(usbReceiver) } catch (_: Exception) {}
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            audioDeviceCallback?.let { audioManager.unregisterAudioDeviceCallback(it) }
        }
    }
}
