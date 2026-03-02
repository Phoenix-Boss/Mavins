// components/equalizer/VerticalEQSlider.tsx - FIXED DIRECTION

import React, { useEffect } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  clamp,
  runOnJS,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend'
import { Colors } from '@/constants/Colors'

interface VerticalEQSliderProps {
  value: number // -15 to +15
  onChange: (value: number) => void
  label: string
  enabled?: boolean
  isPreamp?: boolean
  frequency?: number
}

export const VerticalEQSlider: React.FC<VerticalEQSliderProps> = ({
  value,
  onChange,
  label,
  enabled = true,
  isPreamp = false,
  frequency,
}) => {
  const sliderHeight = verticalScale(160)

  // UI thread shared value
  const translateY = useSharedValue(0)

  // Convert dB to Y position (0 = top, sliderHeight = bottom)
  const valueToY = (val: number) => {
    'worklet'
    // Map -15dB to top (0), +15dB to bottom (sliderHeight)
    const normalized = (val + 15) / 30
    return sliderHeight * normalized
  }

  // Convert Y to dB (0 = top -> -15dB, sliderHeight = bottom -> +15dB)
  const yToValue = (y: number) => {
    'worklet'
    const normalized = y / sliderHeight
    const raw = normalized * 30 - 15
    return Math.round(raw * 2) / 2 // snap to 0.5 dB
  }

  // Sync external value → UI thread
  useEffect(() => {
    translateY.value = withSpring(valueToY(value), {
      damping: 20,
      stiffness: 220,
    })
  }, [value])

  // Gesture - now properly maps up/down movement
  const gesture = Gesture.Pan()
    .enabled(enabled)
    .onUpdate((e) => {
      // e.changeY is positive when moving down, negative when moving up
      // This matches natural expectation: moving finger down increases value
      const nextY = clamp(
        translateY.value + e.changeY,
        0,
        sliderHeight
      )

      translateY.value = nextY

      const db = yToValue(nextY)

      // Send to JS only when needed
      runOnJS(onChange)(db)
    })
    .onEnd(() => {
      const db = yToValue(translateY.value)

      // Snap to 0dB if close
      if (Math.abs(db) < 0.5) {
        translateY.value = withSpring(valueToY(0), {
          damping: 18,
          stiffness: 260,
        })
        runOnJS(onChange)(0)
        return
      }

      const snappedY = valueToY(db)

      translateY.value = withSpring(snappedY, {
        damping: 18,
        stiffness: 260,
      })

      runOnJS(onChange)(db)
    })

  // Thumb style
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }))

  // Active fill from bottom
  const activeBarStyle = useAnimatedStyle(() => ({
    height: sliderHeight - translateY.value,
  }))

  const accentColor = isPreamp
    ? Colors.metallicBrown.light
    : Colors.metallicBrown.primary

  return (
    <View style={styles.sliderColumn}>
      <GestureDetector gesture={gesture}>
        <View
          style={[
            styles.trackContainer,
            { height: sliderHeight },
          ]}
        >
          <View style={styles.track}>
            {/* Active fill */}
            <Animated.View
              style={[
                styles.activeBar,
                activeBarStyle,
                {
                  backgroundColor: enabled
                    ? accentColor
                    : '#333',
                },
              ]}
            />

            {/* 0dB line */}
            <View style={styles.centerLine} />

            {/* Thumb */}
            <Animated.View
              style={[
                styles.thumb,
                thumbStyle,
                {
                  borderColor: accentColor,
                  opacity: enabled ? 1 : 0.4,
                },
              ]}
            >
              <View style={styles.thumbLine} />
              <View style={styles.thumbLineSmall} />
            </Animated.View>
          </View>
        </View>
      </GestureDetector>

      {/* Label */}
      <Text style={styles.label}>{label}</Text>

      {frequency && (
        <Text style={styles.freq}>
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
  trackContainer: {
    width: scale(40),
    justifyContent: 'center',
    alignItems: 'center',
  },
  track: {
    width: scale(8),
    flex: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  activeBar: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    borderRadius: 4,
  },
  centerLine: {
    position: 'absolute',
    top: '50%',
    height: 1,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  thumb: {
    position: 'absolute',
    left: -10,
    width: scale(28),
    height: scale(40),
    borderRadius: 14,
    backgroundColor: '#2A2A2A',
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbLine: {
    width: scale(14),
    height: 2,
    backgroundColor: '#fff',
    marginBottom: 2,
  },
  thumbLineSmall: {
    width: scale(8),
    height: 2,
    backgroundColor: '#fff',
  },
  label: {
    color: '#fff',
    marginTop: 6,
    fontSize: moderateScale(10),
    fontWeight: '600',
  },
  freq: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: moderateScale(8),
  },
})