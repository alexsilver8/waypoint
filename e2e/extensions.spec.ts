import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';

// The extensions that ship with Waypoint, driven through the launcher.

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let app: ElectronApplication;
let page: Page;

/** An extension of the test's own, which asks Waypoint for a wake lock through `ctx.power`. */
function addWakeLockExtension(userData: string) {
  const dir = join(userData, 'extensions', 'wake-lock-check');
  mkdirSync(dir, { recursive: true });
  const command = (name: string, title: string) => ({ name, title, mode: 'no-view' });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'wake-lock-check',
      type: 'module',
      main: 'index.js',
      waypoint: {
        title: 'Wake Lock Check',
        commands: [
          command('hold', 'Hold a Wake Lock'),
          command('check', 'Check the Wake Lock'),
          command('release', 'Let Go of the Wake Lock'),
        ],
      },
    }),
  );
  writeFileSync(
    join(dir, 'index.js'),
    `export default {
      commands: {
        hold: { async run(ctx) { await ctx.power.keepAwake({ until: Date.now() + 60_000 }); return { toast: 'Holding', clearSearch: true }; } },
        check: { async run(ctx) { const lock = await ctx.power.wakeLock(); return { toast: lock ? 'Held until ' + lock.until : 'Not held', clearSearch: true }; } },
        release: { async run(ctx) { await ctx.power.allowSleep(); return { toast: 'Let go', clearSearch: true }; } },
      },
    };`,
  );
}

/**
 * Extensions of the test's own that use @waypoint-org/api without installing it, as an ES module and
 * as CommonJS, and one that brings its own copy.
 */
function addApiExtensions(userData: string) {
  const add = (name: string, title: string, files: Record<string, string>, type = 'module') => {
    const dir = join(userData, 'extensions', name);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
    }
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name, type, waypoint: { title, commands: [{ name: 'show', title, mode: 'view' }] } }),
    );
  };
  add('api-helpers', 'Try API Helpers', {
    'index.js': `import { Action, Icon, defineExtension, item, list } from '@waypoint-org/api';
      export default defineExtension({
        commands: {
          show: {
            view: () => list({
              title: 'Helpers',
              items: [
                item({
                  title: 'Built with helpers',
                  icon: Icon.builtin('sparkles', 'purple'),
                  actions: [Action.copy('from @waypoint-org/api', { title: 'Copy Text', shortcut: 'mod+shift+c' })],
                }),
              ],
            }),
          },
        },
      });`,
  });
  add(
    'api-commonjs',
    'Try API from CommonJS',
    {
      'index.js': `const { defineExtension, item, list } = require('@waypoint-org/api');
        module.exports = defineExtension({ commands: { show: { view: () => list({ title: 'CommonJS', items: [item({ title: 'Required from CommonJS' })] }) } } });`,
    },
    'commonjs',
  );
  add('api-own-copy', 'Try Own API Copy', {
    'index.js': `import { list } from '@waypoint-org/api';
      export default { commands: { show: { view: () => list() } } };`,
    'node_modules/@waypoint-org/api/package.json': JSON.stringify({
      name: '@waypoint-org/api',
      type: 'module',
      exports: './index.js',
    }),
    'node_modules/@waypoint-org/api/index.js': `export const list = () => ({
      type: 'list',
      title: 'Own copy',
      sections: [{ items: [{ id: 'own', title: 'Its own copy', actions: [] }] }],
    });`,
  });
}

test.beforeEach(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'waypoint-ext-'));
  // Copy rather than paste, so the tests never type into whatever app is in front.
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ hideOnBlur: false, pasteIntoApps: false }));
  addWakeLockExtension(userData);
  addApiExtensions(userData);
  app = await electron.launch({
    args: [join(import.meta.dirname, '..'), '--show', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    // Without pnpm's NODE_PATH, through which `require` would find this repo's packages/api.
    env: { ...process.env, WAYPOINT_USER_DATA: userData, NODE_PATH: '' },
  });
  page = await app.firstWindow();
  await expect(page.getByRole('combobox')).toBeFocused();
  await expect(page.getByRole('option').first()).toBeVisible();
});

test.afterEach(async () => {
  await app.close();
});

async function open(command: string) {
  await page.keyboard.type(command);
  await expect(page.getByRole('option').first()).toContainText(command, { ignoreCase: true });
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toBeVisible();
}

/** Runs a command that doesn't open a view, from an empty search field. */
async function run(command: string) {
  await page.getByRole('combobox').fill('');
  await page.keyboard.type(command);
  await expect(page.getByRole('option').first()).toContainText(command);
  await page.keyboard.press('Enter');
}

const clipboardText = () => app.evaluate(({ clipboard }) => clipboard.readText());
const launcherVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible());

test('stops the program listening on a port', async () => {
  // A stand-in for a forgotten dev server, in a process of its own.
  const server: ChildProcess = spawn(
    process.execPath,
    [
      '-e',
      "require('net').createServer().listen(0, '127.0.0.1', function () { process.stdout.write(String(this.address().port)) })",
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()));
  try {
    const port = await new Promise<string>((resolve) =>
      server.stdout?.once('data', (data) => resolve(String(data).trim())),
    );

    await open('Open Ports');
    await page.keyboard.type(port);
    const row = page.getByRole('option', { name: `Port ${port}` });
    await expect(row).toBeVisible();
    await expect(page.getByRole('complementary')).toContainText('This computer only');

    await page.keyboard.press('Enter');
    await exited;
    await expect(page.locator('.toast')).toHaveText(new RegExp(`Stopped .+ on port ${port}`));
    await expect(row).toHaveCount(0);
  } finally {
    server.kill();
  }
});

test('copies a gitmoji when pasting into apps is turned off', async () => {
  await open('Search Gitmoji');
  await page.keyboard.type('bug');
  await expect(page.getByRole('option').first()).toContainText('Fix a bug');
  await page.keyboard.press('Enter');
  // ↵ pastes; with pasting turned off it copies and closes the launcher.
  await expect.poll(launcherVisible).toBe(false);
  expect(await clipboardText()).toBe('🐛');
});

test('copies a gitmoji code', async () => {
  await open('Search Gitmoji');
  await page.keyboard.type('sparkles');
  await expect(page.getByRole('option').first()).toContainText(':sparkles:');
  await page.keyboard.press(`${mod}+Shift+c`);
  await expect.poll(clipboardText).toBe(':sparkles:');
});

test('finds emoji and uses the chosen skin tone', async () => {
  await open('Search Emoji');
  await expect(page.locator('.results__heading').first()).toHaveText('Smileys & Emotion');

  await page.keyboard.press(`${mod}+Shift+t`);
  await page.getByRole('option', { name: /^Medium$/ }).click();
  await expect(page.locator('.toast')).toHaveText('Skin tone: Medium');

  await page.keyboard.type('waving hand');
  const wave = page.getByRole('option').first();
  await expect(wave).toContainText('Waving hand');
  await expect(wave.locator('.icon')).toHaveText('👋🏽');
  await page.keyboard.press(`${mod}+k`);
  await page
    .getByRole('dialog')
    .getByRole('option', { name: /Copy Emoji/ })
    .click();
  await expect.poll(clipboardText).toBe('👋🏽');
});

test('shows a whole emoji category', async () => {
  await open('Search Emoji');
  // Long lists only draw what's in view, so scroll down to it like a person would.
  const more = page.getByRole('option', { name: /All \d+ in Food & Drink/ });
  await page.locator('.content__list').hover();
  for (let i = 0; i < 40 && (await more.count()) === 0; i++) await page.mouse.wheel(0, 300);
  await more.click();
  await expect(page.locator('.results__heading')).toHaveText(['Food & Drink']);
  await expect(page.getByRole('option', { name: /Pizza/ })).toBeAttached();
});

test('writes a conventional commit message from a type', async () => {
  await open('Write Commit Message');
  await expect(page.getByRole('option').first()).toContainText('feat');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox')).toHaveValue('feat: ');
  await expect(page.getByRole('complementary')).toContainText('Describe the change after the colon');

  await page.keyboard.type('add emoji search');
  await expect(page.getByRole('option').first()).toContainText('feat: add emoji search');
  await expect(page.getByRole('complementary')).toContainText('Looks good');
  await page.keyboard.press('Enter');
  await expect.poll(clipboardText).toBe('feat: add emoji search');
});

test('suggests a type for a description typed in the launcher', async () => {
  await page.keyboard.type('fix the crash on start');
  await page.getByRole('option', { name: /Write Commit Message/ }).click();
  await expect(page.getByRole('option').first()).toContainText('fix: fix the crash on start');
  await expect(page.getByRole('option').first()).toContainText('Patch release');
});

test('shows this computer’s details in System Info and copies one', async () => {
  await open('system info');
  await expect(page.locator('.results__heading')).toContainText(['Hardware', 'Network', 'System']);
  await expect(page.getByRole('option', { name: /^CPU/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /^Memory/ })).toContainText(/of .* used/);
  await expect(page.getByRole('option', { name: /^Disk/ })).toContainText(/free of/);
  await page.keyboard.type('memory');
  await page.keyboard.press('Enter');
  await expect.poll(clipboardText).toMatch(/B of .*B used/);
});

test('holds an extension’s wake lock in Waypoint itself, so it lasts when the extensions reload', async () => {
  // Electron numbers its blockers from 0, and nothing else in Waypoint starts one.
  const blocking = () =>
    app.evaluate(({ powerSaveBlocker }) => [...Array(50).keys()].some((id) => powerSaveBlocker.isStarted(id)));
  expect(await blocking()).toBe(false);

  await run('Hold a Wake Lock');
  await expect(page.locator('.toast')).toHaveText('Holding');
  expect(await blocking()).toBe(true);

  // Restarts the extension host.
  await run('Reload Extensions');
  await expect(page.locator('.toast')).toHaveText(/^Loaded \d+ extensions$/);
  await run('Check the Wake Lock');
  await expect(page.locator('.toast')).toHaveText(/^Held until \d+$/);
  expect(await blocking()).toBe(true);

  await run('Let Go of the Wake Lock');
  await expect(page.locator('.toast')).toHaveText('Let go');
  expect(await blocking()).toBe(false);
});

test('gives extensions @waypoint-org/api when they use it without installing it', async () => {
  await open('Try API from CommonJS');
  await expect(page.getByRole('option', { name: /Required from CommonJS/ })).toBeVisible();

  // A copy the extension installed itself comes first.
  await page.keyboard.press('Escape');
  await open('Try Own API Copy');
  await expect(page.getByRole('option', { name: /Its own copy/ })).toBeVisible();

  await page.keyboard.press('Escape');
  await open('Try API Helpers');
  await expect(page.getByRole('option', { name: /Built with helpers/ })).toBeVisible();
  // The action the helpers built works like any other, shortcut and all.
  await page.keyboard.press(`${mod}+Shift+c`);
  await expect.poll(clipboardText).toBe('from @waypoint-org/api');
});

test('shows what takes up space in a folder, and opens the folders in it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'waypoint-disk-'));
  mkdirSync(join(root, 'Videos'));
  writeFileSync(join(root, 'Videos', 'trip.mov'), randomBytes(3_000_000));
  writeFileSync(join(root, 'backup.zip'), randomBytes(2_000_000));
  writeFileSync(join(root, 'notes.txt'), 'small');

  await open('Disk Usage');
  // A folder typed outside your home folder is scanned when asked, not on the way to another.
  await page.keyboard.type(`${root}/`);
  const rows = page.getByRole('option');
  await expect(rows).toHaveText([/^Scan \/.*waypoint-disk-/]);
  await page.keyboard.press('Enter');
  await expect(rows.first()).toContainText(/Videos.*3\.\d MB/);
  await expect(rows.nth(1)).toContainText(/backup\.zip.*ZIP archive.*2\.\d MB/);
  await expect(page.getByRole('option', { name: /^1 smaller item/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /^Scanned just now/ })).toBeVisible();

  // ↵ opens the folder, with its path in the search field.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox')).toHaveValue(`${root}/Videos/`);
  await expect(rows.first()).toContainText('trip.mov');

  // Scan Again counts what's new, and going back shows the folder it's in grown too.
  writeFileSync(join(root, 'Videos', 'more.mov'), randomBytes(4_000_000));
  await page.keyboard.press(`${mod}+r`);
  await expect(rows.first()).toContainText('more.mov');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('combobox')).toHaveValue(`${root}/`);
  await expect(rows.first()).toContainText(/Videos.*7\.\d MB/);

  // Esc goes all the way home from a folder inside, not up to the folder it's in.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox')).toHaveValue(`${root}/Videos/`);
  await page.keyboard.press('Escape');
  await expect(page.locator('.search__crumb')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveValue('');
  expect(await launcherVisible()).toBe(true);
});
