// components/equalizer/Watermark.tsx

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Animated } from 'react-native';

interface WatermarkProps {
  source: any;
  size?: number;
  opacity?: number;
}

export const Watermark: React.FC<WatermarkProps> = ({
  source,
  size = 300,
  opacity = 0.08,
}) => {
  const watermarkPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(watermarkPulse, {
          toValue: 1.06,
          duration: 3000,
          useNativeDriver: true,
        }),
        Animated.timing(watermarkPulse, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [watermarkPulse]);

  return (
    <Animated.View pointerEvents="none" style={styles.watermarkWrapper}>
      <Animated.Image
        source={source}
        style={[
          styles.watermark,
          {
            width: size,
            height: size,
            opacity,
            transform: [{ scale: watermarkPulse }],
          },
        ]}
        resizeMode="contain"
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  watermarkWrapper: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  watermark: {},
});