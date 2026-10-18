import { type UtilityProcess, utilityProcess } from 'electron';
import type {
  HostExtension,
  HostMethod,
  HostMethods,
  HostRequest,
  HostResponse,
  LoadReport,
  MainRequest,
  MainResponse,
} from '../../shared/extension-protocol';

/** Does what the host asks for an extension; what it returns, or throws, goes back. */
export type HostServices = (request: MainRequest) => unknown;

const LOAD_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 10_000;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/**
 * Talks to the extension host utility process. The process is started when extensions are
 * loaded, restarted (and the extensions reloaded) if it crashes, and killed if a call hangs.
 */
export class ExtensionHostClient {
  private child: UtilityProcess | undefined;
  private starting: Promise<void> | undefined;
  /** Bumped by stop(), so a process that finishes spawning after it is discarded. */
  private generation = 0;
  private extensions: HostExtension[] = [];
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly scriptPath: string,
    private readonly services?: HostServices,
  ) {}

  /** Starts a fresh host and loads the given extensions in it. */
  async load(extensions: HostExtension[]): Promise<LoadReport> {
    this.extensions = extensions;
    this.stop();
    if (extensions.length === 0) return { loaded: [], failed: [] };
    await this.ensureStarted(false);
    return this.request('load', { extensions }, LOAD_TIMEOUT_MS);
  }

  async call<M extends Exclude<HostMethod, 'load'>>(method: M, params: HostMethods[M]['params']): Promise<unknown> {
    await this.ensureStarted(true);
    return this.request(method, params, CALL_TIMEOUT_MS);
  }

  stop(): void {
    const child = this.child;
    this.generation++;
    this.child = undefined;
    this.starting = undefined;
    this.rejectAll(new Error('The extension host was stopped.'));
    child?.kill();
  }

  private ensureStarted(reload: boolean): Promise<void> {
    if (this.child) return Promise.resolve();
    if (!this.starting) {
      const starting = this.spawn().then(async () => {
        // After a crash, bring the extensions back before the call that needs them.
        if (reload && this.extensions.length > 0) {
          await this.request('load', { extensions: this.extensions }, LOAD_TIMEOUT_MS);
        }
      });
      this.starting = starting;
      starting.catch(() => {
        if (this.starting === starting) this.starting = undefined;
      });
    }
    return this.starting;
  }

  private spawn(): Promise<void> {
    const generation = this.generation;
    return new Promise<void>((resolve, reject) => {
      const child = utilityProcess.fork(this.scriptPath, [], {
        serviceName: 'Waypoint Extension Host',
        stdio: 'inherit',
      });
      child.on('message', (message: HostResponse | MainRequest) => {
        if ('type' in message && message.type === 'main-request') void this.serve(child, message);
        else this.onMessage(message as HostResponse);
      });
      child.once('spawn', () => {
        if (generation !== this.generation) {
          // stop() or a newer load() ran while this process was starting.
          child.kill();
          reject(new Error('The extension host was restarted.'));
          return;
        }
        this.child = child;
        resolve();
      });
      child.once('exit', (code) => {
        const error = new Error(`The extension host exited (code ${code}).`);
        reject(error); // no-op once spawned
        if (this.child === child) {
          this.child = undefined;
          this.starting = undefined;
          this.rejectAll(error);
        }
      });
    });
  }

  private request<M extends HostMethod>(
    method: M,
    params: HostMethods[M]['params'],
    timeoutMs: number,
  ): Promise<HostMethods[M]['result']> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('The extension host is not running.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The extension took longer than ${timeoutMs / 1000}s to respond.`));
        // A hung extension blocks the whole host, so restart it on the next call.
        if (this.child === child) this.stop();
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      const request: HostRequest<M> = { id, method, params };
      child.postMessage(request);
    });
  }

  /** Answers a request from the host, unless the host has been replaced meanwhile. */
  private async serve(child: UtilityProcess, request: MainRequest): Promise<void> {
    let response: MainResponse;
    try {
      if (!this.services) throw new Error('Waypoint has nothing to answer that with.');
      const result = await this.services(request);
      response = { type: 'main-response', id: request.id, ok: true, result: result ?? null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response = { type: 'main-response', id: request.id, ok: false, error: message };
    }
    if (this.child === child) child.postMessage(response);
  }

  private onMessage(message: HostResponse): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error));
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
