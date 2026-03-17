// modules/honeygain/index.ts
// JS entry point for the Honeygain Expo module.
// Imported via package.json alias: "honeygain-sdk": "file:./modules/honeygain"
// Native side registered as Name("Honeygain") in HoneygainModule.kt.
//
// ─── KEY OWNERSHIP ────────────────────────────────────────────────────────────
// API_KEY lives here and ONLY here in JS-land.
// No caller (ConsentGate, screens, hooks) ever sees or passes the key.
// initialize() is intentionally no-arg — the module injects the key itself.
//
// To keep the key out of source control, replace the inline string with:
//   import { HONEYGAIN_API_KEY } from '../secrets'; // secrets.ts is gitignored
// ─────────────────────────────────────────────────────────────────────────────

import { requireNativeModule, EventEmitter } from 'expo-modules-core';

const API_KEY = '2125ae20cfd8855abc0bee8cc9c997c4';

// ─── Event map ────────────────────────────────────────────────────────────────
// expo-modules-core's EventEmitter<T> requires T to extend EventsMap, which
// demands an index signature: [key: string]: (...args: any[]) => void
// Without it TS raises: "Type does not satisfy the constraint 'EventsMap'.
//   Index signature for type 'string' is missing in type '...'"
interface HoneygainEvents {
  [key: string]:    (...args: any[]) => void; // satisfies EventsMap constraint
  onError:          (e: { message: string })   => void;
  onConsentGranted: (e: { timestamp: number }) => void;
  onConsentDenied:  (e: { timestamp: number }) => void;
  onSdkStarted:     (e: { timestamp: number }) => void;
  onSdkStopped:     (e: { timestamp: number }) => void;
}

// ─── Native module ────────────────────────────────────────────────────────────
export const HoneygainModule  = requireNativeModule('Honeygain');
export const HoneygainEmitter = new EventEmitter<HoneygainEvents>(HoneygainModule);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HoneygainStatus {
  isRunning: boolean;
  isOptedIn: boolean;
  isBackground: boolean;
  launchOnBoot: boolean;
  enableLogging: boolean;
  lastError?: string | null;
  initialized: boolean;
}

export interface HoneygainConfig {
  isBackground?: boolean;
  launchOnBoot?: boolean;
  enableLogging?: boolean;
}

export interface SdkResult {
  success: boolean;
  message?: string;
  requiresConsent?: boolean;
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Initialise the SDK. No arguments — key is managed inside this module.
 * Must be called before optIn() + start().
 */
export const initialize = (): Promise<SdkResult> =>
  HoneygainModule.initialize(API_KEY);

/** Start bandwidth sharing. Returns { requiresConsent: true } if optIn() hasn't been called. */
export const start = (): Promise<SdkResult> =>
  HoneygainModule.start();

/** Temporarily stop the SDK. Restarts on next init / reboot if launchOnBoot is true. */
export const stop = (): Promise<SdkResult> =>
  HoneygainModule.stop();

/** Grant consent programmatically (custom consent UI). Must be called before start(). */
export const optIn = (): Promise<SdkResult> =>
  HoneygainModule.optIn();

/** Revoke consent and stop the SDK immediately. */
export const optOut = (): Promise<SdkResult> =>
  HoneygainModule.optOut();

/** Get the full SDK status snapshot. */
export const getStatus = (): Promise<HoneygainStatus> =>
  HoneygainModule.getStatus();

/** Get the last error that caused the SDK to stop, or null if none. */
export const getLastError = (): Promise<{ message: string } | null> =>
  HoneygainModule.getLastError();

/** Update runtime config (isBackground, launchOnBoot, enableLogging). */
export const configure = (config: HoneygainConfig): Promise<SdkResult> =>
  HoneygainModule.configure(config);

// ─── Events ───────────────────────────────────────────────────────────────────

export const onError = (cb: (e: { message: string }) => void) =>
  HoneygainEmitter.addListener('onError', cb);

export const onConsentGranted = (cb: (e: { timestamp: number }) => void) =>
  HoneygainEmitter.addListener('onConsentGranted', cb);

export const onConsentDenied = (cb: (e: { timestamp: number }) => void) =>
  HoneygainEmitter.addListener('onConsentDenied', cb);

export const onSdkStarted = (cb: (e: { timestamp: number }) => void) =>
  HoneygainEmitter.addListener('onSdkStarted', cb);

export const onSdkStopped = (cb: (e: { timestamp: number }) => void) =>
  HoneygainEmitter.addListener('onSdkStopped', cb);

// ─── Backward-compat stubs ────────────────────────────────────────────────────

/** @deprecated → stop() */
export const stopSharing = (): Promise<SdkResult> => {
  console.warn('[Honeygain] stopSharing() is deprecated → use stop()');
  return stop();
};

/** @deprecated → getStatus() */
export const getEarnings = (): Promise<HoneygainStatus> => {
  console.warn('[Honeygain] getEarnings() is deprecated → use getStatus()');
  return getStatus();
};

/** @deprecated → initialize() + start() */
export const startBandwidthSession = async (_durationSeconds: number): Promise<boolean> => {
  console.warn('[Honeygain] startBandwidthSession() is deprecated → use initialize() + start()');
  return getStatus().then(s => s.isRunning);
};

/** @deprecated → stop() */
export const stopSession = (): Promise<SdkResult> => {
  console.warn('[Honeygain] stopSession() is deprecated → use stop()');
  return stop();
};

// ─── Default export ───────────────────────────────────────────────────────────

export default {
  HoneygainModule,
  HoneygainEmitter,
  // core
  initialize,
  start,
  stop,
  optIn,
  optOut,
  getStatus,
  getLastError,
  configure,
  // events
  onError,
  onConsentGranted,
  onConsentDenied,
  onSdkStarted,
  onSdkStopped,
  // backward compat
  stopSharing,
  getEarnings,
  startBandwidthSession,
  stopSession,
};