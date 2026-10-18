import type { Action, ActionContext, ActionResult, CommandRef, Platform, RootItem, View } from './types';

/** IPC channel names, in one place so main and preload can't drift apart. */
export const IpcChannel = {
  rootItems: 'palette:root-items',
  runAction: 'palette:run-action',
  searchView: 'palette:search-view',
  hide: 'palette:hide',
  /** renderer → main: the pointer was pressed on the window's glass and moved; follow it. */
  startDrag: 'palette:start-drag',
  /** renderer → main: the pointer was let go; stop following it. */
  endDrag: 'palette:end-drag',
  /** main → renderer: the window was just shown. */
  shown: 'palette:shown',
  /** main → renderer: apps or extensions changed; fetch root items again. */
  rootItemsChanged: 'palette:root-items-changed',
  /** main → renderer: show a message in the footer. */
  toast: 'palette:toast',
} as const;

export interface ShownInfo {
  /** The window was hidden long enough that the launcher should start over at the root. */
  reset: boolean;
}

export interface ToastMessage {
  text: string;
  style: 'success' | 'failure';
}

/** The API the preload script exposes to the renderer as `window.palette`. */
export interface PaletteApi {
  platform: Platform;
  getRootItems(): Promise<RootItem[]>;
  runAction(action: Action, context: ActionContext): Promise<ActionResult>;
  /** Re-renders a view whose command filters by itself (`filtering: false`). */
  searchView(ref: CommandRef, query: string): Promise<View>;
  hide(): void;
  /** The window follows the pointer, snapping to guides, until `endDrag`. */
  startDrag(): void;
  endDrag(): void;
  onShown(listener: (info: ShownInfo) => void): () => void;
  onRootItemsChanged(listener: () => void): () => void;
  onToast(listener: (toast: ToastMessage) => void): () => void;
}
