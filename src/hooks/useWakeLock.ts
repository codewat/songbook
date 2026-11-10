import { useCallback, useEffect, useRef, useState } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
}

export function useWakeLock(initialEnabled = true) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isActive, setIsActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const supported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  const acquire = useCallback(async () => {
    if (!supported || !enabled) return;
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
      };
      if (!nav.wakeLock) return;
      const sentinel = await nav.wakeLock.request('screen');
      sentinelRef.current = sentinel;
      setIsActive(true);
      sentinel.addEventListener?.('release', () => {
        setIsActive(false);
      });
    } catch {
      setIsActive(false);
    }
  }, [enabled, supported]);

  const release = useCallback(async () => {
    if (sentinelRef.current && !sentinelRef.current.released) {
      try {
        await sentinelRef.current.release();
      } catch {
        // Ignore release errors
      }
    }
    sentinelRef.current = null;
    setIsActive(false);
  }, []);

  useEffect(() => {
    if (enabled) {
      void acquire();
    } else {
      void release();
    }
    return () => {
      void release();
    };
  }, [enabled, acquire, release]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && enabled) {
        void acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [enabled, acquire]);

  return {
    supported,
    enabled,
    isActive,
    toggle: () => setEnabled((v) => !v),
    setEnabled,
  };
}
