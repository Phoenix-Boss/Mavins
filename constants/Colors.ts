// constants/colors.ts

/**
 * This file defines the color palette used throughout the AudioScape application.
 * It centralizes color definitions to ensure consistency and easy modification of the app's theme.
 */

export const Colors = {
  /**
   * Color for the inactive part of a track progress bar.
   */
  maximumTrackTintColor: "rgba(255,255,255,0.2)",
  /**
   * Color for the active part of a track progress bar.
   */
  minimumTrackTintColor: "#fff",
  /**
   * Primary text color.
   */
  text: "#ECEDEE",
  /**
   * Muted text color, for secondary information.
   */
  textMuted: "#9ca3af",
  /**
   * Main background color of the application.
   */
  background: "#000",
  /**
   * Accent color, often used for interactive elements or highlights.
   */
  tint: "#fff",
  /**
   * Default color for icons.
   */
  icon: "#9BA1A6",
  /**
   * Metallic Brown color scheme for the equalizer and audio controls
   */
  metallicBrown: {
    primary: "#8B7355",
    secondary: "#A0826D",
    light: "#B8956A",
    dark: "#6B5344",
    glow: "#9C846F",
    surface: "#121212",
  },
};

// Also export METALLIC_BROWN separately for backward compatibility
export const METALLIC_BROWN = Colors.metallicBrown;
