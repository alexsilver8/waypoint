/**
 * Placeholders in quicklinks and snippets, filled in when a quicklink opens or a snippet is
 * pasted: `{argument}`, `{clipboard}`, `{date}`, `{time}`, `{datetime}` and `{uuid}`, some with
 * options like `{date format="yyyy-MM-dd" offset="+1d"}`. Anything else in braces is left as it
 * is, so JSON or code in a snippet comes out unchanged.
 */

export const PLACEHOLDER_NAMES = ['argument', 'clipboard', 'date', 'time', 'datetime', 'uuid'] as const;

export type PlaceholderName = (typeof PLACEHOLDER_NAMES)[number];

export interface Placeholder {
  name: PlaceholderName;
  /** `{date format="yyyy-MM-dd"}` has `{ format: "yyyy-MM-dd" }`. Option names are lowercase. */
  options: Record<string, string>;
}

/** What the placeholders are filled in with. Anything left out has a sensible default. */
export interface PlaceholderValues {
  /** What was typed for `{argument}`. When empty, its `default` option is used. */
  argument?: string;
  /** Asked for only when the text has `{clipboard}`, and only once. */
  clipboard?: () => string;
  /** The moment `{date}` and `{time}` show; now when left out. */
  now?: Date;
  /** For `{date}` without a format, and month and day names. The system's when left out. */
  locale?: string;
  /** Makes each `{uuid}`; `crypto.randomUUID` when left out. */
  uuid?: () => string;
}

export interface ExpandOptions {
  /** The placeholders to fill in; the others stay as written. All of them when left out. */
  names?: readonly PlaceholderName[];
  /** What to show for a placeholder that isn't filled in, instead of it as written. */
  unfilled?: (placeholder: Placeholder) => string;
  /** Applied to every value put in, e.g. `encodeURIComponent` for a URL. */
  encode?: (value: string) => string;
}

const PLACEHOLDER = /\{(argument|clipboard|date|time|datetime|uuid)((?:\s+[A-Za-z]+\s*=\s*"[^"]*")*)\s*\}/g;
const OPTION = /([A-Za-z]+)\s*=\s*"([^"]*)"/g;

function parseOptions(source: string): Record<string, string> {
  const options: Record<string, string> = {};
  for (const [, key, value] of source.matchAll(OPTION)) {
    if (key !== undefined && value !== undefined) options[key.toLowerCase()] = value;
  }
  return options;
}

/** Every placeholder in the text, in order. */
export function findPlaceholders(text: string): Placeholder[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => ({
    name: match[1] as PlaceholderName,
    options: parseOptions(match[2] ?? ''),
  }));
}

/** Whether the text has a placeholder with this name, e.g. to read the clipboard only when it's needed. */
export function hasPlaceholder(text: string, name: PlaceholderName): boolean {
  return findPlaceholders(text).some((placeholder) => placeholder.name === name);
}

/**
 * Values for filling in these texts, with the clipboard read up front (reading it may be
 * asynchronous), and only if one of them has `{clipboard}`.
 */
export async function valuesWithClipboard(
  texts: readonly string[],
  readClipboard: () => Promise<string>,
): Promise<PlaceholderValues> {
  if (!texts.some((text) => hasPlaceholder(text, 'clipboard'))) return {};
  const clipboard = await readClipboard().catch(() => '');
  return { clipboard: () => clipboard };
}

// ── Dates ───────────────────────────────────────────────────

const OFFSET = /^(?:[+-]?\d+[yMwdhm])+$/;
const OFFSET_PART = /([+-]?)(\d+)([yMwdhm])/g;

/**
 * Moves a date by an offset like `+1d`, `-2w` or `+1M -3h`: `y` years, `M` months, `w` weeks,
 * `d` days, `h` hours and `m` minutes. Returns `null` for an offset it can't read.
 */
export function offsetDate(date: Date, offset: string): Date | null {
  const compact = offset.replace(/\s+/g, '');
  if (!OFFSET.test(compact)) return null;
  const result = new Date(date);
  for (const [, sign, digits, unit] of compact.matchAll(OFFSET_PART)) {
    const amount = Number(digits) * (sign === '-' ? -1 : 1);
    if (unit === 'y') result.setFullYear(result.getFullYear() + amount);
    else if (unit === 'M') result.setMonth(result.getMonth() + amount);
    else if (unit === 'w') result.setDate(result.getDate() + amount * 7);
    else if (unit === 'd') result.setDate(result.getDate() + amount);
    else if (unit === 'h') result.setHours(result.getHours() + amount);
    else result.setMinutes(result.getMinutes() + amount);
  }
  return result;
}

const FORMAT_TOKEN = /yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|hh|h|mm|ss|a|'(?:[^']|'')*'/g;

/** Intl throws on a malformed locale; the system's is used instead. */
function dateFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
}

/**
 * Formats a date with tokens like `yyyy-MM-dd HH:mm`: `yyyy` `yy` years, `MMMM` `MMM` `MM` `M`
 * months, `dd` `d` days, `EEEE` `EEE` weekdays, `HH` `H` 24-hour and `hh` `h` 12-hour hours, `mm`
 * minutes, `ss` seconds and `a` AM or PM. Text in single quotes is kept as it is, and `''` is a quote.
 */
export function formatDate(date: Date, format: string, locale?: string): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const name = (options: Intl.DateTimeFormatOptions) => dateFormat(locale, options).format(date);
  const hours12 = date.getHours() % 12 || 12;
  return format.replace(FORMAT_TOKEN, (token) => {
    switch (token) {
      case 'yyyy':
        return String(date.getFullYear());
      case 'yy':
        return pad(date.getFullYear() % 100);
      case 'MMMM':
        return name({ month: 'long' });
      case 'MMM':
        return name({ month: 'short' });
      case 'MM':
        return pad(date.getMonth() + 1);
      case 'M':
        return String(date.getMonth() + 1);
      case 'dd':
        return pad(date.getDate());
      case 'd':
        return String(date.getDate());
      case 'EEEE':
        return name({ weekday: 'long' });
      case 'EEE':
        return name({ weekday: 'short' });
      case 'HH':
        return pad(date.getHours());
      case 'H':
        return String(date.getHours());
      case 'hh':
        return pad(hours12);
      case 'h':
        return String(hours12);
      case 'mm':
        return pad(date.getMinutes());
      case 'ss':
        return pad(date.getSeconds());
      case 'a':
        return date.getHours() < 12 ? 'AM' : 'PM';
      default:
        return token === "''" ? "'" : token.slice(1, -1).replaceAll("''", "'");
    }
  });
}

const DEFAULT_STYLES: Record<'date' | 'time' | 'datetime', Intl.DateTimeFormatOptions> = {
  date: { dateStyle: 'medium' },
  time: { timeStyle: 'short' },
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
};

function moment(name: 'date' | 'time' | 'datetime', options: Record<string, string>, values: PlaceholderValues) {
  const now = values.now ?? new Date();
  const date = (options.offset !== undefined && offsetDate(now, options.offset)) || now;
  if (options.format) return formatDate(date, options.format, values.locale);
  return dateFormat(values.locale, DEFAULT_STYLES[name]).format(date);
}

// ── Filling in ──────────────────────────────────────────────

/** Fills in the placeholders in `text`. */
export function expandPlaceholders(text: string, values: PlaceholderValues = {}, options: ExpandOptions = {}): string {
  const names: readonly string[] = options.names ?? PLACEHOLDER_NAMES;
  let clipboard: string | undefined;
  return text.replace(PLACEHOLDER, (source: string, name: PlaceholderName, rawOptions: string) => {
    const placeholderOptions = parseOptions(rawOptions);
    if (!names.includes(name)) return options.unfilled?.({ name, options: placeholderOptions }) ?? source;
    let value: string;
    if (name === 'argument') value = values.argument || placeholderOptions.default || '';
    else if (name === 'clipboard') value = clipboard ??= values.clipboard?.() ?? '';
    else if (name === 'uuid') value = values.uuid ? values.uuid() : crypto.randomUUID();
    else value = moment(name, placeholderOptions, values);
    return options.encode ? options.encode(value) : value;
  });
}
