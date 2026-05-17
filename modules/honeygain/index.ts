// modules/honeygain/index.ts
// JS/TS entry point for the Pawns SDK Expo module.
//
// Imported via package.json alias: "honeygain-sdk": "file:./modules/honeygain"
// Native side registered as Name("Honeygain") in HoneygainModule.kt.
//
// ─── KEY OWNERSHIP ────────────────────────────────────────────────────────────
// API_KEY lives here and ONLY here in JS-land.
// No caller (ConsentGate, screens, hooks) ever sees or passes the key.
// initialize() is intentionally no-arg for external callers — the module injects
// the key itself.
//
// To keep the key out of source control, replace the inline string with:
//   import { PAWNS_API_KEY } from '../secrets'; // secrets.ts is gitignored
// ─────────────────────────────────────────────────────────────────────────────

import { requireNativeModule, EventEmitter } from 'expo-modules-core';

const API_KEY = '2125ae20cfd8855abc0bee8cc9c997c4';

// ─── Default notification configuration ──────────────────────────────────────
// Adjust these to match your drawable resource name and preferred copy.
const DEFAULT_NOTIFICATION_OPTIONS: NotificationOptions = {
  notificationTitle: 'Mavin is running',
  notificationBody:  'Sharing bandwidth to earn rewards',
  notificationIcon:  'ic_stat_mavin',   // must exist in android/app/src/main/res/drawable
  notificationId:    9901,
};

// ─── Event map ────────────────────────────────────────────────────────────────
interface HoneygainEvents {
  [key: string]:      (...args: any[]) => void; // satisfies EventsMap constraint
  onError:            (e: { message: string })   => void;
  onConsentGranted:   (e: { timestamp: number }) => void;
  onConsentDenied:    (e: { timestamp: number }) => void;
  onSdkStarted:       (e: { timestamp: number }) => void;
  onSdkStopped:       (e: { timestamp: number }) => void;
}

// ─── Native module ────────────────────────────────────────────────────────────
export const HoneygainModule  = requireNativeModule('Honeygain');
export const HoneygainEmitter = new EventEmitter<HoneygainEvents>(HoneygainModule);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NotificationOptions {
  notificationTitle?: string;
  notificationBody?:  string;
  /** Drawable resource name without file extension, e.g. "ic_stat_mavin" */
  notificationIcon?:  string;
  /** Stable integer ID — keep the same value across calls */
  notificationId?:    number;
}

/**
 * Full SDK status snapshot returned by getStatus().
 *
 * Primary fields (Pawns SDK):
 *   isRunning      — true if the service is actively RUNNING
 *   isConsentGiven — true if the user has given consent
 *   serviceState   — raw state string: "IDLE"|"STARTING"|"RUNNING"|"STOPPING"|"STOPPED"|"ERROR"
 *   initialized    — true after initialize() has been called successfully
 *   notification   — current notification config
 *
 * Legacy-compatible aliases (mapped from Honeygain interface):
 *   isOptedIn      — alias of isConsentGiven
 *   isBackground   — always false (module uses FOREGROUND service only)
 *   launchOnBoot   — true if consent is given (boot receiver auto-restarts)
 *   enableLogging  — always false (use Android logcat)
 *   lastError      — last stored error string or null
 */
export interface HoneygainStatus {
  // Primary
  isRunning:      boolean;
  isConsentGiven: boolean;
  serviceState:   'IDLE' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'ERROR';
  initialized:    boolean;
  notification:   {
    title: string;
    body:  string;
    icon:  string;
    id:    number;
  };
  // Legacy aliases
  isOptedIn:     boolean;
  isBackground:  boolean;
  launchOnBoot:  boolean;
  enableLogging: boolean;
  lastError:     string | null;
}

export interface SdkResult {
  success:         boolean;
  message?:        string;
  requiresConsent?: boolean;
}

export interface ConsentResult {
  success:        boolean;
  consentGranted: boolean;
}

export interface BatteryResult {
  success:      boolean;
  alreadyExempt: boolean;
}

export interface ConsentLogEntry {
  type:      'opt_in' | 'opt_out' | 'consent_granted' | 'consent_denied';
  timestamp: number;
  source:    'programmatic' | 'sdk_ui';
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Initialise the SDK.
 *
 * No arguments required for external callers — the API key and default
 * notification options are managed inside this module.
 *
 * Pass overrides to customize the foreground-service notification appearance.
 * Must be called before optIn() + start().
 */
export const initialize = (options?: NotificationOptions): Promise<SdkResult> =>
  HoneygainModule.initialize(
    API_KEY,
    { ...DEFAULT_NOTIFICATION_OPTIONS, ...options }
  );

/**
 * Start bandwidth sharing.
 *
 * Returns { requiresConsent: true } if optIn() has not been called yet.
 * Accepts optional notification overrides that persist across reboots.
 */
export const start = (options?: NotificationOptions): Promise<SdkResult> =>
  HoneygainModule.start(options ?? null);

/**
 * Stop bandwidth sharing.
 * If launchOnBoot / consent remain set, sharing will restart on next reboot.
 * To permanently stop and revoke consent, use optOut().
 */
export const stop = (): Promise<SdkResult> =>
  HoneygainModule.stop();

/**
 * Grant consent programmatically (custom consent UI path).
 *
 * Call this after your custom consent modal is accepted.
 * Must be called before start() — start() will otherwise return
 * { requiresConsent: true }.
 */
export const optIn = (): Promise<SdkResult> =>
  HoneygainModule.optIn();

/**
 * Revoke consent and stop the SDK immediately.
 *
 * Call this from the settings page "Disable & Withdraw Consent" button.
 * After optOut(), the boot receiver will not restart sharing on next reboot.
 * The user must grant consent again (via the consent modal) to re-enable.
 */
export const optOut = (): Promise<SdkResult> =>
  HoneygainModule.optOut();

/**
 * Launch the SDK-provided consent Activity (native UI path).
 *
 * Resolves with { consentGranted: true/false } once the activity returns.
 * The SDK internally calls setConsentGiven(true) when the user accepts.
 * Do NOT call optIn() after this — it is handled internally.
 *
 * Prefer using your custom EarningsConsentGate component + optIn() instead.
 * This function is provided for completeness / fallback.
 */
export const requestConsent = (): Promise<ConsentResult> =>
  HoneygainModule.requestConsent();

/**
 * Get the full SDK status snapshot.
 *
 * Includes both primary Pawns fields and legacy Honeygain-compatible aliases.
 */
export const getStatus = (): Promise<HoneygainStatus> =>
  HoneygainModule.getStatus();

/**
 * Get the last error that caused the SDK to stop, or null if none.
 */
export const getLastError = (): Promise<{ message: string } | null> =>
  HoneygainModule.getLastError();

/**
 * Open the system battery-optimisation exemption dialog.
 *
 * Returns { alreadyExempt: true } if the app is already exempt.
 * On Android < 6.0 (M) this is a no-op (always exempt).
 */
export const requestBatteryOptimisation = (): Promise<BatteryResult> =>
  HoneygainModule.requestBatteryOptimisation();

/**
 * Retrieve the full 24-month consent event log.
 *
 * For compliance and internal audit use only.
 * Each entry: { type, timestamp (epoch ms), source }
 */
export const getConsentLog = (): Promise<ConsentLogEntry[]> =>
  HoneygainModule.getConsentLog();

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

// ─── Backward-compatible stubs ────────────────────────────────────────────────

/** @deprecated Use stop() instead */
export const stopSharing = (): Promise<SdkResult> => {
  console.warn('[Honeygain] stopSharing() is deprecated → use stop()');
  return stop();
};

/** @deprecated Use getStatus() instead */
export const getEarnings = (): Promise<HoneygainStatus> => {
  console.warn('[Honeygain] getEarnings() is deprecated → use getStatus()');
  return getStatus();
};

/** @deprecated Use initialize() + start() instead */
export const startBandwidthSession = async (_durationSeconds: number): Promise<boolean> => {
  console.warn('[Honeygain] startBandwidthSession() is deprecated → use initialize() + start()');
  return getStatus().then(s => s.isRunning);
};

/** @deprecated Use stop() instead */
export const stopSession = (): Promise<SdkResult> => {
  console.warn('[Honeygain] stopSession() is deprecated → use stop()');
  return stop();
};

/** @deprecated Use optIn() instead */
export const configure = (_config: Record<string, unknown>): Promise<SdkResult> => {
  console.warn('[Honeygain] configure() is deprecated → use optIn() / optOut() / start() options');
  return Promise.resolve({ success: true, message: 'configure() is a no-op in Pawns SDK integration' });
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
  requestConsent,
  getStatus,
  getLastError,
  requestBatteryOptimisation,
  getConsentLog,
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
  configure,
};