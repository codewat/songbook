import { useEffect, useState } from 'react';
import {
  Archive,
  Check,
  Cloud,
  CloudOff,
  Copy,
  Flame,
  HardDrive,
  Link2,
  Moon,
  RefreshCw,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  WifiOff,
  X,
} from 'lucide-react';
import firestoreRulesText from '../../firebase/firestore.rules?raw';
import {
  getSavedCloudConfig,
  getSongBlob,
  hasBuiltInCloudConfig,
  saveCloudConfig,
} from '../db/localDb';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { resetFirebaseClientCache } from '../sync/firebaseClient';
import { syncManager, testCloudConnection } from '../sync/syncEngine';
import type {
  FirebaseFileStorageMode,
  Folder,
  Song,
  StagePreferences,
  SyncStatusInfo,
} from '../types/models';
import {
  buildSongsArchiveZip,
  triggerBlobDownload,
  type ExportZipProgress,
} from '../utils/exportZip';
import {
  formatBytes,
  formatRelativeTime,
  parseFirebaseConfigSnippet,
} from '../utils/format';

interface SyncSettingsModalProps {
  open: boolean;
  syncStatus: SyncStatusInfo;
  storageStats: { cachedFilesCount: number; totalBytes: number };
  songs: Song[];
  folders: Folder[];
  stagePrefs: StagePreferences;
  onStagePrefsChange: (next: StagePreferences) => Promise<void>;
  onClose: () => void;
  onConfigChanged: () => Promise<void>;
  onShowToast?: (message: string) => void;
}

export function SyncSettingsModal({
  open,
  syncStatus,
  storageStats,
  songs,
  folders,
  stagePrefs,
  onStagePrefsChange,
  onClose,
  onConfigChanged,
  onShowToast,
}: SyncSettingsModalProps) {
  const builtInCloud = hasBuiltInCloudConfig();
  const { canInstall, isInstalled, isIos, promptInstall } = usePwaInstall();

  const [isPersisted, setIsPersisted] = useState<boolean | null>(null);
  const [copiedAppLink, setCopiedAppLink] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState<ExportZipProgress | null>(null);
  const [zipFeedback, setZipFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [installFeedback, setInstallFeedback] = useState<string | null>(null);

  // Admin / self-host custom Firebase setup (only rendered when no .env config exists)
  const [churchNameInput, setChurchNameInput] = useState('Church Worship Team');
  const [snippetInput, setSnippetInput] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [projectId, setProjectId] = useState('');
  const [appId, setAppId] = useState('');
  const [authDomain, setAuthDomain] = useState('');
  const [storageBucket, setStorageBucket] = useState('');
  const [messagingSenderId, setMessagingSenderId] = useState('');
  const [fileStorageMode, setFileStorageMode] =
    useState<FirebaseFileStorageMode>('firestore');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedRules, setCopiedRules] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    setZipFeedback(null);
    setInstallFeedback(null);
    setSnippetInput('');

    void (async () => {
      if (!builtInCloud) {
        const cfg = await getSavedCloudConfig();
        if (cfg) {
          setChurchNameInput(cfg.churchName || 'Church Worship Team');
          setApiKey(cfg.apiKey);
          setProjectId(cfg.projectId);
          setAppId(cfg.appId);
          setAuthDomain(cfg.authDomain || '');
          setStorageBucket(cfg.storageBucket || '');
          setMessagingSenderId(cfg.messagingSenderId || '');
          setFileStorageMode(cfg.fileStorageMode || 'firestore');
        } else {
          setChurchNameInput('Church Worship Team');
          setApiKey('');
          setProjectId('');
          setAppId('');
          setAuthDomain('');
          setStorageBucket('');
          setMessagingSenderId('');
          setFileStorageMode('firestore');
        }
      }

      if (navigator.storage?.persisted) {
        try {
          setIsPersisted(await navigator.storage.persisted());
        } catch {
          setIsPersisted(null);
        }
      }
    })();
  }, [open, builtInCloud]);

  if (!open) return null;

  const cleanAppUrl = `${window.location.origin}${window.location.pathname}`;
  const supportsWebShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleRequestPersist = async () => {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      setIsPersisted(granted);
      onShowToast?.(
        granted
          ? 'Offline storage protected on this device!'
          : 'Browser keeps offline cache managed automatically.'
      );
    }
  };

  const handleDownloadZip = async () => {
    if (songs.length === 0 || downloadingZip) return;
    setDownloadingZip(true);
    setZipFeedback(null);
    setZipProgress({ processed: 0, total: songs.length, currentTitle: songs[0].title });

    try {
      const result = await buildSongsArchiveZip({
        songs,
        folders,
        resolveBlob: async (song) => {
          const cached = await getSongBlob(song.id);
          if (cached) return cached.blob;
          return syncManager.downloadSingleSong(song);
        },
        onProgress: setZipProgress,
      });

      if (result.includedCount === 0) {
        setZipFeedback({
          ok: false,
          text: 'No offline files could be packaged right now. Connect to the internet and tap "Sync & Download All" first.',
        });
        return;
      }

      triggerBlobDownload(result.blob, result.fileName);

      if (result.skippedSongs.length > 0) {
        setZipFeedback({
          ok: true,
          text: `Downloaded ${result.includedCount} of ${songs.length} songs (${result.fileName}). ${result.skippedSongs.length} uncached file(s) skipped while offline.`,
        });
      } else {
        setZipFeedback({
          ok: true,
          text: `Downloaded ${result.includedCount} song${result.includedCount === 1 ? '' : 's'} into ${result.fileName}.`,
        });
      }
      onShowToast?.(`ZIP ready: ${result.fileName}`);
    } catch (err) {
      setZipFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Unable to build ZIP download.',
      });
    } finally {
      setDownloadingZip(false);
      setZipProgress(null);
    }
  };

  const handleInstallApp = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      setInstallFeedback('Installing SongBook on your device...');
      onShowToast?.('Installing SongBook App!');
    } else if (outcome === 'dismissed') {
      setInstallFeedback('Install cancelled — you can install anytime from Settings.');
    }
  };

  const handleCopyCleanAppLink = async () => {
    await navigator.clipboard.writeText(cleanAppUrl);
    setCopiedAppLink(true);
    onShowToast?.('Clean app link copied!');
    setTimeout(() => setCopiedAppLink(false), 2500);
  };

  const handleShareAppLink = async () => {
    if (!supportsWebShare) {
      await handleCopyCleanAppLink();
      return;
    }
    try {
      await navigator.share({
        title: 'SongBook',
        text: 'Open our SongBook (chords, lyrics & slides):',
        url: cleanAppUrl,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      await handleCopyCleanAppLink();
    }
  };

  // Custom self-hosted Firebase handlers (unused when builtInCloud === true)
  const handleSnippetPaste = (val: string) => {
    setSnippetInput(val);
    const parsed = parseFirebaseConfigSnippet(val);
    if (!parsed) return;
    if (parsed.apiKey) setApiKey(parsed.apiKey);
    if (parsed.projectId) setProjectId(parsed.projectId);
    if (parsed.appId) setAppId(parsed.appId);
    if (parsed.authDomain) setAuthDomain(parsed.authDomain);
    if (parsed.storageBucket) setStorageBucket(parsed.storageBucket);
    if (parsed.messagingSenderId) setMessagingSenderId(parsed.messagingSenderId);
    setFeedback({
      ok: true,
      text: `Parsed Firebase config for project "${parsed.projectId || ''}"! Click "Test Connection" or "Save & Sync Now".`,
    });
  };

  const buildConfig = () => ({
    apiKey: apiKey.trim(),
    projectId: projectId.trim(),
    appId: appId.trim(),
    authDomain: authDomain.trim() || undefined,
    storageBucket: storageBucket.trim() || undefined,
    messagingSenderId: messagingSenderId.trim() || undefined,
    churchName: churchNameInput.trim() || 'Church Worship Team',
    fileStorageMode,
  });

  const handleTest = async () => {
    setTesting(true);
    setFeedback(null);
    const res = await testCloudConnection(buildConfig());
    setFeedback({ ok: res.ok, text: res.message });
    setTesting(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim() || !projectId.trim() || !appId.trim()) {
      setFeedback({
        ok: false,
        text: 'Please paste your Firebase Config or fill in apiKey, projectId, and appId.',
      });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await saveCloudConfig(buildConfig());
      await resetFirebaseClientCache();
      await onConfigChanged();
      await syncManager.syncAll();
      await syncManager.startRealtime();
      setFeedback({
        ok: true,
        text: 'Firebase connected & synced! New uploads will update automatically.',
      });
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to save Firebase config.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    await saveCloudConfig(null);
    syncManager.stopRealtime();
    await resetFirebaseClientCache();
    setApiKey('');
    setProjectId('');
    setAppId('');
    setAuthDomain('');
    setStorageBucket('');
    setMessagingSenderId('');
    await onConfigChanged();
    setFeedback({
      ok: true,
      text: 'Disconnected from Firebase. Saved offline files stay on this device.',
    });
  };

  const handleCopyRules = async () => {
    await navigator.clipboard.writeText(firestoreRulesText);
    setCopiedRules(true);
    setTimeout(() => setCopiedRules(false), 2000);
  };

  const handleCopyInviteLink = async () => {
    if (!apiKey.trim() || !projectId.trim() || !appId.trim()) return;
    const payload = JSON.stringify({
      ak: apiKey.trim(),
      pi: projectId.trim(),
      ai: appId.trim(),
      ad: authDomain.trim() || undefined,
      sb: storageBucket.trim() || undefined,
      ms: messagingSenderId.trim() || undefined,
      cn: churchNameInput.trim() || 'Church Worship Team',
      fm: fileStorageMode,
    });
    const encoded = btoa(unescape(encodeURIComponent(payload)));
    const shareUrl = `${cleanAppUrl}#setup=${encoded}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const renderSyncBadge = () => {
    if (!syncStatus.isConfigured) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300">
          <CloudOff className="h-3 w-3" />
          Local Offline Only
        </span>
      );
    }
    if (!syncStatus.isOnline) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-amber-300">
          <WifiOff className="h-3 w-3" />
          Offline Ready
        </span>
      );
    }
    if (syncStatus.state === 'syncing') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-1 text-[11px] font-medium text-sky-300">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Syncing...
        </span>
      );
    }
    if (syncStatus.state === 'error') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-medium text-rose-300">
          <CloudOff className="h-3 w-3" />
          Sync Issue
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
        <Cloud className="h-3 w-3" />
        Connected • Team Sync
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                App Settings &amp; Downloads
              </h2>
              <p className="text-xs text-slate-400">
                Offline files, ZIP export, install app &amp; stage defaults
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Settings"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Cards */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Card 1: Team Sync & Offline Cache */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <HardDrive className="h-4 w-4 text-emerald-400" />
                  Offline Cache &amp; Team Sync
                </h3>
                <p className="mt-1.5 text-xs text-slate-400">
                  <strong className="text-emerald-400">
                    {storageStats.cachedFilesCount} / {songs.length}
                  </strong>{' '}
                  files saved on this device ({formatBytes(storageStats.totalBytes)}) • Last
                  sync: {formatRelativeTime(syncStatus.lastSyncAt)}
                  {syncStatus.pendingCount > 0
                    ? ` • ${syncStatus.pendingCount} pending upload`
                    : ''}
                </p>
              </div>
              {renderSyncBadge()}
            </div>

            {syncStatus.state === 'error' && syncStatus.errorMessage && (
              <p className="mt-2.5 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {syncStatus.errorMessage}
              </p>
            )}

            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {syncStatus.isConfigured && (
                <button
                  type="button"
                  onClick={() => void syncManager.syncAll()}
                  disabled={syncStatus.state === 'syncing' || !syncStatus.isOnline}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      syncStatus.state === 'syncing' ? 'animate-spin' : ''
                    }`}
                  />
                  {syncStatus.state === 'syncing'
                    ? 'Syncing...'
                    : 'Sync & Download All'}
                </button>
              )}

              {isPersisted === false && (
                <button
                  type="button"
                  onClick={handleRequestPersist}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  Lock Offline Storage
                </button>
              )}

              {isPersisted === true && (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Storage Protected
                </span>
              )}
            </div>
          </div>

          {/* Card 2: Download Backup (.zip), Install App & Share */}
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            {/* Download All Songs (.zip) */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Archive className="h-4 w-4 text-amber-400" />
                    Download Songbook (.zip)
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Export all chords, lyrics &amp; PowerPoint files organized into folders.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void handleDownloadZip()}
                  disabled={songs.length === 0 || downloadingZip}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Archive className="h-3.5 w-3.5" />
                  {downloadingZip
                    ? `Packing ${zipProgress?.processed ?? 0}/${zipProgress?.total ?? songs.length}...`
                    : `Download All (${songs.length})`}
                </button>
              </div>

              {downloadingZip && zipProgress && (
                <p className="mt-2 truncate text-[11px] text-amber-300/90">
                  Adding: {zipProgress.currentTitle}
                </p>
              )}

              {zipFeedback && (
                <p
                  className={`mt-2.5 rounded-xl px-3 py-2 text-xs ${
                    zipFeedback.ok
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {zipFeedback.text}
                </p>
              )}
            </div>

            <div className="border-t border-slate-800/80 pt-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Smartphone className="h-4 w-4 text-sky-400" />
                    Install SongBook App
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {isInstalled
                      ? 'Running as an installed app on this device.'
                      : isIos
                        ? 'iPhone / iPad Safari: tap Share (square + arrow) → Add to Home Screen.'
                        : canInstall
                          ? 'Install SongBook on your phone, tablet, or laptop for fullscreen stage use.'
                          : 'Use Chrome/Edge address bar install icon or browser menu → Install SongBook.'}
                  </p>
                </div>

                {isInstalled ? (
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
                    <Check className="h-3.5 w-3.5" />
                    Installed
                  </span>
                ) : canInstall ? (
                  <button
                    type="button"
                    onClick={() => void handleInstallApp()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/35 bg-sky-500/15 px-3.5 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/25"
                  >
                    <Smartphone className="h-3.5 w-3.5" />
                    Install App
                  </button>
                ) : null}
              </div>

              {installFeedback && (
                <p className="mt-2 text-xs text-sky-300">{installFeedback}</p>
              )}
            </div>

            {/* Share Clean Link */}
            <div className="border-t border-slate-800/80 pt-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Link2 className="h-4 w-4 text-indigo-400" />
                    Share Songbook with Bandmates
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Send the clean app link — team sync connects automatically.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyCleanAppLink()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    {copiedAppLink ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        Link Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy App Link
                      </>
                    )}
                  </button>

                  {supportsWebShare && (
                    <button
                      type="button"
                      onClick={() => void handleShareAppLink()}
                      aria-label="Share App Link"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/35 bg-indigo-500/15 px-3 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/25"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      Share
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Stage Display Defaults */}
          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Moon className="h-4 w-4 text-amber-400" />
              Stage View Defaults
            </h3>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-800/80 bg-slate-900/60 px-3.5 py-2.5">
              <div className="flex items-start gap-2.5">
                <Moon className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <div>
                  <p className="text-xs font-semibold text-slate-100">
                    Default Stage Dark Invert
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Automatically darken white PDF sheets &amp; slides on stage
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={stagePrefs.defaultStageInvert}
                aria-label="Toggle Default Stage Dark Invert"
                onClick={() =>
                  void onStagePrefsChange({
                    ...stagePrefs,
                    defaultStageInvert: !stagePrefs.defaultStageInvert,
                  })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition ${
                  stagePrefs.defaultStageInvert
                    ? 'border-amber-400/50 bg-amber-500'
                    : 'border-slate-700 bg-slate-800'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                    stagePrefs.defaultStageInvert ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-800/80 bg-slate-900/60 px-3.5 py-2.5">
              <div className="flex items-start gap-2.5">
                <Sun className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                <div>
                  <p className="text-xs font-semibold text-slate-100">
                    Keep Screen Awake on Stage
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Prevent screen dimming while viewing songs &amp; slides
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={stagePrefs.defaultKeepAwake}
                aria-label="Toggle Keep Screen Awake on Stage"
                onClick={() =>
                  void onStagePrefsChange({
                    ...stagePrefs,
                    defaultKeepAwake: !stagePrefs.defaultKeepAwake,
                  })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition ${
                  stagePrefs.defaultKeepAwake
                    ? 'border-emerald-400/50 bg-emerald-500'
                    : 'border-slate-700 bg-slate-800'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                    stagePrefs.defaultKeepAwake ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Optional Self-Hosted Admin Setup (ONLY rendered when app has no built-in .env Firebase config) */}
          {!builtInCloud && (
            <details className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <summary className="flex cursor-pointer items-center justify-between text-xs font-semibold text-amber-300">
                <span className="inline-flex items-center gap-2">
                  <Flame className="h-4 w-4 text-amber-400" />
                  Admin: Connect Firebase Team Sync
                </span>
                <span className="text-[11px] font-normal text-slate-400">Expand setup</span>
              </summary>

              <form onSubmit={handleSave} className="mt-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-400">
                    Connect a Firebase project to sync songs across devices.
                  </p>
                  {apiKey && projectId && appId && (
                    <button
                      type="button"
                      onClick={handleCopyInviteLink}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="h-3.5 w-3.5" /> Link Copied!
                        </>
                      ) : (
                        <>
                          <Link2 className="h-3.5 w-3.5" /> Copy Setup Link
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    Quick Paste Firebase Config Snippet
                  </label>
                  <textarea
                    rows={3}
                    value={snippetInput}
                    onChange={(e) => handleSnippetPaste(e.target.value)}
                    placeholder={'Paste const firebaseConfig = { apiKey: "...", projectId: "...", appId: "..." } from Firebase Console'}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-[11px] text-slate-200 placeholder-slate-500 outline-none focus:border-amber-500"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Church / Team Name
                    </label>
                    <input
                      type="text"
                      value={churchNameInput}
                      onChange={(e) => setChurchNameInput(e.target.value)}
                      placeholder="e.g., Grace Fellowship Worship"
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      File Storage Mode
                    </label>
                    <select
                      value={fileStorageMode}
                      onChange={(e) =>
                        setFileStorageMode(e.target.value as FirebaseFileStorageMode)
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
                    >
                      <option value="firestore">
                        Firestore (Free Spark Plan — No CORS setup)
                      </option>
                      <option value="storage">
                        Firebase Storage Bucket (Blaze / CORS enabled)
                      </option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Project ID *
                    </label>
                    <input
                      type="text"
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      placeholder="my-church-songbook"
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      API Key *
                    </label>
                    <input
                      type="text"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="AIzaSy..."
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      App ID *
                    </label>
                    <input
                      type="text"
                      value={appId}
                      onChange={(e) => setAppId(e.target.value)}
                      placeholder="1:123456789:web:abcdef..."
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Storage Bucket (Optional)
                    </label>
                    <input
                      type="text"
                      value={storageBucket}
                      onChange={(e) => setStorageBucket(e.target.value)}
                      placeholder="my-church.firebasestorage.app"
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                {feedback && (
                  <div
                    className={`rounded-xl px-3.5 py-2.5 text-xs ${
                      feedback.ok
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-rose-500/15 text-rose-300'
                    }`}
                  >
                    {feedback.text}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={testing}
                      onClick={handleTest}
                      className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                    >
                      {testing ? 'Testing...' : 'Test Connection'}
                    </button>
                    {syncStatus.isConfigured && (
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                  >
                    {saving ? 'Connecting...' : 'Save & Sync Now'}
                  </button>
                </div>

                <div className="border-t border-slate-800 pt-3">
                  <button
                    type="button"
                    onClick={handleCopyRules}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                  >
                    {copiedRules ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" /> Firestore Rules
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Copy firestore.rules
                      </>
                    )}
                  </button>
                </div>
              </form>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
