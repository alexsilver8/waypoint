import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';

// First-launch setup: on a fresh install it opens in place of the launcher, walks through its
// steps and hands over to the launcher. Finishing or skipping it ends it for good.

const mac = process.platform === 'darwin';

let app: ElectronApplication;
let userData: string;

const isSetup = (page: Page) => page.url().includes('onboarding.html');
const launch = async () => {
  app = await electron.launch({
    args: [join(import.meta.dirname, '..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, WAYPOINT_USER_DATA: userData },
  });
};
/** The setup window's page, once it's open. */
const setupWindow = async (): Promise<Page> => {
  await expect.poll(() => app.windows().some(isSetup)).toBe(true);
  return app.windows().find(isSetup) as Page;
};
/** The pages of the windows on screen, by file name. */
const showing = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((window) => window.isVisible())
      .map((window) => new URL(window.webContents.getURL()).pathname.split('/').pop()),
  );
const saved = (file: string) => JSON.parse(readFileSync(join(userData, file), 'utf8'));
/** What the main process sends when the shortcut is pressed while setup is open. */
const pressShortcut = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes('onboarding.html'))
      ?.webContents.send('onboarding:hotkey-pressed'),
  );

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'waypoint-setup-'));
});

test.afterEach(async () => {
  await app.close();
});

test('opens on a fresh install and walks through to the launcher', async () => {
  await launch();
  const setup = await setupWindow();
  const title = setup.locator('.capsule__title');
  await expect(title).toHaveText('Welcome to Waypoint');
  await expect(setup.getByRole('main')).toBeFocused();
  expect(saved('onboarding.json')).toMatchObject({ status: 'pending' });
  expect(await showing()).toEqual(['onboarding.html']);

  await setup.keyboard.press('Enter');
  await expect(title).toHaveText('Pick your shortcut');
  await expect(setup.getByText('Step 2 of')).toBeVisible();
  // The shortcut answers in the window while it's open.
  await expect(setup.getByText('Try it now')).toBeVisible();
  await pressShortcut();
  await expect(setup.getByText('It works')).toBeVisible();
  // A suggestion becomes the shortcut, and starts out untried.
  await setup.getByRole('button', { name: mac ? '⌃ Space' : 'Ctrl+Space', exact: true }).click();
  await expect.poll(() => saved('settings.json').hotkey).toBe('Control+Space');
  await expect(setup.getByRole('button', { name: mac ? '⌃ Space' : 'Ctrl+Space', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(setup.getByText('Try it now')).toBeVisible();

  // esc goes back, ↵ carries on.
  await setup.keyboard.press('Escape');
  await expect(title).toHaveText('Welcome to Waypoint');
  await setup.keyboard.press('Enter');
  await setup.keyboard.press('Enter');
  if (mac) {
    await expect(title).toHaveText('Allow Accessibility');
    await setup.keyboard.press('Enter');
  }

  await expect(title).toHaveText('Make it yours');
  await setup.getByText('Dark', { exact: true }).click();
  await expect.poll(() => saved('settings.json').theme).toBe('dark');
  await setup.getByRole('switch', { name: 'Save clipboard history' }).click();
  await expect.poll(() => saved('settings.json').clipboardHistory.enabled).toBe(false);
  // After a click, ↵ still continues rather than flipping the switch again.
  await setup.keyboard.press('Enter');

  await expect(title).toHaveText('You’re all set');
  await expect(setup.locator('.ready__keys')).toHaveText(mac ? '⌃Space' : 'CtrlSpace');
  // The dock goes back to any step you've been to.
  await setup.getByRole('button', { name: 'Welcome, done', exact: true }).click();
  await expect(title).toHaveText('Welcome to Waypoint');
  await setup.getByRole('button', { name: 'Ready', exact: true }).click();
  await expect(title).toHaveText('You’re all set');

  // On the last step the shortcut opens the launcher, and setup is done.
  await pressShortcut();
  await expect.poll(showing).toEqual(['index.html']);
  expect(saved('onboarding.json')).toMatchObject({ status: 'finished' });
});

test('skipping ends it for good', async () => {
  await launch();
  const setup = await setupWindow();
  await setup.getByRole('button', { name: 'Skip Setup' }).click();
  await expect.poll(showing).toEqual(['index.html']);
  expect(saved('onboarding.json')).toMatchObject({ status: 'skipped' });

  await app.close();
  await launch();
  const launcher = await app.firstWindow();
  await expect(launcher.getByRole('combobox')).toBeFocused();
  expect(app.windows().some(isSetup)).toBe(false);
});

test('opens again after quitting halfway', async () => {
  await launch();
  const first = await setupWindow();
  await first.keyboard.press('Enter');
  await expect(first.locator('.capsule__title')).toHaveText('Pick your shortcut');

  await app.close();
  expect(saved('onboarding.json')).toMatchObject({ status: 'pending' });
  await launch();
  const again = await setupWindow();
  await expect(again.locator('.capsule__title')).toHaveText('Welcome to Waypoint');
});

test('leaves existing installs alone, and opens from the launcher when asked', async () => {
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ hideOnBlur: false }));
  await launch();
  const launcher = await app.firstWindow();
  await expect(launcher.getByRole('combobox')).toBeFocused();
  await expect(launcher.getByRole('option').first()).toBeVisible();
  expect(app.windows().some(isSetup)).toBe(false);
  expect(existsSync(join(userData, 'onboarding.json'))).toBe(false);

  await launcher.keyboard.type('set up waypoint');
  await expect(launcher.getByRole('option').first()).toContainText('Set Up Waypoint');
  await launcher.keyboard.press('Enter');
  const setup = await setupWindow();
  await expect(setup.locator('.capsule__title')).toHaveText('Welcome to Waypoint');
  await expect.poll(showing).toEqual(['onboarding.html']);
});
