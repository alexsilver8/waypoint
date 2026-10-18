import { EventEmitter } from 'node:events';
import { type FSWatcher, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { type EntryCheck, idFor, type NormalizedEntries } from '../shared/entries';
import { checkQuicklink, normalizeQuicklinks, type Quicklink } from '../shared/quicklinks';
import { checkSnippet, keywordProblem, normalizeSnippets, type Snippet } from '../shared/snippets';
import { debounce, readJsonFile, writeJsonFile } from './json-file';

/** Thrown when an entry to add or change isn't valid; the message says what to fix. */
export class EntryError extends Error {}

interface Entry {
  id: string;
  name: string;
}

export interface EntryFormat<T extends Entry> {
  /** "quicklink", for messages and ids. */
  noun: string;
  normalize(raw: unknown): NormalizedEntries<T>;
  check(value: unknown): EntryCheck<Omit<T, 'id'>>;
  /** Why an entry added or changed clashes with the `others` already there, like a keyword in use. */
  conflict?(entry: Omit<T, 'id'>, others: readonly T[]): string | undefined;
}

interface EntryStoreEvents<T> {
  change: [entries: readonly T[]];
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What the file held: the entries to use, and those that couldn't be, as they were written. */
interface FileContents<T> {
  entries: T[];
  /** Kept in the file, at their place in the list, when it's written again. */
  unusable: Array<{ index: number; value: unknown }>;
}

/**
 * A list of named entries in a JSON file: read and checked like settings (entries that can't be
 * used are left out with a warning), saved atomically, and reloaded when the file is edited by
 * hand. The file isn't written until something is added, so an untouched list leaves no file.
 *
 * Nothing written by hand is lost to a change made here: entries that can't be used are written
 * back as they were, and while the file can't be read at all, changes are refused until it's fixed.
 */
export class EntryStore<T extends Entry> extends EventEmitter<EntryStoreEvents<T>> {
  private entries: readonly T[] = [];
  private unusable: FileContents<T>['unusable'] = [];
  /** Why the file can't be read, while it can't. */
  private unreadable: string | undefined;
  private watcher: FSWatcher | undefined;

  constructor(
    readonly path: string,
    private readonly format: EntryFormat<T>,
  ) {
    super();
    const read = this.read();
    if (read) {
      this.entries = read.entries;
      this.unusable = read.unusable;
    }
  }

  list(): readonly T[] {
    return this.entries;
  }

  get(id: string): T | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  /** Adds an entry with an id made from its name, and saves. Throws an `EntryError` if it isn't valid. */
  add(entry: Omit<T, 'id'>): T {
    const current = this.fresh();
    const checked = this.valid(entry, current);
    const added = { id: idFor(checked.name, new Set(current.map((e) => e.id)), this.format.noun), ...checked } as T;
    this.save([...current, added]);
    return added;
  }

  /** Changes some fields of an entry, and saves. Throws an `EntryError` if it's gone or the result isn't valid. */
  update(id: string, patch: Partial<Omit<T, 'id'>>): T {
    const current = this.fresh();
    const index = current.findIndex((entry) => entry.id === id);
    const existing = current[index];
    if (!existing) throw new EntryError(`That ${this.format.noun} doesn’t exist any more.`);
    const { id: _id, ...fields } = existing;
    const others = current.filter((entry) => entry.id !== id);
    const updated = { id, ...this.valid({ ...fields, ...patch }, others) } as T;
    this.save(current.map((entry, i) => (i === index ? updated : entry)));
    return updated;
  }

  /** Removes an entry and saves. Returns whether there was one to remove. */
  remove(id: string): boolean {
    const current = this.fresh();
    if (!current.some((entry) => entry.id === id)) return false;
    this.save(current.filter((entry) => entry.id !== id));
    return true;
  }

  /** Starts watching the file. Editors often replace files on save, so watch the folder. */
  watch(): void {
    if (this.watcher) return;
    const reload = debounce(() => this.reload(), 150);
    try {
      this.watcher = watch(dirname(this.path), (_event, filename) => {
        if (!filename || filename === basename(this.path)) reload();
      });
    } catch (error) {
      console.warn(`[${this.format.noun}s] Can't watch ${this.path}: ${(error as Error).message}`);
    }
  }

  close(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  /** The entry as it's saved, checked on its own and against the `others`. */
  private valid(value: unknown, others: readonly T[]): Omit<T, 'id'> {
    const result = this.format.check(value);
    if (result.problem !== undefined) throw new EntryError(capitalized(result.problem));
    const conflict = this.format.conflict?.(result.entry, others);
    if (conflict !== undefined) throw new EntryError(capitalized(conflict));
    return result.entry;
  }

  /**
   * What's on disk now, so a change made by hand a moment ago isn't saved over. Throws an
   * `EntryError` when the file can't be read, rather than writing over what's in it.
   */
  private fresh(): readonly T[] {
    const read = this.read();
    if (!read) {
      throw new EntryError(
        `${basename(this.path)} can’t be read (${this.unreadable}), so nothing was changed. Fix the file, then try again.`,
      );
    }
    this.apply(read);
    return this.entries;
  }

  /** Writes the entries, with the ones that couldn't be used back where they were. */
  private save(next: readonly T[]): void {
    const written: unknown[] = [...next];
    for (const { index, value } of this.unusable) written.splice(Math.min(index, written.length), 0, value);
    writeJsonFile(this.path, written);
    this.setEntries(next);
  }

  private reload(): void {
    const read = this.read();
    if (read) this.apply(read);
  }

  private apply(read: FileContents<T>): void {
    this.unusable = read.unusable;
    this.setEntries(read.entries);
  }

  private setEntries(next: readonly T[]): void {
    if (JSON.stringify(next) === JSON.stringify(this.entries)) return;
    this.entries = next;
    this.emit('change', next);
  }

  /**
   * Reads and checks the file; `undefined` if it can't be read, or isn't a list, so what's loaded
   * stays and `unreadable` says why.
   */
  private read(): FileContents<T> | undefined {
    let raw: unknown;
    try {
      raw = readJsonFile(this.path);
      if (raw !== undefined && !Array.isArray(raw)) throw new Error('it must be a list, […]');
    } catch (error) {
      this.unreadable = (error as Error).message;
      console.warn(`[${this.format.noun}s] Could not read ${this.path}: ${this.unreadable}`);
      return undefined;
    }
    this.unreadable = undefined;
    const { entries, problems } = this.format.normalize(raw);
    for (const problem of problems) console.warn(`[${this.format.noun}s] ${problem}`);
    const unusable = (raw ?? []).flatMap((value, index) =>
      this.format.check(value).problem === undefined ? [] : [{ index, value }],
    );
    return { entries, unusable };
  }
}

/** Your quicklinks, in `quicklinks.json`. */
export class QuicklinkStore extends EntryStore<Quicklink> {
  constructor(path: string) {
    super(path, { noun: 'quicklink', normalize: normalizeQuicklinks, check: checkQuicklink });
  }
}

/** Your snippets, in `snippets.json`. Two can't have the same keyword. */
export class SnippetStore extends EntryStore<Snippet> {
  constructor(path: string) {
    super(path, { noun: 'snippet', normalize: normalizeSnippets, check: checkSnippet, conflict: keywordProblem });
  }
}
