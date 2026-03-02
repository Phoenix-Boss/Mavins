import { TurboModule, TurboModuleRegistry } from 'react-native';

export interface MavinEQMWSpec extends TurboModule {
  setGlobalEQEnabled(enabled: boolean): void;
  setGlobalBandGain(bandIndex: number, gain: number): void;
  setGlobalMasterVolumeDB(db: number): void;
  getLiveSpectrum(): number[];
  saveGlobalPreset(name: string): Promise<boolean>;
  loadGlobalPreset(name: string): Promise<boolean>;
}

export default TurboModuleRegistry.getEnforcing<MavinEQMWSpec>('MavinEQMW');
