import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalAccelerator, LAUNCHER_CLASH } from '../shared/command-hotkeys';
import type { CommandRef } from '../shared/types';

vi.mock('electron', () => ({ globalShortcut: {} }));

const { CommandHotkeys, changeCommandHotkey, problemMessage, REFUSED } = await import('./command-hotkeys');
const { HotkeyManager, changeHotkey } = await import('./hotkey');

/** Stands in for Electron's globalShortcut: one holder per set of keys, and some it refuses. */
function fakeShortcuts(refused: string[] = []) {
  const held = new Map<string, () => void>();
  const keys = (accelerator: string) => canonicalAccelerator(accelerator, 'linux');
  return {
    held,
    /** Presses the keys, if anything holds them. */
    press: (accelerator: string) => held.get(keys(accelerator))?.(),
    isRegistered: (accelerator: string) => held.has(keys(accelerator)),
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (accelerator === 'Bogus') throw new Error('Invalid accelerator');
      if (refused.includes(accelerator) || held.has(keys(accelerator))) return false;
      held.set(keys(accelerator), callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => {
      held.delete(keys(accelerator));
    }),
    unregisterAll: vi.fn(() => held.clear()),
  };
}

const COMMANDS = new Map([
  ['window-management/left-half', 'Left Half'],
  ['window-management/right-half', 'Right Half'],
  ['files/search', 'Search Files'],
]);

function setup(options: { wanted?: Record<string, string>; refused?: string[]; launcher?: string } = {}) {
  const shortcuts = fakeShortcuts(options.refused);
  const settings = {
    hotkey: options.launcher ?? 'Alt+Space',
    commandHotkeys: { ...(options.wanted ?? {}) },
  };
  let commands = new Map(COMMANDS);
  const pressed: CommandRef[] = [];
  const problems: string[] = [];
  const onChange = vi.fn();
  const launcher = new HotkeyManager(() => pressed.push({ extension: 'launcher', command: 'toggle' }), shortcuts);
  const hotkeys = new CommandHotkeys({
    platform: 'linux',
    wanted: () => settings.commandHotkeys,
    commands: () => commands,
    launcherHotkey: () => launcher.current,
    onPress: (ref) => pressed.push(ref),
    onProblem: (message) => problems.push(message),
    onChange,
    shortcuts,
  });
  launcher.share(hotkeys);
  const store = {
    get: () => settings,
    update(patch: Partial<typeof settings>) {
      Object.assign(settings, patch);
      hotkeys.sync();
    },
  };
  return {
    shortcuts,
    settings,
    store,
    launcher,
    hotkeys,
    pressed,
    problems,
    onChange,
    setCommands(next: Map<string, string>) {
      commands = next;
    },
  };
}

describe('CommandHotkeys', () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup({ wanted: { 'window-management/left-half': 'Control+Alt+Left', 'files/search': 'Control+Alt+F' } });
    env.launcher.set('Alt+Space');
  });

  it('registers each command’s shortcut beside the launcher’s, and runs the command when pressed', () => {
    expect(env.shortcuts.isRegistered('Alt+Space')).toBe(true);
    expect(env.shortcuts.isRegistered('Control+Alt+Left')).toBe(true);
    expect(env.hotkeys.activeFor('files/search')).toBe('Control+Alt+F');
    env.shortcuts.press('Control+Alt+Left');
    expect(env.pressed).toEqual([{ extension: 'window-management', command: 'left-half' }]);
    expect(env.problems).toEqual([]);
  });

  it('follows the settings: new shortcuts registered, changed ones swapped, removed ones let go', () => {
    env.onChange.mockClear();
    env.store.update({
      commandHotkeys: {
        'window-management/left-half': 'Control+Alt+H',
        'window-management/right-half': 'Control+Alt+L',
      },
    });
    expect(env.shortcuts.isRegistered('Control+Alt+Left')).toBe(false);
    expect(env.shortcuts.isRegistered('Control+Alt+H')).toBe(true);
    expect(env.shortcuts.isRegistered('Control+Alt+L')).toBe(true);
    expect(env.shortcuts.isRegistered('Control+Alt+F')).toBe(false);
    expect(env.onChange).toHaveBeenCalledTimes(1);
    // Nothing changed, nothing to say.
    env.hotkeys.sync();
    expect(env.onChange).toHaveBeenCalledTimes(1);
  });

  it('follows the commands: a command that goes loses its shortcut, and gets it back when it returns', () => {
    env.setCommands(new Map([['window-management/left-half', 'Left Half']]));
    env.hotkeys.sync();
    expect(env.shortcuts.isRegistered('Control+Alt+F')).toBe(false);
    expect(env.hotkeys.problemFor('files/search')).toBeUndefined();
    env.setCommands(new Map(COMMANDS));
    env.hotkeys.sync();
    expect(env.shortcuts.isRegistered('Control+Alt+F')).toBe(true);
    expect(env.problems).toEqual([]);
  });

  it('reports a clash with another command once, and lets the second have it once the first lets go', () => {
    env.store.update({
      commandHotkeys: { ...env.settings.commandHotkeys, 'window-management/right-half': 'Alt+Control+Left' },
    });
    expect(env.hotkeys.problemFor('window-management/right-half')).toBe('Left Half already uses it.');
    expect(env.problems).toEqual(['Alt+Control+Left for Right Half isn’t working. Left Half already uses it.']);
    env.hotkeys.sync();
    expect(env.problems).toHaveLength(1);

    const { 'window-management/left-half': _gone, ...rest } = env.settings.commandHotkeys;
    env.store.update({ commandHotkeys: rest });
    expect(env.hotkeys.problemFor('window-management/right-half')).toBeUndefined();
    env.shortcuts.press('Control+Alt+Left');
    expect(env.pressed).toEqual([{ extension: 'window-management', command: 'right-half' }]);
  });

  it('reports a shortcut the system refuses, and tries it again later', () => {
    env = setup({ wanted: { 'files/search': 'Control+Alt+F' }, refused: ['Control+Alt+F'] });
    env.launcher.set('Alt+Space');
    expect(env.hotkeys.problemFor('files/search')).toBe(REFUSED);
    expect(env.problems).toEqual([`Control+Alt+F for Search Files isn’t working. ${REFUSED}`]);
    env.hotkeys.sync();
    expect(env.problems).toHaveLength(1);
  });

  it('pauses with the launcher’s shortcut while one is recorded, and comes back after', () => {
    env.launcher.pause();
    expect(env.shortcuts.held.size).toBe(0);
    // Still what works, as far as Settings and the launcher are concerned.
    expect(env.hotkeys.activeFor('files/search')).toBe('Control+Alt+F');
    env.hotkeys.sync();
    expect(env.shortcuts.held.size).toBe(0);
    env.launcher.resume();
    expect(env.shortcuts.isRegistered('Alt+Space')).toBe(true);
    expect(env.shortcuts.isRegistered('Control+Alt+F')).toBe(true);
  });

  it('comes back when a new launcher shortcut is set while paused, as setup does', () => {
    env.launcher.pause();
    expect(env.launcher.set('Control+Space')).toBe(true);
    expect(env.shortcuts.isRegistered('Control+Space')).toBe(true);
    expect(env.shortcuts.isRegistered('Alt+Space')).toBe(false);
    expect(env.shortcuts.isRegistered('Control+Alt+F')).toBe(true);
  });
});

describe('the launcher’s shortcut and the commands’', () => {
  it('lets the launcher take a command’s shortcut written in settings.json, and says so', () => {
    const env = setup({ wanted: { 'files/search': 'Control+Alt+F' } });
    env.launcher.set('Alt+Space');
    env.onChange.mockClear();
    expect(env.launcher.set('Control+Alt+F')).toBe(true);
    // The launcher and Settings stop showing it beside the command.
    expect(env.onChange).toHaveBeenCalledTimes(1);
    expect(env.hotkeys.activeFor('files/search')).toBeUndefined();
    env.shortcuts.press('Control+Alt+F');
    expect(env.pressed).toEqual([{ extension: 'launcher', command: 'toggle' }]);
    expect(env.hotkeys.problemFor('files/search')).toBe(LAUNCHER_CLASH);
    expect(env.problems).toEqual([`Control+Alt+F for Search Files isn’t working. ${LAUNCHER_CLASH}`]);
    // The launcher's old one is free again; going back gives the command its own back.
    expect(env.launcher.set('Alt+Space')).toBe(true);
    expect(env.hotkeys.problemFor('files/search')).toBeUndefined();
    expect(env.shortcuts.isRegistered('Control+Alt+F')).toBe(true);
  });

  it('gives a command its shortcut back when the launcher couldn’t use it after all', () => {
    const env = setup({ wanted: { 'files/search': 'Control+Alt+F' }, refused: [] });
    env.launcher.set('Alt+Space');
    env.shortcuts.register.mockImplementationOnce(() => false);
    expect(env.launcher.set('Control+Alt+F')).toBe(false);
    expect(env.launcher.current).toBe('Alt+Space');
    expect(env.shortcuts.isRegistered('Control+Alt+F')).toBe(true);
    expect(env.hotkeys.problemFor('files/search')).toBeUndefined();
  });

  it('won’t record a command’s shortcut as the launcher’s', () => {
    const env = setup({ wanted: { 'files/search': 'Control+Alt+F' } });
    env.launcher.set('Alt+Space');
    env.launcher.pause();
    const error = changeHotkey(env.launcher, env.store, 'Alt+Control+F');
    expect(error).toMatch(/^Search Files already uses Alt\+Control\+F/);
    expect(env.settings.hotkey).toBe('Alt+Space');
    // Recording is over either way.
    expect(env.shortcuts.isRegistered('Alt+Space')).toBe(true);
    expect(env.shortcuts.isRegistered('Control+Alt+F')).toBe(true);
  });
});

describe('changeCommandHotkey', () => {
  const left = 'window-management/left-half';

  it('saves a shortcut that works, registered before the old one is let go', () => {
    const env = setup({ wanted: { [left]: 'Control+Alt+Left' } });
    env.launcher.set('Alt+Space');
    env.launcher.pause();
    expect(changeCommandHotkey(env.launcher, env.hotkeys, env.store, left, 'Control+Alt+H')).toBeUndefined();
    expect(env.settings.commandHotkeys).toEqual({ [left]: 'Control+Alt+H' });
    expect(env.shortcuts.isRegistered('Control+Alt+H')).toBe(true);
    expect(env.shortcuts.isRegistered('Control+Alt+Left')).toBe(false);
    expect(env.shortcuts.isRegistered('Alt+Space')).toBe(true);
    const registeredNew = env.shortcuts.register.mock.calls.findIndex(
      ([accelerator]) => accelerator === 'Control+Alt+H',
    );
    const releasedOld = env.shortcuts.unregister.mock.invocationCallOrder.at(-1) ?? 0;
    expect(env.shortcuts.register.mock.invocationCallOrder[registeredNew]).toBeLessThan(releasedOld);
  });

  it('keeps the old one when the new one clashes or is refused, and says why', () => {
    const env = setup({
      wanted: { [left]: 'Control+Alt+Left', 'files/search': 'Control+Alt+F' },
      refused: ['Alt+F12'],
    });
    env.launcher.set('Alt+Space');
    const change = (accelerator: string) =>
      changeCommandHotkey(env.launcher, env.hotkeys, env.store, left, accelerator);
    expect(change('Alt+Space')).toBe(LAUNCHER_CLASH);
    expect(change('Control+Alt+F')).toBe('Search Files already uses it.');
    expect(change('Alt+F12')).toBe(`Couldn’t use Alt+F12. ${REFUSED}`);
    expect(change('Bogus')).toBe('That isn’t a shortcut a command can use.');
    expect(env.settings.commandHotkeys[left]).toBe('Control+Alt+Left');
    expect(env.shortcuts.isRegistered('Control+Alt+Left')).toBe(true);
    expect(env.problems).toEqual([]);
  });

  it('takes the same keys spelled another way without a fuss', () => {
    const env = setup({ wanted: { [left]: 'Control+Alt+Left' } });
    env.launcher.set('Alt+Space');
    expect(changeCommandHotkey(env.launcher, env.hotkeys, env.store, left, 'Alt+Control+Left')).toBeUndefined();
    expect(env.settings.commandHotkeys[left]).toBe('Alt+Control+Left');
    expect(env.shortcuts.isRegistered('Control+Alt+Left')).toBe(true);
  });

  it('clears one, and refuses what isn’t a command', () => {
    const env = setup({ wanted: { [left]: 'Control+Alt+Left', 'files/search': 'Control+Alt+F' } });
    env.launcher.set('Alt+Space');
    expect(changeCommandHotkey(env.launcher, env.hotkeys, env.store, left, null)).toBeUndefined();
    expect(env.settings.commandHotkeys).toEqual({ 'files/search': 'Control+Alt+F' });
    expect(env.shortcuts.isRegistered('Control+Alt+Left')).toBe(false);
    expect(changeCommandHotkey(env.launcher, env.hotkeys, env.store, 'nonsense', 'Alt+N')).toBe(
      'That isn’t a command.',
    );
    expect(changeCommandHotkey(env.launcher, env.hotkeys, env.store, 'gone/command', 'Alt+N')).toBe(
      'That command isn’t available here.',
    );
  });

  it('drops a shortcut left behind by a command that isn’t here, so it can’t take this one back', () => {
    const env = setup({ wanted: { 'gone/command': 'Control+Alt+G', 'files/search': 'Control+Alt+F' } });
    env.launcher.set('Alt+Space');
    expect(changeCommandHotkey(env.launcher, env.hotkeys, env.store, left, 'Alt+Control+G')).toBeUndefined();
    expect(env.settings.commandHotkeys).toEqual({ 'files/search': 'Control+Alt+F', [left]: 'Alt+Control+G' });
  });
});

describe('problemMessage', () => {
  it('names every command that couldn’t have its shortcut', () => {
    const message = problemMessage(
      [
        { key: 'window-management/left-half', reason: REFUSED, accelerator: 'Alt+L' },
        { key: 'files/search', reason: LAUNCHER_CLASH, accelerator: 'Alt+Space' },
        { key: 'gone/command', reason: REFUSED, accelerator: 'Alt+G' },
      ],
      COMMANDS,
    );
    expect(message).toBe(
      'The shortcuts for Left Half, Search Files and gone/command aren’t working. Settings → Extensions says why.',
    );
  });
});
