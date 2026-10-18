import { globalShortcut } from 'electron';

/** The part of Electron's `globalShortcut` the shortcut managers use, so tests can stand in for it. */
export interface GlobalShortcuts {
  /** Throws for an accelerator it can't read; false when the system won't give it out. */
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  unregisterAll(): void;
}

/** The global shortcuts beside the launcher's: every command's own (see `CommandHotkeys`). */
export interface SharedShortcuts {
  /** While a shortcut is being recorded, none of them fire. */
  pause(): void;
  resume(): void;
  /** The title of the command that has this shortcut, if one does. */
  usedBy(accelerator: string): string | undefined;
  /** Lets go of this shortcut if a command has it: the launcher's comes first. */
  release(accelerator: string): void;
  /** The launcher's shortcut changed, or stayed after a change failed; sort the others out again. */
  sync(): void;
}

/**
 * Owns the global shortcut. A new shortcut is registered before the old one is released,
 * so a typo or a shortcut taken by another app never leaves you without one.
 */
export class HotkeyManager {
  private active: string | undefined;
  private paused = false;
  private shared: SharedShortcuts | undefined;

  constructor(
    private readonly onPress: () => void,
    private readonly shortcuts: GlobalShortcuts = globalShortcut,
  ) {}

  /** The shortcut that currently opens the launcher, if any. */
  get current(): string | undefined {
    return this.active;
  }

  /** Pauses and resumes the commands' shortcuts with this one, and keeps them out of its way. */
  share(shared: SharedShortcuts): void {
    this.shared = shared;
  }

  /** The command that already has this shortcut, if one does. */
  usedBy(accelerator: string): string | undefined {
    return this.shared?.usedBy(accelerator);
  }

  set(accelerator: string): boolean {
    if (accelerator === this.active && !this.paused) return true;
    this.shared?.release(accelerator);
    let registered = false;
    try {
      registered = this.shortcuts.register(accelerator, this.onPress);
    } catch {
      // An invalid accelerator throws.
    }
    if (!registered) {
      if (this.paused) this.resume();
      this.shared?.sync();
      return false;
    }
    if (this.active && this.active !== accelerator && !this.paused) this.shortcuts.unregister(this.active);
    this.active = accelerator;
    if (this.paused) {
      this.paused = false;
      this.shared?.resume();
    }
    this.shared?.sync();
    return true;
  }

  /** Lets the Settings window record a shortcut without the current one, or a command's, firing. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    if (this.active) this.shortcuts.unregister(this.active);
    this.shared?.pause();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.active) {
      try {
        this.shortcuts.register(this.active, this.onPress);
      } catch {
        // It worked before; nothing better to do if it no longer does.
      }
    }
    this.shared?.resume();
  }

  dispose(): void {
    this.shortcuts.unregisterAll();
  }
}

/**
 * Switches to a shortcut someone picked and saves it. Returns why it couldn't be used, in which
 * case the old one keeps working.
 */
export function changeHotkey(
  hotkeys: HotkeyManager,
  settings: { update(patch: { hotkey: string }): unknown },
  accelerator: unknown,
): string | undefined {
  if (typeof accelerator !== 'string' || !accelerator.trim()) {
    hotkeys.resume();
    return 'That isn’t a shortcut.';
  }
  const command = hotkeys.usedBy(accelerator);
  if (command) {
    hotkeys.resume();
    return `${command} already uses ${accelerator}. Pick another, or remove that one in Settings → Extensions.`;
  }
  if (!hotkeys.set(accelerator)) {
    return `Couldn’t use ${accelerator}. Another app may already use it; try a different one.`;
  }
  settings.update({ hotkey: accelerator });
  return undefined;
}
