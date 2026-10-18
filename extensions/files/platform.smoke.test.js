// Searches, lists and copies files on the real system. Off by default; the platform workflow
// runs it on macOS, Windows and Linux with WAYPOINT_SMOKE=1. CI machines may have Spotlight or
// Windows Search turned off, so a search that comes back empty there is reported, not failed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import extension from './index.js';

const enabled = process.env.WAYPOINT_SMOKE === '1';
const platform = /** @type {'darwin' | 'win32' | 'linux'} */ (process.platform);
const name = `waypoint-smoke-${process.pid}-${Date.now()}`;
const folder = join(homedir(), name);
const file = join(folder, `${name} notes.txt`);
const ctx = /** @type {any} */ ({ query: '', platform });

/** @param {string} command @param {string} query */
const view = (command, query) => extension.commands[command]?.view?.({ ...ctx, query });

/** @param {any} result */
function log(label, result) {
  console.log(
    `${label}:`,
    result?.emptyText ?? '',
    JSON.stringify(result?.sections?.map((section) => [section.title, section.items.length])),
  );
}

afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe.runIf(enabled)(`Files on ${platform}`, () => {
  it('finds a file by name', { timeout: 60_000 }, async () => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, 'smoke test\n');
    if (platform === 'darwin') {
      // Ask Spotlight to index it now, if Spotlight is on.
      try {
        execFileSync('mdimport', [file]);
      } catch {
        // Spotlight is off.
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    const result = await view('search', `${name} notes`);
    log('search', result);
    const titles = result?.sections.flatMap((section) => section.items.map((item) => item.title)) ?? [];
    if (titles.length === 0) {
      // Spotlight or Windows Search answered, and hasn't indexed the file (or is turned off).
      expect(platform).not.toBe('linux');
      return;
    }
    expect(titles).toContain(`${name} notes.txt`);
  });

  it('lists recent files', { timeout: 30_000 }, async () => {
    const result = await view('search', '');
    log('recent', result);
    expect(result?.type).toBe('list');
  });

  it('lists the downloads', { timeout: 30_000 }, async () => {
    const result = await view('downloads', '');
    log('downloads', result);
    if (existsSync(join(homedir(), 'Downloads'))) expect(result?.sections.at(-1)?.title).toBe('Folder');
  });

  it('copies a file to the clipboard', { timeout: 30_000 }, async () => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, 'smoke test\n');
    const result = await extension.commands.search?.onAction?.('copy-file', file, ctx);
    console.log('copy:', result);
    if (platform !== 'linux') expect(result).toEqual({ hide: true });
  });

  it.runIf(platform === 'win32')('opens the latest download', { timeout: 30_000 }, async () => {
    const downloads = join(homedir(), 'Downloads');
    mkdirSync(downloads, { recursive: true });
    const notepads = () =>
      execFileSync('tasklist', ['/FI', 'IMAGENAME eq notepad.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter((line) => line.toLowerCase().includes('notepad.exe')).length;
    const before = notepads();
    const latest = join(downloads, `${name}.txt`);
    writeFileSync(latest, 'opened by the smoke test\n');
    try {
      const result = await extension.commands['open-latest-download']?.run?.(ctx);
      console.log('open:', result);
      expect(result).toEqual({ hide: true });
      // PowerShell's Start-Process opens it in Notepad, the default for .txt files.
      await new Promise((resolve) => setTimeout(resolve, 4000));
      expect(notepads()).toBeGreaterThan(before);
    } finally {
      rmSync(latest, { force: true });
    }
  });

  it.runIf(platform === 'win32')('moves a file to the Recycle Bin', { timeout: 30_000 }, async () => {
    const doomed = join(folder, 'recycle me.txt');
    mkdirSync(folder, { recursive: true });
    writeFileSync(doomed, 'bye\n');
    const result = await extension.commands.search?.onAction?.('trash', doomed, { ...ctx, query: 'recycle me' });
    console.log('trash:', result?.toast);
    expect(result?.toast).toBe('Moved “recycle me.txt” to the Recycle Bin');
    expect(existsSync(doomed)).toBe(false);
  });
});
