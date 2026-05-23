// modules/pawns-sdk/index.ts
// JS entry point for the Pawns Expo module.
// Imported via package.json alias: "pawns-sdk": "file:./modules/pawns-sdk"
// Native side registered as Name("PawnsModule") in PawnsModule.kt.
//
// ─── KEY OWNERSHIP ────────────────────────────────────────────────────────────
// API_KEY lives here and ONLY here in JS-land.
// No caller (ConsentGate, screens, hooks) ever sees or passes the key.
// initialize() is intentionally no-arg — the module injects the key itself.
// ─────────────────────────────────────────────────────────────────────────────

import { requireNativeModule, EventEmitter } from 'expo-modules-core';

const API_KEY = '2125ae20cfd8855abc0bee8cc9c997c4';

// ─── Event map ────────────────────────────────────────────────────────────────
interface PawnsEvents {
  [key: string]:    (...args: any[]) => void;
  onError:          (e: { message: string })   => void;
  onConsentGranted: (e: { timestamp: number }) => void;
  onConsentDenied:  (e: { timestamp: number }) => void;
  onSdkStarted:     (e: { timestamp: number }) => void;
  onSdkStopped:     (e: { timestamp: number }) => void;
}

// ─── Native module ────────────────────────────────────────────────────────────
export const PawnsModule  = requireNativeModule('PawnsModule');
export const PawnsEmitter = new EventEmitter<PawnsEvents>(PawnsModule);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PawnsStatus {
  isRunning:      boolean;
  isOptedIn:      boolean;
  isBackground:   boolean;
  launchOnBoot:   boolean;
  enableLogging:  boolean;
  lastError?:     string | null;
// modules/pawns-sdk/index.ts
// JS entry point for the Pawns Expo module.
// Imported via package.json alias: "pawns-sdk": "file:./modules/pawns-sdk"
// Native side registered as Name("PawnsModule") in PawnsModule.kt.
//
// ─── KEY OWNERSHIP ────────────────────────────────────────────────────────────
// API_KEY lives here and ONLY here in JS-land.
// No caller (ConsentGate, screens, hooks) ever sees or passes the key.
// initialize() is intentionally no-arg — the module injects the key itself.
// ─────────────────────────────────────────────────────────────────────────────

import { requireNativeModule, EventEmitter } from 'expo-modules-core';

const API_KEY = '2125ae20cfd8855abc0bee8cc9c997c4';

// ─── Event map ────────────────────────────────────────────────────────────────
interface PawnsEvents {
  [key: string]:    (...args: any[]) => void;
  onError:          (e: { message: string })   => void;
  onConsentGranted: (e: { timestamp: number }) => void;
  onConsentDenied:  (e: { timestamp: number }) => void;
  onSdkStarted:     (e: { timestamp: number }) => void;
  onSdkStopped:     (e: { timestamp: number }) => void;
}

// ─── Native module ────────────────────────────────────────────────────────────
export const PawnsModule  = requireNativeModule('PawnsModule');
export const PawnsEmitter = new EventEmitter<PawnsEvents>(PawnsModule);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PawnsStatus {
  isRunning:      boolean;
  isOptedIn:      boolean;
  isBackground:   boolean;
  launchOnBoot:   boolean;
  enableLogging:  boolean;
  lastError?:     string | null;
  initialized:    boolean;
}

export interface PawnsConfig {
  isBackground?:  boolean;
  launchOnBoot?:  boolean;
  enableLogging?: boolean;
}

export interface SdkResult {
  success:          boolean;
  message?:         string;
  requiresConsent?: boolean;
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Initialise the SDK. No arguments — key is managed inside this module.
 * Must be called before optIn() + start().
 */
export const initialize = (): Promise<SdkResult> =>
  PawnsModule.initialize(API_KEY);

/** Start bandwidth sharing. Returns { requiresConsent: true } if optIn() hasn't been called. */
export const start = (): Promise<SdkResult> =>
  PawnsModule.start();

/** Temporarily stop the SDK. */
export const stop = (): Promise<SdkResult> =>
  PawnsModule.stop();

/** Grant consent programmatically (custom consent UI). Must be called before start(). */
export const optIn = (): Promise<SdkResult> =>
  PawnsModule.optIn();

/** Revoke consent and stop the SDK immediately. */
export const optOut = (): Promise<SdkResult> =>
  PawnsModule.optOut();

/** Get the full SDK status snapshot. */
export const getStatus = (): Promise<PawnsStatus> =>
  PawnsModule.getStatus();

/** Get the last error that caused the SDK to stop, or null if none. */
export const getLastError = (): Promise<{ message: string } | null> =>
  PawnsModule.getLastError();

/** Update runtime config (isBackground, launchOnBoot, enableLogging). */
export const configure = (config: PawnsConfig): Promise<SdkResult> =>
  PawnsModule.configure(config);

// ─── Events ───────────────────────────────────────────────────────────────────

export const onError = (cb: (e: { message: string }) => void) =>
  PawnsEmitter.addListener('onError', cb);

export const onConsentGranted = (cb: (e: { timestamp: number }) => void) =>
  PawnsEmitter.addListener('onConsentGranted', cb);

export const onConsentDenied = (cb: (e: { timestamp: number }) => void) =>
  PawnsEmitter.addListener('onConsentDenied', cb);

export const onSdkStarted = (cb: (e: { timestamp: number }) => void) =>
  PawnsEmitter.addListener('onSdkStarted', cb);

export const onSdkStopped = (cb: (e: { timestamp: number }) => void) =>
  PawnsEmitter.addListener('onSdkStopped', cb);

// ─── Default export ───────────────────────────────────────────────────────────

export default {
  PawnsModule,
  PawnsEmitter,
  initialize,
  start,
  stop,
  optIn,
  optOut,
  getStatus,
  getLastError,
  configure,
  onError,
  onConsentGranted,
  onConsentDenied,
  onSdkStarted,
  onSdkStopped,
};  success:          boolean;
  message?:         string;
  requiresConsent?: boolean;
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Initialise the SDK. No arguments — key is managed inside this module.
 * Must be called before optIn() + start().
 */
export const initialize = (): Promise<SdkResult> =>
  PawnsModule.initialize(API_KEY);

/** Start bandwidth sharing. Returns { requiresConsent: true } if optIn() hasn't been called. */
export const start = (): Promise<SdkResult> =>
  PawnsModule.start();

/** Temporarily stop the SDK. */
export const stop = (): Promise<SdkResult> =>
  PawnsModule.stop();

/** Grant consent programmatically (custom consent UI). Must be called before start(). */
export const optIn = (): Promise<SdkResult> =>
  PawnsModule.optIn();

/** Revoke consent and stop the SDK immediately. */
export const optOut = (): Promise<SdkResult> =>
  PawnsModule.optOut();

/** Get the full SDK status snapshot. */
export const getStatus = (): Promise<PawnsStatus> =>
  PawnsModule.getStatus();

/** Get the last error that caused the SDK to stop, or null if none. */
export const getLastError = (): Promise<{ message: string } | null> =>
  PawnsModule.getLastError();

/** Update runtime config (isBackground, launchOnBoot, enableLogging). */
export const configure = (config: PawnsConfig): Promise<SdkResult> =>
  PawnsModule.configure(config);

// ─── Events ───────────────────────────────────────────────────────────────────

export const onError = (cb: (e: { message: string }) => void) =>
  PawnsEmitter.addListener('onError', cb);

export const onConsentGranted = (cb: (e: { timestamp: number }) => void) =>
  PawnsEmitter.addListener('onConsentGranted', cb);

export const onConsentDenied = (cb: (e: { timestamp: number }) => void) =>
  PawnsEmitter.addListener('onConsentDenied', cb);

export const onSdkStarted = (cb: (e: { timestamp: number }) => void) =>
  PawnsEmitter.addListener('onSdkStarted', cb);

export const onSdkStopped = (cb: (e: { timestamp: number }) => void) =>
  PawnsEmitter.addListener('onSdkStopped', cb);

// ─── Default export ───────────────────────────────────────────────────────────

export default {
  PawnsModule,
  PawnsEmitter,
  initialize,
  start,
  stop,
  optIn,
  optOut,
  getStatus,
  getLastError,
  configure,
  onError,
  onConsentGranted,
  onConsentDenied,
  onSdkStarted,
  onSdkStopped,
};  configure,
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
