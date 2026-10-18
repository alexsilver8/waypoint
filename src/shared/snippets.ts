/**
 * Snippets: text you paste with a few keys, kept in `snippets.json`. The text can hold
 * placeholders like `{clipboard}` and `{date}`, filled in when it's pasted, and a keyword like
 * `!email` finds it in the launcher.
 */
import {
  type EntryCheck,
  isRecord,
  type NormalizedEntries,
  normalizeEntries,
  optionalText,
  textField,
} from './entries';
import { expandPlaceholders, type PlaceholderName, type PlaceholderValues } from './placeholders';

export interface Snippet {
  /** Stable, made from the name when it's added. */
  id: string;
  name: string;
  /** What's pasted, with placeholders. */
  text: string;
  /** Typed in the launcher to find it, like `!email`. */
  keyword?: string;
}

/**
 * Whether snippets expand as you type in other apps: `off` in Settings, `on` and working, or
 * not working because macOS hasn't allowed Accessibility yet, the session is Wayland (which keeps
 * keys from other apps), or the keyboard hook couldn't load.
 */
export type SnippetExpansionStatus = 'off' | 'on' | 'needs-accessibility' | 'unsupported' | 'unavailable';

/** A snippet as the Settings window sends it: without an id when it's new. */
export type SnippetDraft = Omit<Snippet, 'id'> & { id?: string };

/** The placeholders a snippet can hold. `{argument}` is only for quicklinks. */
export const SNIPPET_PLACEHOLDERS: readonly PlaceholderName[] = ['clipboard', 'date', 'time', 'datetime', 'uuid'];

const MAX_NAME = 200;
const MAX_TEXT = 100_000;
const MAX_KEYWORD = 50;

/** Checks a snippet from the file or the Settings window; `id` is dealt with by the caller. */
export function checkSnippet(value: unknown): EntryCheck<Omit<Snippet, 'id'>> {
  if (!isRecord(value)) return { problem: 'it must be an object with a name and some text.' };
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return { problem: 'it needs a name.' };
  // The text is pasted exactly as written, spaces and line breaks included.
  if (typeof value.text !== 'string' || !value.text.trim()) return { problem: 'it needs some text.' };
  if (value.text.length > MAX_TEXT) return { problem: 'its text is too long.' };
  const keyword = optionalText(value.keyword);
  if (!keyword.ok) return { problem: 'the keyword must be text.' };
  if (keyword.value !== undefined) {
    if (/\s/.test(keyword.value)) return { problem: 'the keyword can’t have spaces in it.' };
    if (keyword.value.length > MAX_KEYWORD) return { problem: 'the keyword is too long.' };
  }
  const entry: Omit<Snippet, 'id'> = { name, text: value.text };
  if (keyword.value) entry.keyword = keyword.value;
  return { entry };
}

/**
 * A snippet's fields as a form or the Settings window sends them, to check and save. Every field
 * is there, so a keyword left empty is cleared. The text is kept exactly as typed.
 */
export function snippetFields(raw: unknown): Omit<Snippet, 'id'> {
  return { name: textField(raw, 'name'), text: textField(raw, 'text'), keyword: textField(raw, 'keyword') };
}

/**
 * Why a snippet added or changed can't have its keyword: another snippet has it already, in any
 * letter case, so typing it would find two. `others` are the snippets besides this one.
 */
export function keywordProblem(entry: Omit<Snippet, 'id'>, others: readonly Snippet[]): string | undefined {
  const keyword = entry.keyword?.toLowerCase();
  if (!keyword) return undefined;
  const holder = others.find((other) => other.keyword?.toLowerCase() === keyword);
  return holder ? `“${holder.name}” already has the keyword ${holder.keyword}.` : undefined;
}

/** The snippets in `snippets.json`, leaving out (and describing) any that can't be used. */
export function normalizeSnippets(raw: unknown): NormalizedEntries<Snippet> {
  return normalizeEntries(raw, { noun: 'snippet', file: 'snippets.json', check: checkSnippet });
}

/** The snippet's text with its placeholders filled in, as it's pasted. */
export function expandSnippet(text: string, values: PlaceholderValues): string {
  return expandPlaceholders(text, values, { names: SNIPPET_PLACEHOLDERS });
}

/** The first line with something on it, for a subtitle. */
export function snippetPreview(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const collapsed = line.trim().replace(/\s+/g, ' ');
  return collapsed.length > 120 ? `${collapsed.slice(0, 119)}…` : collapsed;
}
