import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClipboardHistory, type ClipboardSource } from './history';

function fakeClipboard() {
  const state = { text: '', concealed: false };
  const source: ClipboardSource = {
    readText: async () => state.text,
    isConcealed: async () => state.concealed,
  };
  return { state, source };
}

function tempFile() {
  return join(mkdtempSync(join(tmpdir(), 'clip-')), 'history.json');
}

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
