// app/(player)/_layout.tsx
import { Tabs } from 'expo-router';
import { View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { usePlayerOverlay } from '@/libs/playerOverlay';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

export default function PlayerLayout() {
  const { colors } = useTheme();
  const { playerMode } = usePlayerOverlay();
  const insets = useSafeAreaInsets();
  
  const isExpandedPlayerVisible = playerMode === 'expanded';
  const shouldShowTabBar = !isExpandedPlayerVisible;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            position: 'absolute',
            bottom: Platform.OS === 'ios' ? 20 : 16,
            left: 16,
            right: 16,
            backgroundColor: colors.tabBarBackground,
            borderRadius: 28,
            height: Platform.OS === 'ios' ? 70 : 60,
            paddingBottom: Platform.OS === 'ios' ? 10 : 8,
            paddingTop: 8,
            paddingHorizontal: 12,
            borderTopWidth: 0,
            shadowColor: colors.isDark ? '#000' : '#888',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: colors.isDark ? 0.3 : 0.15,
            shadowRadius: 12,
            elevation: 10,
            borderWidth: colors.isDark ? 0 : 0.5,
            borderColor: colors.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
            display: shouldShowTabBar ? 'flex' : 'none',
          },
          tabBarActiveTintColor: colors.gold,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '500',
            marginTop: 4,
          },
          tabBarItemStyle: {
            borderRadius: 20,
            marginHorizontal: 4,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons 
                name={focused ? 'home' : 'home-outline'} 
                size={size} 
                color={color} 
              />
            ),
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: 'Library',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons 
                name={focused ? 'library' : 'library-outline'} 
                size={size} 
                color={color} 
              />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons 
                name={focused ? 'settings' : 'settings-outline'} 
                size={size} 
                color={color} 
              />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});