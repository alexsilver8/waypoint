/**
 * Expands snippets as you type, in any app: type a snippet's keyword, and it's erased and the
 * snippet pasted in its place. A system-wide keyboard hook watches what's typed; the same hook
 * presses Backspace and paste. The clipboard is put back as it was afterwards.
 */
import { EventEmitter } from 'node:events';
import { valuesWithClipboard } from '../../shared/placeholders';
import { expandSnippet, type Snippet, type SnippetExpansionStatus } from '../../shared/snippets';
import type { Platform } from '../../shared/types';
import { isWayland } from '../paste';
import { type KeyPress, keywordAtEnd, TypedKeys } from './typed-keys';

/** The system-wide hook: the keys going down, the mouse, and keys to press. */
export interface KeyboardHook {
  onKeyDown(listener: (key: KeyPress) => void): void;
  /** A click can move the cursor, so what was typed before it no longer leads up to it. */
  onMouseDown(listener: () => void): void;
  start(): void;
  stop(): void;
  /** Presses and lets go of a key, holding the modifiers (keycodes too) down around it. */
  tap(keycode: number, modifiers?: number[]): void;
}

/** What's on the clipboard, to put back. */
export interface ClipboardKeeper<Saved> {
  save(): Promise<Saved>;
  write(text: string): Promise<void>;
  restore(saved: Saved): Promise<void>;
}

export interface ExpanderOptions<Saved> {
  platform: Platform;
  /** Loads the hook; throws when it can't be (its library missing, say). */
  loadHook(): Promise<KeyboardHook>;
  snippets(): readonly Snippet[];
  /** Whether a Waypoint window has the keyboard: the launcher finds snippets by keyword itself. */
  waypointFocused(): boolean;
  /** Whether macOS lets Waypoint watch and press keys; `prompt` asks it to show its dialog. */
  trusted(prompt: boolean): boolean;
  readClipboard(): Promise<string>;
  clipboard: ClipboardKeeper<Saved>;
  env?: NodeJS.ProcessEnv;
  wait?(ms: number): Promise<void>;
}

const BACKSPACE = 14;
const V = 47;
const CTRL = 29;
const META = 3675;
/** Room for the longest keyword (50) and the character before it. */
const TYPED_LENGTH = 51;
/** Lets the app take the keyword's last key before it's erased. */
const KEY_DELAY_MS = 30;
/** How long the app has to read the clipboard before it's put back. */
const RESTORE_DELAY_MS = 400;
/** How often to look whether Accessibility was turned on, while waiting for it. */
const TRUST_POLL_MS = 2000;

export class SnippetExpander<Saved> extends EventEmitter<{ status: [SnippetExpansionStatus] }> {
  private enabled = false;
  private hook: KeyboardHook | undefined;
  private running = false;
  private expanding = false;
  private trustTimer: NodeJS.Timeout | undefined;
  private current: SnippetExpansionStatus = 'off';
  private readonly typed = new TypedKeys(TYPED_LENGTH);
  private readonly wait: (ms: number) => Promise<void>;

  constructor(private readonly options: ExpanderOptions<Saved>) {
    super();
    this.wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get status(): SnippetExpansionStatus {
    return this.current;
  }

  /**
   * Turns expansion on or off, as the setting says. `prompt`: on macOS, ask for Accessibility if
   * it's missing (when it's just been turned on, not each time Waypoint starts).
   */
  async setEnabled(enabled: boolean, prompt = true): Promise<void> {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
      this.setStatus('off');
      return;
    }
    await this.tryStart(prompt);
  }

  /** Asks macOS for Accessibility again, from Settings. */
  askForAccess(): void {
    if (this.options.platform === 'darwin') this.options.trusted(true);
  }

  dispose(): void {
    this.enabled = false;
    this.stop();
  }

  private async tryStart(prompt: boolean): Promise<void> {
    if (!this.enabled || this.running) return;
    const { platform } = this.options;
    // The hook reads X11; apps on Wayland keep their keys to themselves.
    if (platform === 'linux' && isWayland(this.options.env)) {
      this.setStatus('unsupported');
      return;
    }
    if (platform === 'darwin' && !this.options.trusted(prompt)) {
      this.setStatus('needs-accessibility');
      this.trustTimer ??= setInterval(() => void this.tryStart(false), TRUST_POLL_MS);
      return;
    }
    clearInterval(this.trustTimer);
    this.trustTimer = undefined;
    try {
      if (!this.hook) {
        const hook = await this.options.loadHook();
        hook.onKeyDown((key) => this.keyDown(key));
        hook.onMouseDown(() => this.typed.reset());
        this.hook = hook;
      }
      // Turned off while the hook loaded.
      if (!this.enabled) return;
      this.hook.start();
      this.running = true;
      this.setStatus('on');
    } catch (error) {
      console.warn('[snippets] Could not watch the keyboard:', error);
      this.setStatus('unavailable');
    }
  }

  private stop(): void {
    clearInterval(this.trustTimer);
    this.trustTimer = undefined;
    if (this.running) this.hook?.stop();
    this.running = false;
    this.typed.reset();
  }

  private setStatus(status: SnippetExpansionStatus): void {
    if (status === this.current) return;
    this.current = status;
    this.emit('status', status);
  }

  private keyDown(key: KeyPress): void {
    // The keys it presses itself come back through the hook too.
    if (this.expanding) return;
    if (this.options.waypointFocused()) {
      this.typed.reset();
      return;
    }
    this.typed.press(key);
    const snippets = this.options.snippets();
    const keyword = keywordAtEnd(
      this.typed.text,
      snippets.flatMap((snippet) => (snippet.keyword ? [snippet.keyword] : [])),
    );
    const snippet = keyword && snippets.find((s) => s.keyword?.toLowerCase() === keyword.toLowerCase());
    if (snippet && keyword) void this.expand(snippet, keyword.length);
  }

  private async expand(snippet: Snippet, typedLength: number): Promise<void> {
    const hook = this.hook;
    if (!hook) return;
    this.expanding = true;
    this.typed.reset();
    const { clipboard, readClipboard, platform } = this.options;
    let saved: Saved | undefined;
    try {
      // Placeholders read the clipboard before the snippet takes its place there.
      const text = expandSnippet(snippet.text, await valuesWithClipboard([snippet.text], readClipboard));
      saved = await clipboard.save();
      await this.wait(KEY_DELAY_MS);
      for (let i = 0; i < typedLength; i++) hook.tap(BACKSPACE);
      await clipboard.write(text);
      hook.tap(V, [platform === 'darwin' ? META : CTRL]);
      await this.wait(RESTORE_DELAY_MS);
    } catch (error) {
      console.warn(`[snippets] Could not expand “${snippet.name}”:`, error);
    } finally {
      if (saved !== undefined) await clipboard.restore(saved).catch((error) => console.warn('[snippets]', error));
      this.typed.reset();
      this.expanding = false;
    }
  }
}
