# expo-autoeq-engine

31-band graphic EQ + parametric biquad layer for Expo apps, powered by Android's `DynamicsProcessing`. Pro-gated with per-minute Supabase tokens.

---

## Requirements

- Expo SDK 50+
- EAS Build / Dev Client (does **not** work in Expo Go — native module required)
- Android API 28+ (DynamicsProcessing minimum)
- Supabase project with the schema from `schema.sql`

---

## Installation

### 1. Add the module to your app

This is a **local module** — drop it inside your repo's `modules/` folder:

```
your-app/
└── modules/
    └── expo-autoeq-engine/   ← this folder
```

In your app's `package.json`:

```json
{
  "dependencies": {
    "expo-autoeq-engine": "./modules/expo-autoeq-engine"
  }
}
```

### 2. Add the config plugin to `app.json`

```json
{
  "expo": {
    "plugins": [
      "./modules/expo-autoeq-engine"
    ]
  }
}
```

### 3. Run the Supabase schema

Open `schema.sql` and run it in your Supabase SQL editor. This creates:
- `profiles` table (Pro status + EQ minutes)
- `eq_usage` table (audit log)
- `eq_presets` table (user presets)
- `deduct_eq_minutes` and `add_eq_minutes` RPC functions
- Row Level Security policies

### 4. Build with EAS

```bash
eas build --profile development --platform android
```

---

## Quick start

```ts
import MyEQ, {
  applyPreset,
  applyEqPreset,
  BUILT_IN_PRESETS,
  claimEqMinutesForPlayback,
} from "expo-autoeq-engine";
import { supabase } from "@/lib/supabase";

// On track start — gate with Pro check + minute deduction
const audioSessionId = await TrackPlayer.getAudioSessionId();
const ok = await claimEqMinutesForPlayback(
  supabase,
  audioSessionId,
  track.duration,
  async (needed, remaining) => {
    // Show your purchase UI here, return true if user completed top-up
    return await showTopUpSheet(needed, remaining);
  }
);

if (ok) {
  // Apply the Harman preset
  await applyPreset(BUILT_IN_PRESETS.harman.gains_31);
}

// On track end or player destroy — always release
await MyEQ.release();
```

---

## Using the React hook

```tsx
import { useEqualizer } from "expo-autoeq-engine/src/useEqualizer";
import { supabase } from "@/lib/supabase";

export function EqualizerScreen({ audioSessionId, trackDuration }) {
  const eq = useEqualizer({
    supabase,
    audioSessionId,
    trackDuration,
    onNeedTopUp: async (needed, remaining) => {
      return await showTopUpSheet(needed, remaining);
    },
  });

  return (
    <View>
      {/* Toggle */}
      <Switch value={eq.isEnabled} onValueChange={eq.toggle} />

      {/* 31 band sliders */}
      {eq.gains.map((gain, i) => (
        <Slider
          key={i}
          value={gain}
          minimumValue={-12}
          maximumValue={12}
          onValueChange={(v) => eq.setBand(i, v)}
        />
      ))}

      {/* Preset list */}
      {eq.presets.map((preset) => (
        <TouchableOpacity key={preset.id} onPress={() => eq.applyPreset(preset)}>
          <Text>{preset.name}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
```

---

## Native API

| Method | Description |
|--------|-------------|
| `setupEQ(audioSessionId)` | Attach DynamicsProcessing to the player's audio session |
| `setBand(index, gainDb)` | Adjust a single band (0–30), gain -12..+12 dB |
| `applyBands(gains[])` | Batch-apply all 31 bands in one bridge call |
| `setBiquadParam(type, bandIndex, fc, gainDb)` | Apply parametric biquad filter |
| `getGains()` | Get current gain values for all 31 bands |
| `setEnabled(boolean)` | Toggle EQ on/off without releasing |
| `release()` | **Always call on track change or player destroy** |

---

## Pricing model

| Plan | Price | EQ minutes |
|------|-------|------------|
| Normal Pro | $20/month | 1,000 minutes |
| Weekend Pro | $10/weekend | 300 minutes |
| Top-up 50 min | $5 | +50 minutes |
| Top-up 100 min | $9 | +100 minutes |
| Top-up 200 min | $15 | +200 minutes |

---

## File structure

```
expo-autoeq-engine/
├── expo-module.config.json         # Expo auto-discovery
├── package.json
├── schema.sql                      # Supabase schema + RLS + RPCs
├── plugin/
│   └── withAutoEQPlugin.ts         # Expo config plugin
├── src/
│   ├── index.ts                    # Public API + native binding
│   ├── types.ts                    # TypeScript types
│   ├── presets.ts                  # Built-in 31-band presets
│   ├── supabase-helpers.ts         # Pro gate + preset CRUD
│   └── useEqualizer.ts             # React hook
└── android/
    └── src/main/kotlin/expo/modules/autoeqengine/
        ├── AutoEQModule.kt         # Native DynamicsProcessing module
        └── AutoEQPackage.kt        # Expo module registration
```
