import {
  Cloud,
  CloudOff,
  Menu,
  Music,
  RefreshCw,
  Settings,
  Upload,
  WifiOff,
} from 'lucide-react';
import type { SyncStatusInfo } from '../types/models';

interface HeaderProps {
  churchName: string;
  syncStatus: SyncStatusInfo;
  onToggleSidebar: () => void;
  onSyncClick: () => void;
  onUploadClick: () => void;
  onSettingsClick: () => void;
}

export function Header({
  churchName,
  syncStatus,
  onToggleSidebar,
  onSyncClick,
  onUploadClick,
  onSettingsClick,
}: HeaderProps) {
  const renderSyncPill = () => {
    if (!syncStatus.isConfigured) {
      return (
        <button
          type="button"
          onClick={onSettingsClick}
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
        >
          <CloudOff className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Local Offline Mode • Setup Sync</span>
          <span className="sm:hidden">Setup Sync</span>
        </button>
      );
    }

    if (!syncStatus.isOnline) {
      return (
        <button
          type="button"
          onClick={onSettingsClick}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300"
        >
          <WifiOff className="h-3.5 w-3.5 text-amber-400" />
          <span>
            Offline{syncStatus.pendingCount > 0 ? ` • ${syncStatus.pendingCount} queued` : ''}
          </span>
        </button>
      );
    }

    if (syncStatus.state === 'syncing') {
      return (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          <span>
            {syncStatus.downloadingCount > 0
              ? `Caching ${syncStatus.downloadingCount} offline...`
              : 'Syncing...'}
          </span>
        </div>
      );
    }

    if (syncStatus.state === 'error') {
      return (
        <button
          type="button"
          onClick={onSyncClick}
          title={syncStatus.errorMessage || 'Sync error'}
          className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
        >
          <CloudOff className="h-3.5 w-3.5" />
          <span>Sync Error • Retry</span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={onSyncClick}
        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
      >
        <Cloud className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Synced &amp; Offline Ready</span>
        <span className="sm:hidden">Synced</span>
      </button>
    );
  };

  return (
    <header className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-950 px-3 py-2.5 sm:px-5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Open menu"
          className="rounded-xl p-2 text-slate-300 hover:bg-slate-800 hover:text-white md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 shadow-md shadow-amber-500/20">
            <Music className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold text-white sm:text-base">WorshipDeck</p>
            <p className="hidden text-[11px] text-slate-400 sm:block">{churchName}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {renderSyncPill()}

        <button
          type="button"
          onClick={onUploadClick}
          title="Upload Song"
          className="hidden items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 sm:inline-flex"
        >
          <Upload className="h-3.5 w-3.5 text-amber-400" />
          Upload
        </button>

        <button
          type="button"
          onClick={onSettingsClick}
          title="Settings, Downloads & Offline Sync"
          aria-label="Open Settings"
          className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
