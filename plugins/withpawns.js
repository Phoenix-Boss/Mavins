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
 */

const { withAndroidManifest } = require('@expo/config-plugins');

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Idempotently adds a permission to the manifest.
 * Checks for existence before inserting to avoid duplicates.
 * 
 * @param {Object} manifest - AndroidManifest object
 * @param {string} permissionName - Full permission name (e.g., 'android.permission.INTERNET')
 * @returns {Object} - Updated manifest
 */
function addPermission(manifest, permissionName) {
  // Ensure manifest structure exists
  if (!manifest) {
    manifest = {};
  }
  if (!manifest['uses-permission']) {
    manifest['uses-permission'] = [];
  }

  // Check if permission already exists
  const exists = manifest['uses-permission'].some(
    (p) => p.$ && p.$['android:name'] === permissionName
  );

  // Add if not exists
  if (!exists) {
    manifest['uses-permission'].push({
      $: {
        'android:name': permissionName,
      },
    });
  }

  return manifest;
}

/**
 * Gets the main <application> element or throws an error.
 * 
 * @param {Object} androidManifest - The parsed AndroidManifest object
 * @returns {Object} - The main application element
 * @throws {Error} - If application element is not found
 */
function getMainApplicationOrThrow(androidManifest) {
  if (!androidManifest.manifest) {
    androidManifest.manifest = {};
  }
  if (!androidManifest.manifest.application) {
    androidManifest.manifest.application = [{}];
  }
  if (!androidManifest.manifest.application[0]) {
    androidManifest.manifest.application[0] = {};
  }
  
  return androidManifest.manifest.application[0];
}

/**
 * Ensures a permission exists in the manifest.
 * 
 * @param {Object} manifest - AndroidManifest object
 * @param {string} permission - Permission name
 */
function ensurePermission(manifest, permission) {
  const permissions = manifest['uses-permission'] || [];
  const exists = permissions.some(
    (p) => p.$ && p.$['android:name'] === permission
  );
  if (!exists) {
    addPermission(manifest, permission);
  }
}

// ─── Permissions ──────────────────────────────────────────────────────────────

const REQUIRED_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
];

// ─── Services ─────────────────────────────────────────────────────────────────

/**
 * Idempotently inserts the PeerServiceForeground <service> element.
 * 
 * @param {Object} mainApplication - The main application element
 */
function ensureForegroundService(mainApplication) {
  const serviceName = 'com.pawns.sdk.internal.service.PeerServiceForeground';

  const services = mainApplication['service'] || [];
  const exists = services.some(
    (s) => s.$ && s.$['android:name'] === serviceName
  );

  if (!exists) {
    if (!mainApplication['service']) {
      mainApplication['service'] = [];
    }
    
    mainApplication['service'].push({
      $: {
        'android:name': serviceName,
        'android:exported': 'false',
        'android:foregroundServiceType': 'specialUse',
      },
      property: [
        {
          $: {
            'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
            'android:value': "Allows to share internet traffic by modifying device's " +
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
 * 
 * @param {Object} mainApplication - The main application element
 */
function ensureBackgroundService(mainApplication) {
  const serviceName = 'com.pawns.sdk.internal.service.PeerServiceBackground';

  const services = mainApplication['service'] || [];
  const exists = services.some(
    (s) => s.$ && s.$['android:name'] === serviceName
  );

  if (!exists) {
    if (!mainApplication['service']) {
      mainApplication['service'] = [];
    }
    
    mainApplication['service'].push({
      $: {
        'android:name': serviceName,
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
 * 
 * @param {Object} mainApplication - The main application element
 * @param {string} channelName - Notification channel name
 */
function ensureChannelMetaData(mainApplication, channelName) {
  const metaDataName = 'com.pawns.sdk.pawns_service_channel_name';
  const metaDatas = mainApplication['meta-data'] || [];
  const exists = metaDatas.some(
    (m) => m.$ && m.$['android:name'] === metaDataName
  );

  if (!exists) {
    if (!mainApplication['meta-data']) {
      mainApplication['meta-data'] = [];
    }
    
    mainApplication['meta-data'].push({
      $: {
        'android:name': metaDataName,
        'android:value': channelName,
      },
    });
  }
}

// ─── Boot receiver ────────────────────────────────────────────────────────────

/**
 * Idempotently inserts the PawnsBootReceiver <receiver> element.
 * 
 * @param {Object} mainApplication - The main application element
 */
function ensureBootReceiver(mainApplication) {
  // Use relative name so it resolves to the host app's package
  const receiverName = '.PawnsBootReceiver';

  const receivers = mainApplication['receiver'] || [];
  const exists = receivers.some(
    (r) => r.$ && r.$['android:name'] === receiverName
  );

  if (!exists) {
    if (!mainApplication['receiver']) {
      mainApplication['receiver'] = [];
    }
    
    mainApplication['receiver'].push({
      $: {
        'android:name': receiverName,
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
 * Expo config plugin for Pawns SDK integration.
 * 
 * @param {import('@expo/config-plugins').ExpoConfig} config - Expo config object
 * @param {{ notificationChannelName?: string }} options - Plugin options
 * @returns {import('@expo/config-plugins').ExpoConfig} - Modified config
 */
function withPawns(config, options = {}) {
  const channelName = options.notificationChannelName ?? 'Bandwidth Sharing';

  console.log('[withPawns] Applying Pawns SDK configuration with channel name:', channelName);

  return withAndroidManifest(config, (cfg) => {
    console.log('[withPawns] Modifying AndroidManifest.xml...');
    
    // Get the manifest object
    const androidManifest = cfg.modResults;
    
    // Ensure manifest structure exists
    if (!androidManifest.manifest) {
      androidManifest.manifest = {};
    }
    
    // 1. Add all required permissions
    console.log('[withPawns] Adding permissions...');
    for (const permission of REQUIRED_PERMISSIONS) {
      ensurePermission(androidManifest.manifest, permission);
      console.log('[withPawns]   - Added:', permission);
    }
    
    // 2. Get the main application element
    const mainApp = getMainApplicationOrThrow(androidManifest);
    
    // 3. Add foreground service
    console.log('[withPawns] Adding foreground service...');
    ensureForegroundService(mainApp);
    
    // 4. Add background service
    console.log('[withPawns] Adding background service...');
    ensureBackgroundService(mainApp);
    
    // 5. Add channel meta-data
    console.log('[withPawns] Adding notification channel meta-data...');
    ensureChannelMetaData(mainApp, channelName);
    
    // 6. Add boot receiver
    console.log('[withPawns] Adding boot receiver...');
    ensureBootReceiver(mainApp);
    
    console.log('[withPawns] AndroidManifest.xml modification complete.');
    
    return cfg;
  });
}

module.exports = withPawns;