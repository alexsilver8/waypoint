import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';

// Every command can have its own global shortcut, set from the launcher's Set Shortcut… or in
// Settings → Extensions. Real key presses can't reach a global shortcut under xvfb, so these check
// what's registered, and run commands the way a desktop shortcut on Wayland does: by starting
// `waypoint --command <extension>/<command>` again, which reaches the app as a second instance.

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const LEFT_HALF = 'window-management/left-half';

let app: ElectronApplication;
let page: Page;
let userData: string;

const settingsFile = () => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'));
const registered = (accelerator: string) =>
  app.evaluate(({ globalShortcut }, keys) => globalShortcut.isRegistered(keys), accelerator);
const launcherVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible());
/** What starting `waypoint` again with these arguments hands the running app. */
const startAgain = (...args: string[]) =>
  app.evaluate(
    ({ app: electronApp }, argv) => {
      electronApp.emit('second-instance', {}, argv, '', { argv });
    },
    ['/usr/bin/waypoint', ...args],
  );

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'waypoint-hotkeys-'));
  const commandHotkeys = test.info().title.includes('Settings') ? { [LEFT_HALF]: 'Control+Alt+L' } : {};
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ hideOnBlur: false, clipboardHistory: { enabled: false }, commandHotkeys }),
  );
  app = await electron.launch({
    args: [join(import.meta.dirname, '..'), '--show', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, WAYPOINT_USER_DATA: userData },
  });
  page = await app.firstWindow();
  await expect(page.getByRole('combobox')).toBeFocused();
  await expect(page.getByRole('option').first()).toBeVisible();
});

test.afterEach(async () => {
  await app.close();
});

test('sets a command’s shortcut from Set Shortcut… and shows it beside the command', async () => {
  await page.keyboard.type('left half');
  await expect(page.getByRole('option').first()).toContainText('Left Half');
  await page.keyboard.press(`${mod}+k`);
  const panel = page.getByRole('dialog', { name: /Actions for Left Half/ });
  await page.keyboard.type('set shortcut');
  await expect(panel.getByRole('option')).toHaveText([/^Set Shortcut…/]);
  const [settings] = await Promise.all([app.waitForEvent('window'), page.keyboard.press('Enter')]);

  // Settings opens at the command, already listening for the keys.
  await expect(settings.getByRole('heading', { name: 'Extensions', level: 1 })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Press the new shortcut, or Escape to cancel' })).toBeFocused();
  await settings.keyboard.press('Control+Alt+L');
  await expect.poll(() => settingsFile().commandHotkeys).toEqual({ [LEFT_HALF]: 'Control+Alt+L' });
  await expect(
    settings.getByRole('button', { name: 'Shortcut for Left Half: Control+Alt+L. Click to change' }),
  ).toBeVisible();
  expect(await registered('Control+Alt+L')).toBe(true);

  // The launcher shows it beside the command, and in its actions.
  await startAgain();
  await expect.poll(launcherVisible).toBe(true);
  await page.keyboard.type('left half');
  const row = page.getByRole('option').first();
  await expect(row).toContainText('Left Half');
  await expect(row.locator('.row__hotkey .keycap')).toHaveText(
    process.platform === 'darwin' ? ['⌃', '⌥', 'L'] : ['Ctrl', 'Alt', 'L'],
  );
  await page.keyboard.press(`${mod}+k`);
  await expect(panel.locator('.action-panel__hotkey .keycap')).toHaveCount(3);
  await expect(panel.getByRole('option')).toHaveText([/^Run Command/, /^Change Shortcut…/]);
});

test('refuses a clash in Settings, pauses command shortcuts while recording, and clears one', async () => {
  expect(await registered('Control+Alt+L')).toBe(true);
  const [settings] = await Promise.all([app.waitForEvent('window'), page.keyboard.press(`${mod}+Comma`)]);
  await settings.getByRole('button', { name: 'Extensions' }).click();
  await settings.getByRole('searchbox', { name: 'Search commands' }).fill('half');
  await expect(settings.getByRole('button', { name: /^Shortcut for Left Half: Control\+Alt\+L/ })).toBeVisible();

  // While a shortcut is recorded, pressing a command's records it rather than running it.
  await settings.getByRole('button', { name: /^Shortcut for Right Half: none/ }).click();
  await expect(settings.getByText('Press a shortcut…')).toBeVisible();
  expect(await registered('Control+Alt+L')).toBe(false);
  expect(await registered('Alt+Space')).toBe(false);
  await settings.keyboard.press('Control+Alt+L');
  await expect(settings.getByRole('alert')).toHaveText('Left Half already uses it.');
  expect(settingsFile().commandHotkeys).toEqual({ [LEFT_HALF]: 'Control+Alt+L' });
  expect(await registered('Control+Alt+L')).toBe(true);
  expect(await registered('Alt+Space')).toBe(true);

  await settings.getByRole('button', { name: 'Remove the shortcut for Left Half' }).click();
  await expect.poll(() => settingsFile().commandHotkeys).toEqual({});
  await expect(settings.getByRole('button', { name: /^Shortcut for Left Half: none/ })).toBeVisible();
  expect(await registered('Control+Alt+L')).toBe(false);
});

test('reports a shortcut written in settings.json that the launcher already uses', async () => {
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ ...settingsFile(), hotkey: 'Alt+Space', commandHotkeys: { [LEFT_HALF]: 'Alt+Space' } }),
  );
  await expect(page.locator('.footer')).toContainText(
    'Alt+Space for Left Half isn’t working. That’s the shortcut that opens Waypoint.',
  );
  expect(await registered('Alt+Space')).toBe(true);

  const [settings] = await Promise.all([app.waitForEvent('window'), page.keyboard.press(`${mod}+Comma`)]);
  await settings.getByRole('button', { name: 'Extensions' }).click();
  await settings.getByRole('searchbox', { name: 'Search commands' }).fill('left half');
  await expect(settings.getByRole('status')).toHaveText('That’s the shortcut that opens Waypoint.');
});

test('runs a command with --command, opening a view command and closing it again', async () => {
  await page.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);

  await startAgain('--command', 'waypoint/extensions');
  await expect.poll(launcherVisible).toBe(true);
  await expect(page.locator('.search__crumb')).toHaveText('Extensions');
  // Back goes to the root search, as if it was picked there.
  await page.keyboard.press('Backspace');
  await expect(page.locator('.search__crumb')).toHaveCount(0);

  await startAgain('--command', 'waypoint/extensions');
  await expect(page.locator('.search__crumb')).toHaveText('Extensions');
  // Its shortcut again, with its view in front, closes the launcher.
  await startAgain('--command', 'waypoint/extensions');
  await expect.poll(launcherVisible).toBe(false);
});

test('runs a no-view command with --command without the launcher, with what it says as a notification', async () => {
  await app.evaluate(({ Notification }) => {
    const shown: Array<{ title: string; body: string }> = [];
    (globalThis as { notifications?: typeof shown }).notifications = shown;
    Notification.isSupported = () => true;
    Notification.prototype.show = function (this: Electron.Notification) {
      shown.push({ title: this.title, body: this.body });
    };
  });
  await page.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);

  await startAgain('--command=waypoint/reload-extensions');
  await expect
    .poll(() => app.evaluate(() => (globalThis as { notifications?: unknown[] }).notifications))
    .toEqual([{ title: 'Reload Extensions', body: expect.stringMatching(/^Loaded \d+ extensions?/) }]);
  expect(await launcherVisible()).toBe(false);

  // It counts as used, like a pick from the root search.
  await startAgain();
  await expect.poll(launcherVisible).toBe(true);
  await expect(page.getByRole('group', { name: 'Suggestions' }).getByRole('option')).toContainText([
    'Reload Extensions',
  ]);

  // A link, which any web page can open, asks first.
  await page.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);
  await startAgain('waypoint://commands/waypoint/reload-extensions');
  await expect.poll(launcherVisible).toBe(true);
  await expect(page.locator('.search__crumb')).toHaveText('Reload Extensions');
  await expect(page.getByRole('option')).toHaveText([/^Run Reload Extensions/]);
  await page.keyboard.press('Enter');
  await expect
    .poll(() => app.evaluate(() => (globalThis as { notifications?: unknown[] }).notifications?.length))
    .toBe(1);
  await expect(page.locator('.footer')).toContainText(/Loaded \d+ extensions?/);

  // One for a command that isn't there says so.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);
  await startAgain('waypoint://commands/nope/missing');
  await expect.poll(launcherVisible).toBe(true);
  await expect(page.locator('.footer')).toContainText('There’s no command “nope/missing”.');
});
