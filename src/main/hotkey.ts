import { globalShortcut } from 'electron';

/**
 * Owns the global shortcut. A new shortcut is registered before the old one is released,
 * so a typo or a shortcut taken by another app never leaves you without one.
 */
export class HotkeyManager {
  private active: string | undefined;
  private paused = false;

  constructor(private readonly onPress: () => void) {}

  /** The shortcut that currently opens the launcher, if any. */
  get current(): string | undefined {
    return this.active;
  }

  set(accelerator: string): boolean {
    if (accelerator === this.active && !this.paused) return true;
    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, this.onPress);
    } catch {
      // An invalid accelerator throws.
    }
    if (!registered) {
      if (this.paused) this.resume();
      return false;
    }
    if (this.active && this.active !== accelerator && !this.paused) globalShortcut.unregister(this.active);
    this.active = accelerator;
    this.paused = false;
    return true;
  }

  /** Lets the Settings window record a shortcut without the current one firing. */
  pause(): void {
    if (this.paused || !this.active) return;
    globalShortcut.unregister(this.active);
    this.paused = true;
  }

  resume(): void {
    if (!this.paused || !this.active) return;
    this.paused = false;
    try {
      globalShortcut.register(this.active, this.onPress);
    } catch {
      // It worked before; nothing better to do if it no longer does.
    }
  }

  dispose(): void {
    globalShortcut.unregisterAll();
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
  if (!hotkeys.set(accelerator)) {
    return `Couldn’t use ${accelerator}. Another app may already use it; try a different one.`;
  }
  settings.update({ hotkey: accelerator });
  return undefined;
}
