/** Messages between the main process and the extension host process. */
import type { CommandContext, Json, WakeLock } from './types';

export interface HostExtension {
  name: string;
  /** Absolute path of the module to import. */
  entry: string;
  /** The extension's folder. */
  dir: string;
  /** Writable folder for the extension's own data. */
  supportPath: string;
}

export interface CommandCall {
  extension: string;
  command: string;
  ctx: CommandContext;
}

export interface HostMethods {
  load: { params: { extensions: HostExtension[] }; result: LoadReport };
  view: { params: CommandCall; result: unknown };
  run: { params: CommandCall; result: unknown };
  action: { params: CommandCall & { actionId: string; payload?: Json }; result: unknown };
}

export type HostMethod = keyof HostMethods;

export interface HostRequest<M extends HostMethod = HostMethod> {
  id: number;
  method: M;
  params: HostMethods[M]['params'];
}

export type HostResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export interface LoadReport {
  loaded: string[];
  failed: Array<{ name: string; error: string }>;
}

/**
 * What the extension host asks the main process to do for an extension, while one of its
 * commands runs. `extension` is the extension asking.
 */
export interface MainMethods {
  keepAwake: { params: { extension: string; until: number | null }; result: WakeLock };
  allowSleep: { params: { extension: string }; result: null };
  wakeLock: { params: { extension: string }; result: WakeLock | null };
}

export type MainMethod = keyof MainMethods;

/** From the host to the main process; told apart from a `HostResponse` by its `type`. */
export interface MainRequest<M extends MainMethod = MainMethod> {
  type: 'main-request';
  id: number;
  method: M;
  params: MainMethods[M]['params'];
}

/** The main process's answer to a `MainRequest`. */
export type MainResponse =
  | { type: 'main-response'; id: number; ok: true; result: unknown }
  | { type: 'main-response'; id: number; ok: false; error: string };
