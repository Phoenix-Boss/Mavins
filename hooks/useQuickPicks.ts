// hooks/useQuickPicks.ts
import { useEffect, useState } from 'react';
import { supabase } from '@/libs/supabase';
import { useHomeStore, CampaignCard } from '@/store/home';

export function useQuickPicks() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setQuickPicks = useHomeStore((s) => s.setQuickPicks);
  const quickPicks = useHomeStore((s) => s.quickPicks);

  const fetchQuickPicks = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: supaError } = await supabase
        .from('quick_picks')
        .select('*')
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (supaError) throw supaError;

      // Map database fields to CampaignCard type
      const cards: CampaignCard[] = (data || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        description: item.description || '',
        thumbnail: item.thumbnail || '',
        promoted: item.promoted || false,
        mavinSpecial: item.mavin_special || false,
        playCount: item.play_count || 0,
        ctaUrl: item.cta_url || undefined,
        songId: item.song_id || undefined,
      }));

      setQuickPicks(cards);
      console.log(`📊 [useQuickPicks] Fetched ${cards.length} quick picks`);
    } catch (err: any) {
      console.error('[useQuickPicks] Error fetching quick picks:', err);
      setError(err.message || 'Failed to fetch quick picks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuickPicks();
  }, []);

  return { quickPicks, loading, error, refetch: fetchQuickPicks };
}