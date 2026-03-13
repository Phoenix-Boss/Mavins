/**
 * useLiveStations Hook — Supabase DB Edition
 *
 * Data flow:
 * sections (section_type = 'radio_fm')
 *   → section_items (radio_station_id)
 *     → radio_stations (name, stream_url, thumbnail, genre, listeners)
 *
 * Note: radio_stations table needs to be populated before this hook
 * returns data. The section and section_items linkage is already in place.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const MAX_ITEMS = 8;
const CACHE_KEY = 'radio:live';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────
export function formatViewers(count: number): string {
  if (!count) return '0';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────
async function fetchLiveStations(): Promise<LiveStationItem[]> {
  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .select('id')
    .eq('section_type', 'radio_fm')
    .eq('is_visible', true)
    .single();

  if (sectionError || !section) {
    throw new Error(`Radio FM section not found: ${sectionError?.message}`);
  }

  const { data: sectionItems, error: itemsError } = await supabase
    .from('section_items')
    .select('radio_station_id, display_order')
    .eq('section_id', section.id)
    .not('radio_station_id', 'is', null)
    .order('display_order', { ascending: true })
    .limit(MAX_ITEMS);

  if (itemsError) throw new Error(`Failed to fetch section items: ${itemsError.message}`);
  if (!sectionItems?.length) throw new Error('Radio FM section has no stations linked yet');

  const stationIds = sectionItems.map(si => si.radio_station_id);

  const { data: stations, error: stationsError } = await supabase
    .from('radio_stations')
    .select('*')
    .in('id', stationIds);

  if (stationsError) throw new Error(`Failed to fetch radio stations: ${stationsError.message}`);
  if (!stations?.length) throw new Error('No radio stations found — populate the radio_stations table first');

  const stationMap = new Map(stations.map(s => [s.id, s]));

  const items: LiveStationItem[] = sectionItems
    .map(si => {
      const station = stationMap.get(si.radio_station_id);
      if (!station) return null;
      return {
        id: station.id,
        name: station.name ?? 'Unknown Station',
        streamUrl: station.stream_url ?? '',
        thumbnail: station.thumbnail_url ?? station.artwork_url ?? '',
        genre: station.genre ?? '',
        listeners: station.listeners ?? station.listener_count ?? 0,
        isLive: true,
      };
    })
    .filter((item): item is LiveStationItem => item !== null);

  if (!items.length) throw new Error('Could not map any radio stations');
  return items;
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────
export const useLiveStations = (): UseLiveStationsResult => {
  const [data, setData]       = useState<LiveStationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchLiveStationsData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useLiveStations] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }
      console.log('🔍 [useLiveStations] Fetching from Supabase...');
      const stations = await fetchLiveStations();
      console.log(`✅ [useLiveStations] Received ${stations.length} stations`);
      await cache.set(CACHE_KEY, stations, CACHE_TTL_MS);
      setData(stations);
    } catch (err: any) {
      console.error('❌ [useLiveStations] Failed:', err);
      setError(err.message || 'Failed to load radio stations');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLiveStationsData(); }, [fetchLiveStationsData]);

  return { data, loading, error, refetch: fetchLiveStationsData };
};