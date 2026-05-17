// components/ScrollControllerWrapper.tsx
import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScrollHandler } from '@/hooks/useScrollHandler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useTheme } from '@/contexts/ThemeContext';

interface ScrollControllerWrapperProps {
  children: React.ReactNode;
  headerComponent?: React.ReactNode;
  showHeader?: boolean;
  refreshControl?: React.ReactElement;
  contentContainerStyle?: any;
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
  const { colors } = useTheme();

  const [headerHeight, setHeaderHeight] = useState(initialHeaderHeight);
  const { scrollHandler, headerTranslateY } = useScrollHandler({ headerHeight });

  const onHeaderLayout = useCallback((event: any) => {
    const measuredHeight = event.nativeEvent.layout.height;
    if (Math.abs(measuredHeight - headerHeight) > 1) {
      setHeaderHeight(measuredHeight);
    }
  }, [headerHeight]);

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: headerTranslateY.value }],
  }));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Animated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.contentContainer,
          contentContainerStyle,
          {
            paddingTop: showHeader && headerComponent ? headerHeight : 0,
            paddingBottom: safeAreaBottom + 80,
          },
        ]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        overScrollMode="always"
        refreshControl={refreshControl}
      >
        {children}
      </Animated.ScrollView>

      {showHeader && headerComponent && (
        <Animated.View
          style={[
            styles.headerContainer,
            { 
              backgroundColor: colors.background,
              borderBottomColor: colors.border,
            },
            headerAnimatedStyle,
          ]}
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
  },
  headerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    borderBottomWidth: 1,
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
