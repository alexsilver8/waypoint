import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test';

// Open at login on Linux, in the installed app: only a packaged copy registers itself, so this
// drives the unpacked build. Make it first with `pnpm dist:dir`; without it these are skipped.
// Each run gets its own home and config folders, so your own autostart folder is never touched.

const { version } = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
const unpacked = join(import.meta.dirname, '..', 'release', version, 'linux-unpacked');
const executable = join(unpacked, 'waypoint');

test.skip(process.platform !== 'linux', 'Opening at login through XDG Autostart is Linux only.');
test.skip(!existsSync(executable), `Needs the unpacked build at ${unpacked}: run pnpm dist:dir first.`);

let app: ElectronApplication;
let home: string;
let config: string;
let userData: string;

const entryFile = () => join(config, 'autostart', 'dev.waypoint.app.desktop');
const entry = () => readFileSync(entryFile(), 'utf8');
const settingsFile = () => join(userData, 'settings.json');
const writeSettings = (settings: object) =>
  writeFileSync(
    settingsFile(),
    JSON.stringify({ hideOnBlur: false, clipboardHistory: { enabled: false }, ...settings }),
  );
const launch = async (env: NodeJS.ProcessEnv = {}) => {
  app = await electron.launch({
    executablePath: executable,
    args: ['--no-sandbox'],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: config, WAYPOINT_USER_DATA: userData, ...env },
  });
};
const visibleWindows = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length);

test.beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'waypoint-home-'));
  config = join(home, 'config');
  userData = mkdtempSync(join(tmpdir(), 'waypoint-login-'));
  // Setup is done, so the app starts as it does at login.
  writeFileSync(join(userData, 'onboarding.json'), JSON.stringify({ status: 'finished' }));
});

test.afterEach(async () => {
  await app?.close();
});

test('turns on from Settings and settings.json, and starts quietly in the tray', async () => {
  writeSettings({ launchAtLogin: false });
  await launch();
  expect(existsSync(entryFile())).toBe(false);
  // Started without --show, as at login: nothing pops up.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(await visibleWindows()).toBe(0);

  // Running it again opens the launcher (its window is already there, hidden); open Settings from it.
  await app.evaluate(({ app }) => app.emit('second-instance', {}, []));
  await expect.poll(visibleWindows).toBe(1);
  const launcher = app.windows().find((page) => page.url().includes('index.html'));
  if (!launcher) throw new Error('No launcher window');
  await expect(launcher.getByRole('combobox')).toBeFocused();
  const [settings] = await Promise.all([app.waitForEvent('window'), launcher.keyboard.press('Control+Comma')]);
  const toggle = settings.getByRole('switch', { name: 'Open at login' });
  await expect(toggle).toBeEnabled();
  await expect(settings.getByText('Start Waypoint when you log in.')).toBeVisible();

  await toggle.click();
  await expect.poll(() => existsSync(entryFile())).toBe(true);
  expect(entry()).toContain(`\nExec=${executable}\n`);
  expect(entry()).toContain('\nX-GNOME-Autostart-enabled=true\n');
  await expect(toggle).toBeChecked();

  await toggle.click();
  await expect.poll(() => existsSync(entryFile())).toBe(false);
  await expect(toggle).not.toBeChecked();

  // settings.json is watched, and works the same way.
  writeSettings({ launchAtLogin: true });
  await expect.poll(() => existsSync(entryFile())).toBe(true);
  await expect(toggle).toBeChecked();
});

test('starts an AppImage from where it is, and follows it when it moves', async () => {
  const appImage = (dir: string) => {
    mkdirSync(join(home, dir), { recursive: true });
    return join(home, dir, 'Waypoint.AppImage');
  };
  // As if the build were mounted from an AppImage: it runs from APPDIR, and APPIMAGE is the file.
  const before = appImage('Downloads');
  writeSettings({ launchAtLogin: true });
  await launch({ APPIMAGE: before, APPDIR: unpacked });
  await expect.poll(() => existsSync(entryFile())).toBe(true);
  expect(entry()).toContain(`\nExec=${before}\nTryExec=${before}\n`);
  await app.close();

  // You add something of your own, then move the AppImage somewhere with a space in its name.
  writeFileSync(entryFile(), `${entry()}X-GNOME-Autostart-Delay=5\n`);
  const after = appImage('My Apps');
  await launch({ APPIMAGE: after, APPDIR: unpacked });
  await expect.poll(entry).toContain(`\nExec="${after}"\nTryExec=${after}\n`);
  expect(entry()).toContain('\nX-GNOME-Autostart-Delay=5\n');
});

test("turns the setting back off when the entry can't be written", async () => {
  mkdirSync(config, { recursive: true });
  // A file where the autostart folder should be stops it, even for root.
  writeFileSync(join(config, 'autostart'), '');
  writeSettings({ launchAtLogin: true });
  await launch();
  await expect.poll(() => JSON.parse(readFileSync(settingsFile(), 'utf8')).launchAtLogin).toBe(false);
});
