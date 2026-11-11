export interface AppOverlaySnapshot {
  exitPromptOpen: boolean;
  confirmOpen: boolean;
  viewerOpen: boolean;
  settingsOpen: boolean;
  uploadOpen: boolean;
  createModalOpen: boolean;
  addToPlaylistOpen: boolean;
  mobileSidebarOpen: boolean;
}

export type BackNavigationAction =
  | 'dismiss-exit-prompt'
  | 'close-confirm'
  | 'close-create-modal'
  | 'close-add-to-playlist'
  | 'close-upload'
  | 'close-settings'
  | 'close-viewer'
  | 'close-sidebar'
  | 'prompt-exit';

export function resolveBackNavigationAction(
  overlays: AppOverlaySnapshot
): BackNavigationAction {
  if (overlays.exitPromptOpen) return 'dismiss-exit-prompt';
  if (overlays.confirmOpen) return 'close-confirm';
  if (overlays.createModalOpen) return 'close-create-modal';
  if (overlays.addToPlaylistOpen) return 'close-add-to-playlist';
  if (overlays.uploadOpen) return 'close-upload';
  if (overlays.settingsOpen) return 'close-settings';
  if (overlays.viewerOpen) return 'close-viewer';
  if (overlays.mobileSidebarOpen) return 'close-sidebar';
  return 'prompt-exit';
}

export function shouldPromptBeforeUnload(options: {
  allowExit: boolean;
  hasInteracted: boolean;
}): boolean {
  return !options.allowExit && options.hasInteracted;
}
