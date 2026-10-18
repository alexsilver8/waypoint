import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';

// Quicklinks and snippets: from their files, forms in the launcher and Settings, through the root search.

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

/** What the launcher's page is given, as far as these tests use it. */
type LauncherPage = typeof globalThis & {
  palette: { onShown(listener: () => void): () => void };
  requestAnimationFrame(callback: () => void): number;
  shownHandled?: Promise<void>;
};

/**
 * Opens the launcher again after an action closed it, with an empty search. It waits until the
 * page has dealt with being shown, which selects the search text: letters typed before that would
 * be selected, and replaced by the next one.
 */
async function showLauncher() {
  await expect.poll(launcherVisible).toBe(false);
  await page.evaluate(() => {
    const launcher = globalThis as LauncherPage;
    launcher.shownHandled = new Promise((resolve) => {
      const off = launcher.palette.onShown(() => {
        off();
        launcher.requestAnimationFrame(() => resolve());
      });
    });
  });
  await app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance'));
  await page.evaluate(() => (globalThis as LauncherPage).shownHandled);
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

/** A page's own requestAnimationFrame, and the callbacks held back from it. */
interface Frames {
  requestAnimationFrame(callback: (time: number) => void): number;
  next?: Frames['requestAnimationFrame'];
  held?: Array<(time: number) => void>;
}

/** Holds back a page's animation frames, as a busy machine does, until `releaseFrames(on)`. */
const holdFrames = (on: Page) =>
  on.evaluate(() => {
    const frames = globalThis as unknown as Frames;
    frames.next ??= frames.requestAnimationFrame.bind(frames);
    const held: Array<(time: number) => void> = [];
    frames.held = held;
    frames.requestAnimationFrame = (callback) => held.push(callback);
  });
const releaseFrames = (on: Page) =>
  on.evaluate(() => {
    const frames = globalThis as unknown as Frames;
    if (frames.next) frames.requestAnimationFrame = frames.next;
    for (const callback of frames.held?.splice(0) ?? []) callback(performance.now());
  });

/** A field of the form that's open, by its label. */
const field = (name: string) => page.getByRole('textbox', { name, exact: true });

test('makes and changes quicklinks and snippets in forms in the launcher', async () => {
  // Create Quicklink opens a form, with the keyboard in its first field.
  await page.keyboard.type('create quicklink');
  await expect(page.getByRole('option').first()).toContainText('Create Quicklink');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Create Quicklink');
  await expect(field('Name')).toBeFocused();
  await expect(page.getByText(/Put \{argument\} where what you type after its name goes/)).toBeVisible();
  await expect(page.getByRole('combobox', { name: /Open With/ })).toHaveText(/Default/);
  await page.keyboard.type('Docs');

  // The store's own checks: a link that can't open says why, and the form keeps what was typed.
  await field('Link').fill('docs for everything');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.toast')).toHaveText(/^Use a web address like https:\/\/example.com/);
  await expect(page.locator('.search__crumb')).toHaveText('Create Quicklink');
  await expect(field('Name')).toHaveValue('Docs');
  await field('Link').fill('https://example.com/docs/{argument}');
  await field('Icon').fill('📘');
  await page.keyboard.press(`${mod}+Enter`);

  // Saved, and back to an empty root search, where it's ready to use.
  await expect(page.locator('.toast')).toHaveText('Quicklink created');
  await expect(page.locator('.search__crumb')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveValue('');
  expect(saved('quicklinks.json')).toEqual([
    { id: 'docs', name: 'Docs', link: 'https://example.com/docs/{argument}', icon: '📘' },
  ]);
  await page.keyboard.type('docs intro');
  await expect(page.getByRole('option').first()).toContainText('“intro”');
  await page.keyboard.press('Enter');
  await expect.poll(opened).toEqual(['https://example.com/docs/intro']);
  await showLauncher();

  // ⌘E in Search Quicklinks edits it in the same form, then goes back to the list with the change.
  await page.keyboard.type('search quicklinks');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Quicklinks');
  await expect(page.getByRole('option', { name: /Docs/ })).toBeVisible();
  await page.keyboard.press(`${mod}+e`);
  await expect(page.locator('.search__crumb')).toHaveText('Edit Quicklink');
  await expect(field('Name')).toHaveValue('Docs');
  await expect(field('Link')).toHaveValue('https://example.com/docs/{argument}');
  await field('Name').fill('Docs Search');
  await field('Name').press('Enter');
  await expect(page.locator('.toast')).toHaveText('Quicklink saved');
  await expect(page.locator('.search__crumb')).toHaveText('Quicklinks');
  await expect(page.getByRole('option', { name: /Docs Search/ })).toBeVisible();
  expect(saved('quicklinks.json')).toEqual([
    { id: 'docs', name: 'Docs Search', link: 'https://example.com/docs/{argument}', icon: '📘' },
  ]);

  // ⌘E on it in the root search too, back to the search as it was.
  await page.keyboard.press('Escape');
  await page.keyboard.type('docs search');
  await expect(page.getByRole('option').first()).toContainText('Docs Search');
  await page.keyboard.press(`${mod}+e`);
  await expect(page.locator('.search__crumb')).toHaveText('Edit Quicklink');
  await field('Icon').fill('');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.toast')).toHaveText('Quicklink saved');
  // The toast can show a moment before the form makes way for the search.
  await expect(page.locator('.search__crumb')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveValue('docs search');
  await expect.poll(() => saved('quicklinks.json')[0]).not.toHaveProperty('icon');
  await page.keyboard.press('Escape');

  // A link typed in the search can be made into a quicklink from ⌘K, starting from the link.
  await page.keyboard.type('example.com/wiki');
  await expect(page.getByRole('option').first()).toContainText('Open example.com/wiki');
  await page.keyboard.press(`${mod}+k`);
  await page
    .getByRole('dialog')
    .getByRole('option', { name: /Create Quicklink/ })
    .click();
  await expect(page.locator('.search__crumb')).toHaveText('Create Quicklink');
  await expect(field('Link')).toHaveValue('https://example.com/wiki');
  await page.keyboard.type('Wiki');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.toast')).toHaveText('Quicklink created');
  expect(saved('quicklinks.json')[1]).toEqual({ id: 'wiki', name: 'Wiki', link: 'https://example.com/wiki' });

  // Create Snippet: ↵ in the text starts a new line, and ⌘↵ saves.
  await page.keyboard.type('create snippet');
  await expect(page.getByRole('option').first()).toContainText('Create Snippet');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Create Snippet');
  await page.keyboard.type('Address');
  await page.keyboard.press('Tab');
  await expect(field('Text')).toBeFocused();
  await page.keyboard.type('Bahnhofstrasse 1');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Copied: {clipboard}');
  await field('Keyword').fill('!addr');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.toast')).toHaveText('Snippet created');
  expect(saved('snippets.json')).toEqual([
    { id: 'address', name: 'Address', text: 'Bahnhofstrasse 1\nCopied: {clipboard}', keyword: '!addr' },
  ]);

  // A keyword another snippet has is refused, and the form stays open with what was typed.
  await page.keyboard.type('create snippet');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Create Snippet');
  await page.keyboard.type('Home');
  await field('Text').fill('Home sweet home');
  await field('Keyword').fill('!ADDR');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.toast')).toHaveText('“Address” already has the keyword !addr.');
  await expect(page.locator('.search__crumb')).toHaveText('Create Snippet');
  await expect(field('Text')).toHaveValue('Home sweet home');
  await field('Keyword').fill('!home');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.toast')).toHaveText('Snippet created');
  expect(saved('snippets.json')).toHaveLength(2);

  // ⌘E in Search Snippets, then ⌘↵ copies the changed one.
  await page.keyboard.type('search snippets');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Snippets');
  await page.getByRole('combobox').fill('address');
  await expect(page.getByRole('option').first()).toContainText('Address');
  await page.keyboard.press(`${mod}+e`);
  await expect(page.locator('.search__crumb')).toHaveText('Edit Snippet');
  await expect(field('Keyword')).toHaveValue('!addr');
  await field('Text').fill('Bahnhofstrasse 2\nCopied: {clipboard}');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.toast')).toHaveText('Snippet saved');
  await expect(page.locator('.search__crumb')).toHaveText('Snippets');
  await expect(page.getByRole('combobox')).toHaveValue('address');
  await app.evaluate(({ clipboard }) => clipboard.writeText('the plan'));
  await page.keyboard.press(`${mod}+Enter`);
  await expect.poll(clipboardText).toBe('Bahnhofstrasse 2\nCopied: the plan');
});

test('makes, changes and deletes quicklinks and snippets in Settings', async () => {
  // Settings has its own editors too.
  const [settings] = await Promise.all([app.waitForEvent('window'), page.keyboard.press(`${mod}+,`)]);
  await settings.getByRole('button', { name: 'Quicklinks', exact: true }).click();
  await expect(settings.getByRole('heading', { name: 'Quicklinks', exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'New Quicklink' }).click();
  const quicklinkForm = settings.getByRole('form', { name: 'New Quicklink' });
  await expect(quicklinkForm.getByLabel('Name')).toBeFocused();
  await settings.keyboard.type('Docs');
  // Mistakes are pointed out before anything is saved.
  await quicklinkForm.getByLabel('Link').fill('docs for everything');
  await quicklinkForm.getByRole('button', { name: 'Save' }).click();
  await expect(quicklinkForm.getByRole('alert')).toContainText('Use a web address');
  await quicklinkForm.getByLabel('Link').fill('https://example.com/docs/');
  // A placeholder goes in at once, caret and all: on a busy machine, the field clicked next keeps
  // the keyboard rather than losing it to the Link field a frame later.
  await holdFrames(settings);
  await quicklinkForm.getByRole('button', { name: '{argument}' }).click();
  await expect(quicklinkForm.getByLabel('Link')).toHaveValue('https://example.com/docs/{argument}');
  await expect(quicklinkForm.getByLabel('Link')).toBeFocused();
  await quicklinkForm.getByLabel('Icon').click();
  await releaseFrames(settings);
  await settings.keyboard.type('📘');
  await expect(quicklinkForm.getByLabel('Icon')).toHaveValue('📘');
  await expect(quicklinkForm.getByLabel('Link')).toHaveValue('https://example.com/docs/{argument}');
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

  // Search Quicklinks shows it with a preview; Edit in Settings (⌘K) takes it to Settings.
  await page.keyboard.type('search quicklinks');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Quicklinks');
  await expect(page.getByRole('option', { name: /Docs/ })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Preview of Docs' })).toContainText(
    'https://example.com/docs/{argument}',
  );
  await page.keyboard.press(`${mod}+k`);
  await page
    .getByRole('dialog')
    .getByRole('option', { name: /Edit in Settings/ })
    .click();
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

  // The store's checks apply here too: a keyword in use is refused.
  await settings.getByRole('button', { name: 'New Snippet' }).click();
  const another = settings.getByRole('form', { name: 'New Snippet' });
  await another.getByLabel('Name').fill('Office');
  await another.getByLabel('Keyword').fill('!addr');
  await another.getByLabel('Text').fill('Somewhere else');
  await another.getByRole('button', { name: 'Save' }).click();
  await expect(another.getByRole('alert')).toContainText('“Address” already has the keyword !addr.');
  await another.getByRole('button', { name: 'Cancel' }).click();

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
