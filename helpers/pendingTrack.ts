/**
 * pendingTrack.ts
 *
 * A tiny synchronous signal that lets the search screen (or any screen)
 * tell FloatingPlayer to render a skeleton pill IMMEDIATELY on tap —
 * before RNTP has loaded the track and useActiveTrack() returns a value.
 *
 * Usage:
 *   // On song tap (before calling playAudio):
 *   setPendingTrack({ title: song.title, artist: song.artist, artwork: song.thumbnail });
 *
 *   // FloatingPlayer reads this and shows the pill right away.
 *   // Once useActiveTrack() returns the real track, FloatingPlayer switches
 *   // to the real data and clearPendingTrack() is called automatically.
 */

export interface PendingTrackInfo {
  title:   string;
  artist:  string;
  artwork: string;
}

type Listener = (track: PendingTrackInfo | null) => void;

let _pending:   PendingTrackInfo | null = null;
const _listeners = new Set<Listener>();

export function setPendingTrack(track: PendingTrackInfo): void {
  _pending = track;
  _listeners.forEach((l) => l(_pending));
}

export function clearPendingTrack(): void {
  if (_pending === null) return;
  _pending = null;
  _listeners.forEach((l) => l(null));
}

export function getPendingTrack(): PendingTrackInfo | null {
  return _pending;
}

export function subscribePendingTrack(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}
