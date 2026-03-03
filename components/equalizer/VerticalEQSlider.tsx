// components/equalizer/VerticalEQSlider.tsx - PROFESSIONAL GRADE WITH ALL FLAWS FIXED
// Fixed: dB markers static on track, active bar fill connects thumb to center,
// larger buttons with icons, clear visual states, no overlaps

import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  clamp,
  runOnJS,
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
  const sliderHeight = verticalScale(160)
  const centerY = sliderHeight / 2

  const translateY = useSharedValue(0)
  const [displayValue, setDisplayValue] = useState(value)
  const isDragging = useSharedValue(false)

  // Convert dB to Y position (0 = top/+15dB, sliderHeight = bottom/-15dB)
  const valueToY = (val: number) => {
    'worklet'
    const normalized = (15 - val) / 30 // +15dB = 0, -15dB = 1
    return sliderHeight * normalized
  }

  // Convert Y to dB (0/top = +15dB, sliderHeight/bottom = -15dB)
  const yToValue = (y: number) => {
    'worklet'
    const normalized = y / sliderHeight
    const raw = 15 - (normalized * 30)
    return Math.round(raw * 2) / 2
  }

  // Sync external value
  useEffect(() => {
    translateY.value = withSpring(valueToY(value), {
      damping: 20,
      stiffness: 220,
    })
    setDisplayValue(value)
  }, [value])

  const triggerHaptic = (style: 'light' | 'medium' | 'selection') => {
    if (style === 'selection') {
      Haptics.selectionAsync()
    } else if (style === 'medium') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  }

  const gesture = Gesture.Pan()
    .enabled(enabled && !bypassed)
    .hitSlop({ top: verticalScale(20), bottom: verticalScale(20), left: scale(30), right: scale(30) })
    .onBegin(() => {
      isDragging.value = true
    })
    .onUpdate((e) => {
      const nextY = clamp(translateY.value + e.changeY, 0, sliderHeight)
      translateY.value = nextY
      const db = yToValue(nextY)
      runOnJS(setDisplayValue)(db)
      if (Math.abs(e.changeY) > 10) {
        runOnJS(triggerHaptic)('selection')
      }
      runOnJS(onChange)(db)
    })
    .onEnd(() => {
      isDragging.value = false
      const db = yToValue(translateY.value)
      if (Math.abs(db) < 0.5) {
        translateY.value = withSpring(valueToY(0), { damping: 18, stiffness: 260 })
        runOnJS(setDisplayValue)(0)
        runOnJS(triggerHaptic)('medium')
        runOnJS(onChange)(0)
        return
      }
      const snappedY = valueToY(db)
      translateY.value = withSpring(snappedY, { damping: 18, stiffness: 260 })
      runOnJS(setDisplayValue)(db)
      runOnJS(triggerHaptic)('light')
      runOnJS(onChange)(db)
    })

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    shadowOpacity: isDragging.value ? 0.6 : 0.3,
    shadowRadius: isDragging.value ? 8 : 4,
  }))

  // FIXED: Active bar now connects thumb to center line
  const activeBarStyle = useAnimatedStyle(() => {
    'worklet'
    const thumbY = translateY.value
    
    if (thumbY <= centerY) {
      // Boost: fill from thumb DOWN to center
      return {
        top: thumbY,
        height: centerY - thumbY,
      }
    } else {
      // Cut: fill from center DOWN to thumb
      return {
        top: centerY,
        height: thumbY - centerY,
      }
    }
  })

  const accentColor = isPreamp ? Colors.metallicBrown.light : Colors.metallicBrown.primary
  
  // Determine if band is active (not bypassed and enabled)
  const isActive = enabled && !bypassed

  // Format display value
  const formattedValue = displayValue > 0 
    ? `+${displayValue.toFixed(1)}` 
    : displayValue < 0 
    ? `${displayValue.toFixed(1)}`
    : '0'

  return (
    <View style={styles.sliderColumn}>
      {/* Value indicator */}
      <View style={[
        styles.valueContainer,
        displayValue > 0 && styles.valuePositive,
        displayValue < 0 && styles.valueNegative,
        !isActive && styles.valueInactive
      ]}>
        <Text style={[
          styles.valueIndicator,
          !isActive && styles.textInactive
        ]}>
          {formattedValue}
        </Text>
      </View>

      <GestureDetector gesture={gesture}>
        <View style={[styles.trackContainer, { height: sliderHeight }]}>
          <View style={styles.track}>
            {/* Static dB reference markers on the left */}
            <View style={styles.dbMarkers}>
              <Text style={[styles.dbMarker, { top: 0 }]}>+15</Text>
              <Text style={[styles.dbMarker, { top: centerY * 0.5 }]}>+7.5</Text>
              <Text style={[styles.dbMarker, { top: centerY }]}>0</Text>
              <Text style={[styles.dbMarker, { top: sliderHeight * 0.75 }]}>-7.5</Text>
              <Text style={[styles.dbMarker, { bottom: 0 }]}>-15</Text>
            </View>

            {/* Active fill bar */}
            <Animated.View
              style={[
                styles.activeBar,
                activeBarStyle,
                { 
                  backgroundColor: isActive ? accentColor : '#333',
                },
              ]}
            />

            {/* Center line (0dB reference) */}
            <View style={styles.centerLine} />

            {/* Thumb */}
            <Animated.View
              style={[
                styles.thumb,
                thumbStyle,
                {
                  borderColor: isActive ? accentColor : '#666',
                  backgroundColor: isActive ? '#2A2A2A' : '#1A1A1A',
                },
              ]}
            >
              <View style={styles.thumbGripContainer}>
                <View style={[styles.thumbGripVertical, !isActive && styles.gripInactive]} />
                <View style={[styles.thumbGripVertical, !isActive && styles.gripInactive]} />
                <View style={[styles.thumbGripVertical, !isActive && styles.gripInactive]} />
              </View>
            </Animated.View>
          </View>
        </View>
      </GestureDetector>

      {/* Control buttons with icons */}
      <View style={styles.controlsRow}>
        <TouchableOpacity 
          onPress={onBypass} 
          style={[
            styles.controlButton,
            bypassed && styles.controlButtonActive,
            !enabled && styles.controlButtonDisabled
          ]}
          disabled={!enabled}
        >
          <MaterialCommunityIcons 
            name="power" 
            size={16} 
            color={bypassed ? Colors.metallicBrown.primary : '#888'} 
          />
        </TouchableOpacity>
        
        <TouchableOpacity 
          onPress={onSolo} 
          style={[
            styles.controlButton,
            isSoloed && styles.controlButtonSolo,
            !enabled && styles.controlButtonDisabled
          ]}
          disabled={!enabled}
        >
          <MaterialCommunityIcons 
            name="headphones" 
            size={16} 
            color={isSoloed ? '#FFD700' : '#888'} 
          />
        </TouchableOpacity>
        
        <TouchableOpacity 
          onPress={onMute} 
          style={[
            styles.controlButton,
            isMuted && styles.controlButtonMute,
            !enabled && styles.controlButtonDisabled
          ]}
          disabled={!enabled}
        >
          <MaterialCommunityIcons 
            name={isMuted ? "volume-off" : "volume-high"} 
            size={16} 
            color={isMuted ? '#FF4444' : '#888'} 
          />
        </TouchableOpacity>
      </View>

      {/* Frequency label */}
      <Text style={[styles.label, !isActive && styles.textInactive]}>
        {label}
      </Text>

      {frequency && (
        <Text style={[styles.freq, !isActive && styles.textInactive]}>
          {frequency < 1000
            ? `${frequency}Hz`
            : `${(frequency / 1000).toFixed(1)}kHz`}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  sliderColumn: {
    alignItems: 'center',
    flex: 1,
  },
  valueContainer: {
    paddingHorizontal: scale(4),
    paddingVertical: verticalScale(2),
    borderRadius: 4,
    marginBottom: verticalScale(4),
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  valuePositive: {
    backgroundColor: 'rgba(139, 115, 85, 0.3)',
  },
  valueNegative: {
    backgroundColor: 'rgba(100, 100, 100, 0.3)',
  },
  valueInactive: {
    backgroundColor: 'rgba(50, 50, 50, 0.3)',
  },
  valueIndicator: {
    color: '#fff',
    fontSize: moderateScale(10),
    fontWeight: 'bold',
    textAlign: 'center',
  },
  trackContainer: {
    width: scale(60),
    justifyContent: 'center',
    alignItems: 'center',
  },
  track: {
    width: scale(12),
    flex: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    position: 'relative',
  },
  dbMarkers: {
    position: 'absolute',
    left: scale(-35),
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 5,
  },
  dbMarker: {
    position: 'absolute',
    color: 'rgba(255,255,255,0.4)',
    fontSize: moderateScale(8),
    textAlign: 'right',
    width: scale(30),
  },
  activeBar: {
    position: 'absolute',
    width: '100%',
    borderRadius: 6,
  },
  centerLine: {
    position: 'absolute',
    top: '50%',
    height: 2,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.8)',
    zIndex: 10,
  },
  thumb: {
    position: 'absolute',
    left: scale(-14),
    width: scale(40),
    height: scale(48),
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    zIndex: 20,
  },
  thumbGripContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbGripVertical: {
    width: 2,
    height: scale(20),
    backgroundColor: '#fff',
    marginHorizontal: 3,
    borderRadius: 1,
  },
  gripInactive: {
    backgroundColor: '#666',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: scale(60),
    marginTop: verticalScale(8),
    marginBottom: verticalScale(4),
  },
  controlButton: {
    width: scale(28),
    height: scale(28),
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  controlButtonActive: {
    borderColor: Colors.metallicBrown.primary,
    backgroundColor: 'rgba(139, 115, 85, 0.2)',
  },
  controlButtonSolo: {
    borderColor: '#FFD700',
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
  },
  controlButtonMute: {
    borderColor: '#FF4444',
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
  },
  controlButtonDisabled: {
    opacity: 0.3,
  },
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
  textInactive: {
    color: '#666',
  },
})