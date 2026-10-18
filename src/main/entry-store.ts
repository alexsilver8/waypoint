import { EventEmitter } from 'node:events';
import { type FSWatcher, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { type EntryCheck, idFor, type NormalizedEntries } from '../shared/entries';
import { checkQuicklink, normalizeQuicklinks, type Quicklink } from '../shared/quicklinks';
import { checkSnippet, normalizeSnippets, type Snippet } from '../shared/snippets';
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
}

interface EntryStoreEvents<T> {
  change: [entries: readonly T[]];
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A list of named entries in a JSON file: read and checked like settings (entries that can't be
 * used are left out with a warning), saved atomically, and reloaded when the file is edited by
 * hand. The file isn't written until something is added, so an untouched list leaves no file.
 */
export class EntryStore<T extends Entry> extends EventEmitter<EntryStoreEvents<T>> {
  private entries: readonly T[];
  private watcher: FSWatcher | undefined;

  constructor(
    readonly path: string,
    private readonly format: EntryFormat<T>,
  ) {
    super();
    this.entries = this.read() ?? [];
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
    const checked = this.valid(entry);
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
    const updated = { id, ...this.valid({ ...fields, ...patch }) } as T;
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

  private valid(value: unknown): Omit<T, 'id'> {
    const result = this.format.check(value);
    if (result.problem !== undefined) throw new EntryError(capitalized(result.problem));
    return result.entry;
  }

  /** What's on disk now, so a change made by hand a moment ago isn't saved over. */
  private fresh(): readonly T[] {
    const read = this.read();
    if (read) this.setEntries(read);
    return this.entries;
  }

  private save(next: readonly T[]): void {
    writeJsonFile(this.path, next);
    this.setEntries(next);
  }

  private reload(): void {
    const next = this.read();
    if (next) this.setEntries(next);
  }

  private setEntries(next: readonly T[]): void {
    if (JSON.stringify(next) === JSON.stringify(this.entries)) return;
    this.entries = next;
    this.emit('change', next);
  }

  /** Reads and checks the file; `undefined` if it can't be read, so what's loaded stays. */
  private read(): T[] | undefined {
    try {
      const { entries, problems } = this.format.normalize(readJsonFile(this.path));
      for (const problem of problems) console.warn(`[${this.format.noun}s] ${problem}`);
      return entries;
    } catch (error) {
      console.warn(`[${this.format.noun}s] Could not read ${this.path}: ${(error as Error).message}`);
      return undefined;
    }
  }
}

/** Your quicklinks, in `quicklinks.json`. */
export class QuicklinkStore extends EntryStore<Quicklink> {
  constructor(path: string) {
    super(path, { noun: 'quicklink', normalize: normalizeQuicklinks, check: checkQuicklink });
  }
}

/** Your snippets, in `snippets.json`. */
export class SnippetStore extends EntryStore<Snippet> {
  constructor(path: string) {
    super(path, { noun: 'snippet', normalize: normalizeSnippets, check: checkSnippet });
  }
}
