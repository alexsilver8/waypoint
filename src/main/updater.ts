import { EventEmitter } from 'node:events';
import { releaseUrl, type UpdateMode, type UpdateStatus } from '../shared/updates';

/** The part of electron-updater's `autoUpdater` this uses, so tests can stand in for it. */
export interface UpdaterBackend {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'checking-for-update', listener: () => void): unknown;
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'update-not-available', listener: () => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface UpdaterOptions {
  mode: UpdateMode;
  /** Loaded only when needed: electron-updater reads the app's update config as it starts. */
  backend: () => UpdaterBackend;
  /** Whether to look for updates by itself (the setting); checking from the menu works either way. */
  enabled: () => boolean;
  /** Says a version is ready or out, once per version; clicking it does the update's action. */
  notify(text: string, onClick: () => void): void;
  openUrl(url: string): void;
}

interface UpdaterEvents {
  change: [status: UpdateStatus];
}

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Keeps Waypoint up to date from its GitHub releases: looks shortly after it starts and every few
 * hours, then installs or points you at the download, as `mode` says.
 */
export class Updater extends EventEmitter<UpdaterEvents> {
  private current: UpdateStatus = { state: 'idle' };
  private loaded: UpdaterBackend | undefined;
  private timers: NodeJS.Timeout[] = [];
  private notified = new Set<string>();

  constructor(private readonly options: UpdaterOptions) {
    super();
  }

  get mode(): UpdateMode {
    return this.options.mode;
  }

  get status(): UpdateStatus {
    return this.current;
  }

  /** Starts checking by itself, while the setting is on. */
  start(): void {
    if (this.mode === 'off' || this.timers.length) return;
    const automatic = () => {
      if (this.options.enabled()) void this.check();
    };
    this.timers.push(setTimeout(automatic, FIRST_CHECK_MS).unref());
    this.timers.push(setInterval(automatic, CHECK_EVERY_MS).unref());
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** Looks for a new version. Nothing to do while one is on its way or waiting for a restart. */
  async check(): Promise<void> {
    if (this.mode === 'off') return;
    const { state } = this.current;
    if (state === 'checking' || state === 'downloading' || state === 'ready') return;
    if (state === 'available' && this.mode === 'install') return;
    this.set({ state: 'checking' });
    try {
      await this.backend().checkForUpdates();
    } catch (error) {
      this.failed(error);
    }
  }

  /** What the update item does: check, download in `notify` mode, or restart into the new version. */
  act(): void {
    const status = this.current;
    if (status.state === 'ready') this.backend().quitAndInstall(true, true);
    else if (status.state === 'available' && this.mode === 'notify') this.options.openUrl(releaseUrl(status.version));
    else void this.check();
  }

  private backend(): UpdaterBackend {
    if (this.loaded) return this.loaded;
    const backend = this.options.backend();
    backend.autoDownload = this.mode === 'install';
    backend.autoInstallOnAppQuit = this.mode === 'install';
    backend.on('checking-for-update', () => this.set({ state: 'checking' }));
    backend.on('update-not-available', () => this.set({ state: 'up-to-date' }));
    backend.on('update-available', ({ version }) => {
      this.set({ state: 'available', version });
      if (this.mode === 'notify') this.notifyOnce(version, `Waypoint ${version} is out. Click to download it.`);
    });
    backend.on('download-progress', ({ percent }) => {
      const { current } = this;
      if (current.state === 'available' || current.state === 'downloading') {
        // Whole percents, so the tray menu isn't rebuilt for every chunk.
        this.set({ state: 'downloading', version: current.version, percent: Math.floor(percent) });
      }
    });
    backend.on('update-downloaded', ({ version }) => {
      this.set({ state: 'ready', version });
      this.notifyOnce(version, `Waypoint ${version} is ready. Click to restart and update.`);
    });
    backend.on('error', (error) => this.failed(error));
    this.loaded = backend;
    return backend;
  }

  private notifyOnce(version: string, text: string): void {
    if (this.notified.has(version)) return;
    this.notified.add(version);
    this.options.notify(text, () => this.act());
  }

  private failed(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[updates]', message);
    this.set({ state: 'error', message: message.split('\n')[0] ?? message });
  }

  private set(status: UpdateStatus): void {
    if (JSON.stringify(status) === JSON.stringify(this.current)) return;
    this.current = status;
    this.emit('change', status);
  }
}
