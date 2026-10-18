import { Notification } from 'electron';
import type { Platform } from '../shared/types';
import { CommandHotkeys, commandTitles } from './command-hotkeys';
import { CommandRunner } from './command-runner';
import type { HotkeyManager } from './hotkey';
import { finishAction } from './ipc';
import type { CommandRegistry } from './registry';
import type { SettingsStore } from './settings';
import type { LauncherWindow } from './window';

export interface CommandShortcutsOptions {
  platform: Platform;
  settings: SettingsStore;
  registry: CommandRegistry;
  launcher: LauncherWindow;
  /** The launcher's shortcut, which comes first and pauses the commands' with its own. */
  hotkeys: HotkeyManager;
  /** Which shortcuts work changed: the launcher and Settings show them. */
  onChange(): void;
}

/** A quiet system notification, where the system has them. */
function notify(title: string, body: string): boolean {
  if (!Notification.isSupported()) return false;
  new Notification({ title, body, silent: true }).show();
  return true;
}

/**
 * Every command's own shortcut, and what runs a command from outside the launcher: those
 * shortcuts, `waypoint --command <extension>/<command>` and `waypoint://commands/…` links.
 */
export function commandShortcuts({
  platform,
  settings,
  registry,
  launcher,
  hotkeys,
  onChange,
}: CommandShortcutsOptions): {
  hotkeys: CommandHotkeys;
  runner: CommandRunner;
} {
  const runner = new CommandRunner({
    registry,
    launcher,
    finish: (result) => finishAction(result, launcher, { pasteIntoApps: () => settings.get().pasteIntoApps }),
    notify,
  });
  const commandHotkeys = new CommandHotkeys({
    platform,
    wanted: () => settings.get().commandHotkeys,
    commands: () => commandTitles(registry.listCommands()),
    launcherHotkey: () => hotkeys.current,
    onPress: (ref) => void runner.run(ref),
    onProblem: (text) => launcher.toast({ text, style: 'failure' }),
    onChange,
  });
  hotkeys.share(commandHotkeys);
  // Commands come and go as extensions load, and with them the shortcuts that run them.
  registry.on('change', () => commandHotkeys.sync());
  // After the launcher's new shortcut, if there is one, so swapping the two isn't taken for a clash.
  settings.on('change', () => queueMicrotask(() => commandHotkeys.sync()));
  return { hotkeys: commandHotkeys, runner };
}
