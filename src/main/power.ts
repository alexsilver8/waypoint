import type { WakeLock } from '../shared/types';

/** The part of Electron's powerSaveBlocker used here, so tests can stand in for it. */
export interface Blocker {
  start(type: 'prevent-app-suspension' | 'prevent-display-sleep'): number;
  stop(id: number): boolean;
  isStarted(id: number): boolean;
}

/** The longest a timer can wait; a longer wait is made of several. */
const MAX_TIMER_MS = 2 ** 31 - 1;

interface Held extends WakeLock {
  /** Electron's ID for the blocker. */
  id: number;
  timer?: NodeJS.Timeout;
}

/**
 * Keeps the computer and its display awake for extensions, one request each, from the main
 * process: the extension host can restart without the computer going to sleep. Each request
 * lasts until its time is up, it's let go, or Waypoint quits.
 */
export class WakeLocks {
  private readonly held = new Map<string, Held>();

  constructor(
    private readonly blocker: Blocker,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts `owner`'s request, in place of any it had. */
  keepAwake(owner: string, until: number | null): WakeLock {
    if (until !== null && (!Number.isFinite(until) || until <= this.now())) {
      throw new Error('A wake lock has to end in the future.');
    }
    this.allowSleep(owner);
    const held: Held = { id: this.blocker.start('prevent-display-sleep'), since: this.now(), until };
    this.held.set(owner, held);
    this.schedule(owner, held);
    return { since: held.since, until };
  }

  allowSleep(owner: string): void {
    const held = this.held.get(owner);
    if (!held) return;
    clearTimeout(held.timer);
    this.held.delete(owner);
    if (this.blocker.isStarted(held.id)) this.blocker.stop(held.id);
  }

  /** `owner`'s request, if it still holds. */
  wakeLock(owner: string): WakeLock | null {
    const held = this.held.get(owner);
    if (!held) return null;
    if (!this.blocker.isStarted(held.id) || (held.until !== null && held.until <= this.now())) {
      this.allowSleep(owner);
      return null;
    }
    return { since: held.since, until: held.until };
  }

  /** Ends a timed request once its time is up. */
  private schedule(owner: string, held: Held): void {
    if (held.until === null) return;
    const wait = Math.min(MAX_TIMER_MS, Math.max(0, held.until - this.now()));
    held.timer = setTimeout(() => {
      if (this.held.get(owner) !== held) return;
      if (held.until !== null && held.until > this.now()) this.schedule(owner, held);
      else this.allowSleep(owner);
    }, wait);
  }
}
