import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';

// Clipboard history keeps a copied image: as a file in the data folder, with a row and a preview in
// the launcher, and puts it back on the clipboard from there.

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let app: ElectronApplication;
let page: Page;
let userData: string;

const savedImages = () => {
  try {
    return readdirSync(join(userData, 'clipboard-images'));
  } catch {
    return [];
  }
};

/** The saved history, newest first: each entry's text, or "image". */
const savedHistory = () => {
  try {
    const entries: Array<{ text: string }> = JSON.parse(readFileSync(join(userData, 'clipboard-history.json'), 'utf8'));
    return entries.map((entry) => entry.text || 'image');
  } catch {
    return [];
  }
};

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'waypoint-clipboard-'));
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

/** Copies a grey 30×20 image, as a screenshot tool would. */
async function copyImage() {
  await app.evaluate(async ({ clipboard, nativeImage, ClipboardItem }) => {
    const image = nativeImage.createFromBitmap(Buffer.alloc(30 * 20 * 4, 0xc0), { width: 30, height: 20 });
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) }),
    ]);
  });
  // The image and its thumbnail.
  await expect.poll(savedImages).toHaveLength(2);
}

/** An `<img>`'s width once loaded; 0 while it isn't, or couldn't be. */
const naturalWidth = (img: unknown) => (img as { naturalWidth: number }).naturalWidth;

async function openClipboardHistory() {
  await page.keyboard.type('clipboard hist');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search__crumb')).toHaveText('Clipboard History');
}

test('shows a copied image in the list and the preview, and deletes its files with it', async () => {
  await copyImage();
  await openClipboardHistory();
  const row = page.getByRole('option', { name: /Image \(30×20\)/ });
  await expect(row).toBeVisible();
  await expect.poll(() => row.locator('img').evaluate(naturalWidth)).toBe(30);
  const preview = page.getByRole('complementary', { name: /Preview/ }).locator('img');
  await expect.poll(() => preview.evaluate(naturalWidth)).toBe(30);

  await page.keyboard.press(`${mod}+Backspace`);
  await expect(page.getByText('Entry deleted')).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect.poll(savedImages).toEqual([]);
});

test('puts an image back on the clipboard without adding it again', async () => {
  await copyImage();
  await app.evaluate(({ clipboard }) => clipboard.writeText('copied after'));
  await expect.poll(savedHistory).toEqual(['copied after', 'image']);
  await openClipboardHistory();
  await expect(page.getByRole('option').first()).toContainText('copied after');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.has('image/png'))).toBe(true);
  // The image moves to the top. Clipboard history looks a few times meanwhile and doesn't add it again.
  await expect.poll(savedHistory).toEqual(['image', 'copied after']);
  await page.waitForTimeout(2000);
  expect(savedHistory()).toEqual(['image', 'copied after']);
});
