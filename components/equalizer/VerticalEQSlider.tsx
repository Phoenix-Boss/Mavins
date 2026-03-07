// components/equalizer/VerticalEQSlider.tsx
import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  clamp,
  runOnJS,
  measure,
  useAnimatedRef,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend'
import { Colors } from '@/constants/Colors'
import * as Haptics from 'expo-haptics'
import { MaterialCommunityIcons } from '@expo/vector-icons'

interface VerticalEQSliderProps {
  value: number // -15 to +15
  onChange: (value: number) => void
  label: string
  enabled?: boolean
  isPreamp?: boolean
  frequency?: number
  bypassed?: boolean
  onBypass?: () => void
  onSolo?: () => void
  onMute?: () => void
  isSoloed?: boolean
  isMuted?: boolean
}

export const VerticalEQSlider: React.FC<VerticalEQSliderProps> = ({
  value,
  onChange,
  label,
  enabled = true,
  isPreamp = false,
  frequency,
  bypassed = false,
  onBypass,
  onSolo,
  onMute,
  isSoloed = false,
  isMuted = false,
}) => {
  const [sliderHeight, setSliderHeight] = useState(verticalScale(160))
  const centerY = sliderHeight / 2
  
  // Refs and Shared Values
  const translateY = useSharedValue(0)
  const [displayValue, setDisplayValue] = useState(value)
  const isDragging = useSharedValue(false)

  // Conversion Utilities
  const valueToY = (val: number) => {
    'worklet'
    // +15dB is top (0), -15dB is bottom (sliderHeight)
    const normalized = (15 - val) / 30 
    return sliderHeight * normalized
  }

  const yToValue = (y: number) => {
    'worklet'
    // Top (0) is +15, Bottom (height) is -15
    const normalized = y / sliderHeight
    const raw = 15 - (normalized * 30)
    return Math.round(raw * 2) / 2 // Snap to 0.5 steps
  }

  // Sync external value changes to position
  useEffect(() => {
    // If bypassed, force visual to 0dB (center)
    const targetValue = bypassed ? 0 : value
    translateY.value = withSpring(valueToY(targetValue), {
      damping: 20,
      stiffness: 220,
    })
    setDisplayValue(targetValue)
  }, [value, sliderHeight, bypassed])

  const triggerHaptic = (style: 'light' | 'medium' | 'selection') => {
    if (style === 'selection') Haptics.selectionAsync()
    else if (style === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  const gesture = Gesture.Pan()
    .enabled(enabled && !bypassed) // Disable gesture if bypassed
    .hitSlop({ top: verticalScale(20), bottom: verticalScale(20), left: scale(30), right: scale(30) })
    .onBegin(() => {
      if (bypassed) return
      isDragging.value = true
    })
    .onUpdate((e) => {
      if (bypassed) return
      const nextY = clamp(translateY.value + e.changeY, 0, sliderHeight)
      translateY.value = nextY
      const db = yToValue(nextY)
      runOnJS(setDisplayValue)(db)
      // Haptic feedback on drag
      if (Math.abs(e.changeY) > 5) {
         runOnJS(triggerHaptic)('selection')
      }
    })
    .onEnd(() => {
      if (bypassed) return
      isDragging.value = false
      const db = yToValue(translateY.value)
      
      // Snap to 0 if close
      if (Math.abs(db) < 0.5) {
        translateY.value = withSpring(valueToY(0), { damping: 18, stiffness: 260 })
        runOnJS(setDisplayValue)(0)
        runOnJS(triggerHaptic)('medium')
        runOnJS(onChange)(0)
        return
      }
      
      // Snap to nearest 0.5dB
      const snappedY = valueToY(db)
      translateY.value = withSpring(snappedY, { damping: 18, stiffness: 260 })
      runOnJS(triggerHaptic)('light')
      runOnJS(onChange)(db)
    })

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    shadowOpacity: isDragging.value ? 0.6 : 0.3,
    shadowRadius: isDragging.value ? 8 : 4,
    opacity: bypassed ? 0.5 : 1,
  }))

  // Active Bar Logic: Connect Thumb to Center
  const activeBarStyle = useAnimatedStyle(() => {
    'worklet'
    const thumbY = translateY.value
    const center = sliderHeight / 2
    
    if (thumbY <= center) {
      // Boost: Fill from Thumb (top) DOWN to Center
      return {
        top: thumbY,
        height: center - thumbY,
        backgroundColor: Colors.metallicBrown.primary, // Warm color for boost
      }
    } else {
      // Cut: Fill from Center DOWN to Thumb
      return {
        top: center,
        height: thumbY - center,
        backgroundColor: Colors.metallicBrown.secondary, // Darker/cool color for cut
      }
    }
  })

  const onLayout = (e: LayoutChangeEvent) => {
    setSliderHeight(e.nativeEvent.layout.height)
  }

  const isActive = enabled && !bypassed
  const formattedValue = displayValue > 0 
    ? `+${displayValue.toFixed(1)}` 
    : displayValue.toFixed(1)

  return (
    <View style={styles.sliderColumn}>
      {/* Value Display */}
      <View style={[
        styles.valueContainer,
        displayValue > 0 && styles.valuePositive,
        displayValue < 0 && styles.valueNegative,
        !isActive && styles.valueInactive
      ]}>
        <Text style={[styles.valueIndicator, !isActive && styles.textInactive]}>
          {bypassed ? 'BYP' : formattedValue}
        </Text>
      </View>

      <GestureDetector gesture={gesture}>
        <View style={[styles.trackContainer, { height: sliderHeight }]} onLayout={onLayout}>
          <View style={styles.track}>
            
            {/* Static dB Reference Markers */}
            <View style={styles.dbMarkersContainer}>
              <Text style={[styles.dbMarkerText, { top: 0 }]}>+15</Text>
              <Text style={[styles.dbMarkerText, { top: '25%' }]}>+7</Text>
              <Text style={[styles.dbMarkerText, { top: '50%' }]}>0</Text>
              <Text style={[styles.dbMarkerText, { top: '75%' }]}>-7</Text>
              <Text style={[styles.dbMarkerText, { bottom: 0, top: undefined }]}>-15</Text>
            </View>

            {/* Active Fill Bar */}
            {!bypassed && (
              <Animated.View style={[styles.activeBar, activeBarStyle]} />
            )}

            {/* Center Line */}
            <View style={styles.centerLine} />

            {/* Thumb */}
            <Animated.View
              style={[
                styles.thumb,
                thumbStyle,
                { borderColor: isActive ? Colors.metallicBrown.light : '#444' },
              ]}
            >
              <View style={styles.thumbGripContainer}>
                <View style={[styles.thumbGripLine, !isActive && styles.gripInactive]} />
                <View style={[styles.thumbGripLine, !isActive && styles.gripInactive]} />
              </View>
            </Animated.View>
          </View>
        </View>
      </GestureDetector>

      {/* Control Buttons (Bypass, Solo, Mute) */}
      <View style={styles.controlsRow}>
        {/* Bypass */}
        <TouchableOpacity 
          onPress={onBypass} 
          style={[styles.controlButton, bypassed && styles.buttonActive]}
          disabled={!enabled}
        >
          <MaterialCommunityIcons 
            name="power" 
            size={16} 
            color={bypassed ? Colors.metallicBrown.primary : '#888'} 
          />
        </TouchableOpacity>
        
        {/* Solo */}
        <TouchableOpacity 
          onPress={onSolo} 
          style={[styles.controlButton, isSoloed && styles.buttonSoloActive]}
          disabled={!enabled}
        >
          <Text style={[styles.buttonText, isSoloed && styles.textSolo]}>S</Text>
        </TouchableOpacity>
        
        {/* Mute */}
        <TouchableOpacity 
          onPress={onMute} 
          style={[styles.controlButton, isMuted && styles.buttonMuteActive]}
          disabled={!enabled}
        >
          <Text style={[styles.buttonText, isMuted && styles.textMute]}>M</Text>
        </TouchableOpacity>
      </View>

      {/* Labels */}
      <Text style={[styles.label, !isActive && styles.textInactive]}>
        {label}
      </Text>

      {frequency && (
        <Text style={[styles.freq, !isActive && styles.textInactive]}>
          {frequency < 1000 ? `${frequency}Hz` : `${(frequency / 1000).toFixed(1)}kHz`}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  sliderColumn: {
    alignItems: 'center',
    flex: 1,
    maxWidth: scale(55),
  },
  valueContainer: {
    paddingHorizontal: scale(4),
    paddingVertical: verticalScale(2),
    borderRadius: 4,
    marginBottom: verticalScale(4),
    backgroundColor: 'rgba(0,0,0,0.3)',
    minWidth: scale(36),
    alignItems: 'center',
  },
  valuePositive: { backgroundColor: 'rgba(139, 115, 85, 0.3)' },
  valueNegative: { backgroundColor: 'rgba(80, 80, 80, 0.3)' },
  valueInactive: { backgroundColor: 'rgba(0,0,0,0.1)' },
  valueIndicator: {
    color: '#fff',
    fontSize: moderateScale(9),
    fontWeight: 'bold',
  },
  textInactive: { color: '#555' },
  
  trackContainer: {
    width: scale(50),
    justifyContent: 'center',
    alignItems: 'center',
  },
  track: {
    width: scale(10),
    flex: 1,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
    position: 'relative',
  },
  
  // Markers
  dbMarkersContainer: {
    position: 'absolute',
    left: scale(-32),
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 1,
  },
  dbMarkerText: {
    position: 'absolute',
    color: 'rgba(255,255,255,0.3)',
    fontSize: moderateScale(8),
    textAlign: 'right',
    width: scale(28),
    right: 0,
  },

  activeBar: {
    position: 'absolute',
    width: '100%',
    borderRadius: 5,
  },
  centerLine: {
    position: 'absolute',
    top: '50%',
    marginTop: -1,
    height: 2,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.7)',
    zIndex: 2,
  },
  
  thumb: {
    position: 'absolute',
    left: scale(-15),
    width: scale(40),
    height: verticalScale(30),
    borderRadius: 12,
    backgroundColor: '#1A1A1A',
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    zIndex: 10,
  },
  thumbGripContainer: {
    flexDirection: 'row',
    gap: 6,
  },
  thumbGripLine: {
    width: 2,
    height: verticalScale(12),
    backgroundColor: '#FFF',
    borderRadius: 1,
  },
  gripInactive: { backgroundColor: '#444' },

  // Buttons
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: verticalScale(8),
    paddingHorizontal: scale(2),
  },
  controlButton: {
    width: scale(22),
    height: scale(22),
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  buttonActive: {
    borderColor: Colors.metallicBrown.primary,
    backgroundColor: 'rgba(139, 115, 85, 0.2)',
  },
  buttonSoloActive: {
    borderColor: '#FFD700',
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
  },
  buttonMuteActive: {
    borderColor: '#FF4444',
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
  },
  buttonText: {
    color: '#888',
    fontSize: moderateScale(10),
    fontWeight: 'bold',
  },
  textSolo: { color: '#FFD700' },
  textMute: { color: '#FF4444' },

  label: {
    color: '#fff',
    fontSize: moderateScale(10),
    fontWeight: '600',
    marginTop: verticalScale(2),
  },
  freq: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: moderateScale(8),
  },
})