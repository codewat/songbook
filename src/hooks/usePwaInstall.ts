import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function detectStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    Boolean(nav.standalone) ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  );
}

function detectIosSafariFamily(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isAppleMobile = /iPad|iPhone|iPod/i.test(ua);
  const isIpadDesktopMode =
    navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
  return isAppleMobile || isIpadDesktopMode;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notifyListeners();
  });
}

export function usePwaInstall() {
  const [canInstall, setCanInstall] = useState(() => Boolean(deferredPrompt));
  const [isInstalled, setIsInstalled] = useState(() => detectStandaloneMode());
  const isIos = detectIosSafariFamily();

  useEffect(() => {
    const sync = () => {
      setCanInstall(Boolean(deferredPrompt));
      setIsInstalled(detectStandaloneMode());
    };

    listeners.add(sync);
    sync();

    const mediaQuery =
      typeof window !== 'undefined'
        ? window.matchMedia?.('(display-mode: standalone)')
        : undefined;
    const handleMediaChange = () => sync();
    mediaQuery?.addEventListener?.('change', handleMediaChange);

    return () => {
      listeners.delete(sync);
      mediaQuery?.removeEventListener?.('change', handleMediaChange);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > => {
    if (!deferredPrompt) return 'unavailable';
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    notifyListeners();
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    return outcome;
  }, []);

  return {
    canInstall,
    isInstalled,
    isIos,
    promptInstall,
  };
}
