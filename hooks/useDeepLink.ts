// hooks/useDeepLink.ts
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Alert } from 'react-native';
import { useMusicPlayer } from '@/libs/playerSetup';
import { useAlert } from '@/contexts/AlertContext';

interface DeepLinkParams {
  track_id: string;
  user_id: string;
  title?: string;
  artist?: string;
  task_id?: string;
  share_id?: string;
  ts?: string;
  sig?: string;
  activate?: string;
  duration?: string;
}

export function useDeepLink() {
  const { playAudio, currentTrack } = useMusicPlayer();
  const { showAlert } = useAlert();
  const [initialLinkProcessed, setInitialLinkProcessed] = useState(false);
  const isProcessingRef = useRef(false);

  // ─────────────────────────────────────────────────────────────
  // Parse deep link URL
  // ─────────────────────────────────────────────────────────────
  const parseDeepLink = (url: string): DeepLinkParams | null => {
    try {
      // Handle both formats:
      // soundwave://play?track_id=xxx&user_id=xxx&title=xxx&artist=xxx
      // https://mavins.vercel.app/share/xxx (web fallback)
      
      const parsedUrl = new URL(url);
      
      // Check if it's a soundwave deep link
      if (parsedUrl.protocol === 'soundwave:') {
        const params = new URLSearchParams(parsedUrl.search);
        const trackId = params.get('track_id');
        const userId = params.get('user_id');
        
        if (!trackId || !userId) {
          console.warn('[useDeepLink] Missing required parameters:', { trackId, userId });
          return null;
        }
        
        return {
          track_id: trackId,
          user_id: userId,
          title: params.get('title') || undefined,
          artist: params.get('artist') || undefined,
          task_id: params.get('task_id') || undefined,
          share_id: params.get('share_id') || undefined,
          ts: params.get('ts') || undefined,
          sig: params.get('sig') || undefined,
          activate: params.get('activate') || undefined,
          duration: params.get('duration') || undefined,
        };
      }
      
      // Handle web share URL fallback (mavins.vercel.app/share/xxx)
      if (parsedUrl.hostname.includes('mavins.vercel.app') && parsedUrl.pathname.startsWith('/share/')) {
        const shareId = parsedUrl.pathname.split('/').pop();
        if (shareId) {
          // Resolve the share ID by calling the website API
          resolveShareId(shareId);
          return null;
        }
      }
      
      // Handle YouTube URL (fallback)
      if (parsedUrl.hostname.includes('youtube.com') || parsedUrl.hostname.includes('youtu.be')) {
        const videoId = parsedUrl.searchParams.get('v') || parsedUrl.pathname.split('/').pop();
        if (videoId) {
          return {
            track_id: videoId,
            user_id: 'guest',
            title: undefined,
            artist: undefined,
          };
        }
      }
      
      console.warn('[useDeepLink] Unsupported URL format:', url);
      return null;
    } catch (error) {
      console.error('[useDeepLink] Failed to parse deep link:', error);
      return null;
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Resolve share ID via website API
  // ─────────────────────────────────────────────────────────────
  const resolveShareId = async (shareId: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      const response = await fetch(`https://mavins.vercel.app/api/share/resolve/${shareId}`);
      
      if (!response.ok) {
        showAlert('Invalid Share', 'This share link could not be resolved.');
        return;
      }

      const data = await response.json();
      
      if (!data.trackId) {
        showAlert('Invalid Share', 'This share link does not contain a valid track.');
        return;
      }

      // Create song object from resolved data
      const song = {
        id: data.trackId,
        title: data.title || 'Unknown Track',
        artist: data.artist || 'Unknown Artist',
        url: `https://www.youtube.com/watch?v=${data.trackId}`,
        videoId: data.trackId,
        thumbnail: `https://img.youtube.com/vi/${data.trackId}/maxresdefault.jpg`,
      };

      // Play the song
      await playAudio(song);
      
      // Send tracking for share click (if user is logged in)
      if (data.userId && data.userId !== 'guest') {
        fetch(`https://mavins.vercel.app/api/share/track/${shareId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: data.userId,
          }),
        }).catch(() => {});
      }

    } catch (error) {
      console.error('[useDeepLink] Failed to resolve share ID:', error);
      showAlert('Error', 'Failed to load the shared track.');
    } finally {
      isProcessingRef.current = false;
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Handle deep link
  // ─────────────────────────────────────────────────────────────
  const handleDeepLink = async (url: string) => {
    console.log('[useDeepLink] Handling deep link:', url);

    if (isProcessingRef.current) {
      console.log('[useDeepLink] Already processing a deep link, skipping.');
      return;
    }

    try {
      const params = parseDeepLink(url);
      
      if (!params) {
        console.warn('[useDeepLink] Could not parse deep link:', url);
        return;
      }

      // If it's a web share URL, it was handled by resolveShareId
      if (params.share_id) {
        await resolveShareId(params.share_id);
        return;
      }

      // Check if it's the same track already playing
      if (currentTrack?.id === params.track_id) {
        console.log('[useDeepLink] Same track already playing, expanding player.');
        // You can optionally expand the player here
        return;
      }

      // Create song object from deep link params
      const song = {
        id: params.track_id,
        title: params.title || 'Unknown Track',
        artist: params.artist || 'Unknown Artist',
        url: `https://www.youtube.com/watch?v=${params.track_id}`,
        videoId: params.track_id,
        thumbnail: `https://img.youtube.com/vi/${params.track_id}/maxresdefault.jpg`,
      };

      console.log('[useDeepLink] Playing track:', song.title);

      // Play the song (this will also expand the player)
      await playAudio(song);

      // If there's a task_id, track task completion
      if (params.task_id && params.user_id && params.user_id !== 'guest') {
        trackTaskCompletion(params.user_id, params.task_id, params.track_id);
      }

      // Send share click tracking
      if (params.share_id) {
        fetch(`https://mavins.vercel.app/api/share/track/${params.share_id}`, {
          method: 'POST',
        }).catch(() => {});
      }

    } catch (error) {
      console.error('[useDeepLink] Error handling deep link:', error);
      showAlert('Error', 'Failed to open the shared track.');
    } finally {
      isProcessingRef.current = false;
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Track task completion (gamification)
  // ─────────────────────────────────────────────────────────────
  const trackTaskCompletion = async (userId: string, taskId: string, trackId: string) => {
    try {
      await fetch('https://mavins.vercel.app/api/deeplink/callback', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        // Note: In production, you'd want to build the full deeplink URL
        // with signature for security
      });
    } catch (error) {
      console.error('[useDeepLink] Failed to track task completion:', error);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Set up deep link listeners
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    // Handle initial URL when app starts
    const handleInitialUrl = async () => {
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) {
          console.log('[useDeepLink] Initial URL:', initialUrl);
          setInitialLinkProcessed(true);
          await handleDeepLink(initialUrl);
        }
      } catch (error) {
        console.error('[useDeepLink] Failed to get initial URL:', error);
      }
    };

    handleInitialUrl();

    // Handle subsequent deep links while app is running
    const subscription = Linking.addEventListener('url', ({ url }) => {
      console.log('[useDeepLink] Received deep link event:', url);
      handleDeepLink(url);
    });

    // Cleanup
    return () => {
      subscription.remove();
    };
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Handle Android app links (if configured)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'android') {
      // Android app links are handled by the intent filter
      // They come through as regular URLs in the event listener
      const handleAndroidAppLink = async () => {
        try {
          const initialUrl = await Linking.getInitialURL();
          if (initialUrl && initialUrl.startsWith('https://mavins.vercel.app/share/')) {
            const shareId = initialUrl.split('/').pop();
            if (shareId) {
              await resolveShareId(shareId);
            }
          }
        } catch (error) {
          console.error('[useDeepLink] Failed to handle Android app link:', error);
        }
      };

      // Only run if not already processed
      if (!initialLinkProcessed) {
        handleAndroidAppLink();
      }
    }
  }, [initialLinkProcessed]);

  // ─────────────────────────────────────────────────────────────
  // Public methods
  // ─────────────────────────────────────────────────────────────
  return {
    // Manually trigger deep link handling (useful for debugging)
    handleDeepLink,
    // Check if a link is a valid deep link
    isValidDeepLink: (url: string): boolean => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'soundwave:' || 
               (parsed.hostname.includes('mavins.vercel.app') && parsed.pathname.startsWith('/share/'));
      } catch {
        return false;
      }
    },
    // Parse a deep link without executing it
    parseDeepLink,
    // Check if initial link was processed
    initialLinkProcessed,
  };
}

export default useDeepLink;