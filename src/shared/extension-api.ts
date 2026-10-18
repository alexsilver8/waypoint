/**
 * Types for extension authors. An extension is a folder with a package.json (see
 * docs/extensions.md) whose entry module exports its commands:
 *
 *   export default {
 *     commands: {
 *       greet: { view: (ctx) => ({ type: 'list', items: [...] }) },
 *     },
 *   };
 *
 * Extensions run in a separate Node.js process (Electron's utility process), so a slow or
 * crashing extension can't freeze the launcher. They have full Node.js access — only
 * install extensions you trust.
 */
import type { CommandContext, CommandImplementation, Json, WakeLock } from './types';

export type * from './types';

/** A small persistent key-value store, private to each extension. */
export interface ExtensionStorage {
  get<T extends Json = Json>(key: string): T | undefined;
  set(key: string, value: Json): void;
  remove(key: string): void;
}

/**
 * Keeps the computer and its display awake, held by Waypoint's own process rather than the
 * extension's: it lasts for as long as Waypoint runs, through Reload Extensions and an
 * extension timing out. Each extension has one request at a time.
 */
export interface ExtensionPower {
  /**
   * Keeps the computer awake until `until` (ms since the epoch), or until `allowSleep()` or
   * Waypoint quits. Replaces this extension's earlier request.
   */
  keepAwake(options?: { until?: number }): Promise<WakeLock>;
  /** Lets go of this extension's request. */
  allowSleep(): Promise<void>;
  /** This extension's request, while it's held. */
  wakeLock(): Promise<WakeLock | undefined>;
}

export interface ExtensionContext extends CommandContext {
  /** A folder this extension may write to; it survives updates and restarts. */
  supportPath: string;
  storage: ExtensionStorage;
  extension: { name: string; path: string };
  power: ExtensionPower;
}

export interface Extension {
  /** Keyed by the command names declared in package.json. */
  commands: Record<string, CommandImplementation<ExtensionContext>>;
}
