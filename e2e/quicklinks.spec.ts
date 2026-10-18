import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';

// Quicklinks and snippets: from their files and from Settings, through the root search.

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let app: ElectronApplication;
let page: Page;
let userData: string;

const saved = (name: string) => JSON.parse(readFileSync(join(userData, name), 'utf8'));
const clipboardText = () => app.evaluate(({ clipboard }) => clipboard.readText());
/** Whether the launcher is on screen. Settings opens too, so it's found by its page. */
const launcherVisible = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes('/index.html'))
      ?.isVisible(),
  );
/** What the app asked the system to open, instead of opening a browser. */
const opened = () => app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? []);

/** Today in the main process, as `{date format="yyyy-MM-dd"}` writes it. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Opens the launcher again after an action closed it, with an empty search. */
async function showLauncher() {
  await expect.poll(launcherVisible).toBe(false);
  await app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance'));
  await expect.poll(launcherVisible).toBe(true);
  await expect(page.getByRole('combobox')).toHaveValue('');
}

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'waypoint-quicklinks-'));
  // Copy rather than paste, so the tests never type into whatever app is in front.
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ hideOnBlur: false, pasteIntoApps: false, clipboardHistory: { enabled: false } }),
  );
  if (test.info().title.includes('written before')) {
    writeFileSync(
      join(userData, 'quicklinks.json'),
      JSON.stringify([
        { name: 'GitHub Search', link: 'https://github.com/search?q={argument}', icon: '🐙' },
        { name: 'Waypoint Repo', link: 'https://github.com/alexsilver8/waypoint' },
        { name: 'Broken', link: 'not a link' },
      ]),
    );
    writeFileSync(
      join(userData, 'snippets.json'),
      JSON.stringify([
        {
          name: 'Email Signature',
          keyword: '!sig',
          text: 'Thanks,\nAlex\nRe: {clipboard} ({date format="yyyy-MM-dd"})',
        },
      ]),
    );
  }
  app = await electron.launch({
    args: [join(import.meta.dirname, '..'), '--show', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, WAYPOINT_USER_DATA: userData },
  });
  page = await app.firstWindow();
  await expect(page.getByRole('combobox')).toBeFocused();
  await expect(page.getByRole('option').first()).toBeVisible();
  // Links are recorded rather than opened in a browser.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    Object.assign(globalThis, { opened });
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
});

test.afterEach(async () => {
  await app.close();
});

test('finds quicklinks and snippets written before launch, and opens and pastes them', async () => {
  // Quicklinks are found like commands; the one that isn't a link was left out.
  await page.keyboard.type('waypoint repo');
  await expect(page.getByRole('option').first()).toContainText('Quicklink');
  await page.getByRole('combobox').fill('broken');
  await expect(page.getByRole('option', { name: /^Broken/ })).toHaveCount(0);
  await page.getByRole('combobox').fill('');

  // What's typed after a quicklink's name goes into its link.
  await page.keyboard.type('gh waypoint');
  const first = page.getByRole('option').first();
  await expect(first).toContainText('GitHub Search');
  await expect(first).toContainText('“waypoint”');
  await page.keyboard.press('Enter');
  await expect.poll(opened).toEqual(['https://github.com/search?q=waypoint']);
  await app.evaluate(({ clipboard }) => clipboard.writeText('PR #42'));
  await showLauncher();

  // A snippet's keyword finds it, and ↵ pastes it (copies, with pasting into apps off), filled in.
  await page.keyboard.type('!sig');
  await expect(page.getByRole('option').first()).toContainText('Email Signature');
  await expect(page.getByRole('complementary', { name: 'Preview of Email Signature' })).toContainText('Re: PR #42');
  await page.keyboard.press('Enter');
  await expect.poll(clipboardText).toBe(`Thanks,\nAlex\nRe: PR #42 (${today()})`);
  await showLauncher();

  // Quicklinks that take text are offered for anything typed.
  await page.keyboard.type('rust lifetimes');
  const useWith = page.getByRole('option', { name: /GitHub Search/ }).last();
  await expect(useWith).toBeVisible();
  await useWith.click();
  await expect.poll(opened).toContain('https://github.com/search?q=rust%20lifetimes');
  await showLauncher();

  // Picking one without text types its name, so what's typed next is the text.
  await page.keyboard.type('github search');
  await expect(page.getByRole('option').first()).toContainText('GitHub Search');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox')).toHaveValue('GitHub Search ');
  await expect(page.locator('.toast')).toHaveText(/Type the text, then press/);
  await page.keyboard.type('cats & dogs');
  await page.keyboard.press('Enter');
  await expect.poll(opened).toContain('https://github.com/search?q=cats%20%26%20dogs');
});

test('makes, changes and deletes quicklinks and snippets in Settings', async () => {
  // Create Quicklink opens Settings with a new quicklink started.
  await page.keyboard.type('create quicklink');
  await expect(page.getByRole('option').first()).toContainText('Create Quicklink');
  const [settings] = await Promise.all([app.waitForEvent('window'), page.keyboard.press('Enter')]);
  await expect(settings.getByRole('heading', { name: 'Quicklinks', exact: true })).toBeVisible();
  const quicklinkForm = settings.getByRole('form', { name: 'New Quicklink' });
  await expect(quicklinkForm.getByLabel('Name')).toBeFocused();
  await settings.keyboard.type('Docs');
  // Mistakes are pointed out before anything is saved.
  await quicklinkForm.getByLabel('Link').fill('docs for everything');
  await quicklinkForm.getByRole('button', { name: 'Save' }).click();
  await expect(quicklinkForm.getByRole('alert')).toContainText('Use a web address');
  await quicklinkForm.getByLabel('Link').fill('https://example.com/docs/');
  await quicklinkForm.getByRole('button', { name: '{argument}' }).click();
  await expect(quicklinkForm.getByLabel('Link')).toHaveValue('https://example.com/docs/{argument}');
  await quicklinkForm.getByLabel('Icon').fill('📘');
  await quicklinkForm.getByLabel('Link').press('Enter');
  await expect
    .poll(() => saved('quicklinks.json'))
    .toEqual([{ id: 'docs', name: 'Docs', link: 'https://example.com/docs/{argument}', icon: '📘' }]);
  await expect(settings.getByRole('listitem').filter({ hasText: 'Docs' })).toContainText('example.com/docs/{argument}');

  // It's in the launcher straight away.
  await showLauncher();
  await page.keyboard.type('docs intro');
  await expect(page.getByRole('option').first()).toContainText('“intro”');
  await page.keyboard.press('Enter');
  await expect.poll(opened).toEqual(['https://example.com/docs/intro']);
  await showLauncher();

  // Search Quicklinks shows it with a preview; ⌘E edits it in Settings.
  await page.keyboard.type('search quicklinks');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Quicklinks');
  await expect(page.getByRole('option', { name: /Docs/ })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Preview of Docs' })).toContainText(
    'https://example.com/docs/{argument}',
  );
  await page.keyboard.press(`${mod}+e`);
  const editForm = settings.getByRole('form', { name: 'Edit Quicklink' });
  await expect(editForm.getByLabel('Name')).toHaveValue('Docs');
  await editForm.getByLabel('Name').fill('Docs Search');
  await editForm.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => saved('quicklinks.json')[0]?.name).toBe('Docs Search');

  // ⌘⌫ deletes it.
  await showLauncher();
  await page.keyboard.type('search quicklinks');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Quicklinks');
  await expect(page.getByRole('option', { name: /Docs Search/ })).toBeVisible();
  await page.keyboard.press(`${mod}+Backspace`);
  await expect(page.locator('.toast')).toHaveText('Quicklink deleted');
  await expect(page.getByText('No quicklinks yet. Run Create Quicklink to add one.')).toBeVisible();
  expect(saved('quicklinks.json')).toEqual([]);

  // A snippet, made in Settings and copied from Search Snippets with its placeholders filled in.
  await settings.getByRole('button', { name: 'Snippets', exact: true }).click();
  await settings.getByRole('button', { name: 'New Snippet' }).click();
  const snippetForm = settings.getByRole('form', { name: 'New Snippet' });
  await snippetForm.getByLabel('Name').fill('Address');
  await snippetForm.getByLabel('Keyword').fill('!addr');
  await snippetForm.getByLabel('Text').fill('Bahnhofstrasse 1\n8001 Zürich\nCopied: ');
  await snippetForm.getByRole('button', { name: '{clipboard}' }).click();
  await expect(snippetForm.getByLabel('Text')).toHaveValue('Bahnhofstrasse 1\n8001 Zürich\nCopied: {clipboard}');
  await snippetForm.getByLabel('Text').press(`${mod}+Enter`);
  await expect
    .poll(() => saved('snippets.json'))
    .toEqual([
      {
        id: 'address',
        name: 'Address',
        text: 'Bahnhofstrasse 1\n8001 Zürich\nCopied: {clipboard}',
        keyword: '!addr',
      },
    ]);

  await page.keyboard.press('Escape');
  await app.evaluate(({ clipboard }) => clipboard.writeText('the plan'));
  await page.keyboard.type('search snippets');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Snippets');
  await expect(page.getByRole('option', { name: /Address/ })).toBeVisible();
  await page.keyboard.press(`${mod}+Enter`);
  await expect.poll(clipboardText).toBe('Bahnhofstrasse 1\n8001 Zürich\nCopied: the plan');
});

test('picks up quicklinks.json when it’s edited by hand', async () => {
  await page.keyboard.type('changelog');
  await expect(page.getByRole('option', { name: /Changelog/ })).toHaveCount(0);
  writeFileSync(
    join(userData, 'quicklinks.json'),
    JSON.stringify([{ name: 'Changelog', link: 'github.com/alexsilver8/waypoint/releases' }]),
  );
  const row = page.getByRole('option', { name: /Changelog/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Quicklink');
  await page.keyboard.press('Enter');
  await expect.poll(opened).toEqual(['https://github.com/alexsilver8/waypoint/releases']);
});
