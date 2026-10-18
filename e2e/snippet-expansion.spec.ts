import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';
import type { SettingsApi } from '../src/shared/settings-ipc';

// Turning on Expand keywords as you type in Settings: the setting is saved, and the system-wide
// keyboard hook, a native module, loads and starts in the app. On macOS it would wait for
// Accessibility, which a test can't grant, so this runs on Linux (X11) and Windows.

test.skip(process.platform === 'darwin', 'macOS waits for Accessibility, which a test can’t turn on.');

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let app: ElectronApplication;
let page: Page;
let userData: string;

const settingsFile = () => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'));

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'waypoint-expansion-'));
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ hideOnBlur: false }));
  app = await electron.launch({
    args: [join(import.meta.dirname, '..'), '--show', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, WAYPOINT_USER_DATA: userData },
  });
  page = await app.firstWindow();
  await expect(page.getByRole('combobox')).toBeFocused();
});

test.afterEach(async () => {
  await app.close();
});

test('turns expanding snippets as you type on and off from Settings', async () => {
  const [settings] = await Promise.all([app.waitForEvent('window'), page.keyboard.press(`${mod}+Comma`)]);
  await settings.getByRole('button', { name: 'Snippets' }).click();
  const toggle = settings.getByRole('switch', { name: 'Expand keywords as you type' });
  const status = () =>
    settings.evaluate(
      async () => (await (globalThis as { settings?: SettingsApi }).settings?.get())?.info.snippetExpansion,
    );
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(await status()).toBe('off');

  await toggle.click();
  await expect.poll(() => settingsFile().snippetExpansion).toBe(true);
  // The hook loaded and is watching the keyboard.
  await expect.poll(status).toBe('on');
  await expect(settings.getByText('Type a snippet’s keyword in any app')).toBeVisible();

  await toggle.click();
  await expect.poll(() => settingsFile().snippetExpansion).toBe(false);
  await expect.poll(status).toBe('off');
});
