import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';
import { tarball } from '../src/main/extensions/test-tarball';

// Installing an extension from npm, from a registry of the test's own, and uninstalling it.

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let app: ElectronApplication;
let page: Page;
let server: Server;
let userData: string;

const archive = tarball([
  {
    name: 'package/package.json',
    data: JSON.stringify({
      name: 'hello-shared',
      version: '1.0.0',
      type: 'module',
      waypoint: { title: 'Hello Shared', commands: [{ name: 'greet', title: 'Say Hello Shared', mode: 'view' }] },
    }),
  },
  {
    name: 'package/index.js',
    data: `export default { commands: { greet: { view: () => ({ type: 'list', sections: [{ items: [{ id: 'hi', title: 'Hello from npm', actions: [] }] }] }) } } };`,
  },
]);

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const { port } = server.address() as AddressInfo;
    if (request.url === '/hello-shared') {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          name: 'hello-shared',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dist: {
                tarball: `http://127.0.0.1:${port}/hello-shared-1.0.0.tgz`,
                integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
              },
            },
          },
        }),
      );
    } else if (request.url?.startsWith('/-/v1/search?')) {
      // Browse Extensions: what npm finds with the waypoint-extension keyword.
      const text = new URL(request.url, 'http://registry').searchParams.get('text') ?? '';
      const words = text.split(' ').slice(1);
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          objects: words.every((word) => 'hello-shared says hello'.includes(word))
            ? [{ package: { name: 'hello-shared', version: '1.0.0', description: 'Says hello' } }]
            : [],
        }),
      );
    } else if (request.url === '/hello-shared-1.0.0.tgz') {
      response.end(archive);
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

test.afterAll(() => {
  server.close();
});

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'waypoint-install-'));
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ hideOnBlur: false, pasteIntoApps: false }));
  const { port } = server.address() as AddressInfo;
  app = await electron.launch({
    args: [join(import.meta.dirname, '..'), '--show', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, WAYPOINT_USER_DATA: userData, WAYPOINT_NPM_REGISTRY: `http://127.0.0.1:${port}` },
  });
  page = await app.firstWindow();
  await expect(page.getByRole('combobox')).toBeFocused();
  await expect(page.getByRole('option').first()).toBeVisible();
});

test.afterEach(async () => {
  await app.close();
});

async function open(command: string) {
  await page.getByRole('combobox').fill('');
  await page.keyboard.type(command);
  await expect(page.getByRole('option').first()).toContainText(command);
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toBeVisible();
}

test('installs an extension from npm once it’s confirmed, and uninstalls it', async () => {
  const folder = join(userData, 'extensions', 'hello-shared');
  await open('Install Extension');
  await page.getByRole('textbox', { name: 'Package or address', exact: true }).fill('hello-shared');
  await page.keyboard.press(`${mod}+Enter`);

  // What it is and where it comes from, before anything is installed.
  await expect(page.getByRole('option').first()).toContainText('Install Hello Shared');
  await expect(page.getByRole('option').first()).toContainText('1.0.0, from npm (hello-shared)');
  await expect(page.getByRole('complementary')).toContainText('anything you can on this computer');
  await expect(page.getByRole('complementary')).toContainText('Say Hello Shared');
  expect(existsSync(folder)).toBe(false);

  await page.keyboard.press('Enter');
  await expect(page.locator('.toast')).toHaveText('Installed Hello Shared 1.0.0');
  expect(existsSync(join(folder, 'index.js'))).toBe(true);
  // Its commands, ready to use.
  await expect(page.getByRole('option').first()).toContainText('Say Hello Shared');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: /Hello from npm/ })).toBeVisible();

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await open('Manage Extensions');
  await page.keyboard.type('hello shared');
  await expect(page.getByRole('option').first()).toContainText('1.0.0 from npm (hello-shared)');
  await page.keyboard.press(`${mod}+Backspace`);
  await expect(page.getByRole('option').first()).toContainText('Uninstall Hello Shared');
  await page.keyboard.press('Enter');
  await expect(page.locator('.toast')).toHaveText('Uninstalled Hello Shared');
  expect(existsSync(folder)).toBe(false);
});

test('lists an installed extension in Settings, and uninstalls it from there', async () => {
  const folder = join(userData, 'extensions', 'hello-shared');
  await open('Install Extension');
  await page.getByRole('textbox', { name: 'Package or address', exact: true }).fill('hello-shared');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.getByRole('option').first()).toContainText('Install Hello Shared');
  await page.keyboard.press('Enter');
  await expect(page.locator('.toast')).toHaveText('Installed Hello Shared 1.0.0');

  await page.keyboard.press('Escape');
  await page.getByRole('combobox').fill('open settings');
  await expect(page.getByRole('option').first()).toContainText('Open Settings');
  const [settings] = await Promise.all([app.waitForEvent('window'), page.keyboard.press('Enter')]);
  await settings.getByRole('button', { name: 'Extensions', exact: true }).click();
  const row = settings.locator('.extension', { hasText: 'Hello Shared' });
  await expect(row).toContainText('1 command, 1.0.0 from npm (hello-shared)');
  // A check before it's gone: the first click only asks.
  await row.getByRole('button', { name: 'Uninstall' }).click();
  await row.getByRole('button', { name: 'Click again to uninstall' }).click();
  await expect(row).toHaveCount(0);
  expect(existsSync(folder)).toBe(false);
});

test('finds an extension in Browse Extensions and installs it', async () => {
  await open('Browse Extensions');
  const listed = page.getByRole('option', { name: /hello-shared/ });
  await expect(listed).toContainText('Says hello');
  await page.keyboard.type('nothing like it');
  await expect(page.getByRole('option').first()).toContainText('No extensions on npm match “nothing like it”');
  await page.getByRole('combobox').fill('hello');
  await expect(listed).toBeVisible();
  await page.keyboard.press('Enter');

  // The same check as Install Extension, before anything is installed.
  await expect(page.getByRole('option').first()).toContainText('Install Hello Shared');
  await page.keyboard.press('Enter');
  await expect(page.locator('.toast')).toHaveText('Installed Hello Shared 1.0.0');
  await expect(page.getByRole('option').first()).toContainText('Say Hello Shared');

  // Back in Browse Extensions, it shows as installed.
  await page.keyboard.press('Escape');
  await open('Browse Extensions');
  await expect(listed).toContainText('Installed');
});
