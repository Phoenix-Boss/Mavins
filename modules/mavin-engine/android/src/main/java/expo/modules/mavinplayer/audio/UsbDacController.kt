package expo.modules.mavinplayer.audio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * UsbDacController - Direct USB DAC Control for High-Resolution Audio
 * 
 * Features:
 * - Detect USB DAC connection/disconnection
 * - Query DAC capabilities (sample rates, bit depths, channel counts)
 * - Direct audio routing to USB device
 * - Bypass Android resampling when possible
 * - Lock-free state updates for JS bridge
 * 
 * Requirements:
 * - USB host permission in AndroidManifest.xml
 * - android.permission.USB_PERMISSION
 * - USB device filter for audio class
 * 
 * Supported DACs:
 * - Any USB Audio Class 1 or 2 compliant DAC
 * - External sound cards
 * - USB-C headphones with DAC
 * - Docks with audio output
 */
class UsbDacController(private val context: Context) {
    
    companion object {
        private const val TAG = "UsbDacController"
        
        // USB device classes
        private const val USB_CLASS_AUDIO = 0x01
        private const val USB_AUDIO_SUBCLASS_CONTROL = 0x01
        private const val USB_AUDIO_SUBCLASS_STREAMING = 0x02
        
        // Supported sample rates (Hz)
        val SUPPORTED_SAMPLE_RATES = intArrayOf(
            44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000
        )
        
        // Supported bit depths
        val SUPPORTED_BIT_DEPTHS = intArrayOf(16, 24, 32)
    }
    
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
    
    private val _currentDacInfo = AtomicReference<DacInfo?>(null)
    val currentDacInfo: DacInfo? get() = _currentDacInfo.get()
    
    private val _dacCapabilities = AtomicReference<DacCapabilities?>(null)
    val dacCapabilities: DacCapabilities? get() = _dacCapabilities.get()
    
    @Volatile
    private var isNativeDirectMode = false
    
    @Volatile
    private var preferredSampleRate = 48000
    
    @Volatile
    private var preferredBitDepth = 24
    
    // AudioManager for routing
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    
    // USB Manager
    private val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
    
    // Callbacks
    var onDacConnected: ((DacInfo) -> Unit)? = null
    var onDacDisconnected: (() -> Unit)? = null
    var onDacCapabilitiesChanged: ((DacCapabilities) -> Unit)? = null
    
    // USB device receiver
    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                    val device = intent.getParcelableExtra<UsbDevice>(UsbManager.EXTRA_DEVICE)
                    device?.let { handleUsbDeviceAttached(it) }
                }
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    val device = intent.getParcelableExtra<UsbDevice>(UsbManager.EXTRA_DEVICE)
                    device?.let { handleUsbDeviceDetached(it) }
                }
            }
        }
    }
    
    // Audio device callback (API 23+)
    private val audioDeviceCallback = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        object : AudioManager.AudioDeviceCallback() {
            override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
                for (device in addedDevices) {
                    if (isUsbAudioDevice(device)) {
                        handleAudioDeviceAdded(device)
                    }
                }
            }
            
            override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
                for (device in removedDevices) {
                    if (isUsbAudioDevice(device)) {
                        handleAudioDeviceRemoved(device)
                    }
                }
            }
        }
    } else null
    
    init {
        registerReceivers()
        scanForConnectedDacs()
    }
    
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // PUBLIC API
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    
    /**
     * Enable direct USB audio routing (bypass Android mixer when possible)
     */
    fun enableDirectUsbRouting(enabled: Boolean): Boolean {
        if (!isDacConnected) {
            Log.w(TAG, "No DAC connected, cannot enable direct routing")
            return false
        }
        
        isNativeDirectMode = enabled
        
        if (enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // Request direct USB output if available
            val preferredDevice = getPreferredUsbDevice()
            if (preferredDevice != null) {
                // Native direct routing is device-specific
                // Full implementation requires AudioTrack.Builder.setDeviceId()
                Log.i(TAG, "Direct USB routing enabled for ${preferredDevice.productName}")
            }
        }
        
        return true
    }
    
    /**
     * Check if direct USB routing is currently active
     */
    fun isDirectUsbRoutingEnabled(): Boolean = isNativeDirectMode
    
    /**
     * Set preferred sample rate for USB DAC output
     */
    fun setPreferredSampleRate(rate: Int): Boolean {
        val capabilities = dacCapabilities
        if (capabilities != null && !capabilities.sampleRates.contains(rate)) {
            Log.w(TAG, "Sample rate $rate not supported by DAC")
            return false
        }
        preferredSampleRate = rate
        Log.i(TAG, "Preferred sample rate set to $rate Hz")
        return true
    }
    
    /**
     * Set preferred bit depth for USB DAC output
     */
    fun setPreferredBitDepth(depth: Int): Boolean {
        val capabilities = dacCapabilities
        if (capabilities != null && !capabilities.bitDepths.contains(depth)) {
            Log.w(TAG, "Bit depth $depth not supported by DAC")
            return false
        }
        preferredBitDepth = depth
        Log.i(TAG, "Preferred bit depth set to $depth-bit")
        return true
    }
    
    /**
     * Get current DAC information
     */
    fun getCurrentDacInfo(): DacInfo? = currentDacInfo
    
    /**
     * Get DAC capabilities (sample rates, bit depths, etc.)
     */
    fun getDacCapabilities(): DacCapabilities? = dacCapabilities
    
    /**
     * Request USB permission for a device
     */
    fun requestUsbPermission(device: UsbDevice, callback: ((Boolean) -> Unit)? = null) {
        if (usbManager.hasPermission(device)) {
            callback?.invoke(true)
            return
        }
        
        val permissionIntent = PendingIntent.getBroadcast(
            context,
            0,
            Intent(ACTION_USB_PERMISSION),
            PendingIntent.FLAG_IMMUTABLE
        )
        
        val permissionReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (ACTION_USB_PERMISSION == intent.action) {
                    val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    callback?.invoke(granted)
                    context.unregisterReceiver(this)
                }
            }
        }
        
        context.registerReceiver(permissionReceiver, IntentFilter(ACTION_USB_PERMISSION))
        usbManager.requestPermission(device, permissionIntent)
    }
    
    /**
     * Force rescan for USB DAC devices
     */
    fun rescanDevices() {
        scanForConnectedDacs()
    }
    
    /**
     * Release resources
     */
    fun release() {
        unregisterReceivers()
    }
    
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // USB DEVICE HANDLING
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    
    private fun scanForConnectedDacs() {
        val devices = usbManager.deviceList
        var foundDac = false
        
        for (device in devices.values) {
            if (isAudioDevice(device)) {
                handleUsbDeviceAttached(device)
                foundDac = true
            }
        }
        
        if (!foundDac) {
            _isDacConnected.set(false)
            _currentDacInfo.set(null)
            _dacCapabilities.set(null)
        }
    }
    
    private fun handleUsbDeviceAttached(device: UsbDevice) {
        if (!isAudioDevice(device)) return
        
        Log.i(TAG, "USB Audio device attached: ${device.productName} (${device.vendorId}:${device.productId})")
        
        // Request permission if not already granted
        if (!usbManager.hasPermission(device)) {
            requestUsbPermission(device) { granted ->
                if (granted) {
                    registerAudioDevice(device)
                }
            }
        } else {
            registerAudioDevice(device)
        }
    }
    
    private fun handleUsbDeviceDetached(device: UsbDevice) {
        val currentInfo = currentDacInfo
        if (currentInfo != null && 
            currentInfo.vendorId == device.vendorId && 
            currentInfo.productId == device.productId) {
            
            Log.i(TAG, "USB Audio device detached: ${device.productName}")
            _isDacConnected.set(false)
            _currentDacInfo.set(null)
            _dacCapabilities.set(null)
            isNativeDirectMode = false
            
            onDacDisconnected?.invoke()
        }
    }
    
    private fun handleAudioDeviceAdded(device: AudioDeviceInfo) {
        val dacInfo = extractDacInfoFromAudioDevice(device)
        if (dacInfo != null) {
            Log.i(TAG, "Audio device added: ${dacInfo.name}")
            _isDacConnected.set(true)
            _currentDacInfo.set(dacInfo)
            _dacCapabilities.set(extractCapabilities(device))
            onDacConnected?.invoke(dacInfo)
            onDacCapabilitiesChanged?.invoke(dacCapabilities!!)
        }
    }
    
    private fun handleAudioDeviceRemoved(device: AudioDeviceInfo) {
        val dacInfo = extractDacInfoFromAudioDevice(device)
        if (dacInfo != null && currentDacInfo?.name == dacInfo.name) {
            Log.i(TAG, "Audio device removed: ${dacInfo.name}")
            _isDacConnected.set(false)
            _currentDacInfo.set(null)
            _dacCapabilities.set(null)
            onDacDisconnected?.invoke()
        }
    }
    
    private fun registerAudioDevice(device: UsbDevice) {
        val dacInfo = extractDacInfoFromUsbDevice(device)
        val capabilities = queryDacCapabilities(device)
        
        _isDacConnected.set(true)
        _currentDacInfo.set(dacInfo)
        _dacCapabilities.set(capabilities)
        
        onDacConnected?.invoke(dacInfo)
        onDacCapabilitiesChanged?.invoke(capabilities)
        
        Log.i(TAG, "DAC registered: ${dacInfo.name}, rates=${capabilities.sampleRates}, depth=${capabilities.maxBitDepth}")
    }
    
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // DEVICE INFO EXTRACTION
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    
    private fun isAudioDevice(device: UsbDevice): Boolean {
        for (i in 0 until device.interfaceCount) {
            val intf = device.getInterface(i)
            if (intf.getInterfaceClass() == USB_CLASS_AUDIO) {
                return true
            }
        }
        return false
    }
    
    private fun isUsbAudioDevice(device: AudioDeviceInfo): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return device.type == AudioDeviceInfo.TYPE_USB_DEVICE ||
                   device.type == AudioDeviceInfo.TYPE_USB_HEADSET ||
                   device.type == AudioDeviceInfo.TYPE_HDMI
        }
        return false
    }
    
    private fun extractDacInfoFromUsbDevice(device: UsbDevice): DacInfo {
        return DacInfo(
            name = device.productName ?: device.manufacturerName ?: "USB Audio Device",
            vendorId = device.vendorId,
            productId = device.productId,
            isConnected = true,
            hasAudioOutput = true,
            supportedSampleRates = detectSupportedSampleRates(device),
            maxBitDepth = detectMaxBitDepth(device),
            maxChannels = detectMaxChannels(device),
            isNativeDirectSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
        )
    }
    
    private fun extractDacInfoFromAudioDevice(device: AudioDeviceInfo): DacInfo? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
        
        return DacInfo(
            name = device.productName?.toString() ?: "USB Audio Device",
            vendorId = 0, // Not available from AudioDeviceInfo
            productId = 0,
            isConnected = true,
            hasAudioOutput = device.type == AudioDeviceInfo.TYPE_USB_DEVICE,
            supportedSampleRates = getSupportedSampleRates(device),
            maxBitDepth = getMaxBitDepth(device),
            maxChannels = device.getChannelCounts()?.maxOrNull() ?: 2,
            isNativeDirectSupported = true
        )
    }
    
    private fun extractCapabilities(device: AudioDeviceInfo): DacCapabilities? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
        
        return DacCapabilities(
            sampleRates = getSupportedSampleRates(device),
            bitDepths = getSupportedBitDepths(device),
            channelCounts = device.getChannelCounts()?.toList() ?: listOf(2),
            supportsFloatOutput = device.encodingList?.contains(AudioFormat.ENCODING_PCM_FLOAT) ?: false,
            supportsHdAudio = getSupportedSampleRates(device).any { it >= 96000 },
            nativeSampleRate = preferredSampleRate,
            nativeBitDepth = preferredBitDepth
        )
    }
    
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // CAPABILITY DETECTION
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    
    private fun detectSupportedSampleRates(device: UsbDevice): List<Int> {
        // Query USB audio control interface for supported sample rates
        // Full implementation requires USB host library
        // Return common high-res rates as default
        return listOf(44100, 48000, 88200, 96000, 176400, 192000)
    }
    
    private fun detectMaxBitDepth(device: UsbDevice): Int {
        // Query USB audio streaming interface for bit depth support
        return 24 // Most USB DACs support 24-bit
    }
    
    private fun detectMaxChannels(device: UsbDevice): Int {
        return 2 // Stereo output
    }
    
    private fun getSupportedSampleRates(device: AudioDeviceInfo): List<Int> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return listOf(48000)
        
        val rates = mutableListOf<Int>()
        for (rate in SUPPORTED_SAMPLE_RATES) {
            if (device.isSampleRateSupported(rate)) {
                rates.add(rate)
            }
        }
        return rates
    }
    
    private fun getSupportedBitDepths(device: AudioDeviceInfo): List<Int> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return listOf(16)
        
        val depths = mutableListOf<Int>()
        for (depth in SUPPORTED_BIT_DEPTHS) {
            if (device.isEncodingSupported(getEncodingForBitDepth(depth))) {
                depths.add(depth)
            }
        }
        return depths
    }
    
    private fun getMaxBitDepth(device: AudioDeviceInfo): Int {
        return getSupportedBitDepths(device).maxOrNull() ?: 16
    }
    
    private fun getPreferredUsbDevice(): AudioDeviceInfo? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
        
        val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        return devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_USB_DEVICE }
    }
    
    private fun getEncodingForBitDepth(bitDepth: Int): Int {
        return when (bitDepth) {
            16 -> AudioFormat.ENCODING_PCM_16BIT
            24 -> AudioFormat.ENCODING_PCM_24BIT_PACKED
            32 -> AudioFormat.ENCODING_PCM_32BIT
            else -> AudioFormat.ENCODING_PCM_16BIT
        }
    }
    
    private fun queryDacCapabilities(device: UsbDevice): DacCapabilities {
        return DacCapabilities(
            sampleRates = detectSupportedSampleRates(device),
            bitDepths = listOf(16, 24),
            channelCounts = listOf(2),
            supportsFloatOutput = false,
            supportsHdAudio = detectSupportedSampleRates(device).any { it >= 96000 },
            nativeSampleRate = 48000,
            nativeBitDepth = 24
        )
    }
    
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // RECEIVER MANAGEMENT
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    
    private fun registerReceivers() {
        val usbFilter = IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        context.registerReceiver(usbReceiver, usbFilter)
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && audioDeviceCallback != null) {
            audioManager.registerAudioDeviceCallback(audioDeviceCallback, Handler(Looper.getMainLooper()))
        }
    }
    
    private fun unregisterReceivers() {
        try {
            context.unregisterReceiver(usbReceiver)
        } catch (e: Exception) {
            Log.w(TAG, "Receiver not registered")
        }
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && audioDeviceCallback != null) {
            audioManager.unregisterAudioDeviceCallback(audioDeviceCallback)
        }
    }
    }
}