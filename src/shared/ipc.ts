import type { ExchangeRates } from './currencies';
import type { Action, ActionContext, ActionResult, CommandRef, Platform, RootItem, View } from './types';

/** IPC channel names, in one place so main and preload can't drift apart. */
export const IpcChannel = {
  rootItems: 'palette:root-items',
  runAction: 'palette:run-action',
  searchView: 'palette:search-view',
  exchangeRates: 'palette:exchange-rates',
  hide: 'palette:hide',
  /** renderer → main: the pointer was pressed on the window's glass and moved; follow it. */
  startDrag: 'palette:start-drag',
  /** renderer → main: the pointer was let go; stop following it. */
  endDrag: 'palette:end-drag',
  /** main → renderer: the window was just shown. */
  shown: 'palette:shown',
  /** main → renderer: the window was just hidden. */
  hidden: 'palette:hidden',
  /** main → renderer: apps or extensions changed; fetch root items again. */
  rootItemsChanged: 'palette:root-items-changed',
  /** main → renderer: new exchange rates came; fetch them again. */
  exchangeRatesChanged: 'palette:exchange-rates-changed',
  /** main → renderer: show a message in the footer. */
  toast: 'palette:toast',
  /** main → renderer: open a command as if picked from the root search (its shortcut, `--command`). */
  runCommand: 'palette:run-command',
} as const;

export interface ShownInfo {
  /** The window was hidden long enough that the launcher should start over at the root. */
  reset: boolean;
}

export interface ToastMessage {
  text: string;
  style: 'success' | 'failure';
}

/** A command to open from outside the launcher: its own shortcut, `waypoint --command`, a link. */
export interface CommandRequest {
  ref: CommandRef;
  /** The launcher was already in front; if this command's view is showing, it closes instead. */
  toggle: boolean;
  /** It already ran, out of sight: show what it returned rather than running it again. */
  result?: ActionResult;
  /**
   * `result` asks whether to run it, for a link: ↵ is ignored for a moment as it appears, so a ↵
   * typed into another app just as the launcher took the keyboard doesn't answer yes.
   */
  confirm?: boolean;
}

/** The API the preload script exposes to the renderer as `window.palette`. */
export interface PaletteApi {
  platform: Platform;
  getRootItems(): Promise<RootItem[]>;
  runAction(action: Action, context: ActionContext): Promise<ActionResult>;
  /** Re-renders a view whose command filters by itself (`filtering: false`). */
  searchView(ref: CommandRef, query: string): Promise<View>;
  /** The rates the calculator converts currencies with, or `null` before any have been fetched. */
  getExchangeRates(): Promise<ExchangeRates | null>;
  hide(): void;
  /** The window follows the pointer, snapping to guides, until `endDrag`. */
  startDrag(): void;
  endDrag(): void;
  onShown(listener: (info: ShownInfo) => void): () => void;
  onHidden(listener: () => void): () => void;
  onRootItemsChanged(listener: () => void): () => void;
  onExchangeRatesChanged(listener: () => void): () => void;
  onToast(listener: (toast: ToastMessage) => void): () => void;
  /** Requests that came before anything listened are handed over when something does. */
  onRunCommand(listener: (request: CommandRequest) => void): () => void;
}
