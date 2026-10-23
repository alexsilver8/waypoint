import { calculate, formatResult } from '../../shared/calculator';
import { type Conversion, convert, formatAmount, parseConversion, withUnit } from '../../shared/conversion';
import { type ExchangeRates, formatRatesDate } from '../../shared/currencies';
import { rankItems, scoreItem } from '../../shared/search';
import { answerTimeQuery, parseTimeQuery, type TimeQuery } from '../../shared/time-zones';
import { matchTitleAndText } from '../../shared/title-and-text';
import type { RootItem, RootKind } from '../../shared/types';
import type { DisplayItem, DisplaySection } from './model';

const MAX_SUGGESTIONS = 5;
const MAX_RESULTS = 60;
/** In "All", notes and clipboard entries are a short taste; their own tabs show everything. */
const MAX_NOTES_IN_ALL = 4;
const MAX_CLIPBOARD_IN_ALL = 3;
const MAX_IN_TAB = 300;

/** A kind of thing, or the commands of extensions grouped by extension. */
export type RootFilter = 'all' | RootKind | 'extensions';

export const ROOT_FILTERS: ReadonlyArray<{ id: RootFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'application', label: 'Apps' },
  { id: 'command', label: 'Commands' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'note', label: 'Notes' },
  { id: 'clipboard', label: 'Clipboard' },
];

const TAB_TITLES: Record<RootKind, { recent: string; matches: string }> = {
  application: { recent: 'Applications', matches: 'Applications' },
  command: { recent: 'Commands', matches: 'Commands' },
  note: { recent: 'Recent notes', matches: 'Notes' },
  clipboard: { recent: 'Recently copied', matches: 'Clipboard' },
};

const URL_WITH_SCHEME = /^https?:\/\/\S+$/i;
const BARE_DOMAIN =
  /^(www\.)?[\w-]+(\.[\w-]+)*\.(com|org|net|io|dev|app|ai|co|so|gg|me|sh|xyz|edu|gov|ch|de|uk|ie|fr|es|it|nl|br|jp|ca|au)(:\d+)?(\/\S*)?$/i;

/** Create Quicklink, offered for a link typed in the search, which it starts from. */
const CREATE_QUICKLINK = { extension: 'quicklinks', command: 'create' };

/** Returns a URL to open if the query looks like one. */
export function asUrl(query: string): string | null {
  if (URL_WITH_SCHEME.test(query)) return query;
  if (BARE_DOMAIN.test(query)) return `https://${query}`;
  return null;
}

/** Frequently used items get a bonus that can lift them a few places, but not past much better matches. */
function usageBoost(item: RootItem): number {
  return Math.min(2, Math.log2(1 + item.frecency));
}

function quote(query: string): string {
  return query.length > 32 ? `${query.slice(0, 31)}…` : query;
}

function ofKind(items: readonly RootItem[], kinds: readonly RootKind[]): RootItem[] {
  return items.filter((item) => kinds.includes(item.kind));
}

function ranked(items: readonly RootItem[], query: string): DisplayItem[] {
  return rankItems(items, query, usageBoost).map(({ item, titlePositions }) => ({
    ...asRootRow(item),
    titlePositions,
  }));
}

/** How many items of each kind match the query, for the filter tabs. */
export function countRootMatches(items: readonly RootItem[], rawQuery: string): Record<RootFilter, number> {
  const query = rawQuery.trim();
  const counts: Record<RootFilter, number> = {
    all: 0,
    application: 0,
    command: 0,
    extensions: 0,
    note: 0,
    clipboard: 0,
  };
  const matching = query
    ? [...rankItems(items, query).map((r) => r.item), ...items.filter((item) => textMatch(item, query))]
    : items;
  for (const item of matching) {
    counts[item.kind] += 1;
    counts.all += 1;
  }
  const extensionCommands = withExtensionTitles(fromExtensions(items));
  counts.extensions = query ? rankItems(extensionCommands, query).length : extensionCommands.length;
  return counts;
}

/** Commands from extensions you can add or remove: bundled ones and your own, not the app's built-ins. */
function fromExtensions(items: readonly RootItem[]): RootItem[] {
  return items.filter((item) => item.kind === 'command' && item.extension && item.extension.source !== 'builtin');
}

/** Lets a command be found by its extension's name too: "docker" finds all of Docker's commands. */
function withExtensionTitles(items: readonly RootItem[]): RootItem[] {
  return items.map((item) =>
    item.extension ? { ...item, keywords: [...(item.keywords ?? []), item.extension.title] } : item,
  );
}

/** The calculator's row for a conversion, or a row saying exchange rates haven't come yet. */
function conversionRow(query: string, conversion: Conversion, rates: ExchangeRates | null): DisplayItem {
  const { from, to } = conversion;
  const value = convert(conversion, rates);
  if (value === null) {
    const missing = [from, to].find(
      (measure) => measure.dimension === 'currency' && measure.code !== 'EUR' && !rates?.rates[measure.code],
    );
    return {
      id: 'calculator',
      title:
        rates && missing?.dimension === 'currency'
          ? `No exchange rate for ${missing.code}`
          : 'Exchange rates unavailable',
      subtitle: 'Waypoint gets them from the European Central Bank once a day, when online',
      icon: { builtin: 'calculator' },
      actions: [],
    };
  }
  const number = formatAmount(value, to);
  const result = withUnit(number, to);
  const toLabel =
    to.dimension === 'currency' && rates ? `${to.name}, ECB rate of ${formatRatesDate(rates.date)}` : to.name;
  return {
    id: 'calculator',
    title: result,
    subtitle: query,
    calculator: { expression: query, result, labels: [from.name, toLabel] },
    actions: [
      { type: 'copy', text: formatAmount(value, to, false), title: 'Copy Answer' },
      { type: 'copy', text: withUnit(formatAmount(value, to, false), to), title: 'Copy with Unit' },
      { type: 'copy', text: `${query} = ${result}`, title: 'Copy Calculation' },
    ],
  };
}

/** When and where the launcher is, for questions about the time somewhere else. */
export interface Clock {
  now: Date;
  /** The IANA zone the computer is set to. */
  zone: string;
}

function localClock(): Clock {
  return { now: new Date(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

/** The time somewhere else, as a card like the calculator's: the time here or there on the left, there on the right. */
function timeRow(query: string, question: TimeQuery, clock: Clock): DisplayItem {
  const answer = answerTimeQuery(question, clock.now, clock.zone);
  const to = question.to.name;
  const fromLabel = [question.from?.note ?? answer.fromName, answer.fromDay, question.time ? '' : 'now']
    .filter(Boolean)
    .join(' · ');
  const toLabel = [question.to.note ?? to, answer.day, answer.difference].join(' · ');
  return {
    id: 'time',
    title: `${answer.time} in ${to}`,
    subtitle: query,
    calculator: { expression: answer.fromTime, result: answer.time, labels: [fromLabel, toLabel] },
    actions: [
      { type: 'copy', text: answer.time, title: 'Copy Time' },
      { type: 'copy', text: `${answer.time} in ${to}`, title: 'Copy with Place' },
      { type: 'copy', text: `${answer.fromTime} ${answer.fromName} = ${answer.time} ${to}`, title: 'Copy Both Times' },
    ],
  };
}

/**
 * Builds the root list. "All" shows suggestions and commands when empty, and ranked results
 * when searching; a kind's tab shows everything of that kind. `rates` are for converting
 * currencies, once they've arrived, and `clock` is for the time elsewhere.
 */
export function buildRootSections(
  items: readonly RootItem[],
  rawQuery: string,
  filter: RootFilter = 'all',
  rates: ExchangeRates | null = null,
  clock: Clock = localClock(),
): DisplaySection[] {
  const query = rawQuery.trim();
  if (filter === 'extensions') return buildExtensionsTab(items, query);
  if (filter !== 'all') return buildTab(items, query, filter);

  const sections: DisplaySection[] = [];
  const launchable = ofKind(items, ['command', 'application']);

  if (!query) {
    const listed = launchable.filter((item) => !item.searchOnly);
    const suggestions = listed
      .filter((item) => item.frecency > 0)
      .sort((a, b) => b.frecency - a.frecency)
      .slice(0, MAX_SUGGESTIONS);
    const suggested = new Set(suggestions.map((item) => item.id));
    const commands = listed
      .filter((item) => item.kind === 'command' && !suggested.has(item.id))
      .sort((a, b) => a.title.localeCompare(b.title));
    if (suggestions.length > 0) sections.push({ title: 'Suggestions', items: suggestions.map(asRootRow) });
    if (commands.length > 0) sections.push({ title: 'Commands', items: commands.map(asRootRow) });
    return sections;
  }

  const conversion = parseConversion(query);
  const value = conversion ? null : calculate(query);
  if (conversion) {
    sections.push({ title: 'Calculator', items: [conversionRow(query, conversion, rates)] });
  } else if (value !== null) {
    const result = formatResult(value);
    sections.push({
      title: 'Calculator',
      items: [
        {
          id: 'calculator',
          title: result,
          subtitle: query,
          calculator: { expression: query, result },
          actions: [
            { type: 'copy', text: String(value), title: 'Copy Answer' },
            { type: 'copy', text: `${query} = ${result}`, title: 'Copy Calculation' },
          ],
        },
      ],
    });
  } else {
    const question = parseTimeQuery(query);
    if (question) sections.push({ title: 'Time', items: [timeRow(query, question, clock)] });
  }

  const url = asUrl(query);
  if (url) {
    sections.push({
      title: 'Link',
      items: [
        {
          id: 'open-link',
          title: `Open ${url.replace(/^https?:\/\//, '')}`,
          icon: { builtin: 'link', tint: 'blue' },
          actions: [
            { type: 'open-url', url, title: 'Open in Browser' },
            { type: 'copy', text: url, title: 'Copy Link' },
            { type: 'open-command', ref: CREATE_QUICKLINK, argument: url, title: 'Create Quicklink' },
          ],
        },
      ],
    });
  }

  const results = rankedWithText(launchable, query).slice(0, MAX_RESULTS);
  if (results.length > 0) sections.push({ title: 'Results', items: results });

  const notes = ranked(ofKind(items, ['note']), query).slice(0, MAX_NOTES_IN_ALL);
  if (notes.length > 0) sections.push({ title: 'Notes', items: notes });

  const copied = ranked(ofKind(items, ['clipboard']), query).slice(0, MAX_CLIPBOARD_IN_ALL);
  if (copied.length > 0) sections.push({ title: 'Clipboard', items: copied });

  const fallbacks: DisplayItem[] = items
    .filter((item) => item.fallback)
    .map((item) => ({
      ...asRootRow(item),
      id: `fallback:${item.id}`,
      actions: [
        {
          type: 'open-command',
          ref: item.fallback as NonNullable<RootItem['fallback']>,
          argument: query,
          title: item.title,
        },
      ],
    }));
  for (const item of items) {
    if (item.takesText)
      fallbacks.push({ ...withText(item, query), id: `fallback:${item.id}`, subtitle: item.subtitle });
  }
  if (fallbacks.length > 0) sections.push({ title: `Use “${quote(query)}” with…`, items: fallbacks });

  return sections;
}

function buildTab(items: readonly RootItem[], query: string, kind: RootKind): DisplaySection[] {
  const pool = ofKind(items, [kind]);
  const titles = TAB_TITLES[kind];
  if (!query) {
    const listed = pool.filter((item) => !item.searchOnly);
    // Notes and clipboard entries arrive newest first; apps and commands read best A to Z.
    const ordered =
      kind === 'note' || kind === 'clipboard' ? listed : [...listed].sort((a, b) => a.title.localeCompare(b.title));
    const rows = ordered.slice(0, MAX_IN_TAB).map(asRootRow);
    return rows.length > 0 ? [{ title: titles.recent, items: rows }] : [];
  }
  const rows = (kind === 'command' ? rankedWithText(pool, query) : ranked(pool, query)).slice(0, MAX_IN_TAB);
  return rows.length > 0 ? [{ title: titles.matches, items: rows }] : [];
}

/**
 * Every extension's commands under the extension's name, extensions A to Z. When searching,
 * the extension with the best match comes first, and its matching commands in order.
 */
function buildExtensionsTab(items: readonly RootItem[], query: string): DisplaySection[] {
  const pool = withExtensionTitles(fromExtensions(items));
  const ordered = query
    ? rankItems(pool, query, usageBoost).map(({ item, titlePositions }) => ({ item, titlePositions }))
    : [...pool]
        .sort(
          (a, b) =>
            (a.extension?.title ?? '').localeCompare(b.extension?.title ?? '') || a.title.localeCompare(b.title),
        )
        .map((item) => ({ item, titlePositions: undefined }));

  const sections = new Map<string, DisplaySection>();
  for (const { item, titlePositions } of ordered) {
    const extension = item.extension;
    if (!extension) continue;
    let section = sections.get(extension.name);
    if (!section) {
      section = { title: extension.title, items: [] };
      sections.set(extension.name, section);
    }
    const row = asRootRow(item);
    // The heading already names the extension.
    if (row.subtitle === extension.title) delete row.subtitle;
    section.items.push(titlePositions ? { ...row, titlePositions } : row);
  }
  return [...sections.values()];
}

/** What's typed after the title of an item that takes text, unless the whole search matches it anyway. */
function textMatch(item: RootItem, query: string) {
  if (!item.takesText || scoreItem(query, item)) return null;
  return matchTitleAndText(query, item);
}

/** A row that opens an item that takes text with `text`, keeping the item's other actions. */
function withText(item: RootItem, text: string): DisplayItem {
  const row = asRootRow(item);
  if (!item.takesText) return row;
  const { ref, prefix = '' } = item.takesText;
  const [first, ...rest] = item.actions;
  return {
    ...row,
    id: `text:${item.id}`,
    subtitle: `“${quote(text)}”`,
    actions: [{ type: 'open-command', ref, argument: `${prefix}${text}`, title: first?.title ?? item.title }, ...rest],
  };
}

/**
 * The items that match, best first, with a row for each item that takes text whose title the
 * search starts with: "gh waypoint" offers GitHub Search with "waypoint", ranked by how well "gh"
 * matches the title, the text counting as matched (see `matchTitleAndText`).
 */
function rankedWithText(items: readonly RootItem[], query: string): DisplayItem[] {
  const rows = rankItems(items, query, usageBoost).map(({ item, score, titlePositions }) => ({
    score,
    row: { ...asRootRow(item), titlePositions },
  }));
  for (const item of items) {
    const match = textMatch(item, query);
    if (match) {
      const row = { ...withText(item, match.text), titlePositions: match.titlePositions };
      rows.push({ score: match.score + usageBoost(item), row });
    }
  }
  // Stable, so equal scores keep rankItems' order.
  return rows.sort((a, b) => b.score - a.score).map(({ row }) => row);
}

function asRootRow(item: RootItem): DisplayItem {
  const {
    kind,
    frecency: _frecency,
    fallback: _fallback,
    extension: _extension,
    takesText: _takesText,
    searchOnly: _searchOnly,
    ...row
  } = item;
  // Only launching apps and commands teaches the ranking what you use.
  return kind === 'command' || kind === 'application' ? { ...row, rootItemId: item.id } : row;
}
