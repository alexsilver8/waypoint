import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainRequest } from '../shared/extension-protocol';
import { hostServices } from './extensions/services';
import { type Blocker, WakeLocks } from './power';

/** Stands in for Electron's powerSaveBlocker, keeping the blockers started. */
function fakeBlocker() {
  const started = new Set<number>();
  let next = 0;
  const blocker: Blocker = {
    start: vi.fn(() => {
      started.add(next);
      return next++;
    }),
    stop: vi.fn((id: number) => started.delete(id)),
    isStarted: (id: number) => started.has(id),
  };
  return { blocker, started };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WakeLocks', () => {
  it('keeps the display awake until let go', () => {
    const { blocker, started } = fakeBlocker();
    const locks = new WakeLocks(blocker);
    expect(locks.keepAwake('keep-awake', null)).toEqual({ since: Date.now(), until: null });
    expect(blocker.start).toHaveBeenCalledWith('prevent-display-sleep');
    expect(started.size).toBe(1);
    expect(locks.wakeLock('keep-awake')).toEqual({ since: Date.now(), until: null });

    locks.allowSleep('keep-awake');
    expect(started.size).toBe(0);
    expect(locks.wakeLock('keep-awake')).toBeNull();
    // Letting go of nothing is fine.
    locks.allowSleep('keep-awake');
  });

  it('ends a timed request when its time is up', () => {
    const { blocker, started } = fakeBlocker();
    const locks = new WakeLocks(blocker);
    const until = Date.now() + 30 * 60_000;
    locks.keepAwake('keep-awake', until);
    vi.advanceTimersByTime(30 * 60_000 - 1);
    expect(locks.wakeLock('keep-awake')).toEqual({ since: expect.any(Number), until });
    vi.advanceTimersByTime(1);
    expect(started.size).toBe(0);
    expect(locks.wakeLock('keep-awake')).toBeNull();
  });

  it('waits longer than one timer can', () => {
    const { blocker, started } = fakeBlocker();
    const locks = new WakeLocks(blocker);
    const days = 30;
    locks.keepAwake('keep-awake', Date.now() + days * 86_400_000);
    vi.advanceTimersByTime(25 * 86_400_000);
    expect(started.size).toBe(1);
    vi.advanceTimersByTime(5 * 86_400_000);
    expect(started.size).toBe(0);
  });

  it('gives each extension one request, replacing its last', () => {
    const { blocker, started } = fakeBlocker();
    const locks = new WakeLocks(blocker);
    locks.keepAwake('one', Date.now() + 60_000);
    locks.keepAwake('one', null);
    locks.keepAwake('two', null);
    expect(started.size).toBe(2);
    // The replaced request's timer doesn't end the new one.
    vi.advanceTimersByTime(120_000);
    expect(locks.wakeLock('one')).toEqual({ since: expect.any(Number), until: null });
    locks.allowSleep('one');
    expect(locks.wakeLock('two')).not.toBeNull();
  });

  it('turns down a time that has passed', () => {
    const locks = new WakeLocks(fakeBlocker().blocker);
    expect(() => locks.keepAwake('keep-awake', Date.now())).toThrow(/future/);
    expect(() => locks.keepAwake('keep-awake', Number.NaN)).toThrow(/future/);
  });
});

describe('hostServices', () => {
  const request = (method: string, params: Record<string, unknown>) =>
    ({ type: 'main-request', id: 1, method, params }) as unknown as MainRequest;

  it('keeps the computer awake for the extension asking', async () => {
    const { blocker, started } = fakeBlocker();
    const serve = hostServices(new WakeLocks(blocker));
    const until = Date.now() + 60_000;
    expect(await serve(request('keepAwake', { extension: 'keep-awake', until }))).toEqual({
      since: Date.now(),
      until,
    });
    expect(await serve(request('wakeLock', { extension: 'keep-awake' }))).toEqual({ since: Date.now(), until });
    expect(await serve(request('wakeLock', { extension: 'other' }))).toBeNull();
    expect(await serve(request('allowSleep', { extension: 'keep-awake' }))).toBeNull();
    expect(started.size).toBe(0);
  });

  it('checks what comes in', () => {
    const serve = hostServices(new WakeLocks(fakeBlocker().blocker));
    expect(() => serve(request('keepAwake', { extension: 'x', until: 'soon' }))).toThrow(/`until`/);
    expect(() => serve(request('wakeLock', { extension: '' }))).toThrow(/No extension/);
    expect(() => serve(request('shutDown', { extension: 'x' }))).toThrow(/can't do "shutDown"/);
  });
});
