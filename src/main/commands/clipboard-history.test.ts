import { describe, expect, it, vi } from 'vitest';
import type { ClipboardEntry, ClipboardHistory } from '../clipboard/history';
import {
  CLIPBOARD_ROOT_LIMIT,
  clipboardHistoryExtension,
  clipboardRootItems,
  markdownImage,
} from './clipboard-history';

const IMAGE: ClipboardEntry = {
  id: 'img',
  text: '',
  image: { hash: 'abc', width: 1280, height: 720, bytes: 1_234_567 },
  copiedAt: 1_000_000,
};

function historyOf(texts: string[], images: ClipboardEntry[] = []) {
  const entries: ClipboardEntry[] = [
    ...images,
    ...texts.map((text, i) => ({ id: `e${i}`, text, copiedAt: 1_000_000 - i })),
  ];
  const copyImage = vi.fn(async (id: string) => entries.some((entry) => entry.id === id && entry.image));
  const history = {
    entries: () => entries,
    imageFiles: (entry: ClipboardEntry) =>
      entry.image
        ? { image: `/data/clipboard-images/${entry.image.hash}.png`, thumbnail: `/data/${entry.image.hash}.thumb.png` }
        : undefined,
    copyImage,
  } as unknown as ClipboardHistory;
  return { history, copyImage };
}

describe('clipboardRootItems', () => {
  it('offers recent entries to the root search, with a preview and a copy action', () => {
    const [item] = clipboardRootItems(historyOf(['line one\nline two']).history, () => true);
    expect(item).toMatchObject({
      id: 'clipboard:e0',
      kind: 'clipboard',
      title: 'line one',
      detail: { body: 'line one\nline two' },
      actions: [{ type: 'copy', text: 'line one\nline two' }],
    });
    expect(item?.detail?.metadata).toContainEqual({ label: 'Lines', value: '2' });
  });

  it('shows an image with its size, its thumbnail and the picture in the preview', () => {
    const [item] = clipboardRootItems(historyOf([], [IMAGE]).history, () => true);
    expect(item).toMatchObject({
      id: 'clipboard:img',
      kind: 'clipboard',
      title: 'Image (1280×720)',
      subtitle: 'PNG image, 1.2 MB',
      icon: { path: '/data/abc.thumb.png' },
      keywords: ['image'],
      detail: { markdown: '![Image (1280×720)](</data/clipboard-images/abc.png>)' },
      actions: [
        { type: 'open-command', ref: { extension: 'clipboard', command: 'copy-image' }, argument: 'img' },
        { type: 'open-command', ref: { extension: 'clipboard', command: 'paste-image' }, argument: 'img' },
      ],
    });
    expect(item?.detail?.metadata).toContainEqual({ label: 'Dimensions', value: '1280×720' });
  });

  it('carries only the most recent entries', () => {
    const texts = Array.from({ length: CLIPBOARD_ROOT_LIMIT + 50 }, (_, i) => `entry ${i}`);
    const items = clipboardRootItems(historyOf(texts).history, () => true);
    expect(items).toHaveLength(CLIPBOARD_ROOT_LIMIT);
    expect(items[0]?.title).toBe('entry 0');
  });

  it('offers nothing while clipboard history is off', () => {
    expect(clipboardRootItems(historyOf(['secret']).history, () => false)).toEqual([]);
  });
});

describe('markdownImage', () => {
  it('keeps spaces and Windows paths intact', () => {
    expect(markdownImage('Image', '/Users/me/Library/Application Support/Waypoint/a.png')).toBe(
      '![Image](</Users/me/Library/Application Support/Waypoint/a.png>)',
    );
    expect(markdownImage('Image', 'C:\\Users\\me\\AppData\\Roaming\\Waypoint\\a.png')).toBe(
      '![Image](<C:/Users/me/AppData/Roaming/Waypoint/a.png>)',
    );
  });
});

describe('clipboardHistoryExtension', () => {
  const ctx = (argument?: string) => ({ query: '', platform: 'darwin' as const, argument });

  it('lists images with the same actions, and delete', async () => {
    const extension = clipboardHistoryExtension(historyOf(['text'], [IMAGE]).history, () => true);
    const view = await extension.commands.history?.view?.(ctx());
    const items = view?.type === 'list' ? view.sections[0]?.items : [];
    expect(items?.map((item) => item.title)).toEqual(['Image (1280×720)', 'text']);
    expect(items?.[0]?.actions.map((action) => action.title)).toEqual([
      'Copy to Clipboard',
      'Paste Image',
      'Delete Entry',
      'Clear History',
    ]);
    expect(extension.unlisted).toEqual(['copy-image', 'paste-image']);
  });

  it('copies an image back, or pastes it, and says when it is gone', async () => {
    const { history, copyImage } = historyOf([], [IMAGE]);
    const { commands } = clipboardHistoryExtension(history, () => true);
    expect(await commands['copy-image']?.run?.(ctx('img'))).toEqual({ hide: true });
    expect(await commands['paste-image']?.run?.(ctx('img'))).toEqual({ pasteClipboard: true });
    expect(copyImage).toHaveBeenCalledTimes(2);
    expect(await commands['paste-image']?.run?.(ctx('gone'))).toMatchObject({ toastStyle: 'failure' });
  });
});
