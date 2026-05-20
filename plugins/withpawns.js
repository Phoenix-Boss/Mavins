const { withAndroidManifest } = require('@expo/config-plugins');

// ─── Helper Functions ─────────────────────────────────────────────────────────

function addPermission(manifest, permissionName) {
  if (!manifest) {
    manifest = {};
  }
  if (!manifest['uses-permission']) {
    manifest['uses-permission'] = [];
  }

  const exists = manifest['uses-permission'].some(
    (p) => p.$ && p.$['android:name'] === permissionName
  );

  if (!exists) {
    manifest['uses-permission'].push({
      $: {
        'android:name': permissionName,
      },
    });
  }

  return manifest;
}

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

function ensureForegroundService(mainApplication) {
  const serviceName = 'com.pawns.sdk.internal.service.PeerServiceForeground';

  const services = mainApplication['service'] || [];
  const existingService = services.find(
    (s) => s.$ && s.$['android:name'] === serviceName
  );

  // Skip if service already exists (added by honeygain SDK)
  if (existingService) {
    console.log('[withPawns] Foreground service already exists, skipping to avoid manifest conflict...');
    return;
  }

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

function ensureBackgroundService(mainApplication) {
  const serviceName = 'com.pawns.sdk.internal.service.PeerServiceBackground';

  const services = mainApplication['service'] || [];
  const existingService = services.find(
    (s) => s.$ && s.$['android:name'] === serviceName
  );

  // Skip if service already exists
  if (existingService) {
    console.log('[withPawns] Background service already exists, skipping...');
    return;
  }

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

// ─── Meta-data ────────────────────────────────────────────────────────────────

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
  } else {
    console.log('[withPawns] Channel meta-data already exists, skipping...');
  }
}

// ─── Boot receiver ────────────────────────────────────────────────────────────

function ensureBootReceiver(mainApplication) {
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
  } else {
    console.log('[withPawns] Boot receiver already exists, skipping...');
  }
}

// ─── Plugin entry point ───────────────────────────────────────────────────────

function withPawns(config, options = {}) {
  const channelName = options.notificationChannelName ?? 'Bandwidth Sharing';

  console.log('[withPawns] Applying Pawns SDK configuration with channel name:', channelName);

  return withAndroidManifest(config, (cfg) => {
    console.log('[withPawns] Modifying AndroidManifest.xml...');
    
    const androidManifest = cfg.modResults;
    
    if (!androidManifest.manifest) {
      androidManifest.manifest = {};
    }
    
    console.log('[withPawns] Adding permissions...');
    for (const permission of REQUIRED_PERMISSIONS) {
      ensurePermission(androidManifest.manifest, permission);
      console.log('[withPawns]   - Added:', permission);
    }
    
    const mainApp = getMainApplicationOrThrow(androidManifest);
    
    console.log('[withPawns] Checking foreground service...');
    ensureForegroundService(mainApp);
    
    console.log('[withPawns] Checking background service...');
    ensureBackgroundService(mainApp);
    
    console.log('[withPawns] Checking notification channel meta-data...');
    ensureChannelMetaData(mainApp, channelName);
    
    console.log('[withPawns] Checking boot receiver...');
    ensureBootReceiver(mainApp);
    
    console.log('[withPawns] AndroidManifest.xml modification complete.');
    
    return cfg;
  });
}

module.exports = withPawns;