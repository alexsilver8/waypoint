import { isNetworkPath } from '../shared/paths';

/**
 * The file a `palette-icon://icon?path=…` request asks for, or `undefined` when it names none or
 * names one on the network: the path can come from an extension's Markdown, which shows what
 * anyone wrote (an issue, a README), and Windows would connect to that share to read it.
 */
export function iconRequestPath(url: string): string | undefined {
  let path: string | null;
  try {
    path = new URL(url).searchParams.get('path');
  } catch {
    return undefined;
  }
  return path && !isNetworkPath(path) ? path : undefined;
}

/**
 * Remembers rendered icons and limits how many are rendered at once, so scrolling through
 * hundreds of apps doesn't ask the OS for hundreds of icons in the same instant.
 */
export class IconCache {
  private readonly entries = new Map<string, Promise<Uint8Array>>();
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly load: (path: string) => Promise<Uint8Array>,
    private readonly maxEntries = 1000,
    private readonly concurrency = 4,
  ) {}

  get(path: string): Promise<Uint8Array> {
    const hit = this.entries.get(path);
    if (hit) {
      // Keep recently used icons at the end, so the oldest are evicted first.
      this.entries.delete(path);
      this.entries.set(path, hit);
      return hit;
    }
    const promise = this.schedule(() => this.load(path));
    this.entries.set(path, promise);
    // Don't remember failures; the file may be readable next time.
    promise.catch(() => {
      if (this.entries.get(path) === promise) this.entries.delete(path);
    });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return promise;
  }

  private async schedule<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

/**
 * The `size` to ask `app.getFileIcon` for. `large` is documented as unsupported on macOS,
 * where requesting it crashed the app, and is no bigger than `normal` on Windows.
 */
export function fileIconSize(platform: NodeJS.Platform): 'normal' | 'large' {
  return platform === 'linux' ? 'large' : 'normal';
}

/** The ways of asking the OS for an icon, passed in so the choice between them can be tested. */
export interface IconSources {
  /** The icon Finder shows, drawn by Quick Look (macOS and Windows). */
  thumbnail(path: string): Promise<Uint8Array | undefined>;
  /** Electron's file icon. On macOS it's the icon of the file's type, not of the file. */
  fileIcon(path: string): Promise<Uint8Array | undefined>;
  realpath(path: string): Promise<string>;
}

/**
 * A file's own icon as a PNG. On macOS, `app.getFileIcon` gives every app the same generic
 * application icon, so Quick Look draws it instead, from the real path: some apps, like
 * Safari, are symlinks, and Quick Look would draw the symlink. The file icon is the fallback.
 */
export async function loadFileIcon(path: string, platform: NodeJS.Platform, sources: IconSources): Promise<Uint8Array> {
  if (platform === 'darwin') {
    try {
      const png = await sources.thumbnail(await sources.realpath(path));
      if (png && png.length > 0) return png;
    } catch {
      // Not something Quick Look can draw; the file icon will do.
    }
  }
  const png = await sources.fileIcon(path);
  if (!png || png.length === 0) throw new Error(`No icon for ${path}`);
  return png;
}
