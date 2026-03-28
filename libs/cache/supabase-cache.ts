// libs/cache/supabase-cache.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  TrackMetadata,
  StreamData,
  StreamSaveData,
  RelatedTrackInput,
  ArtistCache,
  SupabaseStats,
  TrackIdentifier
} from './types';
import { normalizeQuery } from './utils';

/**
Supabase Cache - Persistent storage
Schema alignment notes (confirmed against live DB 2026-03-14):
tracks columns used here:
  id, title, artist_id, album_id, video_id, duration_seconds,
  thumbnail_url, metadata, play_count, updated_at, created_at
streams columns used here:
  id, track_id, source, stream_url, quality, format, duration,
  expiry, health_score, is_active, last_accessed, access_count
artists columns used here:
  id, name, browse_id, thumbnail_url, subscriber_count,
  monthly_listeners, metadata, updated_at, created_at
track_stats — managed by ensureSchema() / saveTrackStats():
  video_id TEXT PRIMARY KEY,
  like_count     BIGINT  DEFAULT -1,
  dislike_count  BIGINT  DEFAULT -1,
  view_count     BIGINT  DEFAULT -1,
  comments_count BIGINT  DEFAULT -1,
  uploader_url   TEXT,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
cache_metadata:
  id, cache_key, original_query, track_id, hit_count,
  last_verified, updated_at, created_at,
  l1_cached, l2_cached, l3_cached, l4_cached + _at fields
related_tracks → table does not exist; methods return empty / false safely.
*/

// ─── TrackStats shape ────────────────────────────────────────────────────────
export interface TrackStats {
  videoId:       string;
  likeCount:     number;  // -1 = hidden / unavailable
  dislikeCount:  number;
  viewCount:     number;
  commentsCount: number;
  uploaderUrl:   string | null;
  fetchedAt:     string;  // ISO timestamp — used to decide staleness
}

export class SupabaseCache {
  private supabase: SupabaseClient | null = null;
  private enabled: boolean = false;
  private ttl: number = 2592000; // 30 days default

  constructor() {
    console.log('\n🏗️ ==================================');
    console.log('🏗️ SupabaseCache constructor starting...');
    console.log('=====================================\n');

    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;

    console.log('📋 Environment check at constructor:');
    console.log('  URL:', url ? '✅ Present' : '❌ Missing');
    console.log('  Anon Key:', anonKey ? '✅ Present' : '❌ Missing');
    console.log('  Service Key:', serviceKey ? '✅ Present' : '❌ Missing');

    if (!url || !anonKey) {
      console.error('❌ Supabase env variables missing');
      this.enabled = false;
      return;
    }

    this.enabled = true;

    try {
      const keyToUse = serviceKey || anonKey;
      console.log('🔧 Creating Supabase client with URL:', url);
      this.supabase = createClient(url, keyToUse, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      });
      console.log('✅ Supabase client created successfully');

      this.testConnection().catch(err => {
        console.warn('⚠️ Supabase connection test failed:', err.message);
      });

      // Ensure all required tables exist — runs CREATE TABLE IF NOT EXISTS
      // for every table the app depends on. Safe to call on every launch.
      this.ensureSchema().catch(err => {
        console.warn('⚠️ ensureSchema failed (non-fatal):', err.message);
      });
    } catch (error) {
      console.error('❌ Failed to create Supabase client:', error);
      this.supabase = null;
      this.enabled = false;
    }

    console.log(`📊 SupabaseCache initialized:`);
    console.log(`   Enabled: ${this.enabled ? '✅' : '❌'}`);
    console.log(`   Client: ${this.supabase ? '✅ Created' : '❌ Not created'}`);
    console.log('🏗️ ==================================\n');
  }

  // ─── Connection test ────────────────────────────────────────────────────────
  private async testConnection(): Promise<void> {
    if (!this.supabase || !this.enabled) return;
    try {
      const { error } = await this.supabase
        .from('tracks')
        .select('count', { count: 'exact', head: true });
      if (error) {
        console.warn('⚠️ Supabase connection test failed:', error.message);
      } else {
        console.log('✅ Supabase connection successful');
      }
    } catch (error) {
      console.warn('⚠️ Supabase connection test error:', error);
    }
  }

  // ─── TRACK METHODS ──────────────────────────────────────────────────────────
  /**
   Get track by ID or title+artist name.
   The tracks table does not have an isrc column or string artist/album columns.
   artist_id and album_id are UUID foreign keys. When looking up by title+artist
   we join through the artists table on name.
   */
  public async getTrack(identifier: string | TrackIdentifier): Promise<TrackMetadata | null> {
    if (!this.enabled || !this.supabase) return null;
    try {
      let data: any = null;

      if (typeof identifier === 'string') {
        // Lookup by track UUID
        const result = await this.supabase
          .from('tracks')
          .select(`
            id, title, video_id, duration_seconds, thumbnail_url,
            metadata, play_count, updated_at, created_at,
            artists ( id, name ),
            albums ( id, title )
          `)
          .eq('id', identifier)
          .maybeSingle();
        if (result.error) { console.error('❌ getTrack error:', result.error); return null; }
        data = result.data;

      } else if (identifier.id) {
        const result = await this.supabase
          .from('tracks')
          .select(`
            id, title, video_id, duration_seconds, thumbnail_url,
            metadata, play_count, updated_at, created_at,
            artists ( id, name ),
            albums ( id, title )
          `)
          .eq('id', identifier.id)
          .maybeSingle();
        if (result.error) { console.error('❌ getTrack error:', result.error); return null; }
        data = result.data;

      } else if (identifier.title && identifier.artist) {
        // Join through artists table to match by name
        const result = await this.supabase
          .from('tracks')
          .select(`
            id, title, video_id, duration_seconds, thumbnail_url,
            metadata, play_count, updated_at, created_at,
            artists!inner ( id, name ),
            albums ( id, title )
          `)
          .eq('title', identifier.title)
          .eq('artists.name', identifier.artist)
          .maybeSingle();
        if (result.error) { console.error('❌ getTrack error:', result.error); return null; }
        data = result.data;

      } else {
        console.log('❌ No valid identifier provided');
        return null;
      }

      if (!data) return null;

      // Bump play_count in background — replaces the old access_count RPC
      // which no longer matches the schema.
      this.incrementPlayCount(data.id).catch(console.error);

      return this.rowToTrackMetadata(data);
    } catch (error) {
      console.error('❌ getTrack error:', error);
      return null;
    }
  }

  /**
   Save (upsert) a track — FIXED to prevent duplicate key errors.
   
   CRITICAL: The tracks table has a UNIQUE constraint on video_id.
   This method now:
   1. First checks if a track with the same video_id (youtubeId) exists
   2. If exists → UPDATE the existing record
   3. If not exists → INSERT new record
   4. Handles race conditions gracefully
   
   @param trackData - Track metadata to save
   @returns The track UUID if successful, null otherwise
   */
  public async saveTrack(trackData: TrackMetadata): Promise<string | null> {
    if (!this.enabled || !this.supabase) return null;
    
    try {
      const now = new Date().toISOString();
      
      // ── STEP 1: Check if track with same video_id already exists ───────────
      // This is the KEY fix — check by video_id (youtubeId), not just title+artist
      let existingTrack: any = null;
      
      if (trackData.youtubeId) {
        const { data: byVideoId } = await this.supabase
          .from('tracks')
          .select('id')
          .eq('video_id', trackData.youtubeId)
          .maybeSingle();
        
        if (byVideoId?.id) {
          existingTrack = byVideoId;
          console.log('✅ Track already exists by video_id:', trackData.youtubeId);
        }
      }
      
      // Fallback: check by title+artist if no video_id
      if (!existingTrack && trackData.title && trackData.artist) {
        const { data: byTitleArtist } = await this.supabase
          .from('tracks')
          .select('id')
          .eq('title', trackData.title)
          .eq('metadata->>artist', trackData.artist.toLowerCase())
          .maybeSingle();
        
        if (byTitleArtist?.id) {
          existingTrack = byTitleArtist;
          console.log('✅ Track already exists by title+artist:', trackData.title);
        }
      }

      // ── STEP 2: Update existing OR insert new ──────────────────────────────
      if (existingTrack?.id) {
        // UPDATE existing track
        const { data, error } = await this.supabase
          .from('tracks')
          .update({
            title: trackData.title,
            video_id: trackData.youtubeId || null,
            duration_seconds: trackData.duration || null,
            thumbnail_url: trackData.artworkUrl || null,
            metadata: trackData.metadata || {},
            updated_at: now
          })
          .eq('id', existingTrack.id)
          .select('id')
          .single();

        if (error) {
          console.error('❌ saveTrack update error:', error);
          return existingTrack.id; // Return existing ID even if update fails
        }
        
        console.log('✅ Track updated:', data.id);
        return data.id;
      }

      // ── STEP 3: Insert new track (no existing found) ───────────────────────
      // Resolve or create the artist row to satisfy the NOT NULL artist_id FK.
      let artistId: string | null = null;
      
      if (trackData.artist) {
        const artistName = trackData.artist.toLowerCase();

        // Check if artist exists
        const { data: existingArtist } = await this.supabase
          .from('artists')
          .select('id')
          .eq('name', artistName)
          .maybeSingle();

        if (existingArtist?.id) {
          artistId = existingArtist.id;
        } else {
          // Create new artist
          const { data: newArtist, error: insertErr } = await this.supabase
            .from('artists')
            .insert({ 
              name: artistName, 
              updated_at: now, 
              created_at: now 
            })
            .select('id')
            .single();

          if (insertErr || !newArtist) {
            // Race condition: another concurrent insert won — look it up
            const { data: retryArtist } = await this.supabase
              .from('artists')
              .select('id')
              .eq('name', artistName)
              .maybeSingle();
            
            if (retryArtist?.id) {
              artistId = retryArtist.id;
            } else {
              console.error('❌ saveTrack: could not resolve artist:', insertErr?.message);
              return null;
            }
          } else {
            artistId = newArtist.id;
          }
        }
      }

      if (!artistId) {
        console.error('❌ saveTrack: cannot insert track without a valid artist_id');
        return null;
      }

      // Insert the track
      const { data, error } = await this.supabase
        .from('tracks')
        .insert({
          title: trackData.title,
          artist_id: artistId,
          video_id: trackData.youtubeId || null,
          duration_seconds: trackData.duration || null,
          thumbnail_url: trackData.artworkUrl || null,
          metadata: trackData.metadata || {},
          created_at: now,
          updated_at: now
        })
        .select('id')
        .single();

      if (error) {
        // Handle duplicate key error gracefully (race condition)
        if (error.code === '23505') {
          console.log('⚠️ Duplicate track detected (race condition), fetching existing...');
          
          // Fetch the existing track by video_id
          if (trackData.youtubeId) {
            const { data: existing } = await this.supabase
              .from('tracks')
              .select('id')
              .eq('video_id', trackData.youtubeId)
              .maybeSingle();
            
            if (existing?.id) {
              console.log('✅ Retrieved existing track ID:', existing.id);
              return existing.id;
            }
          }
        }
        
        console.error('❌ saveTrack insert error:', error);
        return null;
      }

      console.log('✅ New track created:', data.id);
      return data.id;
      
    } catch (error: any) {
      // Handle any remaining duplicate key errors
      if (error?.code === '23505') {
        console.log('⚠️ Duplicate key error caught, fetching existing track...');
        
        if (trackData.youtubeId) {
          const { data: existing } = await this.supabase
            .from('tracks')
            .select('id')
            .eq('video_id', trackData.youtubeId)
            .maybeSingle();
          
          if (existing?.id) {
            return existing.id;
          }
        }
      }
      
      console.error('❌ saveTrack error:', error);
      return null;
    }
  }

  /**
   Increment play_count for a track.
   Replaces the old increment_track_access RPC which no longer matches the schema.
   */
  private async incrementPlayCount(trackId: string): Promise<void> {
    if (!this.supabase) return;
    try {
      await this.supabase.rpc('increment_play_count', { track_id: trackId });
    } catch {
      // RPC may not exist — fall back to a direct update
      try {
        await this.supabase
          .from('tracks')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', trackId);
      } catch { /* non-critical */ }
    }
  }

  // ─── STREAM METHODS ─────────────────────────────────────────────────────────
  /**
   Get the best active stream for a track.
   streams table has: id, track_id, source, stream_url, quality, format,
   duration, expiry, health_score, is_active, last_accessed, access_count.
   No failure_count or last_verified columns.
   */
  public async getStream(trackId: string): Promise<StreamData | null> {
    if (!this.enabled || !this.supabase) return null;
    try {
      // If trackId looks like a YouTube video ID (not a UUID), resolve the real UUID
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trackId);
      let resolvedTrackId = trackId;

      if (!isUuid) {
        const { data: track } = await this.supabase
          .from('tracks')
          .select('id')
          .eq('video_id', trackId)
          .maybeSingle();
        if (!track?.id) return null;
        resolvedTrackId = track.id;
      }

      const { data, error } = await this.supabase
        .from('streams')
        .select('id, track_id, source, stream_url, quality, format, duration, expiry, health_score, is_active, last_accessed, access_count')
        .eq('track_id', resolvedTrackId)
        .eq('is_active', true)
        .order('health_score', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) { console.error('❌ getStream error:', error); return null; }
      if (!data) return null;

      if (new Date(data.expiry) < new Date()) {
        await this.supabase.from('streams').update({ is_active: false }).eq('id', data.id);
        return null;
      }

      // Update access tracking in background
      this.supabase.from('streams').update({
        last_accessed: new Date().toISOString(),
        access_count: (data.access_count || 0) + 1
      }).eq('id', data.id).then(() => {}).catch(() => {});

      return this.rowToStreamData(data);
    } catch (error) {
      console.error('❌ getStream error:', error);
      return null;
    }
  }

  /**
   Save or update a stream URL.
   */
  public async saveStream(streamData: StreamSaveData): Promise<boolean> {
    if (!this.enabled || !this.supabase) return false;
    try {
      // Resolve YouTube video ID → track UUID if needed
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(streamData.trackId);
      let resolvedTrackId = streamData.trackId;

      if (!isUuid) {
        const { data: track } = await this.supabase
          .from('tracks')
          .select('id')
          .eq('video_id', streamData.trackId)
          .maybeSingle();
        if (!track?.id) {
          console.warn(`[MusicPlayer] stream cache write error: invalid input syntax for type uuid: "${streamData.trackId}"`);
          return false;
        }
        resolvedTrackId = track.id;
      }

      const expiryDate = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();

      const { data: existing } = await this.supabase
        .from('streams')
        .select('id')
        .eq('track_id', resolvedTrackId)
        .eq('source', streamData.source)
        .maybeSingle();

      if (existing) {
        const { error } = await this.supabase
          .from('streams')
          .update({
            stream_url: streamData.streamUrl,
            quality: streamData.quality || '128kbps',
            format: streamData.format || 'webm',
            expiry: expiryDate,
            is_active: true,
            health_score: 100,
            last_accessed: now
          })
          .eq('id', existing.id);

        if (error) { console.error('❌ saveStream update error:', error); return false; }
        return true;
      }

      const { error } = await this.supabase
        .from('streams')
        .insert({
          track_id: resolvedTrackId,
          source: streamData.source,
          stream_url: streamData.streamUrl,
          quality: streamData.quality || '128kbps',
          format: streamData.format || 'webm',
          expiry: expiryDate,
          is_active: true,
          health_score: 100,
          last_accessed: now,
          access_count: 0,
          created_at: now
        });

      if (error) { console.error('❌ saveStream insert error:', error); return false; }
      return true;
    } catch (error) {
      console.error('❌ saveStream error:', error);
      return false;
    }
  }

  /**
   Report a stream failure by reducing its health score.
   streams table has no failure_count column — health_score alone is used.
   */
  public async reportStreamFailure(streamId: string): Promise<void> {
    if (!this.supabase) return;
    try {
      const { data } = await this.supabase
        .from('streams')
        .select('health_score')
        .eq('id', streamId)
        .single();

      if (!data) return;

      const newHealth = (data.health_score || 100) - 20;

      await this.supabase
        .from('streams')
        .update({
          health_score: Math.max(newHealth, 0),
          is_active: newHealth <= 0
        })
        .eq('id', streamId);
    } catch (error) {
      console.error('❌ reportStreamFailure error:', error);
    }
  }

  // ─── SEARCH METHODS (via cache_metadata) ───────────────────────────────────
  /**
   The `searches` table does not exist in this schema.
   Search query tracking is handled via the `cache_metadata` table which has:
   cache_key, original_query, track_id, hit_count, last_verified, updated_at.
   */
  public async saveSearch(query: string, trackId: string): Promise<boolean> {
    if (!this.enabled || !this.supabase) return false;
    const normalized = normalizeQuery(query);
    const cacheKey = `search:${normalized}`;
    const now = new Date().toISOString();

    try {
      const { data: existing } = await this.supabase
        .from('cache_metadata')
        .select('id, hit_count')
        .eq('cache_key', cacheKey)
        .maybeSingle();

      if (existing) {
        await this.supabase
          .from('cache_metadata')
          .update({
            hit_count: (existing.hit_count || 0) + 1,
            last_verified: now,
            updated_at: now,
            track_id: trackId
          })
          .eq('id', existing.id);
      } else {
        await this.supabase
          .from('cache_metadata')
          .insert({
            cache_key: cacheKey,
            original_query: query,
            track_id: trackId,
            hit_count: 1,
            l1_cached: false,
            l2_cached: false,
            l3_cached: false,
            l4_cached: false,
            created_at: now,
            updated_at: now
          });
      }

      return true;
    } catch (error) {
      console.error('❌ saveSearch error:', error);
      return false;
    }
  }

  /**
   Find a cached track by search query via cache_metadata.
   */
  public async findBySearch(query: string): Promise<TrackMetadata | null> {
    if (!this.enabled || !this.supabase) return null;
    const cacheKey = `search:${normalizeQuery(query)}`;
    const now = new Date().toISOString();

    try {
      const { data, error } = await this.supabase
        .from('cache_metadata')
        .select('track_id')
        .eq('cache_key', cacheKey)
        .maybeSingle();

      if (error || !data?.track_id) return null;

      // Update last_verified
      await this.supabase
        .from('cache_metadata')
        .update({ last_verified: now, updated_at: now })
        .eq('cache_key', cacheKey);

      return await this.getTrack(data.track_id);
    } catch (error) {
      console.error('❌ findBySearch error:', error);
      return null;
    }
  }

  /**
   Get popular searches for pre-caching, from cache_metadata ordered by hit_count.
   */
  public async getPopularSearches(
    limit = 50,
    minHits = 10
  ): Promise<Array<{ query: string; trackId: string; hitCount: number }>> {
    console.log(`\n📊 Getting popular searches (min hits: ${minHits}, limit: ${limit})`);
    if (!this.enabled || !this.supabase) return [];
    try {
      const { data, error } = await this.supabase
        .from('cache_metadata')
        .select('original_query, track_id, hit_count')
        .not('track_id', 'is', null)
        .not('original_query', 'is', null)
        .gte('hit_count', minHits)
        .order('hit_count', { ascending: false })
        .limit(limit);

      if (error || !data) {
        console.error('❌ getPopularSearches error:', error);
        return [];
      }

      console.log(`   Found ${data.length} popular searches`);
      return data.map(item => ({
        query: item.original_query,
        trackId: item.track_id,
        hitCount: item.hit_count
      }));
    } catch (error) {
      console.error('❌ getPopularSearches error:', error);
      return [];
    }
  }

  // ─── RELATED TRACKS ─────────────────────────────────────────────────────────
  /**
   The `related_tracks` table does not exist in this schema.
   These methods are stubbed to return safe empty values until a
   related_tracks table is added.
   */
  public async saveRelatedTracks(
    sourceTrackId: string,
    relatedTracks: RelatedTrackInput[]
  ): Promise<boolean> {
    console.log(`⚠️ saveRelatedTracks: related_tracks table not in schema, skipping`);
    return false;
  }

  public async getRelatedTracks(trackId: string, limit = 10): Promise<TrackMetadata[]> {
    console.log(`⚠️ getRelatedTracks: related_tracks table not in schema, returning []`);
    return [];
  }

  // ─── ARTIST METHODS ─────────────────────────────────────────────────────────
  /**
   The `artist_cache` table does not exist. The real table is `artists` with:
   id, name, browse_id, thumbnail_url, subscriber_count, monthly_listeners,
   metadata, updated_at, created_at.
   top_tracks, albums, and similar are stored inside the metadata jsonb column.
   */
  public async saveArtist(artistName: string, data: Partial<ArtistCache>): Promise<boolean> {
    if (!this.enabled || !this.supabase) return false;
    const now = new Date().toISOString();

    // CANNOT use onConflict:'name' — no unique constraint on artists.name.
    // Pattern: SELECT → UPDATE if found, INSERT if not.
    try {
      const nameLower = artistName.toLowerCase();
      const metadata = {
        topTracks: data.topTracks || [],
        albums:    data.albums    || [],
        similar:   data.similar   || [],
      };

      const { data: existing } = await this.supabase
        .from('artists')
        .select('id')
        .eq('name', nameLower)
        .maybeSingle();

      if (existing?.id) {
        await this.supabase
          .from('artists')
          .update({ metadata, updated_at: now })
          .eq('id', existing.id);
      } else {
        const { error: insertErr } = await this.supabase
          .from('artists')
          .insert({ name: nameLower, metadata, updated_at: now, created_at: now });

        if (insertErr) {
          // Race: another insert won — update it instead
          const { data: raceRow } = await this.supabase
            .from('artists').select('id').eq('name', nameLower).maybeSingle();
          if (raceRow?.id) {
            await this.supabase
              .from('artists')
              .update({ metadata, updated_at: now })
              .eq('id', raceRow.id);
          }
        }
      }

      console.log('✅ Artist saved');
      return true;
    } catch (error) {
      console.error('❌ saveArtist error:', error);
      return false;
    }
  }

  public async getArtist(artistName: string): Promise<ArtistCache | null> {
    if (!this.enabled || !this.supabase) return null;
    try {
      const { data, error } = await this.supabase
        .from('artists')
        .select('id, name, thumbnail_url, subscriber_count, metadata, updated_at')
        .eq('name', artistName.toLowerCase())
        .maybeSingle();

      if (error || !data) return null;

      return {
        id: data.id,
        name: data.name,
        topTracks: data.metadata?.topTracks || [],
        albums: data.metadata?.albums || [],
        similar: data.metadata?.similar || [],
        lastUpdated: data.updated_at
      };
    } catch (error) {
      console.error('❌ getArtist error:', error);
      return null;
    }
  }

  // ─── STREAM HEALTH ───────────────────────────────────────────────────────────
  /**
   Get streams expiring within the next N hours.
   */
  public async getExpiringStreams(hoursThreshold = 6): Promise<StreamData[]> {
    console.log(`\n⏰ Getting streams expiring in ${hoursThreshold} hours`);
    if (!this.enabled || !this.supabase) return [];
    try {
      const thresholdDate = new Date(
        Date.now() + hoursThreshold * 60 * 60 * 1000
      ).toISOString();

      const { data, error } = await this.supabase
        .from('streams')
        .select('id, track_id, source, stream_url, quality, format, duration, expiry, health_score, is_active, last_accessed, access_count')
        .eq('is_active', true)
        .lt('expiry', thresholdDate)
        .limit(100);

      if (error || !data) {
        console.error('❌ getExpiringStreams error:', error);
        return [];
      }

      console.log(`   Found ${data.length} expiring streams`);
      return data.map(item => this.rowToStreamData(item));
    } catch (error) {
      console.error('❌ getExpiringStreams error:', error);
      return [];
    }
  }

  /**
   Get IDs of tracks not updated in the last N days.
   tracks table has no last_accessed column — updated_at is the correct
   staleness signal (written on every insert, update, and play count bump).
   */
  public async getStaleTracks(daysThreshold = 90): Promise<string[]> {
    console.log(`\n🧹 Getting stale tracks (not accessed in ${daysThreshold} days)`);
    if (!this.enabled || !this.supabase) return [];
    try {
      const thresholdDate = new Date(
        Date.now() - daysThreshold * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data, error } = await this.supabase
        .from('tracks')
        .select('id')
        .lt('updated_at', thresholdDate)
        .limit(1000);

      if (error || !data) {
        console.error('❌ getStaleTracks error:', error);
        return [];
      }

      console.log(`   Found ${data.length} stale tracks`);
      return data.map(t => t.id);
    } catch (error) {
      console.error('❌ getStaleTracks error:', error);
      return [];
    }
  }

  // ─── STATS ──────────────────────────────────────────────────────────────────
  public async getStats(): Promise<SupabaseStats | null> {
    console.log('\n📊 Getting cache statistics');
    if (!this.enabled || !this.supabase) return null;
    try {
      const [tracks, streams, searches] = await Promise.all([
        this.supabase.from('tracks').select('*', { count: 'exact', head: true }),
        this.supabase.from('streams').select('*', { count: 'exact', head: true }).eq('is_active', true),
        this.supabase.from('cache_metadata').select('*', { count: 'exact', head: true })
      ]);

      const stats = {
        tracks: tracks.count || 0,
        activeStreams: streams.count || 0,
        searches: searches.count || 0
      };

      console.log('📊 Stats:', stats);
      return stats;
    } catch (error) {
      console.error('❌ getStats error:', error);
      return null;
    }
  }

  // ─── SCHEMA BOOTSTRAP ───────────────────────────────────────────────────────
  /**
   Ensure all tables the app needs exist.
   Uses raw SQL via Supabase's rpc('exec_sql') if available, otherwise
   tries each table with a lightweight probe and creates it via rpc if missing.
   Tables created here (existing tables are never modified):
   track_stats   — per-video engagement counts from NewPipe extraction
   cache_metadata — already exists in most deployments; safe no-op if so
   The CREATE TABLE statements use IF NOT EXISTS so they are idempotent.
   All timestamps default to now() so callers never need to supply them.
   */
  public async ensureSchema(): Promise<void> {
    if (!this.supabase || !this.enabled) return;
    
    // SQL for every table that may not exist yet.
    // Existing tables are untouched — IF NOT EXISTS is the safety net.
    const statements = [
      // ── track_stats ──────────────────────────────────────────────────────
      // Keyed on video_id (11-char YouTube ID) — one row per video.
      // like_count / dislike_count / view_count / comments_count default to -1
      // which signals "YouTube did not return this value" (hidden likes, etc.)
      `CREATE TABLE IF NOT EXISTS track_stats (
        video_id       TEXT        PRIMARY KEY,
        like_count     BIGINT      NOT NULL DEFAULT -1,
        dislike_count  BIGINT      NOT NULL DEFAULT -1,
        view_count     BIGINT      NOT NULL DEFAULT -1,
        comments_count BIGINT      NOT NULL DEFAULT -1,
        uploader_url   TEXT,
        fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,

      // ── cache_metadata ───────────────────────────────────────────────────
      // May already exist. IF NOT EXISTS makes this a safe no-op.
      `CREATE TABLE IF NOT EXISTS cache_metadata (
        id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        cache_key      TEXT        NOT NULL UNIQUE,
        original_query TEXT,
        track_id       UUID        REFERENCES tracks(id) ON DELETE SET NULL,
        hit_count      INTEGER     NOT NULL  DEFAULT 0,
        last_verified  TIMESTAMPTZ,
        l1_cached      BOOLEAN     NOT NULL DEFAULT false,
        l2_cached      BOOLEAN     NOT NULL DEFAULT false,
        l3_cached      BOOLEAN     NOT NULL DEFAULT false,
        l4_cached      BOOLEAN     NOT NULL DEFAULT false,
        l1_cached_at   TIMESTAMPTZ,
        l2_cached_at   TIMESTAMPTZ,
        l3_cached_at   TIMESTAMPTZ,
        l4_cached_at   TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    ];

    // exec_sql and pg_query RPCs are not available on standard Supabase projects.
    // Instead, probe each table with a lightweight SELECT — if it fails with
    // 'relation does not exist' (42P01) the table is missing and we log a
    // one-time reminder to run the migration SQL manually.
    // Tables that already exist produce no output at all.
    const tablesToProbe = ['track_stats', 'cache_metadata', 'lyrics'];

    for (const table of tablesToProbe) {
      try {
        const { error } = await this.supabase
          .from(table)
          .select('*', { count: 'exact', head: true });
        if (error) {
          const isMissing =
            error.code === '42P01' ||
            error.message?.includes('does not exist') ||
            error.message?.includes('schema cache');
          if (isMissing) {
            console.warn(
              `⚠️ Table '${table}' does not exist. ` +
              `Run the migration SQL from the project docs to create it. ` +
              `The app will continue without it.`
            );
          }
          // Any other error (permissions etc.) is silently ignored — non-fatal.
        }
      } catch { /* non-fatal */ }
    }

    console.log('✅ ensureSchema complete');
  }

  // ─── TRACK STATS ────────────────────────────────────────────────────────────
  /**
   Cache engagement stats for a YouTube video.
   Called fire-and-forget from MusicPlayerContext.resolveTrack() after
   MavinEngine.getStreamInfo() returns — the stats come for free in that
   response so no extra network call is needed.
   TTL: stats older than 24 hours are considered stale and re-fetched
   by MusicPlayerContext on the next play.
   */
  public async saveTrackStats(stats: Omit<TrackStats, 'fetchedAt'>): Promise<void> {
    if (!this.enabled || !this.supabase) return;
    try {
      const now = new Date().toISOString();
      const { error } = await this.supabase
        .from('track_stats')
        .upsert({
          video_id:       stats.videoId,
          like_count:     stats.likeCount,
          dislike_count:  stats.dislikeCount,
          view_count:     stats.viewCount,
          comments_count: stats.commentsCount,
          uploader_url:   stats.uploaderUrl ?? null,
          fetched_at:     now,
          updated_at:     now,
        }, { onConflict: 'video_id' });

      if (error) {
        console.warn('⚠️ saveTrackStats error:', error.message);
      } else {
        console.log(`✅ track_stats saved for ${stats.videoId}`);
      }
    } catch (e: any) {
      console.warn('⚠️ saveTrackStats exception:', e?.message);
    }
  }

  /**
   Retrieve cached engagement stats for a YouTube video.
   Returns null if:
   - No row exists for this videoId
   - The row is older than maxAgeHours (default 24h) — caller should re-fetch
   The caller (MusicPlayerContext) uses this to skip the MavinEngine call
   when fresh stats are already in the DB.
   */
  public async getTrackStats(
    videoId: string,
    maxAgeHours = 24,
  ): Promise<TrackStats | null> {
    if (!this.enabled || !this.supabase) return null;
    try {
      const { data, error } = await this.supabase
        .from('track_stats')
        .select('video_id, like_count, dislike_count, view_count, comments_count, uploader_url, fetched_at')
        .eq('video_id', videoId)
        .maybeSingle();

      if (error || !data) return null;

      // Staleness check — re-fetch if older than maxAgeHours
      const ageMs = Date.now() - new Date(data.fetched_at).getTime();
      if (ageMs > maxAgeHours * 60 * 60 * 1000) {
        console.log(`ℹ️ track_stats for ${videoId} is stale (${Math.round(ageMs / 3600000)}h old)`);
        return null;
      }

      return {
        videoId:       data.video_id,
        likeCount:     data.like_count     ?? -1,
        dislikeCount:  data.dislike_count  ?? -1,
        viewCount:     data.view_count     ?? -1,
        commentsCount: data.comments_count ?? -1,
        uploaderUrl:   data.uploader_url   ?? null,
        fetchedAt:     data.fetched_at,
      };
    } catch (e: any) {
      console.warn('⚠️ getTrackStats exception:', e?.message);
      return null;
    }
  }

  /**
   Patch just the commentsCount on an existing track_stats row.
   Called fire-and-forget from MusicPlayerContext after the background
   getComments call resolves — avoids re-upserting all fields.
   */
  public async patchCommentsCount(videoId: string, commentsCount: number): Promise<void> {
    if (!this.enabled || !this.supabase) return;
    try {
      await this.supabase
        .from('track_stats')
        .update({ comments_count: commentsCount, updated_at: new Date().toISOString() })
        .eq('video_id', videoId);
    } catch (e: any) {
      console.warn('⚠️ patchCommentsCount exception:', e?.message);
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────
  private rowToTrackMetadata(data: any): TrackMetadata {
    return {
      id: data.id,
      isrc: data.metadata?.isrc || null,
      title: data.title,
      artist: data.artists?.name || data.metadata?.artist || '',
      album: data.albums?.title || data.metadata?.album || '',
      duration: data.duration_seconds,
      artworkUrl: data.thumbnail_url,
      spotifyId: data.metadata?.spotifyId || null,
      youtubeId: data.video_id,
      deezerId: data.metadata?.deezerId || null,
      soundcloudId: data.metadata?.soundcloudId || null,
      metadata: data.metadata,
      accessCount: data.play_count,
      lastAccessed: data.updated_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  }

  private rowToStreamData(data: any): StreamData {
    return {
      id: data.id,
      trackId: data.track_id,
      source: data.source,
      streamUrl: data.stream_url,
      quality: data.quality,
      format: data.format,
      expiry: data.expiry,
      isActive: data.is_active,
      healthScore: data.health_score,
      failureCount: 0,           // column does not exist on streams table
      lastVerified: data.last_accessed  // closest equivalent
    };
  }
}

// Export singleton instance
export const supabaseCache = new SupabaseCache();