/**
 * useLiveStations Hook — Supabase DB Edition
 *
 * Data flow:
 *   radio_stations
 *     → is_active = true, stream_url not null
 *     → full pool of 24 cached
 *     → each load picks 8 that were NOT in the previous 8
 *       so all 8 slots always change completely
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';

export interface LiveStationItem {
  id: string;
  name: string;
  streamUrl: string;
  thumbnail: string;
  genre: string;
  listeners: number;
  isLive: boolean;
}

interface UseLiveStationsResult {
  data: LiveStationItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const FETCH_COUNT   = 24; // full pool stored in cache
const DISPLAY_COUNT = 8;  // shown at once — all 8 change every load
const CACHE_KEY     = 'radio:live:v4';
const CACHE_TTL_MS  = 6 * 60 * 60 * 1000;

export function formatViewers(count: number): string {
  if (!count) return '0';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Pick DISPLAY_COUNT items from pool that are NOT in lastShownIds.
 * If the remaining pool is smaller than DISPLAY_COUNT, reset and
 * pick from the full pool (guarantees we always get 8).
 */
function pickFresh(
  pool: LiveStationItem[],
  lastShownIds: Set<string>
): LiveStationItem[] {
  const fresh = pool.filter(s => !lastShownIds.has(s.id));

  if (fresh.length >= DISPLAY_COUNT) {
    // Enough unseen items — shuffle and take 8
    return shuffleArray(fresh).slice(0, DISPLAY_COUNT);
  }

  // Pool exhausted — reset and pick from full shuffled pool
  return shuffleArray(pool).slice(0, DISPLAY_COUNT);
}

async function fetchLiveStations(): Promise<LiveStationItem[]> {
  const { data, error } = await supabase
    .from('radio_stations')
    .select('id, name, stream_url, logo_url, language, listener_count, metadata')
    .eq('is_active', true)
    .not('stream_url', 'is', null)
    .order('listener_count', { ascending: false, nullsFirst: false })
    .limit(FETCH_COUNT);

  if (error) throw new Error(`Failed to fetch radio stations: ${error.message}`);
  if (!data?.length) throw new Error('No radio stations available');

  return data.map(station => {
    const meta = (station.metadata ?? {}) as Record<string, any>;
    return {
      id: station.id,
      name: station.name ?? 'Unknown Station',
      streamUrl: station.stream_url ?? '',
      thumbnail: station.logo_url ?? '',
      genre: meta.tags?.split(',')[0]?.trim() ?? 'Radio',
      listeners: station.listener_count ?? 0,
      isLive: true,
    };
  });
}

export const useLiveStations = (): UseLiveStationsResult => {
  const [data, setData]       = useState<LiveStationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Track which IDs were shown last time so next load picks different ones
  const lastShownIds = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // ── Try cache first ───────────────────────────────────
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useLiveStations] Using cached pool');
        const picked = pickFresh(cached, lastShownIds.current);
        lastShownIds.current = new Set(picked.map(s => s.id));
        setData(picked);
        setLoading(false);
        return;
      }

      // ── Fetch fresh from Supabase ─────────────────────────
      console.log('🔍 [useLiveStations] Fetching from Supabase...');
      const pool = await fetchLiveStations();
      console.log(`✅ [useLiveStations] Received ${pool.length} stations`);

      await cache.set(CACHE_KEY, pool, CACHE_TTL_MS); // store full pool

      const picked = pickFresh(pool, lastShownIds.current);
      lastShownIds.current = new Set(picked.map(s => s.id));
      setData(picked);

    } catch (err: any) {
      console.error('❌ [useLiveStations] Failed:', err);
      setError(err.message || 'Failed to load radio stations');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
};