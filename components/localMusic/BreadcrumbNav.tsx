// components/localMusic/BreadcrumbNav.tsx
import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Ionicons } from '@expo/vector-icons';

interface BreadcrumbNavProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function BreadcrumbNav({ currentPath, onNavigate }: BreadcrumbNavProps) {
  const { colors } = useTheme();
  
  const pathSegments = currentPath === '/'
    ? ['Root']
    : currentPath.split('/').filter(Boolean);
  
  const buildPath = (index: number): string => {
    if (index === -1) return '/';
    const segments = pathSegments.slice(0, index + 1);
    return '/' + segments.join('/');
  };
  
  if (currentPath === '/' && pathSegments.length === 1) {
    return null;
  }
  
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      <TouchableOpacity onPress={() => onNavigate('/')} style={styles.segment}>
        <Text style={[styles.segmentText, { color: colors.gold }]}>Root</Text>
      </TouchableOpacity>
      
      {pathSegments.map((segment, index) => {
        const isLast = index === pathSegments.length - 1;
        const path = buildPath(index);
        
        return (
          <TouchableOpacity
            key={path}
            onPress={() => !isLast && onNavigate(path)}
            style={styles.segment}
            disabled={isLast}
          >
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
            <Text
              style={[
                styles.segmentText,
                { color: isLast ? colors.text : colors.textSub },
              ]}
              numberOfLines={1}
            >
              {segment}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 4,
  },
  segmentText: {
    fontSize: 12,
    marginLeft: 4,
  },
});
