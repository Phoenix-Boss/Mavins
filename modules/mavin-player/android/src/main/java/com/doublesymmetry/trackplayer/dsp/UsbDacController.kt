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

class UsbDacController(private val context: Context) {

    companion object {
        private const val TAG = "UsbDacController"
        private const val ACTION_USB_PERMISSION = "expo.modules.mavinplayer.USB_PERMISSION"
        private const val USB_CLASS_AUDIO = 0x01
        val SUPPORTED_SAMPLE_RATES = intArrayOf(44100,48000,88200,96000,176400,192000,352800,384000,705600,768000)
        val SUPPORTED_BIT_DEPTHS   = intArrayOf(16, 24, 32)
        private const val ENCODING_PCM_24BIT_PACKED = 0x80000004.toInt()
    }

    // Single canonical DacInfo -- only one definition in this file
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

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val device: UsbDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
            else @Suppress("DEPRECATION") intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
            when (intent.action) {
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> device?.let { handleUsbDeviceAttached(it) }
                UsbManager.ACTION_USB_DEVICE_DETACHED -> device?.let { handleUsbDeviceDetached(it) }
            }
        }
    }

    private val audioDeviceCallback: AudioDeviceCallback? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(a: Array<out AudioDeviceInfo>)   { a.filter { isUsbAudioDevice(it) }.forEach { handleAudioDeviceAdded(it) } }
            override fun onAudioDevicesRemoved(r: Array<out AudioDeviceInfo>) { r.filter { isUsbAudioDevice(it) }.forEach { handleAudioDeviceRemoved(it) } }
        } else null

    init { registerReceivers(); scanForConnectedDacs() }

    fun enableDirectUsbRouting(enabled: Boolean): Boolean {
        if (!isDacConnected) return false
        isNativeDirectMode = enabled; return true
    }
    fun isDirectUsbRoutingEnabled() = isNativeDirectMode
    fun setPreferredSampleRate(rate: Int): Boolean { preferredSampleRate = rate; return true }
    fun setPreferredBitDepth(depth: Int): Boolean  { preferredBitDepth  = depth; return true }

    // Explicit getters -- avoid JVM signature clash with AtomicReference fields
    fun getCurrentDacInfo(): DacInfo?          = _currentDacInfo.get()
    fun getDacCapabilities(): DacCapabilities? = _dacCapabilities.get()
    // Legacy alias kept for any callers that used the old name
    fun getConnectedDacInfo(): DacInfo?        = _currentDacInfo.get()

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
    fun release() { unregisterReceivers() }

    private fun scanForConnectedDacs() {
        var found = false
        usbManager.deviceList.values.filter { isAudioDevice(it) }.forEach { handleUsbDeviceAttached(it); found = true }
        if (!found) { _isDacConnected.set(false); _currentDacInfo.set(null); _dacCapabilities.set(null) }
    }

    private fun handleUsbDeviceAttached(device: UsbDevice) {
        if (!isAudioDevice(device)) return
        if (!usbManager.hasPermission(device))
            requestUsbPermission(device) { granted -> if (granted) registerAudioDevice(device) }
        else registerAudioDevice(device)
    }

    private fun handleUsbDeviceDetached(device: UsbDevice) {
        val cur = _currentDacInfo.get() ?: return
        if (cur.vendorId == device.vendorId && cur.productId == device.productId) {
            _isDacConnected.set(false); _currentDacInfo.set(null); _dacCapabilities.set(null)
            isNativeDirectMode = false; onDacDisconnected?.invoke()
        }
    }

    private fun handleAudioDeviceAdded(device: AudioDeviceInfo) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val info = extractDacInfoFromAudioDevice(device) ?: return
        _isDacConnected.set(true); _currentDacInfo.set(info)
        extractCapabilities(device)?.also { _dacCapabilities.set(it); onDacCapabilitiesChanged?.invoke(it) }
        onDacConnected?.invoke(info)
    }

    private fun handleAudioDeviceRemoved(device: AudioDeviceInfo) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val info = extractDacInfoFromAudioDevice(device) ?: return
        if (_currentDacInfo.get()?.name == info.name) {
            _isDacConnected.set(false); _currentDacInfo.set(null); _dacCapabilities.set(null)
            onDacDisconnected?.invoke()
        }
    }

    private fun registerAudioDevice(device: UsbDevice) {
        val info = DacInfo(
            name = device.productName ?: device.manufacturerName ?: "USB Audio Device",
            vendorId = device.vendorId, productId = device.productId,
            isConnected = true, hasAudioOutput = true,
            supportedSampleRates = listOf(44100,48000,88200,96000,176400,192000),
            maxBitDepth = 24, maxChannels = 2,
            isNativeDirectSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
        )
        val caps = DacCapabilities(
            sampleRates = info.supportedSampleRates, bitDepths = listOf(16, 24),
            channelCounts = listOf(2), supportsFloatOutput = false,
            supportsHdAudio = info.supportedSampleRates.any { it >= 96000 },
            nativeSampleRate = 48000, nativeBitDepth = 24
        )
        _isDacConnected.set(true); _currentDacInfo.set(info); _dacCapabilities.set(caps)
        onDacConnected?.invoke(info); onDacCapabilitiesChanged?.invoke(caps)
    }

    private fun isAudioDevice(d: UsbDevice): Boolean {
        for (i in 0 until d.interfaceCount) if (d.getInterface(i).interfaceClass == USB_CLASS_AUDIO) return true
        return false
    }

    private fun isUsbAudioDevice(d: AudioDeviceInfo): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false
        return d.type in setOf(AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_HDMI)
    }

    private fun extractDacInfoFromAudioDevice(d: AudioDeviceInfo): DacInfo? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
        val encodings = d.encodings ?: intArrayOf()
        return DacInfo(
            name = d.productName?.toString() ?: "USB Audio Device",
            vendorId = 0, productId = 0, isConnected = true,
            hasAudioOutput = d.type == AudioDeviceInfo.TYPE_USB_DEVICE,
            supportedSampleRates = (d.sampleRates ?: intArrayOf()).filter { it in SUPPORTED_SAMPLE_RATES }.ifEmpty { SUPPORTED_SAMPLE_RATES.toList() },
            maxBitDepth = when { AudioFormat.ENCODING_PCM_32BIT in encodings -> 32; Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && ENCODING_PCM_24BIT_PACKED in encodings -> 24; else -> 16 },
            maxChannels = d.channelCounts?.maxOrNull() ?: 2,
            isNativeDirectSupported = true
        )
    }

    private fun extractCapabilities(d: AudioDeviceInfo): DacCapabilities? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
        val encodings = d.encodings ?: intArrayOf()
        val rates = (d.sampleRates ?: intArrayOf()).filter { it in SUPPORTED_SAMPLE_RATES }.ifEmpty { SUPPORTED_SAMPLE_RATES.toList() }
        return DacCapabilities(
            sampleRates = rates,
            bitDepths = buildList { add(16); if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && ENCODING_PCM_24BIT_PACKED in encodings) add(24); if (AudioFormat.ENCODING_PCM_32BIT in encodings) add(32) }.sorted(),
            channelCounts = d.channelCounts?.toList() ?: listOf(2),
            supportsFloatOutput = AudioFormat.ENCODING_PCM_FLOAT in encodings,
            supportsHdAudio = rates.any { it >= 96000 },
            nativeSampleRate = preferredSampleRate, nativeBitDepth = preferredBitDepth
        )
    }

    private fun registerReceivers() {
        context.registerReceiver(usbReceiver, IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED); addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        })
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            audioDeviceCallback?.let { audioManager.registerAudioDeviceCallback(it, Handler(Looper.getMainLooper())) }
    }

    private fun unregisterReceivers() {
        try { context.unregisterReceiver(usbReceiver) } catch (_: Exception) {}
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            audioDeviceCallback?.let { audioManager.unregisterAudioDeviceCallback(it) }
    }
}
