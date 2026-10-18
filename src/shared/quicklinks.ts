/**
 * Quicklinks: links you open with a few keys, kept in `quicklinks.json`. A link is a web
 * address, a file or folder, or an app's own link (`spotify:`, `obsidian://`), and can hold
 * placeholders, like `{argument}` for what you type after its name.
 */
import {
  type EntryCheck,
  isRecord,
  isShortIcon,
  type NormalizedEntries,
  normalizeEntries,
  optionalText,
  textField,
} from './entries';
import { expandPlaceholders, findPlaceholders, type PlaceholderValues } from './placeholders';

export interface Quicklink {
  /** Stable, made from the name when it's added. */
  id: string;
  name: string;
  /** A URL, a path, or an app's link, with placeholders. */
  link: string;
  /** The app to open it with, by name or path; left out, whatever opens it normally does. */
  openWith?: string;
  /** An emoji shown beside it. */
  icon?: string;
}

/** A quicklink as the Settings window sends it: without an id when it's new. */
export type QuicklinkDraft = Omit<Quicklink, 'id'> & { id?: string };

const MAX_NAME = 200;
const MAX_LINK = 8192;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_PATH = /^[a-z]:[\\/]|^\\\\/i;
const BLOCKED_SCHEMES = /^(javascript|data|vbscript|blob):/i;
/** `github.com/search`, `docs.example.co.uk`: a web address without its `https://`. */
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i;

function isPath(link: string): boolean {
  return WINDOWS_PATH.test(link) || link.startsWith('/') || link === '~' || /^~[\\/]/.test(link);
}

/** A web address without its scheme, which opens as `https://`. */
export function isBareDomain(link: string): boolean {
  return !SCHEME.test(link) && !isPath(link) && BARE_DOMAIN.test(link);
}

/**
 * Whether the link is a URL (`https:`, `spotify:`, `file:`, or a bare `github.com/…`), where what's
 * put in for a placeholder is percent-encoded. In a path it goes in as it is.
 */
export function isUrlLink(link: string): boolean {
  return (SCHEME.test(link) && !WINDOWS_PATH.test(link)) || isBareDomain(link);
}

/** Why a link can't be opened, or `undefined` if it looks fine. */
export function linkProblem(link: string): string | undefined {
  const value = link.trim();
  if (!value) return 'Add a link.';
  if (value.length > MAX_LINK) return 'The link is too long.';
  if (/[\r\n]/.test(value)) return 'The link must be on one line.';
  // Filled in when it opens, like {clipboard}: there's nothing to check yet.
  if (value.startsWith('{')) return undefined;
  if (isPath(value)) return undefined;
  if (SCHEME.test(value)) {
    return BLOCKED_SCHEMES.test(value) ? `Waypoint doesn’t open ${value.split(':')[0]}: links.` : undefined;
  }
  if (BARE_DOMAIN.test(value)) return undefined;
  return 'Use a web address like https://example.com, a path like ~/Documents, or an app’s link like spotify:.';
}

/** Checks a quicklink from the file or the Settings window; `id` is dealt with by the caller. */
export function checkQuicklink(value: unknown): EntryCheck<Omit<Quicklink, 'id'>> {
  if (!isRecord(value)) return { problem: 'it must be an object with a name and a link.' };
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return { problem: 'it needs a name.' };
  if (typeof value.link !== 'string') return { problem: 'it needs a link.' };
  const link = value.link.trim();
  const problem = linkProblem(link);
  if (problem) return { problem };
  const openWith = optionalText(value.openWith);
  if (!openWith.ok) return { problem: '“openWith” must be the name or path of an app.' };
  const icon = optionalText(value.icon);
  if (!icon.ok || (icon.value !== undefined && !isShortIcon(icon.value))) {
    return { problem: 'the icon must be an emoji.' };
  }
  const entry: Omit<Quicklink, 'id'> = { name, link };
  if (openWith.value) entry.openWith = openWith.value;
  if (icon.value) entry.icon = icon.value;
  return { entry };
}

/**
 * A quicklink's fields as a form or the Settings window sends them, to check and save. Every field
 * is there, so one left empty clears it rather than keeping what it had.
 */
export function quicklinkFields(raw: unknown): Omit<Quicklink, 'id'> {
  return {
    name: textField(raw, 'name'),
    link: textField(raw, 'link'),
    openWith: textField(raw, 'openWith'),
    icon: textField(raw, 'icon'),
  };
}

/** The quicklinks in `quicklinks.json`, leaving out (and describing) any that can't be used. */
export function normalizeQuicklinks(raw: unknown): NormalizedEntries<Quicklink> {
  return normalizeEntries(raw, { noun: 'quicklink', file: 'quicklinks.json', check: checkQuicklink });
}

/** Whether the link has an `{argument}`, so it takes text typed after its name. */
export function takesArgument(link: string): boolean {
  return findPlaceholders(link).some((placeholder) => placeholder.name === 'argument');
}

/** Whether it can't open without text: an `{argument}` without a `default`. */
export function needsArgument(link: string): boolean {
  return findPlaceholders(link).some((p) => p.name === 'argument' && p.options.default === undefined);
}

/** What the text is called, from `{argument name="term"}`; "text" otherwise. */
export function argumentName(link: string): string {
  const named = findPlaceholders(link).find((p) => p.name === 'argument' && p.options.name?.trim());
  return named?.options.name?.trim() ?? 'text';
}

/**
 * The link with its placeholders filled in. Pass `keepArgument` to show where the text goes
 * instead, as `{argument}` (or `{term}` for `{argument name="term"}`), for a preview before
 * anything is typed.
 */
export function expandLink(link: string, values: PlaceholderValues, keepArgument = false): string {
  return expandPlaceholders(link, values, {
    ...(isUrlLink(link) ? { encode: encodeURIComponent } : {}),
    ...(keepArgument
      ? {
          names: ['clipboard', 'date', 'time', 'datetime', 'uuid'],
          unfilled: (placeholder) => `{${placeholder.options.name?.trim() || placeholder.name}}`,
        }
      : {}),
  });
}

/**
 * The link as a subtitle: without `https://` and `www.`, and its placeholders without their
 * options, so `{argument name="term"}` shows as `{term}` and `{date format="…"}` as `{date}`.
 */
export function shortLink(link: string): string {
  const simple = expandPlaceholders(
    link,
    {},
    {
      names: [],
      unfilled: ({ name, options }) => `{${(name === 'argument' && options.name?.trim()) || name}}`,
    },
  );
  return simple.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
}
