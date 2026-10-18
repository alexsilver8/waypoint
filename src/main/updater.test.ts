import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateMode } from '../shared/updates';
import { Updater, type UpdaterBackend } from './updater';

/** Stands in for electron-updater's autoUpdater: tests say what a check finds by emitting its events. */
function fakeBackend() {
  const events = new EventEmitter();
  const backend = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(async () => {
      events.emit('checking-for-update');
    }),
    quitAndInstall: vi.fn(),
    on: (event: string, listener: Parameters<EventEmitter['on']>[1]) => events.on(event, listener),
  };
  return { backend: backend as typeof backend & UpdaterBackend, events };
}

function updater(mode: UpdateMode, enabled = true) {
  const { backend, events } = fakeBackend();
  const notify = vi.fn();
  const openUrl = vi.fn();
  const instance = new Updater({ mode, backend: () => backend, enabled: () => enabled, notify, openUrl });
  return { updater: instance, backend, events, notify, openUrl };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Updater', () => {
  it('downloads and installs by itself in install mode', async () => {
    const { updater: u, backend, events, notify } = updater('install');
    await u.check();
    expect(backend.autoDownload).toBe(true);
    expect(backend.autoInstallOnAppQuit).toBe(true);

    events.emit('update-available', { version: '1.2.0' });
    events.emit('download-progress', { percent: 41.6 });
    expect(u.status).toEqual({ state: 'downloading', version: '1.2.0', percent: 41 });
    events.emit('update-downloaded', { version: '1.2.0' });
    expect(u.status).toEqual({ state: 'ready', version: '1.2.0' });
    expect(notify).toHaveBeenCalledOnce();

    // Clicking the notification (or the menu item) restarts into it.
    notify.mock.calls[0]?.[1]();
    expect(backend.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('only points at the download in notify mode', async () => {
    const { updater: u, backend, events, notify, openUrl } = updater('notify');
    await u.check();
    expect(backend.autoDownload).toBe(false);
    expect(backend.autoInstallOnAppQuit).toBe(false);

    events.emit('update-available', { version: '1.2.0' });
    expect(u.status).toEqual({ state: 'available', version: '1.2.0' });
    u.act();
    expect(openUrl).toHaveBeenCalledWith('https://github.com/alexsilver8/waypoint/releases/tag/v1.2.0');
    expect(backend.quitAndInstall).not.toHaveBeenCalled();

    // Checking again finds the same version, and says so only once.
    await u.check();
    events.emit('update-available', { version: '1.2.0' });
    expect(notify).toHaveBeenCalledOnce();
  });

  it('says when it is up to date, or why it could not check', async () => {
    const { updater: u, backend, events } = updater('install');
    await u.check();
    events.emit('update-not-available');
    expect(u.status).toEqual({ state: 'up-to-date' });

    backend.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_INTERNET_DISCONNECTED\nmore detail'));
    await u.check();
    expect(u.status).toEqual({ state: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });
  });

  it("doesn't check again while a version is on its way or waiting for a restart", async () => {
    const { updater: u, backend, events } = updater('install');
    await u.check();
    events.emit('update-available', { version: '1.2.0' });
    await u.check();
    events.emit('update-downloaded', { version: '1.2.0' });
    await u.check();
    expect(backend.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('checks by itself shortly after starting and every few hours, while the setting is on', async () => {
    const on = updater('install');
    on.updater.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(on.backend.checkForUpdates).toHaveBeenCalledTimes(1);
    on.events.emit('update-not-available');
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(on.backend.checkForUpdates).toHaveBeenCalledTimes(2);
    on.updater.stop();

    const off = updater('install', false);
    off.updater.start();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(off.backend.checkForUpdates).not.toHaveBeenCalled();
  });

  it('never loads electron-updater from source', async () => {
    const backend = vi.fn();
    const u = new Updater({ mode: 'off', backend, enabled: () => true, notify: vi.fn(), openUrl: vi.fn() });
    u.start();
    await u.check();
    u.act();
    expect(backend).not.toHaveBeenCalled();
    expect(u.status).toEqual({ state: 'idle' });
  });
});
