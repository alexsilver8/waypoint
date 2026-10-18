/**
 * The extension host: runs in an Electron utility process, imports third-party extensions
 * and calls their commands on behalf of the main process. Keeping them here means a slow
 * or crashing extension can't take the launcher down with it.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Extension, ExtensionContext, ExtensionPower } from '../shared/extension-api';
import type {
  CommandCall,
  HostExtension,
  HostRequest,
  HostResponse,
  LoadReport,
  MainMethod,
  MainMethods,
  MainRequest,
  MainResponse,
} from '../shared/extension-protocol';
import type { CommandImplementation } from '../shared/types';
import { provideApi } from './api';
import { createStorage } from './storage';

// Built beside this file from packages/api; see electron.vite.config.ts.
provideApi(pathToFileURL(join(import.meta.dirname, 'waypoint-api.js')).href);

/** How long the main process may take to answer; it does nothing slow. */
const MAIN_TIMEOUT_MS = 5000;

interface LoadedExtension {
  info: HostExtension;
  commands: Extension['commands'];
}

const extensions = new Map<string, LoadedExtension>();

interface MainCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/** Requests to the main process waiting for an answer, by ID. */
const mainCalls = new Map<number, MainCall>();
let nextMainCall = 1;

/** Asks the main process to do something for an extension. */
function callMain<M extends MainMethod>(
  method: M,
  params: MainMethods[M]['params'],
): Promise<MainMethods[M]['result']> {
  const id = nextMainCall++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      mainCalls.delete(id);
      reject(new Error('Waypoint took too long to answer.'));
    }, MAIN_TIMEOUT_MS);
    mainCalls.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    const request: MainRequest<M> = { type: 'main-request', id, method, params };
    process.parentPort.postMessage(request);
  });
}

function answered(response: MainResponse): void {
  const call = mainCalls.get(response.id);
  if (!call) return;
  mainCalls.delete(response.id);
  clearTimeout(call.timer);
  if (response.ok) call.resolve(response.result);
  else call.reject(new Error(response.error));
}

/** `ctx.power` for one extension. */
function power(extension: string): ExtensionPower {
  return {
    keepAwake: (options = {}) => callMain('keepAwake', { extension, until: options.until ?? null }),
    allowSleep: async () => {
      await callMain('allowSleep', { extension });
    },
    wakeLock: async () => (await callMain('wakeLock', { extension })) ?? undefined,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function load(list: HostExtension[]): Promise<LoadReport> {
  extensions.clear();
  const report: LoadReport = { loaded: [], failed: [] };
  for (const info of list) {
    try {
      const module = (await import(pathToFileURL(info.entry).href)) as {
        default?: Partial<Extension>;
        commands?: unknown;
      };
      const commands = module.default?.commands ?? module.commands;
      if (typeof commands !== 'object' || commands === null) {
        throw new Error('The entry module must export `commands`, or a default export with `commands`.');
      }
      extensions.set(info.name, { info, commands: commands as Extension['commands'] });
      report.loaded.push(info.name);
    } catch (error) {
      report.failed.push({ name: info.name, error: errorMessage(error) });
    }
  }
  return report;
}

function resolve(call: CommandCall): { command: CommandImplementation<ExtensionContext>; ctx: ExtensionContext } {
  const extension = extensions.get(call.extension);
  if (!extension) throw new Error(`Extension "${call.extension}" is not loaded.`);
  const command = extension.commands[call.command];
  if (!command) throw new Error(`Extension "${call.extension}" does not implement the command "${call.command}".`);
  const { info } = extension;
  mkdirSync(info.supportPath, { recursive: true });
  const ctx: ExtensionContext = {
    ...call.ctx,
    supportPath: info.supportPath,
    storage: createStorage(info.supportPath),
    extension: { name: info.name, path: info.dir },
    power: power(info.name),
  };
  return { command, ctx };
}

async function handle(request: HostRequest): Promise<unknown> {
  switch (request.method) {
    case 'load':
      return load((request as HostRequest<'load'>).params.extensions);
    case 'view': {
      const { command, ctx } = resolve((request as HostRequest<'view'>).params);
      if (!command.view) throw new Error('This command has no view() function.');
      return command.view(ctx);
    }
    case 'run': {
      const { command, ctx } = resolve((request as HostRequest<'run'>).params);
      if (!command.run) throw new Error('This command has no run() function.');
      return command.run(ctx);
    }
    case 'action': {
      const params = (request as HostRequest<'action'>).params;
      const { command, ctx } = resolve(params);
      if (!command.onAction) throw new Error('This command has no onAction() function.');
      return command.onAction(params.actionId, params.payload, ctx);
    }
    default:
      throw new Error(`Unknown method "${String((request as HostRequest).method)}".`);
  }
}

process.parentPort.on('message', async (event) => {
  const message = event.data as HostRequest | MainResponse;
  if ('type' in message && message.type === 'main-response') {
    answered(message);
    return;
  }
  const request = message as HostRequest;
  let response: HostResponse;
  try {
    const result = await handle(request);
    // Round-trip through JSON so functions or class instances never reach the main process.
    response = {
      id: request.id,
      ok: true,
      result: result === undefined ? undefined : JSON.parse(JSON.stringify(result)),
    };
  } catch (error) {
    response = { id: request.id, ok: false, error: errorMessage(error) };
  }
  process.parentPort.postMessage(response);
});

process.on('unhandledRejection', (reason) => {
  console.error('[extension-host] Unhandled rejection:', reason);
});
