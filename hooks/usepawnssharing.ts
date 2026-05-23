/**
 * usePawnsSharing.ts
 *
 * React hook that encapsulates all Pawns SDK interaction for use across your app.
 *
 * Provides:
 *   - status       — latest pawnsStatus snapshot (auto-refreshed on SDK events)
 *   - isReady      — true after initialize() has succeeded
 *   - isLoading    — true while any async operation is in progress
 *   - error        — last error message (from SDK events or caught exceptions)
 *   - initialize   — must be called once (e.g. in App.tsx useEffect)
 *   - start        — start bandwidth sharing (requires consent first)
 *   - stop         — stop bandwidth sharing
 *   - optIn        — grant consent programmatically
 *   - optOut       — revoke consent and stop sharing
 *   - refreshStatus — manually refresh the status snapshot
 *
 * Usage:
 *   const sharing = usePawnsSharing();
 *
 *   // In App.tsx (once):
 *   useEffect(() => { sharing.initialize(); }, []);
 *
 *   // In your consent gate:
 *   await sharing.optIn();
 *   await sharing.start();
 *
 *   // In settings:
 *   await sharing.optOut();
 *
 *   // Anywhere:
 *   if (sharing.status?.isRunning) { ... }
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import pawns, {
  pawnsStatus,
  SdkResult,
  NotificationOptions,
  onSdkStarted,
  onSdkStopped,
  onError as onSdkError,
  onConsentGranted,
  onConsentDenied,
} from './index';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PawnsSharingHook {
  status:        pawnsStatus | null;
  isReady:       boolean;
  isLoading:     boolean;
  error:         string | null;
  initialize:    (options?: NotificationOptions) => Promise<void>;
  start:         (options?: NotificationOptions) => Promise<SdkResult | null>;
  stop:          () => Promise<SdkResult | null>;
  optIn:         () => Promise<SdkResult | null>;
  optOut:        () => Promise<SdkResult | null>;
  refreshStatus: () => Promise<void>;
  clearError:    () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePawnsSharing(): PawnsSharingHook {
  const [status,    setStatus]    = useState<pawnsStatus | null>(null);
  const [isReady,   setIsReady]   = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // ── Status refresh ──────────────────────────────────────────────────────

  const refreshStatus = useCallback(async () => {
    try {
      const s = await pawns.getStatus();
      if (isMounted.current) setStatus(s);
    } catch (err: any) {
      if (isMounted.current) setError(err?.message ?? 'Failed to get status');
    }
  }, []);

  // ── SDK event listeners ─────────────────────────────────────────────────

  useEffect(() => {
    const subs = [
      onSdkStarted(()           => { if (isMounted.current) refreshStatus(); }),
      onSdkStopped(()           => { if (isMounted.current) refreshStatus(); }),
      onSdkError((e)            => { if (isMounted.current) { setError(e.message); refreshStatus(); } }),
      onConsentGranted(()       => { if (isMounted.current) refreshStatus(); }),
      onConsentDenied(()        => { if (isMounted.current) refreshStatus(); }),
    ];
    return () => { subs.forEach(s => s.remove()); };
  }, [refreshStatus]);

  // ── initialize ──────────────────────────────────────────────────────────

  const initialize = useCallback(async (options?: NotificationOptions) => {
    if (isReady) return; // already initialised — idempotent

    setIsLoading(true);
    setError(null);
    try {
      await pawns.initialize(options);
      await refreshStatus();
      if (isMounted.current) setIsReady(true);
    } catch (err: any) {
      if (isMounted.current) setError(err?.message ?? 'Initialization failed');
    } finally {
      if (isMounted.current) setIsLoading(false);
    }
  }, [isReady, refreshStatus]);

  // ── start ───────────────────────────────────────────────────────────────

  const start = useCallback(async (options?: NotificationOptions): Promise<SdkResult | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await pawns.start(options);
      await refreshStatus();
      return result;
    } catch (err: any) {
      if (isMounted.current) setError(err?.message ?? 'Failed to start');
      return null;
    } finally {
      if (isMounted.current) setIsLoading(false);
    }
  }, [refreshStatus]);

  // ── stop ────────────────────────────────────────────────────────────────

  const stop = useCallback(async (): Promise<SdkResult | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await pawns.stop();
      await refreshStatus();
      return result;
    } catch (err: any) {
      if (isMounted.current) setError(err?.message ?? 'Failed to stop');
      return null;
    } finally {
      if (isMounted.current) setIsLoading(false);
    }
  }, [refreshStatus]);

  // ── optIn ───────────────────────────────────────────────────────────────

  const optIn = useCallback(async (): Promise<SdkResult | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await pawns.optIn();
      await refreshStatus();
      return result;
    } catch (err: any) {
      if (isMounted.current) setError(err?.message ?? 'Failed to opt in');
      return null;
    } finally {
      if (isMounted.current) setIsLoading(false);
    }
  }, [refreshStatus]);

  // ── optOut ──────────────────────────────────────────────────────────────

  const optOut = useCallback(async (): Promise<SdkResult | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await pawns.optOut();
      await refreshStatus();
      return result;
    } catch (err: any) {
      if (isMounted.current) setError(err?.message ?? 'Failed to opt out');
      return null;
    } finally {
      if (isMounted.current) setIsLoading(false);
    }
  }, [refreshStatus]);

  // ── clearError ──────────────────────────────────────────────────────────

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    status,
    isReady,
    isLoading,
    error,
    initialize,
    start,
    stop,
    optIn,
    optOut,
    refreshStatus,
    clearError,
  };
}

export default usePawnsSharing;