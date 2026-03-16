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
 * Supabase Cache - Persistent storage
 *
 * Schema alignment notes (confirmed against live DB 2026-03-14):
 *
 * tracks columns used here:
 *   id, title, artist_id, album_id, video_id, duration_seconds,
 *   thumbnail_url, metadata, play_count, updated_at, created_at
 *   — NO: isrc, artist (string), album (string), artwork_url,
 *         spotify_id, youtube_id, deezer_id, soundcloud_id,
 *         access_count, last_accessed
 *
 * streams columns used here:
 *   id, track_id, source, stream_url, quality, format, duration,
 *   expiry, health_score, is_active, last_accessed, access_count
 *   — NO: failure_count, last_verified (not on streams table)
 *
 * artists columns used here:
 *   id, name, browse_id, thumbnail_url, subscriber_count,
 *   monthly_listeners, metadata, updated_at, created_at
 *   — top_tracks / albums / similar stored inside metadata jsonb
 *
 * searches → table does not exist.
 *   Replaced with cache_metadata:
 *   id, cache_key, original_query, track_id, hit_count,
 *   last_verified, updated_at, created_at,
 *   l1_cached, l2_cached, l3_cached, l4_cached + _at fields
 *
 * related_tracks → table does not exist; methods return empty / false safely.
 */
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
   * Get track by ID or title+artist name.
   *
   * The tracks table does not have an isrc column or string artist/album columns.
   * artist_id and album_id are UUID foreign keys. When looking up by title+artist
   * we join through the artists table on name.
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
   * Save (upsert) a track.
   *
   * We can only store fields that exist on the tracks table. artist and album
   * names cannot be stored as strings — caller must resolve artist_id / album_id
   * UUIDs beforehand and pass them in metadata if needed. video_id maps to
   * what was previously youtubeId.
   */
  public async saveTrack(trackData: TrackMetadata): Promise<string | null> {
    if (!this.enabled || !this.supabase) return null;

    try {
      const existing = await this.getTrack({
        title: trackData.title,
        artist: trackData.artist
      });

      const now = new Date().toISOString();

      if (existing?.id) {
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
          .eq('id', existing.id)
          .select('id')
          .single();

        if (error) { console.error('❌ saveTrack update error:', error); return existing.id; }
        console.log('✅ Track updated:', data.id);
        return data.id;
      }

      const { data, error } = await this.supabase
        .from('tracks')
        .insert({
          title: trackData.title,
          video_id: trackData.youtubeId || null,
          duration_seconds: trackData.duration || null,
          thumbnail_url: trackData.artworkUrl || null,
          metadata: trackData.metadata || {},
          created_at: now,
          updated_at: now
        })
        .select('id')
        .single();

      if (error) { console.error('❌ saveTrack insert error:', error); return null; }
      console.log('✅ New track created:', data.id);
      return data.id;
    } catch (error) {
      console.error('❌ saveTrack error:', error);
      return null;
    }
  }

  /**
   * Increment play_count for a track.
   * Replaces the old increment_track_access RPC which no longer matches the schema.
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
   * Get the best active stream for a track.
   * streams table has: id, track_id, source, stream_url, quality, format,
   * duration, expiry, health_score, is_active, last_accessed, access_count.
   * No failure_count or last_verified columns.
   */
  public async getStream(trackId: string): Promise<StreamData | null> {
    if (!this.enabled || !this.supabase) return null;

    try {
      const { data, error } = await this.supabase
        .from('streams')
        .select('id, track_id, source, stream_url, quality, format, duration, expiry, health_score, is_active, last_accessed, access_count')
        .eq('track_id', trackId)
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
   * Save or update a stream URL.
   */
  public async saveStream(streamData: StreamSaveData): Promise<boolean> {
    if (!this.enabled || !this.supabase) return false;

    try {
      const expiryDate = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();

      const { data: existing } = await this.supabase
        .from('streams')
        .select('id')
        .eq('track_id', streamData.trackId)
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
          track_id: streamData.trackId,
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
   * Report a stream failure by reducing its health score.
   * streams table has no failure_count column — health_score alone is used.
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
   * The `searches` table does not exist in this schema.
   * Search query tracking is handled via the `cache_metadata` table which has:
   * cache_key, original_query, track_id, hit_count, last_verified, updated_at.
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
   * Find a cached track by search query via cache_metadata.
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
   * Get popular searches for pre-caching, from cache_metadata ordered by hit_count.
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
   * The `related_tracks` table does not exist in this schema.
   * These methods are stubbed to return safe empty values until a
   * related_tracks table is added.
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
   * The `artist_cache` table does not exist. The real table is `artists` with:
   * id, name, browse_id, thumbnail_url, subscriber_count, monthly_listeners,
   * metadata, updated_at, created_at.
   *
   * top_tracks, albums, and similar are stored inside the metadata jsonb column.
   */
  public async saveArtist(artistName: string, data: Partial<ArtistCache>): Promise<boolean> {
    if (!this.enabled || !this.supabase) return false;

    const now = new Date().toISOString();

    try {
      await this.supabase
        .from('artists')
        .upsert({
          name: artistName.toLowerCase(),
          metadata: {
            topTracks: data.topTracks || [],
            albums: data.albums || [],
            similar: data.similar || []
          },
          updated_at: now
        }, { onConflict: 'name' });

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
   * Get streams expiring within the next N hours.
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
   * Get IDs of tracks not updated in the last N days.
   * tracks table has no last_accessed column — updated_at is the correct
   * staleness signal (written on every insert, update, and play count bump).
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