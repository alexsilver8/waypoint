import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AutostartCommand,
  autostartCommand,
  autostartEntry,
  autostartFile,
  escapeValue,
  formatExec,
  LinuxLoginItem,
  parseExec,
  quoteExecArg,
  readAutostartEntry,
  runsCommand,
  unescapeValue,
  withCommand,
} from './linux';

const DEB: AutostartCommand = { args: ['/opt/Waypoint/waypoint'], tryExec: '/opt/Waypoint/waypoint', icon: 'waypoint' };

describe('autostartFile', () => {
  it('goes in $XDG_CONFIG_HOME/autostart, or ~/.config/autostart', () => {
    expect(autostartFile({ XDG_CONFIG_HOME: '/home/me/conf' }, '/home/me')).toBe(
      '/home/me/conf/autostart/dev.waypoint.app.desktop',
    );
    expect(autostartFile({}, '/home/me')).toBe('/home/me/.config/autostart/dev.waypoint.app.desktop');
    expect(autostartFile({ XDG_CONFIG_HOME: '' }, '/home/me')).toBe(
      '/home/me/.config/autostart/dev.waypoint.app.desktop',
    );
  });

  it('ignores a relative $XDG_CONFIG_HOME, as the spec says', () => {
    expect(autostartFile({ XDG_CONFIG_HOME: 'conf' }, '/home/me')).toBe(
      '/home/me/.config/autostart/dev.waypoint.app.desktop',
    );
  });

  it('uses the real config folder from inside a Flatpak', () => {
    const sandbox = { FLATPAK_ID: 'dev.waypoint.app', XDG_CONFIG_HOME: '/home/me/.var/app/dev.waypoint.app/config' };
    expect(autostartFile(sandbox, '/home/me')).toBe('/home/me/.config/autostart/dev.waypoint.app.desktop');
    expect(autostartFile({ ...sandbox, HOST_XDG_CONFIG_HOME: '/home/me/conf' }, '/home/me')).toBe(
      '/home/me/conf/autostart/dev.waypoint.app.desktop',
    );
  });

  it("doesn't share a name with the app menu's waypoint.desktop", () => {
    expect(autostartFile({}, '/home/me')).not.toMatch(/\/waypoint\.desktop$/);
  });
});

describe('autostartCommand', () => {
  const packaged = (execPath: string, env: NodeJS.ProcessEnv = {}) =>
    autostartCommand({ execPath, env, packaged: true });

  it('runs the deb (or any unpacked copy) by its executable', () => {
    expect(packaged('/opt/Waypoint/waypoint')).toEqual(DEB);
  });

  it('runs an AppImage from the AppImage file, not its temporary mount', () => {
    const env = { APPIMAGE: '/home/me/Apps/Waypoint.AppImage', APPDIR: '/tmp/.mount_WaypoiAbc123' };
    expect(packaged('/tmp/.mount_WaypoiAbc123/waypoint', env)).toEqual({
      args: ['/home/me/Apps/Waypoint.AppImage'],
      tryExec: '/home/me/Apps/Waypoint.AppImage',
      icon: 'waypoint',
    });
  });

  it('ignores AppImage and Snap variables it only inherited from whatever started it', () => {
    const fromAppImageTerminal = { APPIMAGE: '/home/me/Term.AppImage', APPDIR: '/tmp/.mount_TermXyz' };
    expect(packaged('/opt/Waypoint/waypoint', fromAppImageTerminal)).toEqual(DEB);
    const fromSnapEditor = { SNAP: '/snap/code/200', SNAP_NAME: 'code' };
    expect(packaged('/opt/Waypoint/waypoint', fromSnapEditor)).toEqual(DEB);
    // A folder that only starts the same way doesn't count either.
    expect(packaged('/tmp/.mount_TermXyz2/waypoint', fromAppImageTerminal)).toEqual({
      ...DEB,
      args: ['/tmp/.mount_TermXyz2/waypoint'],
      tryExec: '/tmp/.mount_TermXyz2/waypoint',
    });
  });

  it('goes through snap run in a Snap', () => {
    const env = { SNAP: '/snap/waypoint/12', SNAP_NAME: 'waypoint' };
    expect(packaged('/snap/waypoint/12/waypoint', env)).toEqual({
      args: ['snap', 'run', 'waypoint'],
      icon: 'waypoint',
    });
    expect(packaged('/snap/waypoint/12/waypoint', { ...env, SNAP_INSTANCE_NAME: 'waypoint_beta' })?.args).toEqual([
      'snap',
      'run',
      'waypoint_beta',
    ]);
  });

  it('goes through flatpak run in a Flatpak', () => {
    expect(packaged('/app/waypoint/waypoint', { FLATPAK_ID: 'dev.waypoint.app' })).toEqual({
      args: ['flatpak', 'run', 'dev.waypoint.app'],
      icon: 'dev.waypoint.app',
    });
  });

  it('has none from source, where it would start Electron itself', () => {
    const execPath = '/src/waypoint/node_modules/electron/dist/electron';
    expect(autostartCommand({ execPath, env: {}, packaged: false })).toBeNull();
  });
});

describe('Exec quoting', () => {
  it('leaves plain paths alone', () => {
    expect(formatExec(['/opt/Waypoint/waypoint'])).toBe('/opt/Waypoint/waypoint');
    expect(formatExec(['flatpak', 'run', 'dev.waypoint.app'])).toBe('flatpak run dev.waypoint.app');
  });

  it('quotes paths with spaces', () => {
    expect(formatExec(['/home/me/My Apps/Waypoint.AppImage'])).toBe('"/home/me/My Apps/Waypoint.AppImage"');
  });

  it('escapes quotes, backticks, dollars and backslashes inside the quotes, then backslashes again', () => {
    expect(quoteExecArg('/a/"b"')).toBe('"/a/\\"b\\""');
    expect(formatExec(['/a/"b"'])).toBe('"/a/\\\\"b\\\\""');
    // The spec's own examples: a quoted $ is written \\$, and a backslash as four.
    expect(formatExec(['/a/$HOME'])).toBe('"/a/\\\\$HOME"');
    expect(formatExec(['/a\\b'])).toBe('"/a\\\\\\\\b"');
    expect(formatExec(['/a/`b`'])).toBe('"/a/\\\\`b\\\\`"');
  });

  it('quotes the other reserved characters without escaping them', () => {
    expect(formatExec(["/it's/<a>|b&c;d*e?f#g(h)~i"])).toBe('"/it\'s/<a>|b&c;d*e?f#g(h)~i"');
  });

  it('doubles percent signs, quoted or not', () => {
    expect(formatExec(['/home/me/100%/waypoint'])).toBe('/home/me/100%%/waypoint');
    expect(formatExec(['/home/me/100% done/waypoint'])).toBe('"/home/me/100%% done/waypoint"');
  });

  it('keeps empty arguments and line breaks', () => {
    expect(formatExec(['/a', ''])).toBe('/a ""');
    expect(formatExec(['/a\nb\tc'])).toBe('"/a\\nb\\tc"');
  });

  it('reads back what it writes', () => {
    const nasty = [
      '/home/me/My Apps/Waypoint.AppImage',
      '/a/"b" `c` $d \\e',
      "/it's 100% (mine)",
      '/a\\\\b',
      '/line\nbreak\tand tab',
      ' leading space',
      '',
      '%U',
      '%%',
    ];
    for (const arg of nasty) expect(parseExec(formatExec([arg, '--flag']))).toEqual([arg, '--flag']);
    expect(parseExec(formatExec(nasty))).toEqual(nasty);
  });

  it('reads entries written by others, dropping field codes', () => {
    expect(parseExec('/opt/Waypoint/waypoint %U')).toEqual(['/opt/Waypoint/waypoint']);
    expect(parseExec('env FOO=1 "/opt/My App/waypoint" --x  %u')).toEqual([
      'env',
      'FOO=1',
      '/opt/My App/waypoint',
      '--x',
    ]);
    expect(parseExec('"/a/\\\\$b"')).toEqual(['/a/$b']);
  });

  it('escapes other values for the file', () => {
    expect(escapeValue('/a\\b\nc')).toBe('/a\\\\b\\nc');
    expect(escapeValue(' x')).toBe('\\sx');
    expect(unescapeValue('\\sa\\\\b\\nc\\td')).toBe(' a\\b\nc\td');
  });

  // GLib (GNOME, Xfce, Cinnamon) is what starts most autostart entries; check it reads ours the same way.
  const gio = process.platform === 'linux' && spawnSync('gio', ['help', 'launch']).status === 0;
  it.runIf(gio)('starts the right program through GLib, from a folder with every awkward character', async () => {
    const root = mkdtempSync(join(tmpdir(), 'waypoint-exec-'));
    const dir = join(root, 'My "Apps" $HOME `x` \\b \'c\' ;&|<>*?#()~');
    mkdirSync(dir);
    const program = join(dir, 'way point');
    const out = join(root, 'out.txt');
    writeFileSync(program, `#!/bin/sh\nprintf '%s\\n' "$0" "$@" > '${out}'\n`);
    chmodSync(program, 0o755);
    const entry = join(root, 'test.desktop');
    writeFileSync(
      entry,
      `[Desktop Entry]\nType=Application\nName=Test\nExec=${formatExec([program, '100%', "it's"])}\n`,
    );

    const launched = spawnSync('gio', ['launch', entry], { encoding: 'utf8' });
    expect(launched.status, launched.stderr).toBe(0);
    await vi.waitFor(() => expect(existsSync(out)).toBe(true), { timeout: 5000 });
    await vi.waitFor(() => expect(readFileSync(out, 'utf8')).toBe(`${program}\n100%\nit's\n`), { timeout: 5000 });
  });
});

describe('autostartEntry', () => {
  it('is an application entry that desktops start at login', () => {
    expect(
      autostartEntry({
        ...DEB,
        args: ['/home/me/My Apps/Waypoint.AppImage'],
        tryExec: '/home/me/My Apps/Waypoint.AppImage',
      }),
    ).toBe(`# Added by Waypoint for Settings → Open at login. Turning that off removes this file.
[Desktop Entry]
Type=Application
Name=Waypoint
Comment=Keyboard-first launcher, ready in the tray when you log in
Exec="/home/me/My Apps/Waypoint.AppImage"
TryExec=/home/me/My Apps/Waypoint.AppImage
Icon=waypoint
Terminal=false
NoDisplay=false
Hidden=false
X-GNOME-Autostart-enabled=true
`);
  });

  it('has no TryExec for snap run or flatpak run', () => {
    const entry = autostartEntry({ args: ['flatpak', 'run', 'dev.waypoint.app'], icon: 'dev.waypoint.app' });
    expect(entry).toContain('\nExec=flatpak run dev.waypoint.app\n');
    expect(entry).toContain('\nIcon=dev.waypoint.app\n');
    expect(entry).not.toContain('TryExec');
  });

  it('reads back as on, running the command', () => {
    expect(readAutostartEntry(autostartEntry(DEB))).toEqual({ enabled: true, exec: ['/opt/Waypoint/waypoint'] });
  });
});

describe('readAutostartEntry', () => {
  it('is off when a desktop has turned it off', () => {
    expect(readAutostartEntry('[Desktop Entry]\nExec=x\nHidden=true').enabled).toBe(false);
    expect(readAutostartEntry('[Desktop Entry]\nExec=x\nX-GNOME-Autostart-enabled=false').enabled).toBe(false);
    expect(readAutostartEntry('[Desktop Entry]\nExec=x\nHidden = false').enabled).toBe(true);
  });

  it('only reads the Desktop Entry group', () => {
    const text = '[Desktop Action other]\nExec=other\nHidden=true\n[Desktop Entry]\n# Exec=commented\nExec=mine';
    expect(readAutostartEntry(text)).toEqual({ enabled: true, exec: ['mine'] });
  });
});

describe('runsCommand', () => {
  it('finds the command anywhere in the line', () => {
    expect(runsCommand(['/opt/Waypoint/waypoint'], ['/opt/Waypoint/waypoint'])).toBe(true);
    expect(runsCommand(['env', 'X=1', '/opt/Waypoint/waypoint', '--x'], ['/opt/Waypoint/waypoint'])).toBe(true);
    expect(runsCommand(['/old/Waypoint.AppImage'], ['/new/Waypoint.AppImage'])).toBe(false);
  });
});

describe('withCommand', () => {
  it('replaces Exec and TryExec, and nothing else', () => {
    const text = '[Desktop Entry]\nName=Mine\nExec=/old %U\nTryExec=/old\nX-GNOME-Autostart-Delay=5\n';
    expect(withCommand(text, DEB)).toBe(
      '[Desktop Entry]\nName=Mine\nExec=/opt/Waypoint/waypoint\nTryExec=/opt/Waypoint/waypoint\nX-GNOME-Autostart-Delay=5\n',
    );
    expect(withCommand(text, { args: ['snap', 'run', 'waypoint'], icon: 'waypoint' })).toBe(
      '[Desktop Entry]\nName=Mine\nExec=snap run waypoint\nX-GNOME-Autostart-Delay=5\n',
    );
  });
});

describe('LinuxLoginItem', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  afterEach(() => warn.mockClear());

  const setup = (command: AutostartCommand = DEB) => {
    const config = mkdtempSync(join(tmpdir(), 'waypoint-autostart-'));
    const file = autostartFile({ XDG_CONFIG_HOME: config }, '/nowhere');
    return { config, file, item: new LinuxLoginItem(file, command) };
  };

  it('writes the entry when turned on and removes it when turned off', () => {
    const { file, item } = setup();
    expect(item.isEnabled()).toBe(false);

    expect(item.sync(true)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(autostartEntry(DEB));
    expect(item.isEnabled()).toBe(true);

    expect(item.sync(false)).toBe(false);
    expect(existsSync(file)).toBe(false);
    // Turning off what's already off is fine.
    expect(item.sync(false)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves an entry that already runs this copy as it is, with your changes', () => {
    const { file, item } = setup();
    mkdirSync(join(file, '..'), { recursive: true });
    const edited = `${autostartEntry(DEB).replace('Exec=/opt/Waypoint/waypoint', 'Exec=/opt/Waypoint/waypoint --ozone-platform=wayland')}X-GNOME-Autostart-Delay=10\n`;
    writeFileSync(file, edited);
    expect(item.sync(true)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(edited);
  });

  it('points an entry at this copy again when the AppImage has moved', () => {
    const moved = {
      args: ['/home/me/Apps/Waypoint.AppImage'],
      tryExec: '/home/me/Apps/Waypoint.AppImage',
      icon: 'waypoint',
    };
    const { file, item } = setup(moved);
    mkdirSync(join(file, '..'), { recursive: true });
    const old = autostartEntry({
      ...moved,
      args: ['/home/me/Downloads/Waypoint.AppImage'],
      tryExec: '/home/me/Downloads/Waypoint.AppImage',
    });
    writeFileSync(file, `${old}X-GNOME-Autostart-Delay=10\n`);

    expect(item.sync(true)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(`${autostartEntry(moved)}X-GNOME-Autostart-Delay=10\n`);
  });

  it('turns an entry a desktop turned off back on, as the setting says', () => {
    const { file, item } = setup();
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(
      file,
      autostartEntry(DEB).replace('X-GNOME-Autostart-enabled=true', 'X-GNOME-Autostart-enabled=false'),
    );
    expect(item.isEnabled()).toBe(false);
    expect(item.sync(true)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(autostartEntry(DEB));
  });

  it("logs and reports off when the entry can't be written", () => {
    const { config, file, item } = setup();
    // A file where the autostart folder should be stops it, even for root.
    writeFileSync(join(config, 'autostart'), '');
    expect(item.sync(true)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`Could not write ${file}`));
    expect(item.isEnabled()).toBe(false);
  });
});
