import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  startBandwidthSession(durationSeconds: number): Promise<boolean>;
  downloadPresetWithBandwidth(presetUrl: string, bandwidthGB: number): Promise<boolean>;
  getEarnings(): Promise<{
    isRunning: boolean;
    isOptedIn: boolean;
    lastError?: string;
  }>;
  stopSession(): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Honeygain');
