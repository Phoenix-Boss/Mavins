/**
 * types.ts — expo-autoeq-engine
 */

// ── Band index ────────────────────────────────────────────────────────────────
export type EqBandIndex =
  | 0|1|2|3|4|5|6|7|8|9
  | 10|11|12|13|14|15|16|17|18|19
  | 20|21|22|23|24|25|26|27|28|29|30;

// ── 31-band gains array ───────────────────────────────────────────────────────
export type EqBandGains = [
  number,number,number,number,number,number,number,number,number,number,
  number,number,number,number,number,number,number,number,number,number,
  number,number,number,number,number,number,number,number,number,number,number
];

// ── Biquad filter ─────────────────────────────────────────────────────────────
// Matches the AutoEq ParametricEQ.txt format exactly.
// fc + q + gainDb — NO bandIndex field (bandIndex was wrong; AutoEq uses frequency)
export type EqBiquadType =
  | "PK" | "LS" | "HS" | "LP" | "HP"        // AutoEq short codes
  | "peaking" | "lowShelf" | "highShelf"      // long-form aliases
  | "lowPass" | "highPass";

export interface EqBiquadFilter {
  /** Filter type — PK/LS/HS (gain-modifying) or LP/HP (pass, no gain) */
  filter_type: EqBiquadType;
  /** Center / cutoff frequency in Hz */
  fc: number;
  /** Quality factor */
  q: number;
  /** Gain in dB — used for PK, LS, HS. Ignored for LP, HP. */
  gain_db: number;
}

// ── Preset shapes ─────────────────────────────────────────────────────────────
export interface EqPresetGraphic {
  id: string;
  name: string;
  type: "graphic_31band";
  gains_31: EqBandGains;
  biquad_filters?: never;
  preamp_db?: number;
}

export interface EqPresetParametric {
  id: string;
  name: string;
  type: "biquad";
  gains_31?: never;
  biquad_filters: EqBiquadFilter[];
  /** Preamp from AutoEq "Preamp: X dB" line — applied before all filters */
  preamp_db: number;
}

export type EqPreset = EqPresetGraphic | EqPresetParametric;

// ── Native module interface ───────────────────────────────────────────────────
export interface AutoEQNativeModule {
  setupEQ(audioSessionId: number): Promise<void>;
  getAudioSessionId(): Promise<number>;
  setBand(index: number, gainDb: number): Promise<void>;
  applyBands(gains: number[]): Promise<void>;
  setParametricFilters(
    filters: EqBiquadFilter[],
    preampDb: number
  ): Promise<void>;
  getGains(): Promise<number[]>;
  setEnabled(enabled: boolean): Promise<void>;
  reset(): Promise<void>;
  release(): Promise<void>;
}

// ── EQ UI state ───────────────────────────────────────────────────────────────
export interface EqState {
  isSetup: boolean;
  isEnabled: boolean;
  gains: number[];
  activePreset: EqPreset | null;
  isLoading: boolean;
  error: string | null;
}