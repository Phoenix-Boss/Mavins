/**
 * Sponsored Badge Component - Displays "Sponsored" tag on sponsored content
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
} from "react-native";

// Metallic Gold Color Palette
const COLORS = {
  goldPrimary: '#D4AF37',
  background: '#000000',
};

interface SponsoredBadgeProps {
  sponsorName?: string;
}

export const SponsoredBadge = ({ sponsorName }: SponsoredBadgeProps) => {
  return (
    <View style={styles.sponsoredBadge}>
      <Text style={styles.sponsoredText}>
        {sponsorName ? `Sponsored by ${sponsorName}` : 'Sponsored'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  sponsoredBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: COLORS.goldPrimary + 'DD',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    zIndex: 2,
  },
  sponsoredText: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.background,
  },
});
