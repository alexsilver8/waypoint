import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let app: ElectronApplication;
let page: Page;
let userData: string;

/** Text of every note file, so tests can check what really landed on disk. */
function savedNotes(): string[] {
  const dir = join(userData, 'notes');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => readFileSync(join(dir, name), 'utf8'));
}

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'waypoint-e2e-'));
  if (test.info().title.includes('no cap') || test.info().title.includes('scrolled')) {
    mkdirSync(join(userData, 'notes'));
    for (let i = 1; i <= 12; i++) writeFileSync(join(userData, 'notes', `note-${i}.md`), `Note number ${i}`);
  }
  if (test.info().title.includes('safe')) {
    mkdirSync(join(userData, 'notes'));
    writeFileSync(join(userData, 'notes', 'budget.md'), '# Budget\n\n| item | cost |\n|---|---|\n| rent | 900 |');
    writeFileSync(join(userData, 'notes', 'todo.md'), 'Fix main.py\n\n- step one');
  }
  if (test.info().title.includes('preview')) {
    mkdirSync(join(userData, 'notes'));
    writeFileSync(
      join(userData, 'notes', 'launch.md'),
      '# Launch plan\n\nShip the glass look.\n\n- [x] Settings window\n- [ ] Record a demo',
    );
  }
  const extensionDirectories: string[] = [];
  if (test.info().title.includes('still loading')) {
    // An extension whose list fills in over four calls, its rows changing places on the way.
    const dir = join(userData, 'counting');
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'counting',
        type: 'module',
        waypoint: { title: 'Counting', commands: [{ name: 'count', title: 'Count to Four', mode: 'view' }] },
      }),
    );
    writeFileSync(
      join(dir, 'index.js'),
      `let calls = 0;
export default {
  commands: {
    count: {
      view() {
        calls += 1;
        const rows = calls < 3 ? ['Small', 'Big', 'Other'] : ['Big', 'Other', 'Small'];
        return {
          type: 'list',
          title: 'Counting',
          loading: calls < 4,
          items: rows.map((title) => ({ id: title, title: title + ' ' + calls, actions: [] })),
        };
      },
    },
  },
};
`,
    );
    extensionDirectories.push(dir);
  }
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ hideOnBlur: false, clipboardHistory: { enabled: false }, extensionDirectories }),
  );
  app = await electron.launch({
    // Launch the project folder (package.json "main" points at the build) so the app path
    // is the repo root and the example extensions get loaded.
    args: [join(import.meta.dirname, '..'), '--show', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, WAYPOINT_USER_DATA: userData },
  });
  page = await app.firstWindow();
  await expect(page.getByRole('combobox')).toBeFocused();
  // Root items arrive asynchronously; wait for them before typing.
  await expect(page.getByRole('option').first()).toBeVisible();
});

test.afterEach(async () => {
  await app.close();
});

test('lists commands at the root', async () => {
  await expect(page.getByRole('option', { name: /Clipboard History/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Search Google/ })).toBeVisible();
});

test('calculates inline', async () => {
  await page.keyboard.type('12 * (3 + 4)');
  await expect(page.locator('.calc__result')).toHaveText('84');
});

test('opens a command and goes back', async () => {
  await page.keyboard.type('clipboard hist');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Clipboard History');
  await expect(page.getByText('Clipboard history is turned off in settings.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.search__crumb')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveValue('clipboard hist');
});

test('runs an extension command in the extension host', async () => {
  await page.keyboard.type('generate uuid');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Generate UUID');
  const rows = page.getByRole('option');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toHaveText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/);
});

test('asks again for a list that is still loading, keeping the row picked', async () => {
  await page.keyboard.type('count to four');
  await expect(page.getByRole('option').first()).toContainText('Count to Four');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Counting');
  await expect(page.locator('.search')).toHaveAttribute('data-loading', 'true');
  await expect(page.getByRole('option', { selected: true })).toHaveText(/^Small/);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { selected: true })).toHaveText(/^Big/);
  // Done on the fourth call, with nothing more pressed.
  await expect(page.getByRole('option')).toHaveText([/^Big 4/, /^Other 4/, /^Small 4/], { timeout: 10_000 });
  await expect(page.locator('.search')).not.toHaveAttribute('data-loading');
  // The row picked is still the one picked, though it moved up.
  await expect(page.getByRole('option', { selected: true })).toHaveText(/^Big 4/);
});

test('shows the actions of the selected item', async () => {
  await page.keyboard.type('quit');
  await page.keyboard.press(`${mod}+k`);
  const panel = page.getByRole('dialog', { name: /Actions for Quit Waypoint/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('option')).toHaveText([/^Run Command/]);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('acts on what was typed even when ↵ comes before a self-filtering list catches up', async () => {
  await page.keyboard.type('to-dos');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('To-dos');
  await page.keyboard.type('buy oat milk');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: /buy oat milk/ })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveValue('');
});

test('asks before restarting, and Cancel goes back', async () => {
  await page.keyboard.type('restart');
  await expect(page.getByRole('option').first()).toContainText('Restart');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Restart');
  await expect(page.getByRole('option')).toHaveText([/Restart Now/, /Cancel/]);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveValue('restart');
});

test('a held ↵ opens a command once, without running what it shows', async () => {
  await app.evaluate(({ clipboard }) => clipboard.writeText('untouched'));
  await page.keyboard.type('generate uuid');
  await expect(page.getByRole('option').first()).toContainText('Generate UUID');
  await page.keyboard.down('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Generate UUID');
  // Pressing a key that's already down is a repeat.
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Generate UUID');
  await expect(page.getByRole('option')).toHaveCount(5);
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('untouched');
});

test('lists the window layouts', async () => {
  await page.keyboard.type('left half');
  const row = page.getByRole('option').first();
  await expect(row).toContainText('Left Half');
  await expect(row).toContainText('Window Management');
});

test('creates a note and saves it as a Markdown file', async () => {
  await page.keyboard.type('create note');
  const [notes] = await Promise.all([app.waitForEvent('window'), page.keyboard.press('Enter')]);
  const editor = notes.getByRole('textbox', { name: 'Note', exact: true });
  await expect(editor).toBeFocused();
  await editor.pressSequentially('Groceries\n- oat milk');
  // The first line is the note's title, in the middle of the title bar.
  await expect(notes.locator('.notes__title')).toHaveText('Groceries');
  // Typing "- " starts a list, saved as Markdown.
  await expect(editor.getByRole('listitem')).toHaveText('oat milk');
  await expect.poll(savedNotes).toEqual(['Groceries\n\n- oat milk']);
});

test('formats a note with the toolbar, shortcuts and Markdown', async () => {
  await page.keyboard.type('create note');
  const [notes] = await Promise.all([app.waitForEvent('window'), page.keyboard.press('Enter')]);
  const editor = notes.getByRole('textbox', { name: 'Note', exact: true });
  await expect(editor).toBeFocused();

  // The format bar is hidden until ⌥⌘, (Ctrl+Alt+, elsewhere) shows it.
  await expect(notes.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(0);
  await notes.keyboard.press(`${mod}+Alt+Comma`);
  await expect(notes.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
  await expect(notes.locator('.format-bar__count')).toHaveText('0 characters');

  await notes.keyboard.type('Trip');
  await notes.getByRole('button', { name: 'Heading' }).click();
  await notes.getByRole('menuitemradio', { name: /Heading 1/ }).click();
  await expect(editor.getByRole('heading', { level: 1 })).toHaveText('Trip');

  await notes.keyboard.press('Enter');
  await notes.keyboard.type('Pack ');
  await notes.keyboard.press(`${mod}+b`);
  await notes.keyboard.type('light');
  await notes.keyboard.press(`${mod}+b`);
  await notes.keyboard.press('Enter');

  await notes.getByRole('button', { name: 'List' }).click();
  await notes.getByRole('menuitemradio', { name: /Checklist/ }).click();
  await notes.keyboard.type('Book trains ');
  await notes.keyboard.press(`${mod}+l`);
  const address = notes.getByRole('textbox', { name: 'Link address' });
  await expect(address).toBeFocused();
  await address.fill('sbb.ch');
  await address.press('Enter');
  await expect(editor).toBeFocused();
  await expect(editor.getByRole('link', { name: 'sbb.ch' })).toHaveAttribute('href', 'https://sbb.ch');

  // ⌘-click (Ctrl-click) opens the link in the browser.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    Object.assign(globalThis, { opened });
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  await editor.getByRole('link', { name: 'sbb.ch' }).click({ modifiers: ['ControlOrMeta'] });
  await expect.poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened)).toEqual(['https://sbb.ch']);

  await notes.getByRole('checkbox', { name: /Book trains/ }).check();
  await expect.poll(savedNotes).toEqual(['# Trip\n\nPack **light**\n\n- [x] Book trains [sbb.ch](https://sbb.ch)']);
});

test('keeps notes safe from what the editor would change', async () => {
  const note = (name: string) => readFileSync(join(userData, 'notes', name), 'utf8');
  await page.keyboard.type('open notes');
  const [notes] = await Promise.all([app.waitForEvent('window'), page.keyboard.press('Enter')]);
  const editor = notes.getByRole('textbox', { name: 'Note', exact: true });
  const openNote = async (title: RegExp) => {
    await notes.getByRole('button', { name: 'Browse Notes' }).click();
    // Browse Notes opens in a window of its own.
    await expect.poll(() => app.windows().some((window) => window.url() === 'about:blank')).toBe(true);
    const popover = app.windows().find((window) => window.url() === 'about:blank');
    if (!popover) throw new Error('No popover window');
    await popover.getByRole('dialog', { name: 'Browse Notes' }).getByRole('option', { name: title }).click();
    await expect(popover.getByRole('dialog', { name: 'Browse Notes' })).toHaveCount(0);
  };

  // A table can't be shown formatted, so the note is edited as Markdown and keeps it.
  await openNote(/Budget/);
  await expect(editor).toHaveValue(note('budget.md'));
  await expect(notes.getByRole('status')).toContainText('Shown as Markdown');
  await editor.press('ControlOrMeta+End');
  await editor.pressSequentially('\n| food | 300 |');
  await expect
    .poll(() => note('budget.md'))
    .toBe('# Budget\n\n| item | cost |\n|---|---|\n| rent | 900 |\n| food | 300 |');

  // Opening a note doesn't turn file names into links.
  await openNote(/Fix main\.py/);
  await expect(editor).toContainText('Fix main.py');
  await expect(editor.getByRole('link')).toHaveCount(0);
  await expect(notes.getByText('Shown as Markdown')).toHaveCount(0);

  // An edit made elsewhere shows up, and undo can't bring back the old text over it.
  writeFileSync(join(userData, 'notes', 'todo.md'), 'Changed elsewhere');
  await expect(editor).toHaveText('Changed elsewhere');
  await editor.focus();
  await notes.keyboard.press('ControlOrMeta+z');
  await notes.waitForTimeout(700);
  expect(note('todo.md')).toBe('Changed elsewhere');
  expect(note('budget.md')).toContain('| food | 300 |');
});

test('turns launcher text into a note with the Create Note fallback', async () => {
  await page.keyboard.type('remember to call the bank');
  const createNote = page.getByRole('option', { name: /Create Note/ }).last();
  const [notes] = await Promise.all([app.waitForEvent('window'), createNote.click()]);
  await expect(notes.getByRole('textbox', { name: 'Note', exact: true })).toHaveText('remember to call the bank');
  // Showing a note never rewrites its file.
  await notes.waitForTimeout(700);
  expect(savedNotes()).toEqual(['remember to call the bank\n']);
});

test('lists every note, with no cap', async () => {
  await page.keyboard.type('search notes');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Notes');
  await expect(page.locator('.results__heading')).toHaveText('12 notes');
  await expect(page.getByRole('option')).toHaveCount(12);
  await page.keyboard.type('number 7');
  await expect(page.getByRole('option')).toHaveCount(1);
});

test('switches what the root lists with the scope dock', async () => {
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  await expect(tab('All')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(tab('Commands')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox')).toHaveAttribute('placeholder', 'Search commands…');
  await expect(page.locator('.results__heading')).toHaveText(['Commands']);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(tab('Clipboard')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Nothing copied yet, or clipboard history is turned off in Settings.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tab('All')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('option', { name: /Clipboard History/ })).toBeVisible();
});

test('keeps the picked scope legible when nothing matches', async () => {
  const all = page.getByRole('tab', { name: /^All\b/ });
  const commands = page.getByRole('tab', { name: /^Commands\b/ });
  // A tab's icon colour, once any fade between looks has finished.
  const ink = (tab: typeof all) =>
    tab.evaluate(async (el) => {
      for (const animation of el.getAnimations()) await animation.finished;
      return el.ownerDocument.defaultView.getComputedStyle(el).color;
    });
  const picked = await ink(all);
  const other = await ink(commands);

  await page.keyboard.type('qqqqqqqqqqqq');
  await expect(all).toHaveAccessibleName('All, 0');
  await expect(commands).toHaveAccessibleName('Commands, 0');
  // Scopes with nothing step back, but the picked one keeps its ink: on its disc, a faded icon disappears.
  expect(await ink(commands)).not.toBe(other);
  expect(await ink(all)).toBe(picked);
});

test('lists each extension with its commands in the Extensions tab', async () => {
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(tab('Extensions')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox')).toHaveAttribute('placeholder', 'Search extensions and their commands…');
  await expect(page.locator('.results__heading').first()).toHaveText('Browser Bookmarks');

  // An extension's name finds all of its commands; built-in commands aren't listed here.
  await page.keyboard.type('docker');
  await expect(page.locator('.results__heading')).toHaveText(['Docker']);
  await expect(page.getByRole('option')).toHaveText([/Search Docker Containers/, /Search Docker Images/]);
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type('quit waypoint');
  await expect(page.getByRole('option')).toHaveCount(0);

  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type('uuid');
  await expect(page.locator('.results__heading')).toHaveText(['Developer Utilities']);
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Generate UUID');
});

test('finds notes from the root and shows a preview', async () => {
  await page.keyboard.type('glass look');
  const note = page.getByRole('option', { name: /Launch plan/ });
  await expect(note).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Notes/ })).toHaveAccessibleName('Notes, 1');

  // In the Notes tab the note is first, and the preview shows its body.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(note).toHaveAttribute('aria-selected', 'true');
  const preview = page.getByRole('complementary', { name: 'Preview of Launch plan' });
  await expect(preview.getByText('Ship the glass look.')).toBeVisible();
  await expect(preview.getByText('Done: Settings window')).toBeAttached();
  await expect(preview.getByText('Words')).toBeVisible();

  // Clicking the preview leaves the keyboard with the search field.
  await preview.click();
  await expect(page.getByRole('combobox')).toBeFocused();

  const [notes] = await Promise.all([app.waitForEvent('window'), page.keyboard.press('Enter')]);
  await expect(notes.locator('.notes__title')).toHaveText('Launch plan');
});

test('runs a result by its number', async () => {
  await page.keyboard.type('generate uuid');
  await expect(page.getByRole('option').first()).toContainText('Generate UUID');
  await page.keyboard.down(mod);
  await expect(page.getByRole('option').first().locator('.keycap')).toHaveText([mod === 'Meta' ? '⌘' : 'Ctrl', '1']);
  await page.keyboard.press('1');
  await page.keyboard.up(mod);
  await expect(page.locator('.search__crumb')).toHaveText('Generate UUID');
});

test('numbers the rows in view once the list is scrolled', async () => {
  await page.keyboard.type('search notes');
  await page.keyboard.press('Enter');
  const options = page.getByRole('option');
  await expect(options).toHaveCount(12);
  // Scroll the third note to the top of the list.
  await page.locator('.content__list').evaluate((list) => {
    const third = list.querySelectorAll('[role="option"]')[2];
    if (third) list.scrollTop += third.getBoundingClientRect().top - list.getBoundingClientRect().top;
  });
  const fourth = (await options.nth(3).locator('.row__title').textContent()) ?? '';
  await page.keyboard.down(mod);
  await expect(options.first().locator('.keycap')).toHaveCount(0);
  await expect(options.nth(2).locator('.keycap')).toHaveText([mod === 'Meta' ? '⌘' : 'Ctrl', '1']);
  const [notes] = await Promise.all([app.waitForEvent('window'), page.keyboard.press('2')]);
  await page.keyboard.up(mod);
  await expect(notes.locator('.notes__title')).toHaveText(fourth);
});

test('opens again where it was dragged', async () => {
  const launcher = () =>
    app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { visible: window?.isVisible(), position: window?.getPosition() };
    });
  const centered = (await launcher()).position;
  // A drag goes through the system's window manager; moving the window stands in for it.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setPosition(60, 80));
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await launcher()).visible).toBe(false);
  await app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance'));
  await expect.poll(async () => (await launcher()).visible).toBe(true);
  expect((await launcher()).position).toEqual([60, 80]);
  expect(centered).not.toEqual([60, 80]);
});

test('shows the snapping guides while it is dragged by its glass', async () => {
  const visibleWindows = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length);
  const icon = await page.locator('.search__icon').boundingBox();
  if (!icon) throw new Error('No search icon');
  await page.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2);
  await page.mouse.down();
  await page.mouse.move(icon.x + 40, icon.y + 30);
  await expect.poll(visibleWindows).toBe(2);
  await page.mouse.up();
  await expect.poll(visibleWindows).toBe(1);
  await expect(page.getByRole('combobox')).toBeFocused();

  // A press on a control is a click, not a drag.
  const tab = await page.getByRole('tab', { name: 'Apps', exact: true }).boundingBox();
  if (!tab) throw new Error('No Apps tab');
  await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
  await page.mouse.down();
  await page.mouse.move(tab.x + 40, tab.y + 30);
  expect(await visibleWindows()).toBe(1);
  await page.mouse.up();
});

test('opens Settings from Waypoint in the footer', async () => {
  const [settings] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', { name: 'Waypoint', exact: true }).click(),
  ]);
  await expect(settings.getByRole('heading', { name: 'General' })).toBeVisible();
});

test('changes settings in the Settings window', async () => {
  const settingsFile = () => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'));
  await page.keyboard.type('open settings');
  const [settings] = await Promise.all([app.waitForEvent('window'), page.keyboard.press('Enter')]);
  await expect(settings.getByRole('heading', { name: 'General' })).toBeVisible();
  // The page starts focused on its content, not on a section button.
  await expect(settings.getByRole('main')).toBeFocused();

  await settings.getByText('Dark', { exact: true }).click();
  await expect.poll(() => settingsFile().theme).toBe('dark');

  await settings.getByRole('button', { name: /^Shortcut:/ }).click();
  await expect(settings.getByText('Press a shortcut…')).toBeVisible();
  await settings.keyboard.press('Control+Shift+K');
  await expect.poll(() => settingsFile().hotkey).toBe('Control+Shift+K');

  await settings.getByRole('button', { name: 'Clipboard' }).click();
  await settings.getByRole('switch', { name: 'Save clipboard history' }).click();
  await settings.getByLabel('Entries to keep').selectOption('500');
  await expect.poll(() => settingsFile().clipboardHistory).toEqual({ enabled: true, maxItems: 500 });
});
