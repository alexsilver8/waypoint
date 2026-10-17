/** Notes: plain Markdown files, as many as you like. Shared by the main process and the Notes window. */
import type { Platform } from './types';

export interface Note {
  /** The file name without `.md`. */
  id: string;
  text: string;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
}

/** A note in Recently Deleted. */
export interface DeletedNote {
  id: string;
  text: string;
  /** Epoch milliseconds. */
  deletedAt: number;
}

/** How long a deleted note stays in Recently Deleted before it goes to the system Trash. */
export const RECENTLY_DELETED_DAYS = 60;

/** What the Notes window remembers between launches. */
export interface NotesWindowState {
  /** Float above other windows, as Raycast Notes does. */
  alwaysOnTop: boolean;
  /** Grow the window as the note gets longer, and shrink it back. */
  autoResize: boolean;
  /** Show the format bar at the bottom of the window. */
  formatBar: boolean;
  /** What notes are measured in, in the format bar and Browse Notes. */
  count: 'characters' | 'words';
  /** Text size of the note; 1 is normal. */
  zoom: number;
  /** Pinned notes, in the order they were pinned. ⌘1–⌘9 open the first nine. */
  pinned: string[];
  /** When each note was last open, in epoch milliseconds. */
  opened: Record<string, number>;
  /** Notes to go back and forward to, nearest last. */
  back: string[];
  forward: string[];
}

export const DEFAULT_NOTES_STATE: NotesWindowState = {
  alwaysOnTop: true,
  autoResize: true,
  formatBar: false,
  count: 'characters',
  zoom: 1,
  pinned: [],
  opened: {},
  back: [],
  forward: [],
};

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2;
/** How far back Go Back can go. */
const HISTORY_LIMIT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ids(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const valid = value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200);
  return [...new Set(valid)].slice(-limit);
}

/** Clamps a text size to what the window offers, in steps of 10%. */
export function clampZoom(zoom: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) * 10) / 10;
}

/** Reads saved window state, keeping each value only if it has the right type. */
export function normalizeNotesState(raw: unknown): NotesWindowState {
  const state = structuredClone(DEFAULT_NOTES_STATE);
  if (!isRecord(raw)) return state;
  for (const key of ['alwaysOnTop', 'autoResize', 'formatBar'] as const) {
    if (typeof raw[key] === 'boolean') state[key] = raw[key];
  }
  if (raw.count === 'characters' || raw.count === 'words') state.count = raw.count;
  if (typeof raw.zoom === 'number' && Number.isFinite(raw.zoom)) state.zoom = clampZoom(raw.zoom);
  state.pinned = ids(raw.pinned, 500) ?? state.pinned;
  state.back = ids(raw.back, HISTORY_LIMIT) ?? state.back;
  state.forward = ids(raw.forward, HISTORY_LIMIT) ?? state.forward;
  if (isRecord(raw.opened)) {
    for (const [id, time] of Object.entries(raw.opened)) {
      if (typeof time === 'number' && Number.isFinite(time) && time > 0) state.opened[id] = time;
    }
  }
  return state;
}

export const NotesChannel = {
  list: 'notes:list',
  create: 'notes:create',
  update: 'notes:update',
  /** Fire-and-forget save, used while the window is closing. */
  flush: 'notes:flush',
  /** Deletes a note only if it's empty; used when leaving a note you never wrote in. */
  discardIfEmpty: 'notes:discard-if-empty',
  /** Moves a note to Recently Deleted. */
  delete: 'notes:delete',
  deleteAll: 'notes:delete-all',
  listDeleted: 'notes:list-deleted',
  restore: 'notes:restore',
  /** Moves a note from Recently Deleted to the system Trash. */
  purge: 'notes:purge',
  reveal: 'notes:reveal',
  getState: 'notes:get-state',
  setState: 'notes:set-state',
  setCurrent: 'notes:set-current',
  openLink: 'notes:open-link',
  copy: 'notes:copy',
  export: 'notes:export',
  /** The heights the note and an open popover need, for auto-resizing. */
  fit: 'notes:fit',
  hide: 'notes:hide',
  /** main → window: show this note. */
  open: 'notes:open',
  /** main → window: files changed on disk. */
  changed: 'notes:changed',
} as const;

export type ExportFormat = 'md' | 'html' | 'txt';

/** What the Notes window's preload exposes as `window.notes`. */
export interface NotesApi {
  platform: Platform;
  list(): Promise<Note[]>;
  create(text?: string): Promise<Note>;
  update(id: string, text: string): Promise<Note>;
  flush(id: string, text: string): void;
  discardIfEmpty(id: string): Promise<boolean>;
  /** Moves a note to Recently Deleted. */
  delete(id: string): Promise<void>;
  /** Asks first, then moves every note to Recently Deleted. Resolves whether it did. */
  deleteAll(): Promise<boolean>;
  listDeleted(): Promise<DeletedNote[]>;
  /** Brings a note back from Recently Deleted. */
  restore(id: string): Promise<Note>;
  /** Deletes a note in Recently Deleted for good, by moving it to the system Trash. */
  purge(id: string): Promise<void>;
  reveal(id: string): void;
  getState(): Promise<NotesWindowState & { currentId?: string }>;
  setState(patch: Partial<NotesWindowState>): void;
  setCurrent(id: string): void;
  /** Opens a web or mail link from a note in the default app. */
  openLink(url: string): void;
  /** Puts text on the clipboard, with HTML for apps that paste formatting. */
  copy(content: { text: string; html?: string }): void;
  /** Asks where to save a note, then saves it. Resolves whether it was saved. */
  export(file: { name: string; format: ExportFormat; content: string }): Promise<boolean>;
  /** The heights the note and an open popover need; the window grows to fit them. */
  fit(heights: { content: number; overlay: number }): void;
  /** Hides the window and hands the keyboard back to the app you were in. */
  hide(): void;
  onOpen(listener: (id: string) => void): () => void;
  onChanged(listener: () => void): () => void;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Turns `&amp;`, `&nbsp;`, `&#39;` and the like back into characters. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === '#') {
      const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}

// Escaped punctuation (`\_`, `\*`) is set aside as private-use characters while markers are
// stripped, so a literal `*` or `_` survives and an emphasis marker doesn't.
const ESCAPED = /\\([!-/:-@[-`{-~])/g;
const protect = (text: string) =>
  text.replace(ESCAPED, (_, char: string) => String.fromCharCode(0xe000 + char.charCodeAt(0)));
const restore = (text: string) =>
  text.replace(/[\ue000-\ue07f]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xe000));

/** Inline Markdown as you'd read it: links as their text, no emphasis or code markers. */
function inlineText(text: string): string {
  const plain = protect(text)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`~]/g, '')
    // Underscores mark emphasis at the edges of words; inside one (snake_case) they're text.
    .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, '$1');
  return decodeEntities(restore(plain));
}

const FENCE = /^\s{0,3}(```|~~~)/;
const QUOTE = /^\s*(?:>\s?)+/;
const BLOCK_MARKER = /^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/;

/** A line as you'd read it: no heading, quote, list or checkbox markers, links as their text. */
function stripMarkdown(line: string): string {
  // Code fences mark where a code block starts and ends; they aren't text.
  if (FENCE.test(line)) return '';
  return inlineText(line.replace(QUOTE, '').replace(BLOCK_MARKER, '')).trim();
}

/**
 * A note's Markdown made easier to read where it's shown as text: entities decoded and
 * backslash escapes dropped, with the block markers (`#`, `-`, `- [ ]`) kept.
 */
export function readableMarkdown(text: string): string {
  return decodeEntities(text.replace(ESCAPED, '$1'));
}

function meaningfulLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(stripMarkdown)
    .filter((line) => line.length > 0);
}

/** The first line with something in it, without Markdown markers. */
export function noteTitle(text: string): string {
  const title = meaningfulLines(text)[0] ?? '';
  if (!title) return 'Untitled';
  return title.length > 80 ? `${title.slice(0, 79)}…` : title;
}

/** The line after the title, for list previews. */
export function notePreview(text: string): string {
  const preview = meaningfulLines(text)[1] ?? '';
  return preview.length > 120 ? `${preview.slice(0, 119)}…` : preview;
}

export function countWords(text: string): number {
  const words = meaningfulLines(text).join(' ').match(/\S+/g);
  return words ? words.length : 0;
}

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Characters you'd read, as Raycast counts them: Markdown markers aside, an emoji is one. */
export function countCharacters(text: string): number {
  let count = 0;
  for (const _ of graphemes.segment(meaningfulLines(text).join('\n'))) count += 1;
  return count;
}

/** "1366 characters", "1 word": written as Raycast writes them, without a thousands separator. */
export function noteLength(text: string, unit: NotesWindowState['count']): string {
  const count = unit === 'words' ? countWords(text) : countCharacters(text);
  const noun = unit === 'words' ? 'word' : 'character';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * A note as plain text, for copying or exporting: no Markdown, with list bullets and
 * checkboxes drawn as characters so the structure still reads.
 */
export function toPlainText(markdown: string): string {
  const lines: string[] = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      lines.push(line);
      continue;
    }
    const text = line.replace(QUOTE, '');
    const task = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(text);
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(text);
    const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(text);
    if (task) lines.push(`${task[1]}${task[2] === ' ' ? '☐' : '☑'} ${inlineText(task[3] ?? '')}`);
    else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(text)) lines.push('———');
    else if (bullet) lines.push(`${bullet[1]}• ${inlineText(bullet[2] ?? '')}`);
    else if (numbered) lines.push(`${numbered[1]}${numbered[2]}. ${inlineText(numbered[3] ?? '')}`);
    else lines.push(inlineText(text.replace(/^\s{0,3}#{1,6}\s+/, '')).trimEnd());
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday", "last month", "7 months ago", as Raycast puts it. */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((Math.min(timestamp, now) - now) / 1000);
  if (seconds > -60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes > -60) return RELATIVE.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours > -24) return RELATIVE.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (days > -7) return RELATIVE.format(days, 'day');
  if (days > -30) return RELATIVE.format(Math.round(days / 7), 'week');
  const months = Math.round(days / 30.4375);
  if (months > -12) return RELATIVE.format(months, 'month');
  return RELATIVE.format(Math.round(days / 365.25), 'year');
}

export interface BrowseSections {
  pinned: Note[];
  notes: Note[];
}

/**
 * Browse Notes, as Raycast lists them: pinned notes first, in the order they were pinned,
 * then the rest by when they were last open, with the note you're on at the end.
 */
export function browseSections(
  notes: Note[],
  { pinned, opened, currentId }: { pinned: string[]; opened: Record<string, number>; currentId: string | null },
): BrowseSections {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const pinnedNotes = pinned.map((id) => byId.get(id)).filter((note): note is Note => note !== undefined);
  const isPinned = new Set(pinnedNotes.map((note) => note.id));
  const lastOpen = (note: Note) => opened[note.id] ?? note.updatedAt;
  const rest = notes
    .filter((note) => !isPinned.has(note.id))
    .sort((a, b) => {
      if (a.id === currentId) return 1;
      if (b.id === currentId) return -1;
      return lastOpen(b) - lastOpen(a);
    });
  return { pinned: pinnedNotes, notes: rest };
}

export const DEEPLINK_SCHEME = 'waypoint';

/** A link that opens a note in Waypoint from anywhere, like Raycast's note deeplinks. */
export function noteDeeplink(id: string): string {
  return `${DEEPLINK_SCHEME}://notes/${encodeURIComponent(id)}`;
}

/** The note a `waypoint://notes/<id>` link opens, if it is one. */
export function noteIdFromDeeplink(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== `${DEEPLINK_SCHEME}:` || parsed.hostname !== 'notes') return undefined;
  let id: string;
  try {
    id = decodeURIComponent(parsed.pathname.replace(/^\/+|\/+$/g, ''));
  } catch {
    return undefined;
  }
  return id && !/[\\/]/.test(id) && !id.startsWith('.') ? id : undefined;
}

/** Links a note may open: web pages and email. Anything else (file:, javascript:) is refused. */
export function isOpenableLink(url: string): boolean {
  return /^(https?:\/\/|mailto:)\S+$/i.test(url.trim());
}

/**
 * What's typed into a note's link field, as an address: `example.com` and `localhost:5173`
 * get `https://`, an email address gets `mailto:`. Empty input gives '' (remove the link);
 * an address of any other kind (`javascript:`, `file:`) gives null.
 */
export function normalizeLink(value: string): string | null {
  const text = value.trim();
  if (!text) return '';
  if (/^(https?:\/\/|mailto:|tel:)\S+$/i.test(text)) return text;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(text) || /^(javascript|data|file|vbscript):/i.test(text)) return null;
  if (/^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(text)) return `mailto:${text}`;
  if (/\s/.test(text)) return null;
  return `https://${text}`;
}
