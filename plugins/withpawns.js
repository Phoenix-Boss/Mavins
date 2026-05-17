/**
 * withPawns.js
 *
 * Expo config plugin that injects all AndroidManifest.xml entries required
 * by the Pawns SDK into the host app's manifest at build time.
 *
 * ─── Usage in app.config.js / app.config.ts ──────────────────────────────────
 *
 *   import withPawns from './modules/honeygain/withPawns';
 *
 *   export default ({ config }) => withPawns(config, {
 *     notificationChannelName: 'Bandwidth Sharing',  // optional
 *   });
 *
 *   // Or in app.config.js:
 *   module.exports = {
 *     plugins: [
 *       ['./modules/honeygain/withPawns', {
 *         notificationChannelName: 'Bandwidth Sharing',
 *       }],
 *     ],
 *   };
 *
 * ─── What this plugin injects ─────────────────────────────────────────────────
 *
 *  Permissions (uses-permission):
 *    INTERNET, ACCESS_NETWORK_STATE, FOREGROUND_SERVICE,
 *    FOREGROUND_SERVICE_SPECIAL_USE, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
 *    RECEIVE_BOOT_COMPLETED
 *
 *  Inside <application>:
 *    <service> PeerServiceForeground  (foregroundServiceType="specialUse")
 *    <service> PeerServiceBackground  (optional, for future use)
 *    <meta-data> pawns_service_channel_name
 *    <receiver> PawnsBootReceiver     (BOOT_COMPLETED)
 *
 * ─── Dependencies ─────────────────────────────────────────────────────────────
 *   @expo/config-plugins  (installed as part of expo)
 *   xml2js                (installed as part of @expo/config-plugins transitive deps)
 */

const {
  withAndroidManifest,
  AndroidConfig,
} = require('@expo/config-plugins');

const {
  addPermission,
  getMainApplicationOrThrow,
} = AndroidConfig.Manifest;

// ─── Permissions ──────────────────────────────────────────────────────────────

const REQUIRED_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
];

/**
 * Idempotently adds a permission to the manifest.
 * Checks for existence before inserting to avoid duplicates.
 */
function ensurePermission(manifest, name) {
  const permissions = manifest['uses-permission'] || [];
  const exists = permissions.some(
    (p) => p.$?.['android:name'] === name
  );
  if (!exists) {
    addPermission(manifest, name);
  }
}

// ─── Services ─────────────────────────────────────────────────────────────────

/**
 * Idempotently inserts the PeerServiceForeground <service> element.
 */
function ensureForegroundService(mainApplication) {
  const serviceName = 'com.pawns.sdk.internal.service.PeerServiceForeground';

  const services = mainApplication['service'] || [];
  const exists = services.some(
    (s) => s.$?.['android:name'] === serviceName
  );

  if (!exists) {
    mainApplication['service'] = mainApplication['service'] || [];
    mainApplication['service'].push({
      $: {
        'android:name':                serviceName,
        'android:exported':            'false',
        'android:foregroundServiceType': 'specialUse',
      },
      property: [
        {
          $: {
            'android:name':
              'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
            'android:value':
              "Allows to share internet traffic by modifying device's " +
              'network settings to be used as a gateway for internet traffic.',
          },
        },
      ],
    });
  }
}

/**
 * Idempotently inserts the PeerServiceBackground <service> element.
 * Only needed if you ever switch to ServiceType.BACKGROUND — included here
 * for completeness and to avoid a manifest crash if the SDK references it.
 */
function ensureBackgroundService(mainApplication) {
  const serviceName = 'com.pawns.sdk.internal.service.PeerServiceBackground';

  const services = mainApplication['service'] || [];
  const exists = services.some(
    (s) => s.$?.['android:name'] === serviceName
  );

  if (!exists) {
    mainApplication['service'] = mainApplication['service'] || [];
    mainApplication['service'].push({
      $: {
        'android:name':     serviceName,
        'android:exported': 'false',
      },
    });
  }
}

// ─── Meta-data ────────────────────────────────────────────────────────────────

/**
 * Idempotently inserts the notification channel name meta-data entry.
 * The value is a literal string (not a @string/ reference) so that no
 * strings.xml changes are required.
 */
function ensureChannelMetaData(mainApplication, channelName) {
  const metaDataName = 'com.pawns.sdk.pawns_service_channel_name';
  const metaDatas    = mainApplication['meta-data'] || [];
  const exists       = metaDatas.some(
    (m) => m.$?.['android:name'] === metaDataName
  );

  if (!exists) {
    mainApplication['meta-data'] = mainApplication['meta-data'] || [];
    mainApplication['meta-data'].push({
      $: {
        'android:name':  metaDataName,
        'android:value': channelName,
      },
    });
  }
}

// ─── Boot receiver ────────────────────────────────────────────────────────────

/**
 * Idempotently inserts the PawnsBootReceiver <receiver> element.
 */
function ensureBootReceiver(mainApplication) {
  // Use the module's package so it resolves correctly regardless of the host
  // app's package name. The host app may also use a relative name like
  // ".PawnsBootReceiver" only if the receiver is in the same package as the
  // application — safest to use the fully-qualified name here.
  const receiverName = 'expo.modules.mavin.honeygain.PawnsBootReceiver';

  const receivers = mainApplication['receiver'] || [];
  const exists    = receivers.some(
    (r) => r.$?.['android:name'] === receiverName
  );

  if (!exists) {
    mainApplication['receiver'] = mainApplication['receiver'] || [];
    mainApplication['receiver'].push({
      $: {
        'android:name':     receiverName,
        'android:exported': 'false',
      },
      'intent-filter': [
        {
          action: [
            {
              $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' },
            },
          ],
        },
      ],
    });
  }
}

// ─── Plugin entry point ───────────────────────────────────────────────────────

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @param {{ notificationChannelName?: string }} options
 */
function withPawns(config, options = {}) {
  const channelName = options.notificationChannelName ?? 'Bandwidth Sharing';

  return withAndroidManifest(config, (cfg) => {
    const manifest      = cfg.modResults.manifest;
    const mainApp       = getMainApplicationOrThrow(cfg.modResults);

    // 1. Permissions
    for (const permission of REQUIRED_PERMISSIONS) {
      ensurePermission(manifest, permission);
    }

    // 2. Services
    ensureForegroundService(mainApp);
    ensureBackgroundService(mainApp);

    // 3. Meta-data
    ensureChannelMetaData(mainApp, channelName);

    // 4. Boot receiver
    ensureBootReceiver(mainApp);

    return cfg;
  });
}

module.exports = withPawns;