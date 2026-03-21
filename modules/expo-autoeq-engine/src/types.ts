/**
 * types.ts — expo-autoeq-engine
 *
 * All public-facing TypeScript types for the EQ module.
 */

// ── Band index ────────────────────────────────────────────────────────────────
// Strictly typed so you can't accidentally pass band 35 to setBand().
export type EqBandIndex =
  | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19
  | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30;

// ── Gains ─────────────────────────────────────────────────────────────────────
// Array of exactly 31 dB values — one per ISO band, -12..+12 dB each.
export type EqBandGains = [
  number, number, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number, number, number,
  number
];

// ── Biquad / parametric ───────────────────────────────────────────────────────
export type EqBiquadType =
  | "peaking"
  | "lowShelf"
  | "highShelf"
  | "lowPass"
  | "highPass";

export interface EqBiquadFilter {
  type: EqBiquadType;
  /** Center / cutoff frequency in Hz */
  fc: number;
  /** Quality factor */
  q: number;
  /** Gain in dB — used for peaking, lowShelf, highShelf */
  gainDb: number;
  /** Which of the 31 bands to apply this to (0–30) */
  bandIndex: EqBandIndex;
}

// ── Preset shapes ─────────────────────────────────────────────────────────────
export type EqPresetType = "graphic_31band" | "biquad";

export interface EqPresetGraphic {
  id: string;
  name: string;
  type: "graphic_31band";
  /** 31 dB values in ISO band order */
  gains_31: EqBandGains;
  biquad_filters?: never;
}

export interface EqPresetBiquad {
  id: string;
  name: string;
  type: "biquad";
  gains_31?: never;
  /** AutoEq-style parametric filters stored in Supabase as jsonb */
  biquad_filters: EqBiquadFilter[];
}

export type EqPreset = EqPresetGraphic | EqPresetBiquad;

// ── Native module interface ───────────────────────────────────────────────────
export interface AutoEQNativeModule {
  /** Attach DynamicsProcessing to the player's audio session. Call once per track. */
  setupEQ(audioSessionId: number): Promise<void>;
  /** Adjust a single band. Prefer applyBands() for full preset application. */
  setBand(index: number, gainDb: number): Promise<void>;
  /** Batch-apply all 31 gains in one bridge call. Fastest for preset loading. */
  applyBands(gains: number[]): Promise<void>;
  /** Apply a parametric biquad filter to a specific band. */
  setBiquadParam(
    type: EqBiquadType,
    bandIndex: number,
    fc: number,
    gainDb: number
  ): Promise<void>;
  /** Returns current gain values for all 31 bands. */
  getGains(): Promise<number[]>;
  /** Toggle EQ on/off without releasing (re-enabling is instant). */
  setEnabled(enabled: boolean): Promise<void>;
  /** Release the AudioEffect chain. ALWAYS call on track change or player destroy. */
  release(): Promise<void>;
}

// ── EQ state for UI ───────────────────────────────────────────────────────────
export interface EqState {
  isSetup: boolean;
  isEnabled: boolean;
  gains: number[];            // current 31-band gains shown in the UI
  activePreset: EqPreset | null;
  isLoading: boolean;
  error: string | null;
}
