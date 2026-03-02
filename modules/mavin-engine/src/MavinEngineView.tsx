import { requireNativeView } from 'expo';
import * as React from 'react';

import { MavinEngineViewProps } from './MavinEngine.types';

const NativeView: React.ComponentType<MavinEngineViewProps> =
  requireNativeView('MavinEngine');

export default function MavinEngineView(props: MavinEngineViewProps) {
  return <NativeView {...props} />;
}
