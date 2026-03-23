/**
 * presets.ts — expo-autoeq-engine
 *
 * Built-in 31-band EQ presets (ISO 20 Hz – 20 kHz).
 * Gains are in dB, ordered from 20 Hz → 20 kHz.
 * Bands: 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315,
 *         400, 500, 630, 800, 1k, 1.25k, 1.6k, 2k, 2.5k, 3.15k, 4k,
 *         5k, 6.3k, 8k, 10k, 12.5k, 16k, 20k
 *
 * These ship with the module so users have presets before loading from Supabase.
 * Your app can override or extend these with Supabase-stored curves.
 */

import type { EqBandGains } from "./types";

export const FLAT: EqBandGains = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

// Harman target curve — broadly accepted as a "reference" listening target
export const HARMAN: EqBandGains = [
  4.0, 3.5, 3.0, 2.5, 2.0, 1.5, 1.0, 0.5, 0.0, -0.5,
  -1.0, -1.0, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5, 2.0, 2.5,
  3.0, 3.5, 4.0, 4.0, 3.5, 3.0, 2.0, 1.0, 0.0, -1.0, -2.0,
];

// Bass boost — sub-bass and low-mid lifted
export const BASS_BOOST: EqBandGains = [
  6.0, 6.0, 5.5, 5.0, 4.5, 4.0, 3.5, 3.0, 2.0, 1.0,
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
];

// Treble boost — presence and air lifted
export const TREBLE_BOOST: EqBandGains = [
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 1.0, 1.5, 2.0,
  2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.0, 5.5, 5.0,
];

// Vocal boost — 1k–4k presence region lifted, sub-bass reduced
export const VOCAL_BOOST: EqBandGains = [
  -2.0, -2.0, -1.5, -1.0, -0.5, 0.0, 0.0, 0.5, 1.0, 1.5,
  2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 4.0, 3.5, 3.0, 2.5,
  2.0, 1.5, 1.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
];

// Classical — slight bass and treble lift, flat mid
export const CLASSICAL: EqBandGains = [
  3.0, 2.5, 2.0, 1.5, 1.0, 0.5, 0.0, 0.0, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5,
  1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.0, 3.5, 3.0, 2.5,
];

// Electronic / EDM — heavy sub, scooped mids, lifted top
export const ELECTRONIC: EqBandGains = [
  6.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.0, 0.0, -1.0, -2.0,
  -3.0, -3.0, -2.0, -1.0, 0.0, 0.5, 1.0, 1.5, 2.0, 2.5,
  3.0, 4.0, 5.0, 5.5, 6.0, 5.5, 5.0, 4.0, 3.0, 2.0, 1.0,
];

export const BUILT_IN_PRESETS = {
  flat:       { id: "builtin_flat",       name: "Flat",          type: "graphic_31band" as const, gains_31: FLAT },
  harman:     { id: "builtin_harman",     name: "Harman",        type: "graphic_31band" as const, gains_31: HARMAN },
  bassBoost:  { id: "builtin_bass",       name: "Bass Boost",    type: "graphic_31band" as const, gains_31: BASS_BOOST },
  treble:     { id: "builtin_treble",     name: "Treble Boost",  type: "graphic_31band" as const, gains_31: TREBLE_BOOST },
  vocal:      { id: "builtin_vocal",      name: "Vocal Boost",   type: "graphic_31band" as const, gains_31: VOCAL_BOOST },
  classical:  { id: "builtin_classical",  name: "Classical",     type: "graphic_31band" as const, gains_31: CLASSICAL },
  electronic: { id: "builtin_electronic", name: "Electronic",    type: "graphic_31band" as const, gains_31: ELECTRONIC },
};

/** The 31 ISO center frequencies in order — useful for rendering the EQ curve UI */
export const ISO_FREQ_CENTERS: readonly number[] = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

/** Format a frequency for display (e.g. 1000 → "1k", 20000 → "20k") */
export function formatFreq(hz: number): string {
  if (hz >= 1000) return `${hz / 1000 % 1 === 0 ? hz / 1000 : (hz / 1000).toFixed(1)}k`;
  return `${hz}`;
}