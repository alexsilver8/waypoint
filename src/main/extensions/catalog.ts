/**
 * Extensions people can install, found on npm: packages that carry the `waypoint-extension`
 * keyword. **Browse Extensions** lists them, and installs one through the same checks as Install
 * Extension.
 */
import { NPM_REGISTRY } from './npm-registry';

/** The keyword a package needs to be listed. */
export const CATALOG_KEYWORD = 'waypoint-extension';
/** As many as npm gives in one go. */
const PAGE_SIZE = 50;
/** A search is asked again after this long, so new and updated packages show. */
const FRESH_MS = 10 * 60 * 1000;
/** Searches remembered, for going back and forth between a few. */
const REMEMBERED = 20;
const TIMEOUT_MS = 8000;

export interface CatalogEntry {
  /** The npm package's name, which is also what Install Extension takes. */
  name: string;
  version: string;
  description?: string;
  /** Who published it, by their npm username. */
  publisher?: string;
  /** When this version was published, as ISO 8601. */
  date?: string;
  weeklyDownloads?: number;
  license?: string;
  /** Its page on npm. */
  npmUrl: string;
  /** Its repository or homepage, as a web address. */
  homepage?: string;
}

export interface CatalogOptions {
  /** Electron's `net.fetch` in the app, which goes through the system's proxy. */
  fetch(url: string, init: { signal: AbortSignal }): Promise<Response>;
  registry?: string;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

/** A web address that opens in the browser, or nothing: `git+https://…/x.git` becomes `https://…/x`. */
export function webAddress(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/, '');
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The entries of an npm search response, skipping anything that isn't a package with a name and version. */
export function parseSearch(body: unknown): CatalogEntry[] {
  if (!isRecord(body) || !Array.isArray(body.objects)) {
    throw new Error('The npm registry sent something unexpected.');
  }
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const object of body.objects) {
    if (!isRecord(object) || !isRecord(object.package)) continue;
    const pkg = object.package;
    const name = text(pkg.name, 214);
    const version = text(pkg.version, 100);
    if (!name || !version || seen.has(name)) continue;
    seen.add(name);
    const links = isRecord(pkg.links) ? pkg.links : {};
    const publisher = isRecord(pkg.publisher) ? text(pkg.publisher.username, 100) : undefined;
    const downloads = isRecord(object.downloads) ? object.downloads.weekly : undefined;
    const description = text(pkg.description, 500);
    const date = text(pkg.date, 40);
    const license = text(pkg.license, 100);
    const homepage = webAddress(links.repository) ?? webAddress(links.homepage);
    entries.push({
      name,
      version,
      npmUrl: webAddress(links.npm) ?? `https://www.npmjs.com/package/${name}`,
      ...(description ? { description } : {}),
      ...(publisher ? { publisher } : {}),
      ...(date ? { date } : {}),
      ...(typeof downloads === 'number' && Number.isFinite(downloads) ? { weeklyDownloads: downloads } : {}),
      ...(license ? { license } : {}),
      ...(homepage ? { homepage } : {}),
    });
  }
  return entries;
}

export class ExtensionCatalog {
  private readonly cache = new Map<string, { at: number; entries: CatalogEntry[] }>();

  constructor(private readonly options: CatalogOptions) {}

  private get now() {
    return this.options.now?.() ?? Date.now();
  }

  /** Extensions whose name, description or keywords match `query`, or the most popular for "". */
  async search(query: string): Promise<CatalogEntry[]> {
    const key = query.trim().toLowerCase().replace(/\s+/g, ' ');
    const cached = this.cache.get(key);
    if (cached && this.now - cached.at < FRESH_MS) return cached.entries;

    const registry = (this.options.registry ?? NPM_REGISTRY).replace(/\/+$/, '');
    const params = new URLSearchParams({
      text: `keywords:${CATALOG_KEYWORD}${key ? ` ${key}` : ''}`,
      size: String(PAGE_SIZE),
      // With nothing typed, the most used come first.
      ...(key ? {} : { popularity: '1.0', quality: '0.0', maintenance: '0.0' }),
    });
    let response: Response;
    try {
      response = await this.options.fetch(`${registry}/-/v1/search?${params}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error('Couldn’t reach npm. Check your connection and try again.');
    }
    if (!response.ok) throw new Error(`npm answered ${response.status}. Try again in a moment.`);
    const entries = parseSearch(await response.json());

    this.cache.delete(key);
    this.cache.set(key, { at: this.now, entries });
    // Forget the oldest beyond a few.
    for (const old of this.cache.keys()) {
      if (this.cache.size <= REMEMBERED) break;
      this.cache.delete(old);
    }
    return entries;
  }
}
