import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';

// The Notes window, which works like Raycast Notes: one note at a time, Browse Notes (⌘P),
// the action panel (⌘K) and their shortcuts. Popovers open in a window of their own beside it.

const mac = process.platform === 'darwin';
const mod = mac ? 'Meta' : 'Control';
const deleteKey = mac ? 'Control+x' : 'Control+Shift+Backspace';

let app: ElectronApplication;
let notes: Page;
/** The page of the window popovers open in. */
let popover: Page;
let userData: string;

const note = (name: string) => readFileSync(join(userData, 'notes', name), 'utf8');
const title = () => notes.locator('.notes__title');
const editor = () => notes.getByRole('textbox', { name: 'Note', exact: true });
const browse = () => popover.getByRole('dialog', { name: 'Browse Notes' });
const actions = () => popover.getByRole('dialog', { name: 'Actions' });
const toast = () => notes.locator('.notes__toast');
const clipboardText = () => app.evaluate(({ clipboard }) => clipboard.readText());
/** The Notes window's size and whether it's showing, from the main process. */
const notesWindow = () =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('notes.html'));
    return window ? { visible: window.isVisible(), ...window.getBounds() } : undefined;
  });
/** The same for the popover window. */
const popoverWindow = () =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === 'about:blank');
    return window ? { visible: window.isVisible(), ...window.getBounds() } : undefined;
  });

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'waypoint-notes-'));
  mkdirSync(join(userData, 'notes'));
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  writeFileSync(join(userData, 'notes', 'groceries.md'), '# Groceries\n\n- oat milk');
  utimesSync(join(userData, 'notes', 'groceries.md'), dayAgo, dayAgo);
  writeFileSync(join(userData, 'notes', 'trip.md'), '# Trip to Lisbon\n\nBook the train');
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ hideOnBlur: false, clipboardHistory: { enabled: false } }),
  );
  app = await electron.launch({
    args: [join(import.meta.dirname, '..'), '--show', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, WAYPOINT_USER_DATA: userData },
  });
  const launcher = await app.firstWindow();
  await expect(launcher.getByRole('combobox')).toBeFocused();
  await expect(launcher.getByRole('option').first()).toBeVisible();
  await launcher.keyboard.type('open notes');
  await expect(launcher.getByRole('option').first()).toContainText('Open Notes');
  [notes] = await Promise.all([app.waitForEvent('window'), launcher.keyboard.press('Enter')]);
  // The newest note opens first.
  await expect(title()).toHaveText('Trip to Lisbon');
  await expect(editor()).toBeFocused();
  // The Notes window opens the popover window, hidden, as it starts.
  await expect.poll(() => app.windows().some((page) => page.url() === 'about:blank')).toBe(true);
  popover = app.windows().find((page) => page.url() === 'about:blank') as Page;
});

test.afterEach(async () => {
  await app.close();
});

test('opens like Raycast Notes: a small window with the title and three buttons at the top', async () => {
  const bounds = await notesWindow();
  expect(bounds).toMatchObject({ visible: true, width: 475, height: 308 });
  const toolbar = notes.getByRole('toolbar', { name: 'Note' });
  await expect(toolbar.getByRole('button')).toHaveCount(3);
  for (const [index, name] of ['Actions', 'Browse Notes', 'New Note'].entries()) {
    await expect(toolbar.getByRole('button').nth(index)).toHaveAccessibleName(name);
  }
  // An empty note says so.
  await toolbar.getByRole('button', { name: 'New Note' }).click();
  await expect(title()).toHaveText('Untitled');
  await expect(notes.locator('.is-editor-empty')).toHaveAttribute('data-placeholder', 'Start writing...');
});

test('browses notes with ⌘P, the note you’re on last', async () => {
  await notes.keyboard.press(`${mod}+p`);
  await expect(browse().getByRole('combobox')).toHaveAttribute('placeholder', 'Search for notes...');
  await expect(browse().locator('.browse__count')).toHaveText('2 Notes');
  const rows = browse().getByRole('option');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Groceries');
  await expect(rows.first()).toContainText(/Opened .+ • 18 characters/);
  await expect(rows.last()).toContainText('Trip to Lisbon');
  await expect(rows.last()).toContainText('Current • 29 characters');
  // It starts on the note you're on, with buttons to pin or delete it.
  await expect(rows.last()).toHaveAttribute('aria-selected', 'true');
  await expect(rows.last().getByRole('button', { name: 'Pin Note' })).toBeVisible();
  await expect(rows.last().getByRole('button', { name: 'Delete Note' })).toBeVisible();
  await expect(rows.first().getByRole('button')).toHaveCount(0);

  await popover.keyboard.type('groc');
  await expect(browse().locator('.browse__count')).toHaveText('1/2 Notes');
  await popover.keyboard.press('Enter');
  await expect(browse()).toHaveCount(0);
  await expect(title()).toHaveText('Groceries');
  await expect(editor()).toBeFocused();
});

test('opens popovers in a window of their own, which hangs below a short note', async () => {
  for (let i = 0; i < 6; i++) writeFileSync(join(userData, 'notes', `extra-${i}.md`), `# Extra ${i}`);
  await notes.keyboard.press(`${mod}+p`);
  await expect(browse().getByRole('option')).toHaveCount(8);
  await expect.poll(async () => (await popoverWindow())?.visible).toBe(true);
  const [window, popoverBounds] = [await notesWindow(), await popoverWindow()];
  if (!window || !popoverBounds) throw new Error('No window');
  // The Notes window stays the size it was; the popover is 100pt down it and centred across it,
  // in a clear margin of 20 for its shadow, and runs past its bottom.
  expect(window).toMatchObject({ width: 475, height: 308 });
  expect(popoverBounds.y).toBe(window.y + 100 - 20);
  const offCentre = popoverBounds.x + popoverBounds.width / 2 - (window.x + window.width / 2);
  expect(Math.abs(offCentre)).toBeLessThanOrEqual(1);
  expect(popoverBounds.width).toBe(320 + 40);
  expect(popoverBounds.y + popoverBounds.height).toBeGreaterThan(window.y + window.height);

  // Searching shrinks it to fit; closing it hides its window.
  await popover.keyboard.type('extra 3');
  await expect.poll(async () => (await popoverWindow())?.height).toBeLessThan(popoverBounds.height);
  await popover.keyboard.press('Escape');
  await popover.keyboard.press('Escape');
  await expect.poll(async () => (await popoverWindow())?.visible).toBe(false);
  await expect(editor()).toBeFocused();
  expect((await notesWindow())?.height).toBe(308);
});

test('closes a popover with Esc, and the window with Esc after that', async () => {
  await notes.keyboard.press(`${mod}+p`);
  await expect(browse()).toBeVisible();
  // While a popover is open, a round button in the corner closes it too.
  await expect(notes.getByRole('button', { name: 'Close' })).toBeVisible();
  await popover.keyboard.press('Escape');
  await expect(browse()).toHaveCount(0);
  await expect(editor()).toBeFocused();
  expect((await notesWindow())?.visible).toBe(true);
  await notes.keyboard.press('Escape');
  await expect.poll(async () => (await notesWindow())?.visible).toBe(false);
});

test('goes back and forward between notes with ⌘[ and ⌘]', async () => {
  await notes.keyboard.press(`${mod}+p`);
  await browse()
    .getByRole('option', { name: /Groceries/ })
    .click();
  await expect(title()).toHaveText('Groceries');
  await notes.keyboard.press(`${mod}+BracketLeft`);
  await expect(title()).toHaveText('Trip to Lisbon');
  await notes.keyboard.press(`${mod}+BracketRight`);
  await expect(title()).toHaveText('Groceries');

  // Browse Notes says when each note was last open, and ⌘P closes it again.
  await notes.keyboard.press(`${mod}+p`);
  await expect(browse().getByRole('option', { name: /Trip to Lisbon/ })).toContainText('Opened just now');
  await popover.keyboard.press(`${mod}+p`);
  await expect(browse()).toHaveCount(0);
});

test('pins notes to the top of Browse Notes and opens them with ⌘1', async () => {
  await notes.keyboard.press(`${mod}+Shift+p`);
  await expect(toast()).toHaveText('Pinned Note');
  await notes.keyboard.press(`${mod}+p`);
  await expect(browse().locator('.popover__section')).toHaveText(['Pinned', 'Notes']);
  await browse()
    .getByRole('option', { name: /Groceries/ })
    .click();
  await expect(title()).toHaveText('Groceries');
  await notes.keyboard.press(`${mod}+1`);
  await expect(title()).toHaveText('Trip to Lisbon');
});

test('shows every action with its shortcut, and greys out what can’t be done', async () => {
  await notes.keyboard.press(`${mod}+n`);
  await expect(title()).toHaveText('Untitled');
  await notes.keyboard.press(`${mod}+k`);
  await expect(actions().getByRole('combobox')).toHaveAttribute('placeholder', 'Search for actions...');
  const rows = actions().getByRole('option');
  await expect(rows.nth(0)).toContainText('New Note');
  await expect(rows.nth(0)).toHaveAttribute('aria-disabled', 'true');
  await expect(rows.nth(1)).toContainText('Duplicate Note');
  await expect(rows.nth(1)).toHaveAttribute('aria-disabled', 'true');
  // The first action that can run is selected, as in Raycast.
  await expect(rows.nth(2)).toContainText('Pin Note');
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(3)).toContainText('Browse Notes');
  await expect(rows.nth(3).locator('.keycap')).toHaveText([mac ? '⌘' : 'Ctrl', 'P']);
  await expect(rows.nth(4)).toContainText('Go Back');
  await expect(rows.nth(4)).not.toHaveAttribute('aria-disabled');

  await popover.keyboard.type('find in');
  await expect(rows.first()).toContainText('Find in Note');
  await popover.keyboard.press('Enter');
  await expect(actions()).toHaveCount(0);
  await expect(notes.getByRole('textbox', { name: 'Find in note' })).toBeFocused();
});

test('finds and replaces text in the note', async () => {
  await editor().press(`${mod}+End`);
  await notes.keyboard.type(' at the station');
  await notes.keyboard.press(`${mod}+f`);
  await notes.keyboard.type('THE');
  await expect(notes.locator('.find__count')).toHaveText('1 of 2');
  await expect(notes.locator('.find-match--current')).toHaveText('the');
  await notes.getByRole('button', { name: 'Replace' }).click();
  const replacement = notes.getByRole('textbox', { name: 'Replace with' });
  // Replace moves on to the next match, though "The" matches too.
  await replacement.fill('The');
  await replacement.press('Enter');
  await expect(notes.locator('.find__count')).toHaveText('2 of 2');
  await replacement.press('Enter');
  await expect(editor()).toContainText('Book The train at The station');
  await replacement.fill('a');
  await notes.getByRole('button', { name: 'All', exact: true }).click();
  await expect(editor()).toContainText('Book a train at a station');
  await expect(notes.locator('.find__count')).toHaveText('No results');
  await notes.keyboard.press('Escape');
  await expect(notes.getByRole('search')).toHaveCount(0);
  await expect.poll(() => note('trip.md')).toBe('# Trip to Lisbon\n\nBook a train at a station');
});

test('keeps finding when you go to another note', async () => {
  await notes.keyboard.press(`${mod}+f`);
  await notes.keyboard.type('milk');
  await expect(notes.locator('.find__count')).toHaveText('No results');
  await notes.keyboard.press(`${mod}+p`);
  await browse()
    .getByRole('option', { name: /Groceries/ })
    .click();
  await expect(title()).toHaveText('Groceries');
  await expect(notes.locator('.find__count')).toHaveText('1 of 1');
  await expect(notes.locator('.find-match--current')).toHaveText('milk');
});

test('deletes a note to Recently Deleted and brings it back', async () => {
  await notes.keyboard.press(deleteKey);
  await expect(toast()).toHaveText('Moved to Recently Deleted');
  await expect(title()).toHaveText('Groceries');
  expect(existsSync(join(userData, 'notes', 'trip.md'))).toBe(false);
  expect(readFileSync(join(userData, 'notes', '.deleted', 'trip.md'), 'utf8')).toBe(
    '# Trip to Lisbon\n\nBook the train',
  );

  await notes.keyboard.press(`${mod}+k`);
  await popover.keyboard.type('recently deleted');
  await popover.keyboard.press('Enter');
  const deleted = popover.getByRole('dialog', { name: 'Recently Deleted Notes' });
  await expect(deleted.getByRole('option')).toHaveCount(1);
  await expect(deleted.getByRole('option')).toContainText(/Trip to Lisbon.*Deleted just now/);
  await popover.keyboard.press('Enter');
  await expect(title()).toHaveText('Trip to Lisbon');
  expect(note('trip.md')).toBe('# Trip to Lisbon\n\nBook the train');

  // Deleting the note you're on from Browse Notes leaves Browse Notes open, and typing in it.
  await notes.keyboard.press(`${mod}+p`);
  await popover.keyboard.press(deleteKey);
  await expect(toast()).toHaveText('Moved to Recently Deleted');
  await expect(title()).toHaveText('Groceries');
  await expect(browse().locator('.browse__count')).toHaveText('1 Note');
  await expect(browse().getByRole('combobox')).toBeFocused();
});

test('grows the window as the note gets longer, and shrinks it back', async () => {
  await editor().press(`${mod}+End`);
  for (let i = 0; i < 16; i++) await notes.keyboard.press('Enter');
  await notes.keyboard.type('the end');
  await expect.poll(async () => (await notesWindow())?.height).toBeGreaterThan(450);

  // Another note fits the window too, without typing in it.
  await notes.keyboard.press(`${mod}+n`);
  await expect.poll(async () => (await notesWindow())?.height).toBe(308);
  await notes.keyboard.press(`${mod}+BracketLeft`);
  await expect(title()).toHaveText('Trip to Lisbon');
  await expect.poll(async () => (await notesWindow())?.height).toBeGreaterThan(450);

  await editor().press(`${mod}+a`);
  await notes.keyboard.press('Backspace');
  await expect.poll(async () => (await notesWindow())?.height).toBe(308);

  // With auto-resizing off, the window keeps its size.
  await notes.keyboard.press(`${mod}+k`);
  await popover.keyboard.type('auto-resizing');
  await expect(actions().getByRole('option').first()).toContainText('Disable Window Auto-Resizing');
  await popover.keyboard.press('Enter');
  await expect(actions()).toHaveCount(0);
  for (let i = 0; i < 16; i++) await notes.keyboard.press('Enter');
  await notes.waitForTimeout(400);
  expect((await notesWindow())?.height).toBe(308);
});

test('formats a line from the / menu', async () => {
  await editor().press(`${mod}+End`);
  await notes.keyboard.press('Enter');
  await notes.keyboard.type('/');
  const menu = notes.getByRole('listbox', { name: 'Format as' });
  await expect(menu.getByRole('option')).toHaveCount(10);
  await notes.keyboard.type('chec');
  await expect(menu.getByRole('option')).toHaveText(['Checklist']);
  await notes.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await notes.keyboard.type('pack the adapter');
  await expect(notes.getByRole('checkbox')).not.toBeChecked();

  // Esc leaves the / as typed, and the window open.
  await notes.keyboard.press('Enter');
  await notes.keyboard.type('/');
  await expect(menu).toBeVisible();
  await notes.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect((await notesWindow())?.visible).toBe(true);
  await expect
    .poll(() => note('trip.md'))
    .toBe('# Trip to Lisbon\n\nBook the train\n\n- [ ] pack the adapter\n- [ ] /');
});

test('picks an emoji by typing a colon and its name', async () => {
  await editor().press(`${mod}+End`);
  await notes.keyboard.type(' :tad');
  const picker = notes.getByRole('listbox', { name: 'Emoji' });
  await expect(picker.getByRole('option').first()).toContainText(':tada:');
  await notes.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect.poll(() => note('trip.md')).toBe('# Trip to Lisbon\n\nBook the train 🎉');
});

test('ticks a checklist item with ⌘↵', async () => {
  await editor().press(`${mod}+End`);
  await notes.keyboard.press('Enter');
  await notes.keyboard.type('[ ] call the bank');
  await notes.keyboard.press(`${mod}+Enter`);
  await expect(notes.getByRole('checkbox')).toBeChecked();
  await expect.poll(() => note('trip.md')).toBe('# Trip to Lisbon\n\nBook the train\n\n- [x] call the bank');
});

test('copies the note as plain text, and a link that opens it', async () => {
  // ⇧⌘C opens the action panel on Copy Note As...
  await notes.keyboard.press(`${mod}+Shift+c`);
  const copyAs = popover.getByRole('dialog', { name: 'Copy Note As' });
  await expect(copyAs.getByRole('option')).toHaveText(['Markdown', 'HTML', 'Plain Text']);
  await copyAs.getByRole('option', { name: 'Plain Text' }).click();
  await expect.poll(clipboardText).toBe('Trip to Lisbon\n\nBook the train');
  await expect(toast()).toHaveText('Copied to Clipboard');

  await notes.keyboard.press(`${mod}+Shift+d`);
  await expect.poll(clipboardText).toBe('waypoint://notes/trip');
});

test('duplicates a note', async () => {
  await notes.keyboard.press(`${mod}+d`);
  await notes.keyboard.press(`${mod}+p`);
  await expect(browse().locator('.browse__count')).toHaveText('3 Notes');
  await expect(browse().getByRole('option', { name: /Trip to Lisbon/ })).toHaveCount(2);
});
