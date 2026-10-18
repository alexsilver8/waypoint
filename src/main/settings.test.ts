import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { SettingsStore } from './settings';

const tempPath = () => join(mkdtempSync(join(tmpdir(), 'settings-')), 'settings.json');

describe('SettingsStore', () => {
  it('writes the defaults on first run', () => {
    const path = tempPath();
    new SettingsStore(path);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps what is already on disk', () => {
    const path = tempPath();
    writeFileSync(path, JSON.stringify({ theme: 'dark' }));
    expect(new SettingsStore(path).get().theme).toBe('dark');
  });

  it('saves updates and reports what changed', () => {
    const path = tempPath();
    const store = new SettingsStore(path);
    const changes: Array<[string, string]> = [];
    store.on('change', (next, previous) => changes.push([previous.theme, next.theme]));

    store.update({ theme: 'light', clipboardHistory: { enabled: false, maxItems: 50, images: true } });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      theme: 'light',
      clipboardHistory: { enabled: false, maxItems: 50, images: true },
    });
    expect(changes).toEqual([['system', 'light']]);

    store.update({ theme: 'light' });
    expect(changes).toHaveLength(1);
  });

  it('drops invalid values instead of saving them', () => {
    const store = new SettingsStore(tempPath());
    store.update({ theme: 'neon' as never, hotkey: '' });
    expect(store.get().theme).toBe('system');
    expect(store.get().hotkey).toBe(DEFAULT_SETTINGS.hotkey);
  });
});
