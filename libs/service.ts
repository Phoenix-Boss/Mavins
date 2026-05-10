// libs/service.ts
//
// expo-av Playback Service — handles remote control events and background playback
// Uses expo-notifications for lock screen controls

import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Import proper types from expo-av
import type { AVPlaybackStatus } from 'expo-av';

// Global state
let _isPlaying = false;
let _position = 0;
let _duration = 0;
let _currentSound: Audio.Sound | null = null;
let _playbackStatusSubscription: any = null;

// Track queue management (simplified - you can expand this)
let _queue: any[] = [];
let _currentTrackIndex = -1;

// Callbacks for UI updates
let _onStateChange: ((isPlaying: boolean) => void) | null = null;
let _onProgressChange: ((position: number, duration: number) => void) | null = null;
let _onTrackChange: ((track: any, index: number) => void) | null = null;

// Safe error handler
async function safe(fn: () => Promise<unknown>, label: string, retries = 1): Promise<void> {
  try {
    await fn();
    console.log(`[PlaybackService] ✅ ${label}`);
  } catch (e) {
    if (retries > 0) {
      console.log(`[PlaybackService] ⚠️ ${label} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 50));
      return safe(fn, label, retries - 1);
    }
    console.error(`[PlaybackService] ❌ ${label} failed:`, e);
  }
}

// Update notification with current track info
async function updateNotification() {
  // Check and store current sound in a local variable to maintain type safety
  const currentSound = _currentSound;
  
  if (!currentSound || _currentTrackIndex < 0 || !_queue[_currentTrackIndex]) {
    await Notifications.dismissAllNotificationsAsync();
    return;
  }

  const track = _queue[_currentTrackIndex];
  const status = await currentSound.getStatusAsync();

  // Create notification category for media controls
  await Notifications.setNotificationCategoryAsync('MEDIA_PLAYBACK', [
    {
      identifier: 'PREVIOUS',
      buttonTitle: '⏮',
      options: { isDestructive: false },
    },
    {
      identifier: status.isLoaded && status.isPlaying ? 'PAUSE' : 'PLAY',
      buttonTitle: status.isLoaded && status.isPlaying ? '⏸' : '▶',
      options: { isDestructive: false },
    },
    {
      identifier: 'NEXT',
      buttonTitle: '⏭',
      options: { isDestructive: false },
    },
    {
      identifier: 'STOP',
      buttonTitle: '⏹',
      options: { isDestructive: true },
    },
  ]);

  // Build notification content
  const notificationContent: any = {
    title: track.title || 'Unknown Track',
    body: track.artist || 'Unknown Artist',
    data: { type: 'MEDIA_PLAYBACK', track, action: 'UPDATE' },
    categoryIdentifier: 'MEDIA_PLAYBACK',
  };

  // Add Android-specific options
  if (Platform.OS === 'android') {
    notificationContent.android = {
      priority: Notifications.AndroidNotificationPriority.HIGH,
    };
    notificationContent.color = '#1DB954';
  }

  // Add iOS attachments with proper structure
  if (track.artwork && Platform.OS === 'ios') {
    notificationContent.attachments = [
      {
        identifier: 'artwork',
        type: 'image',
        url: track.artwork,
      },
    ];
  }

  // Show notification
  await Notifications.scheduleNotificationAsync({
    content: notificationContent,
    trigger: null,
  });
}

// Handle playback status updates
function onPlaybackStatusUpdate(status: AVPlaybackStatus) {
  if (!status.isLoaded) {
    _isPlaying = false;
    _position = 0;
    _duration = 0;
    if (_onStateChange) _onStateChange(false);
    return;
  }

  _isPlaying = status.isPlaying;
  _position = status.positionMillis / 1000;
  _duration = (status.durationMillis || 0) / 1000;

  if (_onStateChange) _onStateChange(_isPlaying);
  if (_onProgressChange) _onProgressChange(_position, _duration);

  // Update notification play/pause button when state changes
  updateNotification().catch(console.warn);
}

// Setup sound listeners
async function setupSoundListeners(sound: Audio.Sound) {
  if (_playbackStatusSubscription) {
    _playbackStatusSubscription.remove();
  }
  _playbackStatusSubscription = sound.setOnPlaybackStatusUpdate(onPlaybackStatusUpdate);
}

// Core playback functions
export async function play(): Promise<void> {
  const currentSound = _currentSound;
  if (currentSound) {
    await safe(() => currentSound.playAsync(), 'Play');
  } else {
    console.warn('[PlaybackService] Cannot play: _currentSound is null');
  }
}

export async function pause(): Promise<void> {
  const currentSound = _currentSound;
  if (currentSound) {
    await safe(() => currentSound.pauseAsync(), 'Pause');
  } else {
    console.warn('[PlaybackService] Cannot pause: _currentSound is null');
  }
}

export async function stop(): Promise<void> {
  const currentSound = _currentSound;
  if (currentSound) {
    await safe(() => currentSound.stopAsync(), 'Stop');
    await updateNotification();
  } else {
    console.warn('[PlaybackService] Cannot stop: _currentSound is null');
  }
}

export async function seekTo(position: number): Promise<void> {
  const currentSound = _currentSound;
  if (currentSound && position >= 0 && position <= _duration) {
    await safe(() => currentSound.setPositionAsync(position * 1000), 'SeekTo');
  } else if (!currentSound) {
    console.warn('[PlaybackService] Cannot seek: _currentSound is null');
  }
}

export async function skipToNext(): Promise<void> {
  if (_queue.length > 0 && _currentTrackIndex < _queue.length - 1) {
    const nextIndex = _currentTrackIndex + 1;
    await loadTrack(nextIndex);
    await safe(() => play(), 'SkipToNext');
  } else {
    console.warn('[PlaybackService] Cannot skip to next: no more tracks');
  }
}

export async function skipToPrevious(): Promise<void> {
  if (_queue.length > 0 && _currentTrackIndex > 0) {
    const prevIndex = _currentTrackIndex - 1;
    await loadTrack(prevIndex);
    await safe(() => play(), 'SkipToPrevious');
  } else {
    console.warn('[PlaybackService] Cannot skip to previous: no previous track');
  }
}

export async function loadTrack(index: number, startPlayback = false): Promise<void> {
  if (!_queue[index]) {
    console.error(`[PlaybackService] No track at index ${index}`);
    return;
  }

  const track = _queue[index];

  try {
    // Unload current sound
    if (_currentSound) {
      await _currentSound.unloadAsync();
      _currentSound = null;
    }

    // Load new sound
    const { sound } = await Audio.Sound.createAsync(
      { uri: track.url },
      { shouldPlay: startPlayback }
    );

    _currentSound = sound;
    _currentTrackIndex = index;
    
    await setupSoundListeners(sound);
    
    if (_onTrackChange) {
      _onTrackChange(track, index);
    }

    await updateNotification();
    console.log(`[PlaybackService] Loaded track: ${track.title}`);
  } catch (error) {
    console.error('[PlaybackService] Error loading track:', error);
  }
}

export async function setQueue(tracks: any[], startIndex = 0): Promise<void> {
  _queue = [...tracks];
  _currentTrackIndex = -1;
  
  if (startIndex >= 0 && startIndex < _queue.length) {
    await loadTrack(startIndex, false);
  }
  
  console.log(`[PlaybackService] Queue set with ${tracks.length} tracks`);
}

export async function getQueue(): Promise<any[]> {
  return [..._queue];
}

export async function getActiveTrack(): Promise<any | null> {
  if (_currentTrackIndex >= 0 && _queue[_currentTrackIndex]) {
    return _queue[_currentTrackIndex];
  }
  return null;
}

export async function getPosition(): Promise<number> {
  return _position;
}

export async function getDuration(): Promise<number> {
  return _duration;
}

export async function isPlaying(): Promise<boolean> {
  return _isPlaying;
}

export async function reset(): Promise<void> {
  const currentSound = _currentSound;
  if (currentSound) {
    await currentSound.stopAsync();
    await currentSound.unloadAsync();
    _currentSound = null;
  }
  _queue = [];
  _currentTrackIndex = -1;
  _isPlaying = false;
  _position = 0;
  _duration = 0;
  await Notifications.dismissAllNotificationsAsync();
  console.log('[PlaybackService] Reset complete');
}

// Register callbacks for UI updates
export function onStateChange(callback: (isPlaying: boolean) => void): void {
  _onStateChange = callback;
}

export function onProgressChange(callback: (position: number, duration: number) => void): void {
  _onProgressChange = callback;
}

export function onTrackChange(callback: (track: any, index: number) => void): void {
  _onTrackChange = callback;
}

// Handle remote notification actions
async function handleRemoteAction(action: string) {
  console.log(`[PlaybackService] Remote action: ${action}`);
  
  switch (action) {
    case 'PLAY':
      await play();
      break;
    case 'PAUSE':
      await pause();
      break;
    case 'STOP':
      await stop();
      break;
    case 'NEXT':
      await skipToNext();
      break;
    case 'PREVIOUS':
      await skipToPrevious();
      break;
  }
}

// Main service initialization
export async function PlaybackService(): Promise<void> {
  console.log('[PlaybackService] Started');

  // Configure audio mode for background playback
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    staysActiveInBackground: true,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });

  // Set up notification listeners
  Notifications.addNotificationResponseReceivedListener((response) => {
    const action = response.actionIdentifier;
    const data = response.notification.request.content.data;
    
    if (data.type === 'MEDIA_PLAYBACK') {
      handleRemoteAction(action).catch(console.error);
    }
  });

  // Set up notification category for remote controls
  await Notifications.setNotificationCategoryAsync('MEDIA_PLAYBACK', [
    {
      identifier: 'PREVIOUS',
      buttonTitle: '⏮',
      options: { isDestructive: false },
    },
    {
      identifier: 'PLAY',
      buttonTitle: '▶',
      options: { isDestructive: false },
    },
    {
      identifier: 'PAUSE',
      buttonTitle: '⏸',
      options: { isDestructive: false },
    },
    {
      identifier: 'NEXT',
      buttonTitle: '⏭',
      options: { isDestructive: false },
    },
    {
      identifier: 'STOP',
      buttonTitle: '⏹',
      options: { isDestructive: true },
    },
  ]);

  console.log('[PlaybackService] ✅ All listeners registered');
}

export default PlaybackService;