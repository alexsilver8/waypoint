import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';

// Detail views and forms, from an extension of the test's own.

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let app: ElectronApplication;
let page: Page;

const NOTES = `# What’s new

Waypoint now shows **pages** and _forms_. See [the docs](https://example.com/docs).

- Detail views
- Forms
  - with dropdowns

- [x] Write it
- [ ] Ship it

| Field | Kind |
| :--- | ---: |
| name | text |
| reply | checkbox |

<b>not bold</b>

\`\`\`js
const page = 'detail';
\`\`\`

${Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of the long tail.`).join('\n\n')}
`;

/** An extension with a page of release notes, and a feedback form that the page's ↵ opens. */
function addViewsExtension(userData: string) {
  const dir = join(userData, 'extensions', 'views-check');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'views-check',
      type: 'module',
      main: 'index.js',
      waypoint: {
        title: 'Views Check',
        commands: [
          { name: 'notes', title: 'Show Release Notes', mode: 'view' },
          { name: 'feedback', title: 'Send Feedback', mode: 'view' },
        ],
      },
    }),
  );
  writeFileSync(
    join(dir, 'index.js'),
    `const feedback = {
  type: 'form',
  title: 'Send Feedback',
  submit: { id: 'send', title: 'Send Feedback' },
  actions: [{ type: 'callback', id: 'later', title: 'Remind Me Later' }],
  fields: [
    { type: 'text', id: 'name', title: 'Name', placeholder: 'Your name', required: true },
    { type: 'textarea', id: 'message', title: 'Message', info: 'Markdown works.' },
    { type: 'separator' },
    { type: 'checkbox', id: 'reply', title: 'Reply', label: 'Write back to me' },
    {
      type: 'dropdown',
      id: 'mood',
      title: 'Mood',
      options: [
        { value: 'happy', title: 'Happy', icon: '😀' },
        { value: 'meh', title: 'Meh', icon: '😐' },
        { value: 'grumpy', title: 'Grumpy', icon: '😠' },
      ],
    },
    { type: 'description', text: 'Nothing leaves your computer.' },
  ],
};

const respond = (id, payload) => {
  if (id === 'star') return { toast: 'Starred' };
  if (id === 'open-form') return { push: feedback };
  if (id === 'later') return { toast: 'Later, then' };
  if (id === 'send') {
    if (payload.name === 'fail') return { toast: 'Could not send', toastStyle: 'failure' };
    return { pop: true, toast: 'Sent ' + JSON.stringify(payload) };
  }
};

export default {
  commands: {
    notes: {
      view: () => ({
        type: 'detail',
        title: 'Release Notes',
        markdown: ${JSON.stringify(NOTES)},
        metadata: [{ label: 'Version', value: '2.0.0' }],
        actions: [
          { type: 'callback', id: 'open-form', title: 'Give Feedback' },
          { type: 'callback', id: 'star', title: 'Star' },
          { type: 'copy', text: 'v2', title: 'Copy Version', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } },
        ],
      }),
      onAction: respond,
    },
    feedback: { view: () => feedback, onAction: respond },
  },
};
`,
  );
}

test.beforeEach(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'waypoint-views-'));
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ hideOnBlur: false, pasteIntoApps: false }));
  addViewsExtension(userData);
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

async function open(command: string, title: string) {
  await page.keyboard.type(command);
  await expect(page.getByRole('option').first()).toContainText(command);
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText(title);
}

const launcherVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible());

test('shows a Markdown page with its actions, and opens its links in the browser', async () => {
  await open('Show Release Notes', 'Release Notes');
  const article = page.getByRole('article', { name: 'Release Notes' });
  await expect(article.getByRole('heading', { level: 1 })).toHaveText('What’s new');
  await expect(article.locator('strong')).toHaveText('pages');
  await expect(article.getByRole('listitem').filter({ hasText: /^with dropdowns$/ })).toBeVisible();
  await expect(article.locator('li.markdown__task')).toHaveText(['Done: Write it', 'To do: Ship it']);
  await expect(article.getByRole('table').getByRole('cell', { name: 'checkbox' })).toBeVisible();
  await expect(article.getByRole('columnheader', { name: 'Kind' })).toHaveCSS('text-align', 'right');
  // Raw HTML is shown as the text it is.
  await expect(article.getByText('<b>not bold</b>')).toBeVisible();
  await expect(article.locator('b')).toHaveCount(0);
  await expect(article.locator('pre code')).toHaveText("const page = 'detail';");
  await expect(page.getByRole('complementary', { name: 'Information' })).toContainText('Version2.0.0');

  // The arrows and Page Down scroll the text; the search field is out of sight.
  const scroller = page.locator('.page__scroll');
  await page.keyboard.press('PageDown');
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  await page.keyboard.press('Home');
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);

  // ⌘↵ runs the second action, and ⌘K lists them all with their keys.
  await expect(page.locator('.footer__button--primary')).toHaveText(/Give Feedback/);
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.toast')).toHaveText('Starred');
  await page.keyboard.press(`${mod}+k`);
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('option')).toHaveText([/Give Feedback/, /Star/, /Copy Version/]);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.search__crumb')).toHaveText('Release Notes');

  // A link opens in the browser, through the main process, and the launcher stays on its page.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    Object.assign(globalThis, { opened });
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  const url = page.url();
  await article.getByRole('link', { name: 'the docs' }).click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
    .toEqual(['https://example.com/docs']);
  expect(page.url()).toBe(url);
  await expect.poll(launcherVisible).toBe(false);
});

test('fills in a form and submits it with ⌘↵', async () => {
  await open('Show Release Notes', 'Release Notes');
  // ↵ runs the page's first action, which opens the form.
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Send Feedback');
  const name = page.getByRole('textbox', { name: 'Name' });
  await expect(name).toBeFocused();
  await expect(page.locator('.footer__button--primary')).toHaveText(/Send Feedback/);

  // ⌫ and the arrows belong to the field, not the launcher.
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.search__crumb')).toHaveText('Send Feedback');
  await expect(name).toBeFocused();

  // A required field left empty stops it, and says so.
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.getByText('Name is required')).toBeVisible();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toBeFocused();

  // A failure leaves the form open with what was typed.
  await page.keyboard.type('fail');
  await expect(page.getByText('Name is required')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('.toast')).toHaveText('Could not send');
  await expect(name).toHaveValue('fail');
  await expect(name).toBeFocused();

  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Ada');
  // ⇥ moves through the fields; ↵ in a text area starts a new line.
  await page.keyboard.press('Tab');
  const message = page.getByRole('textbox', { name: 'Message' });
  await expect(message).toBeFocused();
  await page.keyboard.type('Love it');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Thanks');
  await page.keyboard.press('Tab');
  const reply = page.getByRole('checkbox', { name: /Reply/ });
  await expect(reply).toBeFocused();
  await page.keyboard.press('Space');
  await expect(reply).toBeChecked();
  await page.keyboard.press('Tab');
  const mood = page.getByRole('combobox', { name: /Mood/ });
  await expect(mood).toBeFocused();
  await expect(mood).toHaveText('😀Happy');
  // Typing narrows the dropdown down; ↵ picks, and Esc only closes it.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['😀Happy', '😐Meh', '😠Grumpy']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(mood).toBeFocused();
  await page.keyboard.type('gru');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['😠Grumpy']);
  await page.keyboard.press('Enter');
  await expect(mood).toHaveText('😠Grumpy');
  await expect(mood).toBeFocused();
  // Round again to the first field.
  await page.keyboard.press('Tab');
  await expect(name).toBeFocused();

  // ⌘K has the submit action first, then the form's own.
  await page.keyboard.press(`${mod}+k`);
  await expect(page.getByRole('dialog').getByRole('option')).toHaveText([/Send Feedback/, /Remind Me Later/]);
  await page.keyboard.press('Escape');
  await expect(name).toBeFocused();

  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.toast')).toHaveText(
    'Sent {"name":"Ada","message":"Love it\\nThanks","reply":true,"mood":"grumpy"}',
  );
  // `pop: true` goes back to the page.
  await expect(page.locator('.search__crumb')).toHaveText('Release Notes');
});

test('goes home with Esc from a form', async () => {
  await open('Send Feedback', 'Send Feedback');
  await expect(page.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await page.keyboard.type('Ada');
  await page.keyboard.press('Escape');
  await expect(page.locator('.search__crumb')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toBeFocused();
  await expect(page.getByRole('combobox')).toHaveValue('');
});

test('goes back to the list a form was opened from, with what it added', async () => {
  // The example extension's to-dos: a list that builds itself, and a form that adds to it.
  await page.keyboard.type('To-dos');
  await expect(page.getByRole('option').first()).toContainText('To-dos');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option').first()).toContainText('New To-do…');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('New To-do');
  await page.keyboard.type('Water the plants');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Only the **ferns**');
  await page.keyboard.press(`${mod}+Enter`);

  await expect(page.locator('.toast')).toHaveText('To-do added');
  await expect(page.locator('.search__crumb')).toHaveText('To-dos');
  const row = page.getByRole('option', { name: /Water the plants/ });
  await expect(row).toBeVisible();
  // Its notes show beside the list, as Markdown.
  await page.keyboard.press('ArrowDown');
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.detail__markdown strong')).toHaveText('ferns');
});
