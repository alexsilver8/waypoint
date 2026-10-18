import { describe, expect, it } from 'vitest';
import {
  canonicalAccelerator,
  commandDeeplink,
  commandFromDeeplink,
  commandInArgv,
  commandKey,
  commandRefFromKey,
  isUsableAccelerator,
  LAUNCHER_CLASH,
  launchArguments,
  planCommandHotkeys,
} from './command-hotkeys';
import { normalizeSettings } from './settings';

describe('commandRefFromKey', () => {
  it('reads "<extension>/<command>"', () => {
    expect(commandRefFromKey('window-management/left-half')).toEqual({
      extension: 'window-management',
      command: 'left-half',
    });
    expect(commandKey({ extension: 'keep-awake', command: 'toggle' })).toBe('keep-awake/toggle');
  });

  it('refuses anything else', () => {
    for (const key of ['left-half', 'a/b/c', '/b', 'a/', 'Window/Left', 'a b/c', '../x', 'a/-b']) {
      expect(commandRefFromKey(key)).toBeUndefined();
    }
  });
});

describe('isUsableAccelerator', () => {
  it('takes modifiers and one key', () => {
    for (const accelerator of [
      'Alt+Shift+L',
      'CommandOrControl+Space',
      'Control+Alt+Left',
      'Super+F',
      'Cmd+Plus',
      'Option+/',
      'Ctrl+num5',
      'F5',
      'MediaPlayPause',
      'Shift+F12',
    ]) {
      expect(isUsableAccelerator(accelerator), accelerator).toBe(true);
    }
  });

  it('needs a modifier besides Shift, unless nobody types with the key', () => {
    expect(isUsableAccelerator('L')).toBe(false);
    expect(isUsableAccelerator('Shift+L')).toBe(false);
    expect(isUsableAccelerator('Space')).toBe(false);
  });

  it('refuses what Electron would not read', () => {
    for (const value of ['', 'Alt+', 'Alt++', 'Hyper+L', 'Alt+Foo', 'Alt+L+K', 42, null, undefined]) {
      expect(isUsableAccelerator(value), String(value)).toBe(false);
    }
  });
});

describe('canonicalAccelerator', () => {
  it('spells the same keys the same way, however they are written', () => {
    expect(canonicalAccelerator('Shift+CmdOrCtrl+K', 'linux')).toBe(canonicalAccelerator('control+shift+k', 'linux'));
    expect(canonicalAccelerator('Option+Return', 'darwin')).toBe(canonicalAccelerator('Alt+Enter', 'darwin'));
  });

  it('knows what CommandOrControl and Super mean on each platform', () => {
    expect(canonicalAccelerator('CommandOrControl+K', 'darwin')).toBe(canonicalAccelerator('Command+K', 'darwin'));
    expect(canonicalAccelerator('CommandOrControl+K', 'darwin')).not.toBe(canonicalAccelerator('Control+K', 'darwin'));
    expect(canonicalAccelerator('CommandOrControl+K', 'win32')).toBe(canonicalAccelerator('Control+K', 'win32'));
    expect(canonicalAccelerator('Super+K', 'darwin')).toBe(canonicalAccelerator('Cmd+K', 'darwin'));
    expect(canonicalAccelerator('Super+K', 'linux')).not.toBe(canonicalAccelerator('Control+K', 'linux'));
  });
});

describe('commandHotkeys in settings', () => {
  it('is empty by default', () => {
    expect(normalizeSettings({}).settings.commandHotkeys).toEqual({});
  });

  it('keeps commands with usable shortcuts', () => {
    const { settings, problems } = normalizeSettings({
      commandHotkeys: { 'window-management/left-half': ' Control+Alt+Left ', 'keep-awake/toggle': 'F9' },
    });
    expect(settings.commandHotkeys).toEqual({
      'window-management/left-half': 'Control+Alt+Left',
      'keep-awake/toggle': 'F9',
    });
    expect(problems).toEqual([]);
  });

  it('drops entries that name no command or give no usable shortcut, and says so', () => {
    const { settings, problems } = normalizeSettings({
      commandHotkeys: {
        'left-half': 'Alt+L',
        'files/search': 'Alt+Hyper',
        'emoji/search': 7,
        'gitmoji/search': 'G',
        'keep-awake/toggle': 'Alt+K',
      },
    });
    expect(settings.commandHotkeys).toEqual({ 'keep-awake/toggle': 'Alt+K' });
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/commandHotkeys\.left-half/);
  });

  it('lets an empty shortcut clear one quietly', () => {
    const { settings, problems } = normalizeSettings({ commandHotkeys: { 'files/search': '', 'emoji/search': null } });
    expect(settings.commandHotkeys).toEqual({});
    expect(problems).toEqual([]);
  });

  it('ignores something that is not a map', () => {
    for (const commandHotkeys of [['files/search'], 'Alt+F', 3]) {
      const { settings, problems } = normalizeSettings({ commandHotkeys });
      expect(settings.commandHotkeys).toEqual({});
      expect(problems).toEqual(['Ignoring invalid value for "commandHotkeys".']);
    }
  });
});

describe('planCommandHotkeys', () => {
  const commands = new Map([
    ['window-management/left-half', 'Left Half'],
    ['window-management/right-half', 'Right Half'],
    ['files/search', 'Search Files'],
  ]);

  it('registers every shortcut that clashes with nothing', () => {
    const plan = planCommandHotkeys({
      wanted: { 'window-management/left-half': 'Control+Alt+Left', 'files/search': 'Control+Alt+F' },
      commands,
      launcher: 'Alt+Space',
      platform: 'linux',
    });
    expect([...plan.register]).toEqual([
      ['window-management/left-half', 'Control+Alt+Left'],
      ['files/search', 'Control+Alt+F'],
    ]);
    expect(plan.problems.size).toBe(0);
  });

  it('leaves the launcher its shortcut', () => {
    const plan = planCommandHotkeys({
      wanted: { 'files/search': 'alt+space' },
      commands,
      launcher: 'Alt+Space',
      platform: 'linux',
    });
    expect(plan.register.size).toBe(0);
    expect(plan.problems.get('files/search')).toBe(LAUNCHER_CLASH);
  });

  it('gives a shortcut two commands want to the one written first, and says who has it', () => {
    const plan = planCommandHotkeys({
      wanted: {
        'window-management/right-half': 'CommandOrControl+Alt+H',
        'window-management/left-half': 'Alt+Control+H',
      },
      commands,
      launcher: undefined,
      platform: 'win32',
    });
    expect([...plan.register.keys()]).toEqual(['window-management/right-half']);
    expect(plan.problems.get('window-management/left-half')).toBe('Right Half already uses it.');
  });

  it('skips commands that are not here, without a problem and without taking their shortcut', () => {
    const plan = planCommandHotkeys({
      wanted: { 'gone/command': 'Alt+G', 'files/search': 'Alt+G' },
      commands,
      launcher: undefined,
      platform: 'darwin',
    });
    expect([...plan.register]).toEqual([['files/search', 'Alt+G']]);
    expect(plan.problems.size).toBe(0);
  });
});

describe('running a command from outside', () => {
  const ref = { extension: 'window-management', command: 'left-half' };

  it('makes and reads waypoint://commands links', () => {
    expect(commandDeeplink(ref)).toBe('waypoint://commands/window-management/left-half');
    expect(commandFromDeeplink(commandDeeplink(ref))).toEqual(ref);
    expect(commandFromDeeplink('waypoint://commands/window-management/left-half/')).toEqual(ref);
    expect(commandFromDeeplink('waypoint://notes/groceries')).toBeUndefined();
    expect(commandFromDeeplink('waypoint://commands/left-half')).toBeUndefined();
    expect(commandFromDeeplink('https://commands/a/b')).toBeUndefined();
    expect(commandFromDeeplink('not a link')).toBeUndefined();
  });

  it('reads --command with its value apart or joined', () => {
    expect(commandInArgv(['/usr/bin/waypoint', '--command', 'window-management/left-half'])).toEqual(ref);
    expect(commandInArgv(['/usr/bin/waypoint', '--no-sandbox', '--command=window-management/left-half'])).toEqual(ref);
    expect(commandInArgv(['/usr/bin/waypoint', '--command'])).toBeUndefined();
    expect(commandInArgv(['/usr/bin/waypoint', '--command', 'nonsense'])).toBeUndefined();
    expect(commandInArgv(['/usr/bin/waypoint', '--show'])).toBeUndefined();
    expect(commandInArgv(undefined)).toBeUndefined();
  });

  it('ignores --command when the system started Waypoint for a link', () => {
    // On Windows a link with a quote in it can add arguments of its own.
    expect(
      commandInArgv(['C:\\Waypoint\\Waypoint.exe', 'waypoint://commands/x/y', '--command', 'system/restart']),
    ).toBeUndefined();
    expect(commandInArgv(['/usr/bin/waypoint', '--command=system/restart', 'WAYPOINT://notes/a'])).toBeUndefined();
    expect(commandInArgv(['/usr/bin/waypoint', 'waypoint:x', '--command', 'system/restart'])).toBeUndefined();
  });

  it('prefers the arguments a second copy sent itself, in their order', () => {
    const sent = ['/usr/bin/waypoint', '--command', 'files/search'];
    expect(launchArguments(['/usr/bin/waypoint', '--command', '--x', 'files/search'], { argv: sent })).toEqual(sent);
    expect(launchArguments(['/usr/bin/waypoint'], undefined)).toEqual(['/usr/bin/waypoint']);
    expect(launchArguments(undefined, { argv: [1, 2] })).toEqual([]);
  });
});
