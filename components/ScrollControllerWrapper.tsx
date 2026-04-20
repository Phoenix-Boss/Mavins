// components/ScrollControllerWrapper.tsx
import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScrollHandler } from '@/hooks/useScrollHandler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

interface ScrollControllerWrapperProps {
  children: React.ReactNode;
  headerComponent?: React.ReactNode;
  showHeader?: boolean;
  refreshControl?: React.ReactElement;
  contentContainerStyle?: any;
  /**
   * Approximate header height before onLayout fires.
   * Prevents content from being hidden under the absolute header on the
   * first render frame (when headerHeight state is still 0).
   * Defaults to 70 — adjust to match your actual header height.
   */
  initialHeaderHeight?: number;
}

export default function ScrollControllerWrapper({
  children,
  headerComponent,
  showHeader = true,
  refreshControl,
  contentContainerStyle,
  initialHeaderHeight = 70,
}: ScrollControllerWrapperProps) {
  const { bottom: safeAreaBottom } = useSafeAreaInsets();

  // ==================== MEASUREMENTS ====================
  // Start with initialHeaderHeight so paddingTop is correct on frame 1.
  // Once the header lays out we get the real value and correct if needed.
  const [headerHeight, setHeaderHeight] = useState(initialHeaderHeight);

  // ==================== SCROLL HOOK ====================
  const { scrollHandler, headerTranslateY } = useScrollHandler({ headerHeight });

  // ==================== LAYOUT CALLBACK ====================
  const onHeaderLayout = useCallback((event: any) => {
    const measuredHeight = event.nativeEvent.layout.height;
    // Only update if meaningfully different to avoid unnecessary re-renders
    if (Math.abs(measuredHeight - headerHeight) > 1) {
      setHeaderHeight(measuredHeight);
    }
  }, [headerHeight]);

  // ==================== ANIMATED STYLES ====================
  const headerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: headerTranslateY.value }],
  }));

  // ==================== RENDER ====================
  return (
    <View style={styles.container}>
      {/*
        ScrollView is rendered FIRST in JSX so the header Animated.View,
        rendered after, naturally sits above it in the stacking context
        without needing extra zIndex manipulation.
      */}
      <Animated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.contentContainer,
          contentContainerStyle,
          {
            // paddingTop reserves space for the absolute header.
            // Because we initialise headerHeight with initialHeaderHeight,
            // this is correct from frame 1 — no content hidden on mount.
            paddingTop: showHeader && headerComponent ? headerHeight : 0,
            // Bottom padding accounts for safe area + tab bar height.
            paddingBottom: safeAreaBottom + 80,
          },
        ]}
        onScroll={scrollHandler}
        scrollEventThrottle={1}
        showsVerticalScrollIndicator={false}
        overScrollMode="always"
        // FIX: refreshControl was previously accepted as a prop but never
        // wired to the ScrollView — pull-to-refresh was silently broken.
        refreshControl={refreshControl}
      >
        {children}
      </Animated.ScrollView>

      {/* Header — absolute, rendered after ScrollView so it paints on top */}
      {showHeader && headerComponent && (
        <Animated.View
          style={[styles.headerContainer, headerAnimatedStyle]}
          onLayout={onHeaderLayout}
        >
          {headerComponent}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  headerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: '#000000',
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  contentContainer: {
    flexGrow: 1,
    backgroundColor: 'transparent',
  },
});