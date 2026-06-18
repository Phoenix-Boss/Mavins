import { requireNativeModule, EventEmitter } from 'expo-modules-core';

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZGsiOnRydWUsImV4cCI6MjA4NzQ1MTMwNywianRpIjoiMDFLSkNEWVhYRFNZMTNTRUNDNkZFSlpERjEiLCJpYXQiOjE3NzIwOTEzMDcsInN1YiI6IjAxS0hCOFJaTk41SzIzVjU0VFdXMjZQS1I3In0.aOLBU8O1n_wHDne6VUOijQLHZuM5-EYTj05Sh9TgmQ0';

interface PawnsEvents {
  [key: string]:    (...args: any[]) => void;
  onError:          (e: { message: string })   => void;
  onConsentGranted: (e: { timestamp: number }) => void;
  onConsentDenied:  (e: { timestamp: number }) => void;
  onSdkStarted:     (e: { timestamp: number }) => void;
  onSdkStopped:     (e: { timestamp: number }) => void;
}

export const PawnsModule  = requireNativeModule('PawnsModule');
export const PawnsEmitter = new EventEmitter<PawnsEvents>(PawnsModule);

export interface PawnsStatus {
  isRunning: boolean;
  isConsentGiven: boolean;
  serviceState: string;
  initialized: boolean;
  lastError?: string | null;
}

export interface SdkResult {
  success: boolean;
  message?: string;
}

export const initialize = (): Promise<SdkResult> => PawnsModule.initialize(API_KEY);
export const start = (): Promise<SdkResult> => PawnsModule.start();
export const stop = (): Promise<SdkResult> => PawnsModule.stop();
export const optIn = (): Promise<SdkResult> => PawnsModule.optIn();
export const optOut = (): Promise<SdkResult> => PawnsModule.optOut();
export const getStatus = (): Promise<PawnsStatus> => PawnsModule.getStatus();
export const getLastError = (): Promise<string | null> => PawnsModule.getLastError();
export const configure = (config: any): Promise<SdkResult> => PawnsModule.configure(config);

export const onError = (callback: (event: { message: string }) => void) => 
  PawnsEmitter.addListener('onError', callback);

export const onConsentGranted = (callback: (event: { timestamp: number }) => void) => 
  PawnsEmitter.addListener('onConsentGranted', callback);

export const onConsentDenied = (callback: (event: { timestamp: number }) => void) => 
  PawnsEmitter.addListener('onConsentDenied', callback);

export const onSdkStarted = (callback: (event: { timestamp: number }) => void) => 
  PawnsEmitter.addListener('onSdkStarted', callback);

export const onSdkStopped = (callback: (event: { timestamp: number }) => void) => 
  PawnsEmitter.addListener('onSdkStopped', callback);

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
};