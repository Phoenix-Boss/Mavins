/**
 * presets.ts — mavin-eq
 * 
 * Built-in 31-band EQ presets + factory functions + utilities
 */

import type { EqBandGains, EqPreset, PresetCategory, PresetTag } from './types';

// ── 31-Band ISO Frequency Centers ─────────────────────────────────────────────

export const ISO_FREQ_CENTERS: readonly number[] = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

// ── Built-in Gain Curves ───────────────────────────────────────────────────────

export const FLAT: EqBandGains = Array(31).fill(0);

export const HARMAN: EqBandGains = [
  4.0, 3.5, 3.0, 2.5, 2.0, 1.5, 1.0, 0.5, 0.0, -0.5,
  -1.0, -1.0, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5, 2.0, 2.5,
  3.0, 3.5, 4.0, 4.0, 3.5, 3.0, 2.0, 1.0, 0.0, -1.0, -2.0,
];

export const BASS_BOOST: EqBandGains = [
  6.0, 6.0, 5.5, 5.0, 4.5, 4.0, 3.5, 3.0, 2.0, 1.0,
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
];

export const TREBLE_BOOST: EqBandGains = [
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 1.0, 1.5, 2.0,
  2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.0, 5.5, 5.0,
];

export const VOCAL_BOOST: EqBandGains = [
  -2.0, -2.0, -1.5, -1.0, -0.5, 0.0, 0.0, 0.5, 1.0, 1.5,
  2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 4.0, 3.5, 3.0, 2.5,
  2.0, 1.5, 1.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
];

export const CLASSICAL: EqBandGains = [
  3.0, 2.5, 2.0, 1.5, 1.0, 0.5, 0.0, 0.0, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5,
  1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.0, 3.5, 3.0, 2.5,
];

export const ELECTRONIC: EqBandGains = [
  6.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.0, 0.0, -1.0, -2.0,
  -3.0, -3.0, -2.0, -1.0, 0.0, 0.5, 1.0, 1.5, 2.0, 2.5,
  3.0, 4.0, 5.0, 5.5, 6.0, 5.5, 5.0, 4.0, 3.0, 2.0, 1.0,
];

export const ROCK: EqBandGains = [
  3.0, 3.0, 2.5, 2.0, 1.5, 1.0, 0.5, 0.0, 0.5, 1.0,
  1.5, 2.0, 2.0, 1.5, 1.0, 0.5, 0.0, 0.0, 0.5, 1.0,
  1.5, 2.0, 2.5, 3.0, 3.0, 2.5, 2.0, 1.5, 1.0, 0.5, 0.0,
];

export const JAZZ: EqBandGains = [
  2.0, 1.5, 1.0, 0.5, 0.0, 0.0, 0.5, 1.0, 1.5, 2.0,
  2.5, 2.5, 2.0, 1.5, 1.0, 0.5, 0.0, 0.0, 0.5, 1.0,
  1.5, 2.0, 2.5, 3.0, 3.5, 3.0, 2.0, 1.0, 0.5, 0.0, 0.0,
];

export const PODCAST: EqBandGains = [
  -6.0, -4.0, -2.0, 0.0, 2.0, 4.0, 6.0, 6.0, 6.0, 5.0,
  4.0, 3.0, 2.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
];

export const LOUDNESS: EqBandGains = [
  6.0, 5.5, 5.0, 4.5, 4.0, 3.5, 3.0, 2.5, 2.0, 1.5,
  1.0, 0.5, 0.0, 0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0,
  3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.0, 5.5, 5.0, 4.5, 4.0,
];

export const HIP_HOP: EqBandGains = [
  5.0, 5.0, 4.5, 4.0, 3.0, 2.0, 1.0, 0.0, -0.5, -1.0,
  -1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0,
  3.5, 4.0, 4.5, 5.0, 5.0, 4.5, 4.0, 3.0, 2.0, 1.0, 0.5,
];

export const ACOUSTIC: EqBandGains = [
  1.0, 1.0, 0.5, 0.0, 0.0, 0.5, 1.0, 1.5, 2.0, 2.5,
  3.0, 3.0, 2.5, 2.0, 1.5, 1.0, 0.5, 0.0, 0.0, 0.5,
  1.0, 1.5, 2.0, 2.5, 3.0, 3.0, 2.5, 2.0, 1.5, 1.0, 0.5,
];

// ── Factory Functions ────────────────────────────────────────────────────────

function createBuiltinPreset(
  id: string,
  name: string,
  gains: EqBandGains,
  options: {
    description?: string;
    icon?: string;
    color?: string;
    tags?: PresetTag[];
  } = {}
): EqPreset {
  return {
    id: `builtin_${id}`,
    name,
    type: 'graphic_31band',
    category: 'builtin',
    gains_31: gains,
    preamp_db: 0,
    source: 'local',
    description: options.description,
    icon: options.icon || 'sliders',
    color: options.color || '#6366f1',
    tags: options.tags || ['balanced'],
    isFavorite: false,
  };
}

// ── Built-in Presets Collection ───────────────────────────────────────────────

export const BUILT_IN_PRESETS: Record<string, EqPreset> = {
  flat: createBuiltinPreset('flat', 'Flat', FLAT, {
    description: 'No EQ applied - pure audio',
    icon: 'minus',
    color: '#9ca3af',
    tags: ['flat', 'audiophile'],
  }),
  
  harman: createBuiltinPreset('harman', 'Harman Target', HARMAN, {
    description: 'Research-based reference curve',
    icon: 'target',
    color: '#8b5cf6',
    tags: ['balanced', 'audiophile'],
  }),
  
  bassBoost: createBuiltinPreset('bass', 'Bass Boost', BASS_BOOST, {
    description: 'Deep sub-bass enhancement',
    icon: 'waves',
    color: '#f59e0b',
    tags: ['bass', 'electronic', 'hiphop'],
  }),
  
  trebleBoost: createBuiltinPreset('treble', 'Treble Boost', TREBLE_BOOST, {
    description: 'Enhanced clarity and air',
    icon: 'sparkles',
    color: '#06b6d4',
    tags: ['treble', 'bright'],
  }),
  
  vocalBoost: createBuiltinPreset('vocal', 'Vocal Boost', VOCAL_BOOST, {
    description: 'Clear vocals, reduced bass',
    icon: 'mic',
    color: '#ec4899',
    tags: ['vocal', 'podcast'],
  }),
  
  electronic: createBuiltinPreset('electronic', 'Electronic', ELECTRONIC, {
    description: 'Club-ready EDM curve',
    icon: 'zap',
    color: '#a855f7',
    tags: ['electronic', 'bass', 'loudness'],
  }),
  
  rock: createBuiltinPreset('rock', 'Rock', ROCK, {
    description: 'Guitar-forward with punch',
    icon: 'guitar',
    color: '#ef4444',
    tags: ['rock'],
  }),
  
  jazz: createBuiltinPreset('jazz', 'Jazz', JAZZ, {
    description: 'Warm, natural presentation',
    icon: 'music',
    color: '#f97316',
    tags: ['jazz', 'warm'],
  }),
  
  classical: createBuiltinPreset('classical', 'Classical', CLASSICAL, {
    description: 'Full range, dynamic',
    icon: 'piano',
    color: '#10b981',
    tags: ['classical', 'balanced'],
  }),
  
  podcast: createBuiltinPreset('podcast', 'Podcast', PODCAST, {
    description: 'Voice clarity optimized',
    icon: 'headphones',
    color: '#14b8a6',
    tags: ['podcast', 'vocal'],
  }),
  
  loudness: createBuiltinPreset('loudness', 'Loudness', LOUDNESS, {
    description: 'Maximum perceived volume',
    icon: 'volume-2',
    color: '#dc2626',
    tags: ['loudness'],
  }),
  
  hiphop: createBuiltinPreset('hiphop', 'Hip Hop', HIP_HOP, {
    description: 'Bass-heavy urban sound',
    icon: 'disc',
    color: '#7c3aed',
    tags: ['hiphop', 'bass'],
  }),
  
  acoustic: createBuiltinPreset('acoustic', 'Acoustic', ACOUSTIC, {
    description: 'Natural instrument focus',
    icon: 'guitar',
    color: '#84cc16',
    tags: ['warm', 'balanced'],
  }),
};

export const BUILT_IN_PRESETS_LIST = Object.values(BUILT_IN_PRESETS);

// ── Utility Functions ─────────────────────────────────────────────────────────

export function formatFreq(hz: number): string {
  if (hz >= 1000) {
    const khz = hz / 1000;
    return khz % 1 === 0 ? `${khz.toFixed(0)}k` : `${khz.toFixed(1)}k`;
  }
  return `${hz}`;
}

export function getFreqLabel(index: number): string {
  return formatFreq(ISO_FREQ_CENTERS[index]);
}

export function createCustomPreset(
  name: string,
  gains: EqBandGains,
  options: Partial<Omit<EqPreset, 'id' | 'category' | 'source'>> = {}
): EqPreset {
  const now = new Date().toISOString();
  return {
    id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name,
    type: 'graphic_31band',
    category: 'user',
    gains_31: gains,
    preamp_db: options.preamp_db ?? 0,
    source: 'local',
    description: options.description,
    icon: options.icon || 'user',
    color: options.color || '#6366f1',
    tags: options.tags || ['custom'],
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
    ...options,
  };
}

export function duplicatePreset(preset: EqPreset, newName?: string): EqPreset {
  const now = new Date().toISOString();
  return {
    ...preset,
    id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name: newName || `${preset.name} (Copy)`,
    category: 'user',
    source: 'local',
    supabaseId: undefined,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: undefined,
  };
}

export function normalizeGains(gains: number[]): EqBandGains {
  const normalized = new Array(31).fill(0);
  for (let i = 0; i < Math.min(gains.length, 31); i++) {
    normalized[i] = Math.max(-15, Math.min(15, gains[i]));
  }
  return normalized as EqBandGains;
}

export function interpolatePreset(
  presetA: EqPreset,
  presetB: EqPreset,
  ratio: number
): number[] {
  if (!presetA.gains_31 || !presetB.gains_31) return FLAT;
  
  return presetA.gains_31.map((gain, i) => {
    const target = presetB.gains_31![i] || 0;
    return gain + (target - gain) * ratio;
  });
}

export function getPresetTagsByGenre(genre: string): PresetTag[] {
  const genreMap: Record<string, PresetTag[]> = {
    'electronic': ['electronic', 'bass'],
    'rock': ['rock'],
    'jazz': ['jazz', 'warm'],
    'classical': ['classical', 'balanced'],
    'hip-hop': ['hiphop', 'bass'],
    'podcast': ['podcast', 'vocal'],
    'pop': ['vocal', 'balanced'],
    'acoustic': ['warm', 'balanced'],
  };
  
  return genreMap[genre.toLowerCase()] || ['balanced'];
}