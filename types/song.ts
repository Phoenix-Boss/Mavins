// types/song.ts
//
// Canonical Song shape used by MusicPlayerContext, section hooks,
// and card components throughout the app.
//
// url  — full YouTube watch URL, e.g. "https://www.youtube.com/watch?v=JGwWNGJdvx8"
//         Built by section hooks from the tracks.video_id column.
//         Required by MavinEngine for stream extraction.
//
// videoId — the raw YouTube video ID (e.g. "JGwWNGJdvx8").
//            Kept separately so the Supabase cache write knows
//            which streams row to upsert without re-parsing the URL.
//
// videoUrl — resolved video stream URL returned by MavinEngine.
//             Populated by MusicPlayerContext after extraction and
//             stored on the TrackPlayer Track object so PlayerScreen
//             can read it via useActiveTrack() for the video toggle.

export interface Song {
  id:        string;
  title:     string;
  artist:    string;
  thumbnail: string;
  /** Full YouTube watch URL — required for MavinEngine extraction */
  url:       string;
  /** Raw YouTube video ID extracted from tracks.video_id */
  videoId?:  string;
  /** Resolved video stream URL — set by MusicPlayerContext after extraction */
  videoUrl?: string;
   /** Track duration in seconds */
  duration?: number;
}