/**
 * What quicklinks and snippets have in common: a list of named entries, kept in a JSON file you
 * can edit by hand. Like settings, what's read is checked: entries that can't be used are left
 * out with a note saying why, and the rest load.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The result of checking one entry: the entry, or why it can't be used. */
export type EntryCheck<T> = { entry: T; problem?: undefined } | { entry?: undefined; problem: string };

export interface NormalizedEntries<T> {
  entries: T[];
  /** Human-readable notes about entries that were left out. */
  problems: string[];
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Ids are short and safe to put anywhere: letters, digits, `-` and `_`. */
export function isEntryId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

/** A readable id made from a name, "GitHub Search" → "github-search", that isn't in `taken`. */
export function idFor(name: string, taken: ReadonlySet<string>, fallback: string): string {
  const slug =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || fallback;
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) {
    if (!taken.has(`${slug}-${n}`)) return `${slug}-${n}`;
  }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** An emoji or a couple of characters, counted as people see them (a flag or a family is one). */
export function isShortIcon(value: string): boolean {
  if (value.length === 0 || value.length > 40 || /[\s\\/]/.test(value)) return false;
  return value.length <= 3 || [...graphemes.segment(value)].length <= 3;
}

/** A field as a form or the Settings window sends it: its text, or "" when it's missing or isn't text. */
export function textField(raw: unknown, key: string): string {
  const value = isRecord(raw) ? raw[key] : undefined;
  return typeof value === 'string' ? value : '';
}

/** A string option: trimmed, and left out when empty. Anything but a string is a problem. */
export function optionalText(value: unknown): { value?: string; ok: boolean } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  return trimmed ? { value: trimmed, ok: true } : { ok: true };
}

interface ListFormat<T> {
  /** "quicklink", for messages. */
  noun: string;
  /** The file, for messages. */
  file: string;
  check(value: unknown): EntryCheck<T>;
}

/**
 * Reads a list of entries from what was in the file. Entries that aren't valid are left out and
 * described in `problems`. An entry keeps its `id` when it has a valid one no other entry has;
 * otherwise one is made from its name, so entries written by hand need no ids.
 */
export function normalizeEntries<T extends { name: string }>(
  raw: unknown,
  format: ListFormat<T>,
): NormalizedEntries<T & { id: string }> {
  if (raw === undefined) return { entries: [], problems: [] };
  if (!Array.isArray(raw)) {
    return { entries: [], problems: [`${format.file} must be a list ([…]) of ${format.noun}s; ignoring it.`] };
  }
  const problems: string[] = [];
  const checked: Array<{ entry: T; id?: string }> = [];
  for (const [index, value] of raw.entries()) {
    const result = format.check(value);
    if (result.entry) {
      checked.push({ entry: result.entry, ...(isRecord(value) && isEntryId(value.id) ? { id: value.id } : {}) });
      continue;
    }
    const name =
      isRecord(value) && typeof value.name === 'string' && value.name.trim() ? ` (“${value.name.trim()}”)` : '';
    problems.push(`Ignoring ${format.noun} ${index + 1}${name}: ${result.problem}`);
  }

  // Ids given in the file first, so one made from a name never takes another entry's.
  const taken = new Set<string>();
  const ids = checked.map(({ id }) => {
    if (id === undefined || taken.has(id)) return undefined;
    taken.add(id);
    return id;
  });
  const entries = checked.map(({ entry }, index) => {
    let id = ids[index];
    if (id === undefined) {
      id = idFor(entry.name, taken, format.noun);
      taken.add(id);
    }
    return { id, ...entry };
  });
  return { entries, problems };
}
