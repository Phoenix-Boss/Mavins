// hooks/useQuickPicks.ts
import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '@/libs/supabase';
import { useHomeStore, CampaignCard } from '@/store/home';
import MavinEngine from '@/modules/mavin-engine';
import AsyncStorage from '@react-native-async-storage/async-storage';
import deviceManager from '@/libs/DeviceManager';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SongRow {
  id: string;
  video_id: string;
  title: string;
  artist: string;
  youtube_title: string;
  youtube_thumbnail: string;
  youtube_view_count: number;
  youtube_like_estimate: string;
  youtube_comment_count: number;
  youtube_upload_date: string;
  duration: number;
  genre: string;
  release_year: number;
  explicit: boolean;
  verified: boolean;
  play_count: number;
  created_at: string;
  updated_at: string;
}

interface QuickPickRow {
  id: string;
  title: string;
  description?: string;
  thumbnail: string;
  song_id?: string;
  promoted: boolean;
  mavin_special: boolean;
  play_count: number;
  cta_url?: string;
  active: boolean;
  is_default: boolean;
  campaign_start_date?: string;
  campaign_end_date?: string;
  target_play_count?: number;
  daily_increment_target?: number;
  campaign_active?: boolean;
  display_priority?: number;
  artist_name?: string;
  song_title?: string;
  video_id?: string;
  rotation_weight?: number;
  campaign_phase?: number;
  total_phases?: number;
  phase_start_date?: string;
  phase_end_date?: string;
  phase_target_play_count?: number;
  original_play_count?: number;
  total_accumulated_plays?: number;
  phase_completed?: boolean;
  campaign_history?: any;
  created_at: string;
  updated_at: string;
  songs?: SongRow;
}

interface CampaignProjection {
  totalProjected: number;
  dailyProjected: number;
  hourlyProjected: number;
  aggressiveTarget: number;
  peakHourRate: number;
  offPeakHourRate: number;
  incrementIntervalMinutes: number;
  perDeviceIncrementMinutes: number;
  geography: string;
  niche: string;
  tierLevel: number;
  confidenceScore: number;
  seed: string;
  targetMin: number;
  targetMax: number;
  recommendedTarget: number;
  totalDevices: number;
  seededDevices: number;
  realDevices: number;
  allocatedDevices: number;
  activeParticipants: number;
  playsPerDevice: number;
  engagedListeners: number;
  passiveScrollers: number;
  powerUsers: number;
  occasionalListeners: number;
  sleepers: number;
  newcomers: number;
  segmentDistribution: Record<string, number>;
}

// ─── Campaign Manager ─────────────────────────────────────────────────────────

class CampaignManager {
  private static instance: CampaignManager;
  private campaignCache: Map<string, any> = new Map();
  private deviceId: string | null = null;
  private lastLayer2Values: Map<string, number> = new Map();
  private lastUpdateTimes: Map<string, number> = new Map();
  private cumulativeLayer2Values: Map<string, number> = new Map();
  private usedSeeds: Set<string> = new Set();

  static getInstance(): CampaignManager {
    if (!CampaignManager.instance) {
      CampaignManager.instance = new CampaignManager();
    }
    return CampaignManager.instance;
  }

  async getDeviceId(): Promise<string> {
    if (this.deviceId) return this.deviceId;
    
    try {
      let id = await AsyncStorage.getItem('@campaign_device_id');
      if (!id) {
        id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        await AsyncStorage.setItem('@campaign_device_id', id);
      }
      this.deviceId = id;
      return id;
    } catch {
      if (!this.deviceId) {
        this.deviceId = Math.random().toString(36).substring(2, 15);
      }
      return this.deviceId;
    }
  }

  async getDeviceRotationIndex(deviceId: string, campaignIds: string[], totalCards: number): Promise<number> {
    if (campaignIds.length === 0) return 0;
    const hash = this.hashString(deviceId + campaignIds.join(''));
    return hash % totalCards;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  // ─── Randomization helpers ──────────────────────────────────────────────

  private generateUniqueSeed(cardId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    const seed = `${cardId}_${timestamp}_${random}`;
    this.usedSeeds.add(seed);
    return seed;
  }

  private getRandomInRange(min: number, max: number, seed: string): number {
    const hash = this.hashString(seed + 'range');
    const normalized = (hash % 10000) / 10000;
    return min + (normalized * (max - min));
  }

  private getRandomInt(min: number, max: number, seed: string): number {
    return Math.round(this.getRandomInRange(min, max, seed));
  }

  private pickRandom<T>(items: T[], seed: string): T {
    const index = this.getRandomInt(0, items.length - 1, seed);
    return items[index];
  }

  private weightedRandom(weights: number[], seed: string): number {
    const total = weights.reduce((a, b) => a + b, 0);
    const random = this.getRandomInRange(0, total, seed + 'weighted');
    let cumulative = 0;
    for (let i = 0; i < weights.length; i++) {
      cumulative += weights[i];
      if (random < cumulative) return i;
    }
    return weights.length - 1;
  }

  private shuffleArray<T>(array: T[], seed: string): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = this.getRandomInt(0, i, seed + 'shuffle_' + i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // ─── Campaign status checks (FIXED) ──────────────────────────────────────

  isCampaignActive(card: QuickPickRow): boolean {
    if (!card.campaign_active) return false;
    if (card.is_default) return false;
    if (card.phase_completed) return false;
    
    const now = new Date();
    
    // First check phase dates (if they exist)
    const phaseStartDate = card.phase_start_date ? new Date(card.phase_start_date) : null;
    const phaseEndDate = card.phase_end_date ? new Date(card.phase_end_date) : null;
    
    // If phase dates exist, use them
    if (phaseStartDate && phaseEndDate) {
      if (now < phaseStartDate) return false;
      if (now > phaseEndDate) return false;
      return true;
    }
    
    // Fallback: check campaign dates (if phase dates don't exist)
    const campaignStartDate = card.campaign_start_date ? new Date(card.campaign_start_date) : null;
    const campaignEndDate = card.campaign_end_date ? new Date(card.campaign_end_date) : null;
    
    if (campaignStartDate && campaignEndDate) {
      if (now < campaignStartDate) return false;
      if (now > campaignEndDate) return false;
      return true;
    }
    
    // If no dates are set, consider it active
    return true;
  }

  hasActiveCampaigns(cards: QuickPickRow[]): boolean {
    return cards.some(card => this.isCampaignActive(card));
  }

  getActiveCampaigns(cards: QuickPickRow[]): QuickPickRow[] {
    return cards.filter(card => this.isCampaignActive(card));
  }

  getDefaultCard(cards: QuickPickRow[]): QuickPickRow | null {
    return cards.find(card => card.is_default === true) || null;
  }

  // ─── Time calculations (FIXED) ──────────────────────────────────────────

  getPhaseElapsedSeconds(card: QuickPickRow): number {
    // Check phase_start_date first
    if (card.phase_start_date) {
      const startDate = new Date(card.phase_start_date);
      const now = new Date();
      const diffTime = now.getTime() - startDate.getTime();
      return Math.max(0, Math.ceil(diffTime / 1000));
    }
    
    // Fallback: use campaign_start_date
    if (card.campaign_start_date) {
      const startDate = new Date(card.campaign_start_date);
      const now = new Date();
      const diffTime = now.getTime() - startDate.getTime();
      return Math.max(0, Math.ceil(diffTime / 1000));
    }
    
    return 0;
  }

  getPhaseTotalDurationSeconds(card: QuickPickRow): number {
    // Check phase dates first
    if (card.phase_start_date && card.phase_end_date) {
      const startDate = new Date(card.phase_start_date);
      const endDate = new Date(card.phase_end_date);
      const diffTime = endDate.getTime() - startDate.getTime();
      return Math.max(1, Math.ceil(diffTime / 1000));
    }
    
    // Fallback: use campaign dates
    if (card.campaign_start_date && card.campaign_end_date) {
      const startDate = new Date(card.campaign_start_date);
      const endDate = new Date(card.campaign_end_date);
      const diffTime = endDate.getTime() - startDate.getTime();
      return Math.max(1, Math.ceil(diffTime / 1000));
    }
    
    // If no dates, use default (5 days)
    return 5 * 24 * 60 * 60;
  }

  getPhaseSecondsRemaining(card: QuickPickRow): number {
    // Check phase_end_date first
    if (card.phase_end_date) {
      const endDate = new Date(card.phase_end_date);
      const now = new Date();
      const diffTime = endDate.getTime() - now.getTime();
      return Math.max(0, Math.ceil(diffTime / 1000));
    }
    
    // Fallback: use campaign_end_date
    if (card.campaign_end_date) {
      const endDate = new Date(card.campaign_end_date);
      const now = new Date();
      const diffTime = endDate.getTime() - now.getTime();
      return Math.max(0, Math.ceil(diffTime / 1000));
    }
    
    return 0;
  }

  getPhaseDaysRemaining(card: QuickPickRow): number {
    const seconds = this.getPhaseSecondsRemaining(card);
    return Math.max(0, Math.ceil(seconds / (60 * 60 * 24)));
  }

  getPhaseProgressPercentage(card: QuickPickRow): number {
    const target = card.phase_target_play_count || 0;
    if (target === 0) return 0;
    const progress = ((card.total_accumulated_plays || 0) / target) * 100;
    return Math.min(100, Math.round(progress));
  }

  // ─── DYNAMIC TARGET FETCH ───────────────────────────────────────────────

  async getDynamicTarget(
    totalMinutes: number,
    tierId: string
  ): Promise<{
    targetMin: number;
    targetMax: number;
    industryStandardMultiplier: number;
    aggressiveMultiplier: number;
    recommendedTarget: number;
    aggressiveTarget: number;
  } | null> {
    try {
      const { data, error } = await supabase
        .from('campaign_targets')
        .select('*')
        .eq('tier_id', tierId)
        .eq('is_active', true)
        .lte('duration_range_minutes_min', totalMinutes)
        .gte('duration_range_minutes_max', totalMinutes)
        .maybeSingle();

      if (error || !data) {
        console.error('Failed to get dynamic target:', error);
        return null;
      }

      const targetMin = data.target_play_count_min;
      const targetMax = data.target_play_count_max;
      const industryStandardMultiplier = data.industry_standard_multiplier || 1.0;
      const aggressiveMultiplier = data.recommended_aggressive_multiplier || 3.0;

      const recommendedTarget = Math.round((targetMin + targetMax) / 2);
      const aggressiveTarget = Math.round(recommendedTarget * aggressiveMultiplier);

      console.log(`📊 [CampaignManager] Dynamic target for ${totalMinutes} minutes:`);
      console.log(`   Range: ${targetMin} - ${targetMax}`);
      console.log(`   Recommended: ${recommendedTarget}`);
      console.log(`   Aggressive (${aggressiveMultiplier}x): ${aggressiveTarget}`);

      return {
        targetMin,
        targetMax,
        industryStandardMultiplier,
        aggressiveMultiplier,
        recommendedTarget,
        aggressiveTarget,
      };
    } catch (err) {
      console.error('Failed to get dynamic target:', err);
      return null;
    }
  }

  // ─── Gradual increment logic (PERSISTENT) ────────────────────────────────

  calculateGradualIncrement(card: QuickPickRow): number {
    const elapsedSeconds = this.getPhaseElapsedSeconds(card);
    const totalSeconds = this.getPhaseTotalDurationSeconds(card);
    const target = card.phase_target_play_count || 0;

    if (totalSeconds === 0 || target === 0) return 0;
    if (elapsedSeconds === 0) return 0;

    const lastValue = this.lastLayer2Values.get(card.id) || 0;
    const progress = Math.min(elapsedSeconds / totalSeconds, 1);
    const totalExpected = progress * target;

    const rawIncremental = totalExpected - lastValue;
    let incremental = Math.round(rawIncremental);

    const secondsSinceLastUpdate = this.getSecondsSinceLastUpdate(card.id);
    const maxIncrementPerSecond = Math.max(1, Math.ceil(target / totalSeconds));
    const maxAllowedIncrement = Math.max(1, Math.round(secondsSinceLastUpdate * maxIncrementPerSecond));

    if (incremental > maxAllowedIncrement) {
      incremental = maxAllowedIncrement;
    }

    if (incremental === 0 && totalExpected - lastValue > 0.5) {
      incremental = 1;
    }

    this.lastLayer2Values.set(card.id, totalExpected);
    this.lastUpdateTimes.set(card.id, Date.now());

    const currentCumulative = this.cumulativeLayer2Values.get(card.id) || 0;
    const newCumulative = currentCumulative + incremental;
    this.cumulativeLayer2Values.set(card.id, newCumulative);

    console.log(`📊 [CampaignManager] Increment: +${incremental} (cumulative: ${newCumulative}, expected: ${totalExpected.toFixed(2)})`);

    return incremental;
  }

  private getSecondsSinceLastUpdate(cardId: string): number {
    const lastTime = this.lastUpdateTimes.get(cardId) || Date.now();
    const diff = (Date.now() - lastTime) / 1000;
    return Math.max(0.1, diff);
  }

  getCumulativeLayer2(card: QuickPickRow): number {
    return this.cumulativeLayer2Values.get(card.id) || 0;
  }

  resetTracking(cardId: string): void {
    this.lastLayer2Values.delete(cardId);
    this.lastUpdateTimes.delete(cardId);
    this.cumulativeLayer2Values.delete(cardId);
  }

  // ─── DYNAMIC RANDOMIZED CAMPAIGN PROJECTION ─────────────────────────────

  async calculateDynamicCampaignProjection(
    card: QuickPickRow
  ): Promise<CampaignProjection | null> {
    try {
      const totalSeconds = this.getPhaseTotalDurationSeconds(card);
      const totalMinutes = totalSeconds / 60;
      
      const seed = this.generateUniqueSeed(card.id);
      
      const [tiersData, geographiesData, nichesData, engagementData] = await Promise.all([
        supabase.from('campaign_performance_tiers').select('*').order('tier_level'),
        supabase.from('campaign_geography_performance').select('*'),
        supabase.from('campaign_niche_performance').select('*'),
        supabase.from('campaign_engagement_rates').select('*'),
      ]);

      if (tiersData.error || geographiesData.error || nichesData.error || engagementData.error) {
        console.error('Failed to fetch campaign data');
        return null;
      }

      const tiers = tiersData.data || [];
      const geographies = geographiesData.data || [];
      const niches = nichesData.data || [];
      const engagements = engagementData.data || [];

      if (tiers.length === 0 || geographies.length === 0 || niches.length === 0) {
        console.error('No seeded data available');
        return null;
      }

      const tierWeights = [1, 2, 4, 2];
      const tierIndex = this.weightedRandom(tierWeights, seed + '_tier');
      const selectedTier = tiers[tierIndex];
      const tierLevel = selectedTier.tier_level;

      const dynamicTarget = await this.getDynamicTarget(totalMinutes, selectedTier.id);

      if (!dynamicTarget) {
        console.error('Failed to get dynamic target, using fallback');
        return null;
      }

      // ─── DEVICE POOL (3,000+ USERS) ─────────────────────────────────────
      const devicePool = await deviceManager.getDevicePool(card.id);
      
      const totalDevices = devicePool.totalDevices || 3000;
      const seededDevices = devicePool.seededDevices || 0;
      const realDevices = devicePool.realDevices || 0;
      
      const engagedListeners = devicePool.onlineActive || 0;
      const passiveScrollers = devicePool.onlinePassive || 0;
      const powerUsers = devicePool.offlineActive || 0;
      const occasionalListeners = devicePool.offlinePassive || 0;
      const sleepers = devicePool.dormant || 0;
      const newcomers = devicePool.newDevices || 0;
      const segmentDistribution = devicePool.segments || {};

      console.log(`📱 [CampaignManager] Device Pool:`);
      console.log(`   Total Devices: ${totalDevices}`);
      console.log(`   Seeded Devices: ${seededDevices}`);
      console.log(`   Real Devices: ${realDevices}`);
      console.log(`   🔥 Engaged Listeners: ${engagedListeners}`);
      console.log(`   👀 Passive Scrollers: ${passiveScrollers}`);
      console.log(`   📱 Power Users: ${powerUsers}`);
      console.log(`   💤 Occasional Listeners: ${occasionalListeners}`);
      console.log(`   🌙 Sleepers: ${sleepers}`);
      console.log(`   🌟 Newcomers: ${newcomers}`);

      // ─── CALCULATE CAMPAIGN FACTOR ──────────────────────────────────────
      const durationFactor = Math.min(1, totalMinutes / 1440);
      const tierMultiplier = selectedTier.base_multiplier || 1.0;
      const geographyMultiplier = 1.0;
      
      const campaignFactor = Math.min(1, durationFactor * (tierMultiplier / 3) * geographyMultiplier);
      
      const allocatedDevices = Math.round(totalDevices * campaignFactor);
      const activeParticipants = Math.max(1, Math.round(allocatedDevices / 2));
      
      const aggressiveTarget = dynamicTarget.aggressiveTarget;
      const playsPerDevice = Math.round((aggressiveTarget / activeParticipants) * 10) / 10;

      console.log(`📊 [CampaignManager] Campaign Allocation:`);
      console.log(`   Campaign Factor: ${campaignFactor.toFixed(4)}`);
      console.log(`   Allocated Devices: ${allocatedDevices}`);
      console.log(`   Active Participants: ${activeParticipants}`);
      console.log(`   Plays Per Device: ${playsPerDevice}`);

      const tierGeographies = geographies.filter(g => g.tier_id === selectedTier.id);
      const tierNiches = niches.filter(n => n.tier_id === selectedTier.id);
      const tierEngagements = engagements.filter(e => e.tier_id === selectedTier.id);

      if (tierGeographies.length === 0 || tierNiches.length === 0) {
        console.error('No data for selected tier');
        return null;
      }

      const shuffledGeos = this.shuffleArray(tierGeographies, seed + '_geo');
      const selectedGeo = shuffledGeos[0];

      const shuffledNiches = this.shuffleArray(tierNiches, seed + '_niche');
      const selectedNiche = shuffledNiches[0];

      const geoEngagement = tierEngagements.find(e => e.geography === selectedGeo.geography);

      const confidenceMultiplier = this.getRandomInRange(0.7, 1.3, seed + '_conf');
      const organicMultiplier = this.getRandomInRange(0.85, 1.15, seed + '_org');
      const viralMultiplier = this.getRandomInRange(0.9, 1.1, seed + '_viral');

      const totalHours = totalSeconds / 3600;
      const totalDays = totalHours / 24;

      const targetPlays = Math.max(10, aggressiveTarget);
      const incrementInterval = totalMinutes / targetPlays;
      const perDeviceInterval = incrementInterval * activeParticipants;

      const baseDailyPlays = (selectedGeo.daily_plays_per_1000_followers / 1000) * 10000 * organicMultiplier;
      const nicheMultiplier = (selectedNiche.avg_daily_plays_per_1000_followers / 6.6) * viralMultiplier;
      const baseHourlyPlays = (baseDailyPlays / 24) * nicheMultiplier * selectedTier.base_multiplier;

      let peakMultiplier = 1.5;
      let offPeakMultiplier = 0.5;
      let peakHoursPerDay = 4;
      let weekendMultiplier = 1.2;
      let weekdayMultiplier = 0.9;

      if (geoEngagement) {
        peakMultiplier = geoEngagement.peak_multiplier * this.getRandomInRange(0.9, 1.1, seed + '_peak');
        offPeakMultiplier = geoEngagement.off_peak_multiplier * this.getRandomInRange(0.9, 1.1, seed + '_offpeak');
        peakHoursPerDay = (geoEngagement.peak_hour_end - geoEngagement.peak_hour_start + 1) || 4;
        weekendMultiplier = (geoEngagement.weekend_multiplier || 1.2) * this.getRandomInRange(0.95, 1.05, seed + '_weekend');
        weekdayMultiplier = (geoEngagement.weekday_multiplier || 0.9) * this.getRandomInRange(0.95, 1.05, seed + '_weekday');
      }

      const offPeakHoursPerDay = 24 - peakHoursPerDay;
      const peakHourRate = baseHourlyPlays * peakMultiplier;
      const offPeakHourRate = baseHourlyPlays * offPeakMultiplier;

      const totalPeakHours = peakHoursPerDay * totalDays;
      const totalOffPeakHours = offPeakHoursPerDay * totalDays;

      let totalProjected = Math.round(
        (peakHourRate * totalPeakHours) + 
        (offPeakHourRate * totalOffPeakHours)
      );

      const weekends = Math.floor(totalDays / 7);
      const weekdays = totalDays - weekends;

      const weekendPlays = (totalProjected / totalDays) * weekends * weekendMultiplier;
      const weekdayPlays = (totalProjected / totalDays) * weekdays * weekdayMultiplier;

      totalProjected = Math.round(weekendPlays + weekdayPlays);
      totalProjected = Math.max(10, Math.round(totalProjected * confidenceMultiplier));

      const dailyProjected = Math.round(totalProjected / totalDays);
      const hourlyProjected = Math.round(totalProjected / totalHours);

      const confidenceScore = Math.round(
        this.getRandomInRange(65, 95, seed + '_confidence')
      );

      const projection: CampaignProjection = {
        totalProjected,
        dailyProjected,
        hourlyProjected,
        aggressiveTarget,
        peakHourRate: Math.round(peakHourRate),
        offPeakHourRate: Math.round(offPeakHourRate),
        incrementIntervalMinutes: incrementInterval,
        perDeviceIncrementMinutes: perDeviceInterval,
        geography: selectedGeo.geography,
        niche: selectedNiche.niche_name,
        tierLevel: tierLevel,
        confidenceScore,
        seed: seed,
        targetMin: dynamicTarget.targetMin,
        targetMax: dynamicTarget.targetMax,
        recommendedTarget: dynamicTarget.recommendedTarget,
        totalDevices: totalDevices,
        seededDevices: seededDevices,
        realDevices: realDevices,
        allocatedDevices: allocatedDevices,
        activeParticipants: activeParticipants,
        playsPerDevice: playsPerDevice,
        engagedListeners: engagedListeners,
        passiveScrollers: passiveScrollers,
        powerUsers: powerUsers,
        occasionalListeners: occasionalListeners,
        sleepers: sleepers,
        newcomers: newcomers,
        segmentDistribution: segmentDistribution,
      };

      console.log(`🎲 [CampaignManager] Dynamic projection for ${card.id}:`);
      console.log(`   ⏰ Campaign Duration: ${totalMinutes} minutes (${totalSeconds} seconds)`);
      console.log(`   📊 Target Range: ${dynamicTarget.targetMin} - ${dynamicTarget.targetMax}`);
      console.log(`   🎯 Recommended Target: ${dynamicTarget.recommendedTarget}`);
      console.log(`   🚀 Aggressive Target: ${dynamicTarget.aggressiveTarget}`);
      console.log(`   📱 Total Devices: ${totalDevices} (Seeded: ${seededDevices}, Real: ${realDevices})`);
      console.log(`   📊 Allocated Devices: ${allocatedDevices}`);
      console.log(`   👥 Active Participants: ${activeParticipants}`);
      console.log(`   📈 Plays Per Device: ${playsPerDevice}`);
      console.log(`   ⏱️ Increment interval: ${incrementInterval.toFixed(4)} min`);
      console.log(`   Seed: ${seed}`);
      console.log(`   Tier: ${tierLevel} (${selectedTier.tier_name})`);
      console.log(`   Geography: ${selectedGeo.geography}`);
      console.log(`   Niche: ${selectedNiche.niche_name}`);
      console.log(`   Confidence: ${confidenceScore}%`);

      await this.storeProjection(card.id, projection, selectedTier.id);

      return projection;
    } catch (err) {
      console.error('Failed to calculate dynamic projection:', err);
      return null;
    }
  }

  async storeProjection(cardId: string, projection: CampaignProjection, tierId: string): Promise<void> {
    try {
      const { data: timeframe } = await supabase
        .from('campaign_timeframes')
        .select('id')
        .eq('timeframe_type', 'day')
        .limit(1)
        .maybeSingle();

      if (!timeframe) return;

      await supabase
        .from('campaign_projections')
        .insert({
          quick_pick_id: cardId,
          tier_id: tierId,
          timeframe_id: timeframe.id,
          geography: projection.geography,
          niche: projection.niche,
          follower_count: 10000,
          total_projected_plays: projection.totalProjected,
          daily_projected_plays: projection.dailyProjected,
          hourly_projected_plays: projection.hourlyProjected,
          peak_hour_projected_plays: projection.peakHourRate,
          off_peak_hour_projected_plays: projection.offPeakHourRate,
          weekend_projected_plays: Math.round(projection.dailyProjected * 1.2 * 2),
          weekday_projected_plays: Math.round(projection.dailyProjected * 0.9 * 5),
          aggressive_projected_plays: projection.aggressiveTarget,
        });
    } catch (err) {
      console.error('Failed to store projection:', err);
    }
  }

  // ─── Phase management ─────────────────────────────────────────────────────

  async checkAndAdvancePhase(card: QuickPickRow): Promise<boolean> {
    if (!card.campaign_active) return false;
    if (card.is_default) return false;
    if (card.phase_completed) return false;

    const secondsRemaining = this.getPhaseSecondsRemaining(card);
    const target = card.phase_target_play_count || 0;
    const accumulated = card.total_accumulated_plays || 0;

    const phaseComplete = secondsRemaining <= 0 || (target > 0 && accumulated >= target);

    if (!phaseComplete) return false;

    const currentPhase = card.campaign_phase || 1;
    const totalPhases = card.total_phases || 1;

    if (currentPhase >= totalPhases) {
      await this.markCampaignComplete(card.id);
      return true;
    }

    const nextPhase = currentPhase + 1;
    const durationSeconds = card.campaign_end_date && card.campaign_start_date
      ? Math.ceil((new Date(card.campaign_end_date).getTime() - new Date(card.campaign_start_date).getTime()) / 1000)
      : 86400;

    const phaseDuration = Math.ceil(durationSeconds / totalPhases);
    const nextPhaseStart = new Date();
    const nextPhaseEnd = new Date(nextPhaseStart.getTime() + (phaseDuration * 1000));

    const history = card.campaign_history || [];
    const historyEntry = {
      phase: currentPhase,
      startDate: card.phase_start_date,
      endDate: card.phase_end_date,
      target: card.phase_target_play_count,
      accumulated: accumulated,
      completedAt: new Date().toISOString(),
    };
    history.push(historyEntry);

    const { error } = await supabase
      .from('quick_picks')
      .update({
        campaign_phase: nextPhase,
        phase_start_date: nextPhaseStart.toISOString(),
        phase_end_date: nextPhaseEnd.toISOString(),
        phase_target_play_count: target,
        total_accumulated_plays: accumulated,
        phase_completed: false,
        campaign_history: history,
        updated_at: new Date().toISOString(),
      })
      .eq('id', card.id);

    if (error) {
      console.error('[CampaignManager] Failed to advance phase:', error);
      return false;
    }

    this.resetTracking(card.id);
    return true;
  }

  async markCampaignComplete(cardId: string): Promise<void> {
    const { error } = await supabase
      .from('quick_picks')
      .update({
        phase_completed: true,
        campaign_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cardId);

    if (error) {
      console.error('[CampaignManager] Failed to mark campaign complete:', error);
    }
  }

  // ─── Display helpers ─────────────────────────────────────────────────────

  getPhaseCountdownText(card: QuickPickRow): string {
    const seconds = this.getPhaseSecondsRemaining(card);
    if (seconds <= 0) return 'Phase Ended';
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  getPhaseStatus(card: QuickPickRow): { text: string; color: string } {
    if (card.is_default) {
      return { text: '⭐ Default', color: '#666' };
    }

    if (card.phase_completed) {
      return { text: '✅ Campaign Complete', color: '#4CAF50' };
    }

    const daysRemaining = this.getPhaseDaysRemaining(card);
    const progress = this.getPhaseProgressPercentage(card);

    if (daysRemaining <= 0) {
      return { text: '⏳ Phase Ended', color: '#666' };
    }

    if (progress >= 100) {
      return { text: '✅ Phase Target Reached', color: '#4CAF50' };
    }

    if (daysRemaining <= 1) {
      return { text: '🔥 Phase Ending Soon', color: '#FF5722' };
    }

    if (daysRemaining <= 3) {
      return { text: '⚡ Last Chance', color: '#FF9800' };
    }

    return { text: `📅 Phase ${card.campaign_phase || 1} - ${daysRemaining}d left`, color: '#2196F3' };
  }
}

// ─── Helper: Clean and truncate title ──────────────────────────────────────

function truncateSongTitle(title: string, maxLength: number = 30): string {
  if (!title) return '';
  
  let cleaned = title
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F700}-\u{1F77F}]/gu, '')
    .replace(/[\u{1F780}-\u{1F7FF}]/gu, '')
    .replace(/[\u{1F800}-\u{1F8FF}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2702}-\u{27B0}]/gu, '')
    .replace(/[\u{24C2}-\u{1F251}]/gu, '')
    .trim();
  
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.replace(/[^a-zA-Z0-9\s\-'"]+$/, '');
  
  if (cleaned.length <= maxLength) return cleaned;
  
  const truncated = cleaned.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  
  if (lastSpace > 0) {
    return truncated.substring(0, lastSpace) + '...';
  }
  
  return truncated + '...';
}

// ─── Engine enrichment with retry ──────────────────────────────────────────────

async function enrichFromEngineWithRetry(
  videoId: string,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<{
  songTitle: string;
  artistName: string;
  viewCount: number;
  thumbnail: string;
  duration: number;
  uploadDate: string;
  likeCount: number;
  commentCount: number;
  uploaderUrl: string;
} | null> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const info = await MavinEngine.getStreamInfoById(videoId);

      if (!info || !info.success) {
        const errorMsg = info?.error || info?.message || 'Unknown error';
        console.warn(`[useQuickPicks] Engine returned failure for videoId=${videoId} (attempt ${attempt}):`, errorMsg);
        lastError = new Error(errorMsg);
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        continue;
      }

      const bestThumb =
        info.thumbnails
          ?.slice()
          .sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || '';

      return {
        songTitle:    info.title || '',
        artistName:   info.uploaderName || '',
        viewCount:    info.viewCount || 0,
        thumbnail:    bestThumb,
        duration:     info.duration || 0,
        uploadDate:   info.uploadDate || '',
        likeCount:    info.likeCount || 0,
        commentCount: 0,
        uploaderUrl:  info.uploaderUrl || '',
      };
    } catch (err) {
      const error = err as Error;
      console.error(`[useQuickPicks] Engine fetch failed for videoId=${videoId} (attempt ${attempt}):`, error.message);
      lastError = error;
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  console.error(`[useQuickPicks] All ${maxRetries} attempts failed for videoId=${videoId}:`, lastError?.message);
  return null;
}

// ─── Create or update song in database ──────────────────────────────────────

async function upsertSongFromEngine(
  videoId: string,
  engineData: NonNullable<Awaited<ReturnType<typeof enrichFromEngineWithRetry>>>
): Promise<string | null> {
  try {
    const { data: existingSong, error: checkError } = await supabase
      .from('songs')
      .select('id, youtube_view_count, duration')
      .eq('video_id', videoId)
      .maybeSingle();

    if (checkError) {
      console.error(`[useQuickPicks] Error checking existing song for ${videoId}:`, checkError);
      return null;
    }

    const duration = Math.max(engineData.duration, 30);
    const viewCount = engineData.viewCount || 0;
    
    const songData = {
      title: engineData.songTitle,
      artist: engineData.artistName,
      youtube_title: engineData.songTitle,
      youtube_thumbnail: engineData.thumbnail,
      youtube_view_count: viewCount,
      duration: duration,
      video_id: videoId,
      artwork_thumbnail: engineData.thumbnail,
      youtube_upload_date: engineData.uploadDate || null,
      youtube_like_estimate: engineData.likeCount > 0 ? String(engineData.likeCount) : null,
      youtube_comment_count: engineData.commentCount > 0 ? engineData.commentCount : null,
      genre: 'Pop',
      language: 'English',
      explicit: false,
      verified: false,
      updated_at: new Date().toISOString(),
    };

    let songId: string;

    if (existingSong) {
      const { data, error } = await supabase
        .from('songs')
        .update(songData)
        .eq('video_id', videoId)
        .select('id')
        .maybeSingle();

      if (error || !data) {
        console.error(`[useQuickPicks] Error updating song ${videoId}:`, error);
        return null;
      }

      songId = data.id;
    } else {
      const { data, error } = await supabase
        .from('songs')
        .insert({
          ...songData,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .maybeSingle();

      if (error || !data) {
        console.error(`[useQuickPicks] Error inserting song ${videoId}:`, error);
        return null;
      }

      songId = data.id;
    }

    return songId;
  } catch (err) {
    console.error(`[useQuickPicks] Upsert failed for ${videoId}:`, err);
    return null;
  }
}

// ─── Seed or add view count to play count (Layer 1) with phase accumulation ───

async function seedOrAddPlayCountFromSongsTable(
  cardId: string, 
  songId: string,
  hasSeededMap: Map<string, boolean>
): Promise<number> {
  try {
    console.log(`🌱 [useQuickPicks] Checking play count for card ${cardId} from song ${songId}`);
    
    // 1. Get current play_count and accumulated plays from database
    const { data: quickPick, error: qpError } = await supabase
      .from('quick_picks')
      .select('play_count, total_accumulated_plays, original_play_count, campaign_phase, campaign_history')
      .eq('id', cardId)
      .maybeSingle();

    if (qpError) {
      console.error(`[useQuickPicks] Error fetching quick_pick ${cardId}:`, qpError);
      return 0;
    }

    if (!quickPick) {
      console.warn(`[useQuickPicks] Quick_pick ${cardId} not found`);
      return 0;
    }

    const currentPlayCount = quickPick.play_count || 0;
    const totalAccumulated = quickPick.total_accumulated_plays || 0;
    const currentPhase = quickPick.campaign_phase || 1;
    const campaignHistory = quickPick.campaign_history || [];
    
    console.log(`📊 [useQuickPicks] Current play_count: ${currentPlayCount}`);
    console.log(`📊 [useQuickPicks] Total accumulated: ${totalAccumulated}`);
    console.log(`📊 [useQuickPicks] Current phase: ${currentPhase}`);

    // 2. Get YouTube view count from songs table
    const { data: song, error: songError } = await supabase
      .from('songs')
      .select('youtube_view_count')
      .eq('id', songId)
      .maybeSingle();

    if (songError) {
      console.error(`[useQuickPicks] Error fetching song ${songId}:`, songError);
      return currentPlayCount;
    }

    if (!song) {
      console.warn(`[useQuickPicks] Song ${songId} not found`);
      return currentPlayCount;
    }

    const viewCount = song.youtube_view_count || 0;
    console.log(`📊 [useQuickPicks] YouTube view count: ${viewCount}`);

    if (viewCount === 0) {
      console.log(`⚠️ [useQuickPicks] View count is 0, keeping current: ${currentPlayCount}`);
      hasSeededMap.set(cardId, true);
      return currentPlayCount;
    }

    // ─── PHASE ACCUMULATION LOGIC ──────────────────────────────────────────

    // CASE 1: First time ever (play_count = 0)
    if (currentPlayCount === 0) {
      console.log(`📊 [useQuickPicks] First time seeding, setting play_count to ${viewCount}`);
      
      const { error } = await supabase
        .from('quick_picks')
        .update({
          play_count: viewCount,
          original_play_count: viewCount,
          total_accumulated_plays: viewCount,
          updated_at: new Date().toISOString()
        })
        .eq('id', cardId);

      if (error) {
        console.error(`[useQuickPicks] Error seeding play_count for ${cardId}:`, error);
        return currentPlayCount;
      }

      hasSeededMap.set(cardId, true);
      console.log(`✅ [useQuickPicks] Seeded card ${cardId} play_count to ${viewCount}`);
      return viewCount;
    }

    // CASE 2: Phase 2+ (accumulate previous phase data)
    // Check if we're in a new phase (phase > 1) and need to add view count to accumulated
    if (currentPhase > 1) {
      console.log(`📊 [useQuickPicks] Phase ${currentPhase} - checking for accumulation`);
      
      // Check if this phase has already been seeded
      const phaseSeeded = hasSeededMap.get(`${cardId}_phase_${currentPhase}`) || false;
      
      if (!phaseSeeded) {
        // Get total from previous phases
        const previousTotal = totalAccumulated || currentPlayCount;
        const newTotal = previousTotal + viewCount;
        
        console.log(`📊 [useQuickPicks] Phase ${currentPhase} seeding: ${previousTotal} + ${viewCount} = ${newTotal}`);
        
        const { error } = await supabase
          .from('quick_picks')
          .update({
            play_count: newTotal,
            total_accumulated_plays: newTotal,
            updated_at: new Date().toISOString()
          })
          .eq('id', cardId);

        if (error) {
          console.error(`[useQuickPicks] Error updating play_count for ${cardId}:`, error);
          return currentPlayCount;
        }

        hasSeededMap.set(`${cardId}_phase_${currentPhase}`, true);
        console.log(`✅ [useQuickPicks] Phase ${currentPhase} accumulated: ${newTotal} (${previousTotal} + ${viewCount})`);
        return newTotal;
      } else {
        console.log(`✅ [useQuickPicks] Phase ${currentPhase} already seeded, keeping: ${currentPlayCount}`);
        return currentPlayCount;
      }
    }

    // CASE 3: Phase 1 - normal seeding
    if (currentPlayCount < viewCount) {
      const newCount = currentPlayCount + viewCount;
      console.log(`📊 [useQuickPicks] Adding view count (${viewCount}) to current (${currentPlayCount}) = ${newCount}`);
      
      const { error } = await supabase
        .from('quick_picks')
        .update({
          play_count: newCount,
          total_accumulated_plays: newCount,
          updated_at: new Date().toISOString()
        })
        .eq('id', cardId);

      if (error) {
        console.error(`[useQuickPicks] Error updating play_count for ${cardId}:`, error);
        return currentPlayCount;
      }

      hasSeededMap.set(cardId, true);
      console.log(`✅ [useQuickPicks] Updated card ${cardId} play_count to ${newCount}`);
      return newCount;
    }

    // CASE 4: play_count >= viewCount - keep current
    console.log(`✅ [useQuickPicks] Keeping current: ${currentPlayCount}`);
    hasSeededMap.set(cardId, true);
    return currentPlayCount;
  } catch (err) {
    console.error(`[useQuickPicks] Seed/add failed for ${cardId}:`, err);
    return 0;
  }
}

// ─── Play count increment (foreground) ─────────────────────────────────────

async function incrementPlayCount(cardId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .rpc('increment_play_count', { card_id: cardId });

    if (error) {
      console.error(`[useQuickPicks] incrementPlayCount error:`, error);
      return null;
    }
    console.log(`📊 [useQuickPicks] incrementPlayCount returned: ${data}`);
    return typeof data === 'number' ? data : null;
  } catch (err) {
    console.error(`[useQuickPicks] incrementPlayCount failed for ${cardId}:`, err);
    return null;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useQuickPicks() {
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const setQuickPicks           = useHomeStore((s) => s.setQuickPicks);
  const quickPicks              = useHomeStore((s) => s.quickPicks);

  const cardIdsRef = useRef<string[]>([]);
  const campaignManager = CampaignManager.getInstance();
  const hasSeededMapRef = useRef<Map<string, boolean>>(new Map());

  // ── Register device on mount ──────────────────────────────────────────────

  useEffect(() => {
    const initDevice = async () => {
      try {
        const deviceId = await deviceManager.getDeviceId();
        const region = 'Global';
        await deviceManager.registerRealDevice(region);
        console.log(`📱 Device initialized: ${deviceId}`);
      } catch (err) {
        console.error('Failed to initialize device:', err);
      }
    };
    initDevice();
  }, []);

  // ── Main fetch ──────────────────────────────────────────────────────────────

  const fetchQuickPicks = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('📊 [useQuickPicks] Starting modular fetch...');

      const { data, error: supaError } = await supabase
        .from('quick_picks')
        .select(`
          id,
          title,
          description,
          thumbnail,
          song_id,
          promoted,
          mavin_special,
          play_count,
          cta_url,
          active,
          is_default,
          campaign_start_date,
          campaign_end_date,
          target_play_count,
          daily_increment_target,
          campaign_active,
          display_priority,
          artist_name,
          song_title,
          video_id,
          rotation_weight,
          campaign_phase,
          total_phases,
          phase_start_date,
          phase_end_date,
          phase_target_play_count,
          original_play_count,
          total_accumulated_plays,
          phase_completed,
          campaign_history,
          created_at,
          updated_at,
          songs!quick_picks_song_id_fkey (
            id,
            video_id,
            title,
            artist,
            youtube_title,
            youtube_thumbnail,
            youtube_view_count,
            duration,
            youtube_upload_date,
            youtube_like_estimate,
            youtube_comment_count,
            explicit,
            verified,
            created_at,
            updated_at
          )
        `)
        .eq('active', true)
        .order('is_default', { ascending: false })
        .order('display_priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (supaError) {
        console.error('[useQuickPicks] Supabase error:', supaError);
        throw supaError;
      }

      const rows = (data || []) as QuickPickRow[];
      
      // ─── Check and advance phases ──────────────────────────────────────
      for (const row of rows) {
        if (!row.is_default && row.campaign_active) {
          await campaignManager.checkAndAdvancePhase(row);
        }
      }

      // ─── Refetch after potential phase changes ───────────────────────────
      const { data: refreshedData, error: refreshError } = await supabase
        .from('quick_picks')
        .select(`
          id,
          title,
          description,
          thumbnail,
          song_id,
          promoted,
          mavin_special,
          play_count,
          cta_url,
          active,
          is_default,
          campaign_start_date,
          campaign_end_date,
          target_play_count,
          daily_increment_target,
          campaign_active,
          display_priority,
          artist_name,
          song_title,
          video_id,
          rotation_weight,
          campaign_phase,
          total_phases,
          phase_start_date,
          phase_end_date,
          phase_target_play_count,
          original_play_count,
          total_accumulated_plays,
          phase_completed,
          campaign_history,
          created_at,
          updated_at,
          songs!quick_picks_song_id_fkey (
            id,
            video_id,
            title,
            artist,
            youtube_title,
            youtube_thumbnail,
            youtube_view_count,
            duration,
            youtube_upload_date,
            youtube_like_estimate,
            youtube_comment_count,
            explicit,
            verified,
            created_at,
            updated_at
          )
        `)
        .eq('active', true)
        .order('is_default', { ascending: false })
        .order('display_priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (refreshError) {
        console.error('[useQuickPicks] Refresh error:', refreshError);
        throw refreshError;
      }

      const refreshedRows = (refreshedData || []) as QuickPickRow[];
      
      const defaultCard = campaignManager.getDefaultCard(refreshedRows);
      const activeCampaigns = campaignManager.getActiveCampaigns(refreshedRows);
      
      console.log(`📊 [useQuickPicks] Found ${activeCampaigns.length} active campaigns, default card: ${defaultCard ? 'YES' : 'NO'}`);

      let cardToShow: QuickPickRow | null = null;
      let isCampaign = false;

      if (activeCampaigns.length > 0) {
        const deviceId = await campaignManager.getDeviceId();
        const campaignIds = activeCampaigns.map(c => c.id);
        
        const rotationIndex = await campaignManager.getDeviceRotationIndex(
          deviceId, 
          campaignIds, 
          activeCampaigns.length
        );
        
        cardToShow = activeCampaigns[rotationIndex];
        isCampaign = true;
        
        console.log(`📊 [useQuickPicks] Selected campaign ${cardToShow.id} phase ${cardToShow.campaign_phase} for device ${deviceId}`);
      } else if (defaultCard) {
        cardToShow = defaultCard;
        isCampaign = false;
        console.log(`📊 [useQuickPicks] No active campaigns, showing default card`);
      } else {
        console.log(`📊 [useQuickPicks] No cards available to show`);
        setQuickPicks([]);
        setLoading(false);
        return;
      }

      console.log(`\n📊 [useQuickPicks] Processing card:`);
      console.log(`   ID: ${cardToShow.id}`);
      console.log(`   Title: ${cardToShow.title || cardToShow.song_title}`);
      console.log(`   Is Default: ${cardToShow.is_default}`);
      console.log(`   Is Campaign: ${isCampaign}`);
      
      if (isCampaign) {
        const phase = cardToShow.campaign_phase || 1;
        const totalPhases = cardToShow.total_phases || 1;
        const daysRemaining = campaignManager.getPhaseDaysRemaining(cardToShow);
        const secondsRemaining = campaignManager.getPhaseSecondsRemaining(cardToShow);
        const progress = campaignManager.getPhaseProgressPercentage(cardToShow);
        console.log(`   📅 Phase ${phase}/${totalPhases}: ${daysRemaining} days remaining (${secondsRemaining}s), ${progress}% to target`);
      } else {
        console.log(`   ⭐ Default card - always showing`);
      }

      const song = cardToShow.songs as SongRow | null;
      
      let videoId = cardToShow.video_id || song?.video_id || null;
      if (!videoId && cardToShow.thumbnail) {
        const match = cardToShow.thumbnail.match(/\/vi\/([^\/]+)\//);
        if (match) {
          videoId = match[1];
        }
      }

      if (!videoId && song) {
        videoId = song.video_id;
      }

      let engineData = null;
      let songUuid = cardToShow.song_id;

      if (videoId && !song?.youtube_view_count) {
        console.log(`🔍 [useQuickPicks] Fetching from engine for videoId: ${videoId}...`);
        engineData = await enrichFromEngineWithRetry(videoId);
        
        if (engineData) {
          const upsertedId = await upsertSongFromEngine(videoId, engineData);
          if (upsertedId) {
            songUuid = upsertedId;
            const { data: updatedSong, error: updatedSongError } = await supabase
              .from('songs')
              .select('*')
              .eq('id', upsertedId)
              .maybeSingle();
            
            if (!updatedSongError && updatedSong) {
              Object.assign(song || {}, updatedSong);
            }
          }
        }
      }

      let finalSong = song;
      let finalSongUuid = songUuid;

      if (!finalSong && engineData) {
        finalSong = {
          id: songUuid || '',
          video_id: videoId || '',
          title: engineData.songTitle || '',
          artist: engineData.artistName || '',
          youtube_title: engineData.songTitle || '',
          youtube_thumbnail: engineData.thumbnail || '',
          youtube_view_count: engineData.viewCount || 0,
          duration: Math.max(engineData.duration || 0, 30),
          youtube_upload_date: engineData.uploadDate || '',
          youtube_like_estimate: engineData.likeCount > 0 ? String(engineData.likeCount) : null,
          youtube_comment_count: engineData.commentCount || 0,
          explicit: false,
          verified: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as SongRow;
        finalSongUuid = songUuid || '';
      }

      // ─── LAYER 1: YouTube view count + foreground increments ──────────────
      let layer1PlayCount = cardToShow.play_count || 0;
      
      console.log(`📊 [useQuickPicks] BEFORE Layer 1: play_count = ${layer1PlayCount}`);
      
      if (finalSongUuid && finalSong) {
        layer1PlayCount = await seedOrAddPlayCountFromSongsTable(
          cardToShow.id, 
          finalSongUuid,
          hasSeededMapRef.current
        );
      }

      console.log(`📊 [useQuickPicks] AFTER Layer 1 seeding: play_count = ${layer1PlayCount}`);

      // ─── LAYER 2: Gradual time-based campaign increment ──────────────────
      let layer2Increment = 0;
      let cumulativeLayer2 = 0;
      let aggressiveTarget = 0;
      let projectionData = null;
      
      if (isCampaign) {
        projectionData = await campaignManager.calculateDynamicCampaignProjection(cardToShow);
        
        if (projectionData) {
          aggressiveTarget = projectionData.aggressiveTarget;
          
          await supabase
            .from('quick_picks')
            .update({
              phase_target_play_count: aggressiveTarget,
              target_play_count: aggressiveTarget,
              updated_at: new Date().toISOString(),
            })
            .eq('id', cardToShow.id);
          
          console.log(`🎯 [useQuickPicks] Aggressive target set to ${aggressiveTarget}`);
          console.log(`📊 [useQuickPicks] Target range: ${projectionData.targetMin} - ${projectionData.targetMax}`);
          console.log(`📊 [useQuickPicks] Recommended: ${projectionData.recommendedTarget}`);
          console.log(`📱 [useQuickPicks] Total Devices: ${projectionData.totalDevices}`);
          console.log(`📊 [useQuickPicks] Allocated Devices: ${projectionData.allocatedDevices}`);
          console.log(`👥 [useQuickPicks] Active Participants: ${projectionData.activeParticipants}`);
          console.log(`📈 [useQuickPicks] Plays Per Device: ${projectionData.playsPerDevice}`);
          console.log(`🔥 [useQuickPicks] Engaged Listeners: ${projectionData.engagedListeners}`);
          console.log(`👀 [useQuickPicks] Passive Scrollers: ${projectionData.passiveScrollers}`);
          console.log(`📱 [useQuickPicks] Power Users: ${projectionData.powerUsers}`);
          console.log(`💤 [useQuickPicks] Occasional Listeners: ${projectionData.occasionalListeners}`);
          console.log(`🌙 [useQuickPicks] Sleepers: ${projectionData.sleepers}`);
          console.log(`🌟 [useQuickPicks] Newcomers: ${projectionData.newcomers}`);
        }
        
        layer2Increment = campaignManager.calculateGradualIncrement(cardToShow);
        cumulativeLayer2 = campaignManager.getCumulativeLayer2(cardToShow);
        
        console.log(`📊 [useQuickPicks] Layer 2: +${layer2Increment} (cumulative: ${cumulativeLayer2})`);
      }
      
      // ─── FINAL TOTAL ──────────────────────────────────────────────────────
      const finalPlayCount = layer1PlayCount + cumulativeLayer2;

      console.log(`📊 [useQuickPicks] FINAL: Layer 1: ${layer1PlayCount}, Layer 2 cumulative: ${cumulativeLayer2}, Total: ${finalPlayCount}`);

      const rawTitle = cardToShow.song_title || finalSong?.youtube_title || finalSong?.title || cardToShow.title || '';
      const displayTitle = truncateSongTitle(rawTitle, 30);
      const artistName = cardToShow.artist_name || finalSong?.artist || '';

      const cardData = {
        id:           cardToShow.id,
        title:        cardToShow.title || '',
        description:  cardToShow.description || '',
        thumbnail:    finalSong?.youtube_thumbnail || cardToShow.thumbnail || '',
        promoted:     cardToShow.promoted || false,
        mavinSpecial: cardToShow.mavin_special || false,
        playCount:    finalPlayCount,
        ctaUrl:       cardToShow.cta_url || undefined,
        songId:       cardToShow.song_id || undefined,
        songTitle:    displayTitle,
        artistName:   artistName,
        isDefault:    cardToShow.is_default || false,
        campaign: isCampaign ? {
          phase: cardToShow.campaign_phase || 1,
          totalPhases: cardToShow.total_phases || 1,
          startDate: cardToShow.phase_start_date || undefined,
          endDate: cardToShow.phase_end_date || undefined,
          targetPlayCount: aggressiveTarget || cardToShow.phase_target_play_count || 0,
          daysRemaining: campaignManager.getPhaseDaysRemaining(cardToShow),
          secondsRemaining: campaignManager.getPhaseSecondsRemaining(cardToShow),
          progress: campaignManager.getPhaseProgressPercentage(cardToShow),
          status: campaignManager.getPhaseStatus(cardToShow),
          countdownText: campaignManager.getPhaseCountdownText(cardToShow),
          layer1: layer1PlayCount,
          layer2: cumulativeLayer2,
          layer2Increment: layer2Increment,
          totalAccumulated: cardToShow.total_accumulated_plays || 0,
          originalPlayCount: cardToShow.original_play_count || 0,
          phaseCompleted: cardToShow.phase_completed || false,
          history: cardToShow.campaign_history || [],
          projection: projectionData ? {
            totalProjected: projectionData.totalProjected,
            dailyProjected: projectionData.dailyProjected,
            hourlyProjected: projectionData.hourlyProjected,
            aggressiveTarget: projectionData.aggressiveTarget,
            peakHourRate: projectionData.peakHourRate,
            offPeakHourRate: projectionData.offPeakHourRate,
            geography: projectionData.geography,
            niche: projectionData.niche,
            tierLevel: projectionData.tierLevel,
            confidenceScore: projectionData.confidenceScore,
            incrementInterval: projectionData.incrementIntervalMinutes,
            perDeviceIncrement: projectionData.perDeviceIncrementMinutes,
            targetMin: projectionData.targetMin,
            targetMax: projectionData.targetMax,
            recommendedTarget: projectionData.recommendedTarget,
            totalDevices: projectionData.totalDevices,
            seededDevices: projectionData.seededDevices,
            realDevices: projectionData.realDevices,
            allocatedDevices: projectionData.allocatedDevices,
            activeParticipants: projectionData.activeParticipants,
            playsPerDevice: projectionData.playsPerDevice,
            engagedListeners: projectionData.engagedListeners,
            passiveScrollers: projectionData.passiveScrollers,
            powerUsers: projectionData.powerUsers,
            occasionalListeners: projectionData.occasionalListeners,
            sleepers: projectionData.sleepers,
            newcomers: projectionData.newcomers,
          } : undefined,
        } : undefined
      };

      console.log(`✅ [useQuickPicks] Final card data:`);
      console.log(`   - songTitle: ${cardData.songTitle}`);
      console.log(`   - artistName: ${cardData.artistName || '(not found)'}`);
      console.log(`   - playCount: ${cardData.playCount}`);
      console.log(`   - isDefault: ${cardData.isDefault}`);
      console.log(`   - campaign: ${cardData.campaign ? 'Active' : 'None'}`);
      if (cardData.campaign && cardData.campaign.projection) {
        console.log(`   - 🎯 Aggressive Target: ${cardData.campaign.projection.aggressiveTarget}`);
        console.log(`   - 📊 Target Range: ${cardData.campaign.projection.targetMin} - ${cardData.campaign.projection.targetMax}`);
        console.log(`   - 📈 Recommended: ${cardData.campaign.projection.recommendedTarget}`);
        console.log(`   - 📊 Confidence: ${cardData.campaign.projection.confidenceScore}%`);
        console.log(`   - 🌍 Geography: ${cardData.campaign.projection.geography}`);
        console.log(`   - 🎵 Niche: ${cardData.campaign.projection.niche}`);
        console.log(`   - ⏰ Increment interval: ${cardData.campaign.projection.incrementInterval.toFixed(4)} min`);
        console.log(`   - 📱 Total Devices: ${cardData.campaign.projection.totalDevices}`);
        console.log(`   - 📊 Allocated Devices: ${cardData.campaign.projection.allocatedDevices}`);
        console.log(`   - 👥 Active Participants: ${cardData.campaign.projection.activeParticipants}`);
        console.log(`   - 📈 Plays Per Device: ${cardData.campaign.projection.playsPerDevice}`);
      }

      setQuickPicks([cardData as unknown as CampaignCard]);
      cardIdsRef.current = [cardData.id];

      console.log(`\n✅ [useQuickPicks] Fetched 1 quick pick (${isCampaign ? 'campaign' : 'default'})`);
    } catch (err: any) {
      console.error('[useQuickPicks] Error fetching quick picks:', err);
      setError(err.message || 'Failed to fetch quick picks');
    } finally {
      setLoading(false);
    }
  };

  // ── Foreground handler: increment play_count for all active cards ──────────

  const handleForeground = async () => {
    const ids = cardIdsRef.current;
    if (!ids.length) return;

    console.log(`📊 [useQuickPicks] App foregrounded — incrementing ${ids.length} card(s)`);

    try {
      const deviceId = await deviceManager.getDeviceId();
      await deviceManager.updateDeviceStatus(deviceId, true);
    } catch (err) {
      console.error('Failed to update device status:', err);
    }

    const results = await Promise.all(ids.map((id) => incrementPlayCount(id)));

    try {
      const { data, error: refetchError } = await supabase
        .from('quick_picks')
        .select('id, play_count, target_play_count, campaign_active, campaign_start_date, campaign_end_date')
        .in('id', ids);

      if (refetchError) throw refetchError;

      if (data && data.length > 0) {
        const countMap: Record<string, number> = {};

        (data as any[]).forEach((row) => {
          countMap[row.id] = row.play_count;
        });

        const updated = useHomeStore.getState().quickPicks.map((card) => {
          const newCount = countMap[card.id];
          if (newCount !== undefined) {
            return {
              ...card,
              playCount: newCount,
            };
          }
          return card;
        });
        setQuickPicks(updated);

        console.log(`📊 [useQuickPicks] Play counts updated:`, countMap);
        console.log(`📊 [useQuickPicks] Increment results:`, results);
      }
    } catch (err) {
      console.error('[useQuickPicks] Failed to refresh play counts after foreground:', err);
    }
  };

  // ── AppState listener ──────────────────────────────────────────────────────

  useEffect(() => {
    fetchQuickPicks();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        const updateStatus = async () => {
          try {
            const deviceId = await deviceManager.getDeviceId();
            await deviceManager.updateDeviceStatus(deviceId, true);
          } catch (err) {
            console.error('Failed to update device status:', err);
          }
        };
        updateStatus();
        
        handleForeground();
        fetchQuickPicks();
      } else if (state === 'background') {
        const updateStatus = async () => {
          try {
            const deviceId = await deviceManager.getDeviceId();
            await deviceManager.updateDeviceStatus(deviceId, false);
          } catch (err) {
            console.error('Failed to update device status:', err);
          }
        };
        updateStatus();
      }
    });
    return () => sub.remove();
  }, []);

  return { quickPicks, loading, error, refetch: fetchQuickPicks };
}