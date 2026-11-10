import { useEffect, useState } from 'react';
import {
  Check,
  Cloud,
  Copy,
  Flame,
  HardDrive,
  Link2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import firestoreRulesText from '../../firebase/firestore.rules?raw';
import { getSavedCloudConfig, saveCloudConfig } from '../db/localDb';
import { resetFirebaseClientCache } from '../sync/firebaseClient';
import { syncManager, testCloudConnection } from '../sync/syncEngine';
import type { FirebaseFileStorageMode, SyncStatusInfo } from '../types/models';
import {
  formatBytes,
  formatRelativeTime,
  parseFirebaseConfigSnippet,
} from '../utils/format';

interface SyncSettingsModalProps {
  open: boolean;
  syncStatus: SyncStatusInfo;
  storageStats: { cachedFilesCount: number; totalBytes: number };
  totalSongsCount: number;
  onClose: () => void;
  onConfigChanged: () => Promise<void>;
}

export function SyncSettingsModal({
  open,
  syncStatus,
  storageStats,
  totalSongsCount,
  onClose,
  onConfigChanged,
}: SyncSettingsModalProps) {
  const [churchName, setChurchName] = useState('Church Worship Team');
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
  const [isPersisted, setIsPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    setSnippetInput('');
    void (async () => {
      const cfg = await getSavedCloudConfig();
      if (cfg) {
        setChurchName(cfg.churchName || 'Church Worship Team');
        setApiKey(cfg.apiKey);
        setProjectId(cfg.projectId);
        setAppId(cfg.appId);
        setAuthDomain(cfg.authDomain || '');
        setStorageBucket(cfg.storageBucket || '');
        setMessagingSenderId(cfg.messagingSenderId || '');
        setFileStorageMode(cfg.fileStorageMode || 'firestore');
      } else {
        setChurchName('Church Worship Team');
        setApiKey('');
        setProjectId('');
        setAppId('');
        setAuthDomain('');
        setStorageBucket('');
        setMessagingSenderId('');
        setFileStorageMode('firestore');
      }
      if (navigator.storage?.persisted) {
        try {
          setIsPersisted(await navigator.storage.persisted());
        } catch {
          setIsPersisted(null);
        }
      }
    })();
  }, [open]);

  if (!open) return null;

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
    churchName: churchName.trim() || 'Church Worship Team',
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
        text: 'Firebase connected & synced! New uploads will update for your church team automatically.',
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
      text: 'Disconnected from Firebase. All saved offline files remain safe on this device.',
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
      cn: churchName.trim() || 'Church Worship Team',
      fm: fileStorageMode,
    });
    const encoded = btoa(unescape(encodeURIComponent(payload)));
    const shareUrl = `${window.location.origin}${window.location.pathname}#setup=${encoded}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleRequestPersist = async () => {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      setIsPersisted(granted);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Offline Storage &amp; Firebase Team Sync
              </h2>
              <p className="text-xs text-slate-400">
                Files stay stored offline; Firebase Firestore syncs updates across bandmates
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Offline Storage Card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <HardDrive className="h-4 w-4 text-emerald-400" />
                  Device Offline Storage
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  <strong className="text-emerald-400">
                    {storageStats.cachedFilesCount} / {totalSongsCount}
                  </strong>{' '}
                  files saved inside this app ({formatBytes(storageStats.totalBytes)}) • Last
                  sync: {formatRelativeTime(syncStatus.lastSyncAt)}
                  {syncStatus.pendingCount > 0
                    ? ` • ${syncStatus.pendingCount} waiting to upload`
                    : ''}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {isPersisted === false && (
                  <button
                    type="button"
                    onClick={handleRequestPersist}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                    Lock Offline Storage
                  </button>
                )}
                {syncStatus.isConfigured && (
                  <button
                    type="button"
                    onClick={() => void syncManager.syncAll()}
                    disabled={syncStatus.state === 'syncing' || !syncStatus.isOnline}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${
                        syncStatus.state === 'syncing' ? 'animate-spin' : ''
                      }`}
                    />
                    Sync &amp; Cache All
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Firebase Config Form */}
          <form
            onSubmit={handleSave}
            className="space-y-3.5 rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Flame className="h-4 w-4 text-amber-400" />
                Firebase Cloud Sync
              </h3>
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
                      <Link2 className="h-3.5 w-3.5" /> Copy Team Setup Link
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Quick Paste Snippet */}
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
                  value={churchName}
                  onChange={(e) => setChurchName(e.target.value)}
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
          </form>

          {/* Step-by-step Firebase setup guide */}
          <details className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-amber-300">
              Unsaon pag-setup gamit imong Firebase Account (3 minutes)
            </summary>
            <ol className="mt-3 list-inside list-decimal space-y-2 text-xs leading-relaxed text-slate-300">
              <li>
                Sa{' '}
                <a
                  href="https://console.firebase.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-400 underline"
                >
                  Firebase Console
                </a>
                , paghimo (o pagpili) ug project, dayon i-enable ang{' '}
                <strong>Firestore Database</strong> (Free Spark Plan — walay bayad!).
              </li>
              <li>
                Sa <strong>Firestore Database → Rules</strong>, i-paste ug i-publish kini nga
                rules aron maka-read/write ang inyong worship team:
                <div className="mt-2">
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
              </li>
              <li>
                Adto sa <strong>Project Settings (gear icon) → Your apps → Add Web App (&lt;/&gt;)</strong>,
                kopyaha ang <code>firebaseConfig</code> snippet ug i-paste sa{' '}
                <strong>Quick Paste Firebase Config Snippet</strong> box sa taas.
              </li>
              <li>
                I-click ang <strong>Save &amp; Sync Now</strong>, dayon i-click ang{' '}
                <strong>Copy Team Setup Link</strong> aron i-send sa GC sa inyong banda!
              </li>
            </ol>
          </details>
        </div>
      </div>
    </div>
  );
}
