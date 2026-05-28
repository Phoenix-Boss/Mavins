/**
 * UpdateModal.tsx
 *
 * Checks for new releases on GitHub (Phoenix-Boss/Mavins) and prompts
 * the user to update if a newer version is found.
 *
 * Uses AlertContext + triggerHaptic — no hardcoded Colors or custom Modal UI.
 */

import React, { useEffect } from 'react';
import { Linking } from 'react-native';
import * as Application from 'expo-application';

import { useAlert } from '@/contexts/AlertContext';
import { triggerHaptic } from '@/helpers/haptics';

// ─────────────────────────────────────────────────────────────────────────────
// Module-level cache — survives hot-reloads and re-mounts
// ─────────────────────────────────────────────────────────────────────────────
let _cachedTag: string | null = null;
let _cachedDownloadUrl: string | null = null;
let _alreadyChecked = false;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function compareVersions(v1: string, v2: string): number {
  const normalize = (v: string) => (v.startsWith('v') ? v.slice(1) : v);
  const [maj1, min1, pat1] = normalize(v1).split('.').map(Number);
  const [maj2, min2, pat2] = normalize(v2).split('.').map(Number);
  if (maj1 !== maj2) return maj1 > maj2 ? 1 : -1;
  if (min1 !== min2) return min1 > min2 ? 1 : -1;
  if (pat1 !== pat2) return pat1 > pat2 ? 1 : -1;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export const UpdateModal = () => {
  const { showAlert } = useAlert();

  useEffect(() => {
    const maybeShowAlert = (tag: string, downloadUrl: string) => {
      const currentVersion = Application.nativeApplicationVersion ?? '0.0.0';
      if (compareVersions(currentVersion, tag) >= 0) return;

      _alreadyChecked = true;

      showAlert(
        '🎵 Update Available',
        `Version ${tag} of Mavins is available!\n\nGet the latest features and bug fixes.`,
        [
          {
            text: 'Download',
            style: 'default',
            onPress: () => {
              triggerHaptic();
              Linking.openURL(downloadUrl).catch((err) =>
                console.error('[UpdateModal] Failed to open URL:', err),
              );
            },
          },
          {
            text: 'Later',
            style: 'cancel',
            onPress: () => triggerHaptic(),
          },
        ],
      );
    };

    const check = async () => {
      if (_alreadyChecked) return;

      // Cache hit — skip network call
      if (_cachedTag !== null) {
        maybeShowAlert(_cachedTag, _cachedDownloadUrl ?? '');
        return;
      }

      try {
        const response = await fetch(
          'https://api.github.com/repos/Phoenix-Boss/Mavins/releases/latest',
          { headers: { Accept: 'application/vnd.github.v3+json' } },
        );

        if (response.status === 403 || response.status === 404) return;
        if (!response.ok) {
          console.warn(`[UpdateModal] GitHub API ${response.status} — skipping.`);
          return;
        }

        const data = await response.json();
        const tag: string = data.tag_name ?? '';
        const downloadUrl: string =
          data.assets?.[0]?.browser_download_url ?? data.html_url ?? '';

        _cachedTag = tag;
        _cachedDownloadUrl = downloadUrl;

        maybeShowAlert(tag, downloadUrl);
      } catch {
        // Network unavailable — silently skip
      }
    };

    check();
  }, [showAlert]);

  return null;
};