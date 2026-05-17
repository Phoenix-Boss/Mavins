// libs/supabase/services/radio.ts

import { supabase } from '../client';
import type { RadioStation } from '../types';

export async function getRadioStationsByIds(ids: string[]): Promise<RadioStation[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('radio_stations')
    .select('*')
    .in('id', ids);
  if (error) throw new Error(`Failed to fetch radio stations: ${error.message}`);
  const map = new Map((data ?? []).map(r => [r.id, r]));
  return ids.map(id => map.get(id)).filter((r): r is RadioStation => r !== undefined);
}

export async function getAllRadioStations(limit = 20): Promise<RadioStation[]> {
  const { data, error } = await supabase
    .from('radio_stations')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch radio stations: ${error.message}`);
  return data ?? [];
}
