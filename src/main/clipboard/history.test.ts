import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClipboardHistory, type ClipboardImage, type ClipboardSource } from './history';
import { IMAGES_FOLDER, MAX_IMAGE_BYTES } from './images';

/** An image of `width`×`height` filled with `fill`; `encoding` changes the PNG bytes but not the pixels. */
function fakeImage(fill: number, { width = 4, height = 2, encoding = 0, bytes = 16 } = {}): ClipboardImage {
  return {
    png: new Uint8Array(bytes).fill(fill + encoding * 100),
    decode: () => ({
      width,
      height,
      bitmap: new Uint8Array(width * height * 4).fill(fill),
      thumbnail: () => new Uint8Array([fill]),
    }),
  };
}

function fakeClipboard() {
  const state: { text: string; image: ClipboardImage | undefined; concealed: boolean; written: string[] } = {
    text: '',
    image: undefined,
    concealed: false,
    written: [],
  };
  const source: ClipboardSource = {
    readText: async () => state.text,
    readImage: async () => state.image,
    async writeImage(path) {
      state.written.push(path);
      state.text = '';
      // Encoded afresh, as a real clipboard does.
      state.image = { ...fakeImage(readFileSync(path)[0] ?? 0), png: new Uint8Array([9, 9, 9]) };
    },
    isConcealed: async () => state.concealed,
  };
  return { state, source };
}

function tempFile() {
  return join(mkdtempSync(join(tmpdir(), 'clip-')), 'history.json');
}

const imagesIn = (path: string) => readdirSync(join(dirname(path), IMAGES_FOLDER)).sort();

describe('ClipboardHistory', () => {
  it('records new text, newest first, without duplicates', async () => {
    const { state, source } = fakeClipboard();
    const history = new ClipboardHistory(tempFile(), source, 10);
    for (const text of ['one', 'two', 'one']) {
      state.text = text;
      await history.poll();
    }
    expect(history.entries().map((e) => e.text)).toEqual(['one', 'two']);
  });

  it('ignores whitespace-only text and unchanged clipboards', async () => {
    const { state, source } = fakeClipboard();
    const history = new ClipboardHistory(tempFile(), source, 10);
    state.text = '   ';
    await history.poll();
    state.text = 'x';
    await history.poll();
    await history.poll();
    expect(history.entries()).toHaveLength(1);
  });

  it('skips text Waypoint puts on the clipboard itself', async () => {
    const { state, source } = fakeClipboard();
    const history = new ClipboardHistory(tempFile(), source, 10);
    history.ignore('expanded snippet');
    state.text = 'expanded snippet';
    await history.poll();
    expect(history.entries()).toEqual([]);
  });

  it('skips content that password managers mark as concealed', async () => {
    const { state, source } = fakeClipboard();
    const history = new ClipboardHistory(tempFile(), source, 10);
    state.text = 'hunter2';
    state.concealed = true;
    await history.poll();
    state.text = '';
    state.image = fakeImage(1);
    await history.poll();
    expect(history.entries()).toHaveLength(0);
  });

  it('does not record what was on the clipboard before it started', async () => {
    const { state, source } = fakeClipboard();
    const history = new ClipboardHistory(tempFile(), source, 10);
    state.text = 'old';
    await history.start();
    await history.poll();
    history.stop();
    expect(history.entries()).toHaveLength(0);
  });

  it('keeps at most maxItems entries', () => {
    const { source } = fakeClipboard();
    const history = new ClipboardHistory(tempFile(), source, 2);
    history.add('a');
    history.add('b');
    history.add('c');
    expect(history.entries().map((e) => e.text)).toEqual(['c', 'b']);
    history.setMaxItems(1);
    expect(history.entries().map((e) => e.text)).toEqual(['c']);
  });

  it('removes, clears and persists entries', () => {
    const { source } = fakeClipboard();
    const path = tempFile();
    const history = new ClipboardHistory(path, source, 10);
    history.add('a');
    history.add('b');
    history.remove(history.entries()[0]?.id ?? '');
    history.flush();
    expect(new ClipboardHistory(path, source, 10).entries().map((e) => e.text)).toEqual(['a']);
    history.clear();
    history.flush();
    expect(new ClipboardHistory(path, source, 10).entries()).toEqual([]);
  });
});

describe('ClipboardHistory with images', () => {
  it('records a copied image as a PNG file and a thumbnail', async () => {
    const { state, source } = fakeClipboard();
    const path = tempFile();
    const history = new ClipboardHistory(path, source, 10);
    state.image = fakeImage(7, { width: 1280, height: 720 });
    await history.poll();
    const [entry] = history.entries();
    expect(entry).toMatchObject({ text: '', image: { width: 1280, height: 720, bytes: 16 } });
    const files = entry && history.imageFiles(entry);
    expect(files && readFileSync(files.image)).toEqual(Buffer.from(new Uint8Array(16).fill(7)));
    expect(files && existsSync(files.thumbnail)).toBe(true);
    expect(imagesIn(path)).toHaveLength(2);
  });

  it('records the text when there is text too: apps add a picture of it', async () => {
    const { state, source } = fakeClipboard();
    const history = new ClipboardHistory(tempFile(), source, 10);
    state.text = 'a table';
    state.image = fakeImage(1);
    await history.poll();
    expect(history.entries().map((e) => e.text)).toEqual(['a table']);
  });

  it('keeps one entry for the same picture, however it was encoded', async () => {
    const { state, source } = fakeClipboard();
    const path = tempFile();
    const history = new ClipboardHistory(path, source, 10);
    state.image = fakeImage(1);
    await history.poll();
    state.text = 'between';
    await history.poll();
    state.text = '';
    state.image = fakeImage(1, { encoding: 1 });
    await history.poll();
    expect(history.entries().map((e) => e.text || 'image')).toEqual(['image', 'between']);
    expect(imagesIn(path)).toHaveLength(2);
  });

  it('tells apart images with different pixels', async () => {
    const { state, source } = fakeClipboard();
    const history = new ClipboardHistory(tempFile(), source, 10);
    state.image = fakeImage(1);
    await history.poll();
    state.image = fakeImage(2);
    await history.poll();
    expect(history.entries()).toHaveLength(2);
  });

  it('skips images when they are turned off, and images too big to keep', async () => {
    const { state, source } = fakeClipboard();
    const history = new ClipboardHistory(tempFile(), source, 10);
    history.setKeepImages(false);
    state.image = fakeImage(1);
    await history.poll();
    history.setKeepImages(true);
    state.image = fakeImage(2, { bytes: MAX_IMAGE_BYTES + 1 });
    await history.poll();
    expect(history.entries()).toEqual([]);
  });

  it('deletes an image’s files when it is removed, cleared or falls off the end', async () => {
    const { state, source } = fakeClipboard();
    const path = tempFile();
    const history = new ClipboardHistory(path, source, 2);
    for (const fill of [1, 2, 3]) {
      state.image = fakeImage(fill);
      await history.poll();
    }
    expect(history.entries()).toHaveLength(2);
    expect(imagesIn(path)).toHaveLength(4);
    history.remove(history.entries()[0]?.id ?? '');
    expect(imagesIn(path)).toHaveLength(2);
    history.clear();
    expect(imagesIn(path)).toEqual([]);
  });

  it('puts an image back on the clipboard as the newest entry, without recording it again', async () => {
    const { state, source } = fakeClipboard();
    const history = new ClipboardHistory(tempFile(), source, 10);
    state.image = fakeImage(1);
    await history.poll();
    state.text = 'later';
    await history.poll();
    const image = history.entries()[1];
    expect(await history.copyImage(image?.id ?? '')).toBe(true);
    await history.poll();
    expect(state.written).toEqual([image && history.imageFiles(image)?.image]);
    expect(history.entries().map((e) => e.text || e.id)).toEqual([image?.id, 'later']);
    expect(await history.copyImage('gone')).toBe(false);
  });

  it('loads images back, dropping ones whose file is gone and files nothing uses', async () => {
    const { state, source } = fakeClipboard();
    const path = tempFile();
    const history = new ClipboardHistory(path, source, 10);
    for (const fill of [1, 2]) {
      state.image = fakeImage(fill);
      await history.poll();
    }
    history.flush();
    const [kept, lost] = history.entries();
    // As if Waypoint stopped between deleting one image and saving the history, and after saving
    // another image but before it was in the history.
    const lostFiles = lost && history.imageFiles(lost);
    if (lostFiles) rmSync(lostFiles.image);
    writeFileSync(join(dirname(path), IMAGES_FOLDER, 'left-over.png'), '');
    const loaded = new ClipboardHistory(path, source, 10);
    expect(loaded.entries().map((e) => e.id)).toEqual([kept?.id]);
    const keptFiles = kept && loaded.imageFiles(kept);
    expect(imagesIn(path)).toEqual(keptFiles ? [basename(keptFiles.image), basename(keptFiles.thumbnail)].sort() : []);
  });

  it('ignores image entries that would name a file outside its folder', () => {
    const { source } = fakeClipboard();
    const path = tempFile();
    const entry = {
      id: 'x',
      text: '',
      copiedAt: 1,
      image: { hash: '../../etc/passwd', width: 1, height: 1, bytes: 1 },
    };
    writeFileSync(path, JSON.stringify([entry]));
    expect(new ClipboardHistory(path, source, 10).entries()).toEqual([]);
  });
});
