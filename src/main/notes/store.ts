import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { type FSWatcher, watch } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { DeletedNote, Note } from '../../shared/notes';
import { debounce } from '../json-file';

const EXTENSION = '.md';
/** Recently Deleted: a hidden folder beside the notes, so other apps and the list skip it. */
const DELETED_FOLDER = '.deleted';
/** How long a listing is trusted without word from the watcher, in case it misses a change. */
const CACHE_MS = 10_000;

/** Any file name in the folder is a valid id, as long as it can't escape the folder. */
function assertValidId(id: string): void {
  if (!id || id.length > 200 || id !== basename(id) || id.startsWith('.') || /[\\/]/.test(id)) {
    throw new Error(`Invalid note id: ${id}`);
  }
}

/** Ids made here start with the creation time in base 36, so they sort and date themselves. */
function createdAtFromId(id: string): number | undefined {
  const match = /^([0-9a-z]{8,9})-[0-9a-f]{4}$/.exec(id);
  if (!match) return undefined;
  const time = Number.parseInt(match[1] as string, 36);
  return Number.isFinite(time) && time > 1e12 ? time : undefined;
}

/**
 * Notes are Markdown files in one folder — no database, no limit. Files added, edited or
 * removed by other apps (a sync client, your editor) show up too.
 */
export class NotesStore extends EventEmitter<{ change: [] }> {
  private watcher: FSWatcher | undefined;
  /**
   * While watching, the folder is read once and kept until something changes. Each change
   * bumps the generation, so a read that overlapped a write is never kept.
   */
  private cache: { notes: Promise<Note[]>; generation: number; readAt: number } | undefined;
  private generation = 0;
  /** Ids of notes being created, not written yet. */
  private readonly reserved = new Set<string>();
  private readonly announce = debounce(() => this.emit('change'), 250);

  constructor(
    private dir: string,
    /** Moves a file to the system Trash. */
    private readonly trashFile: (path: string) => Promise<void>,
  ) {
    super();
  }

  get directory(): string {
    return this.dir;
  }

  setDirectory(dir: string): void {
    if (dir === this.dir) return;
    this.dir = dir;
    this.invalidate();
    if (this.watcher) {
      this.unwatch();
      void this.watch();
    }
    this.emit('change');
  }

  pathOf(id: string): string {
    assertValidId(id);
    return join(this.dir, `${id}${EXTENSION}`);
  }

  /** All notes, most recently edited first. */
  async list(): Promise<Note[]> {
    if (!this.watcher) return this.readAll();
    const cached = this.cache;
    if (cached && cached.generation === this.generation && Date.now() - cached.readAt < CACHE_MS) {
      return [...(await cached.notes)];
    }
    const entry = { notes: this.readAll(), generation: this.generation, readAt: Date.now() };
    entry.notes.catch(() => {
      if (this.cache === entry) this.cache = undefined;
    });
    this.cache = entry;
    return [...(await entry.notes)];
  }

  private invalidate(): void {
    this.generation += 1;
    this.cache = undefined;
  }

  private async readAll(): Promise<Note[]> {
    await mkdir(this.dir, { recursive: true });
    const entries = await readdir(this.dir, { withFileTypes: true });
    const notes = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(EXTENSION) && !entry.name.startsWith('.'))
        .map((entry) => this.read(entry.name.slice(0, -EXTENSION.length)).catch(() => undefined)),
    );
    return notes.filter((note): note is Note => note !== undefined).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Note | undefined> {
    return this.read(id).catch(() => undefined);
  }

  async create(text = ''): Promise<Note> {
    await mkdir(this.dir, { recursive: true });
    const id = await this.newId();
    try {
      await this.write(id, text);
    } finally {
      this.reserved.delete(id);
      this.invalidate();
    }
    return this.read(id);
  }

  /**
   * An id no other note has: notes created in the same millisecond only differ by a few random
   * characters, and writing one would replace the other. Ids being created count as taken.
   */
  private async newId(): Promise<string> {
    for (;;) {
      const id = `${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
      if (this.reserved.has(id)) continue;
      this.reserved.add(id);
      const taken = await stat(this.pathOf(id)).then(
        () => true,
        () => false,
      );
      if (!taken) return id;
      this.reserved.delete(id);
    }
  }

  async update(id: string, text: string): Promise<Note> {
    await mkdir(this.dir, { recursive: true });
    try {
      await this.write(id, text);
    } finally {
      this.invalidate();
    }
    return this.read(id);
  }

  private deletedPathOf(id: string): string {
    assertValidId(id);
    return join(this.dir, DELETED_FOLDER, `${id}${EXTENSION}`);
  }

  /** `folder/id.md`, or `folder/id-2.md` and so on if that's taken. */
  private async freePath(folder: string, id: string): Promise<string> {
    for (let n = 1; ; n++) {
      const candidate = join(folder, `${n === 1 ? id : `${id}-${n}`}${EXTENSION}`);
      const taken = await stat(candidate).then(
        () => true,
        () => false,
      );
      if (!taken) return candidate;
    }
  }

  /**
   * Moves a note to Recently Deleted, where it stays for 60 days so a mistake can be undone.
   * Its file's time becomes the time it was deleted.
   */
  async delete(id: string): Promise<void> {
    const from = this.pathOf(id);
    const folder = join(this.dir, DELETED_FOLDER);
    try {
      await mkdir(folder, { recursive: true });
      const to = await this.freePath(folder, id);
      await rename(from, to);
      // The note's gone either way; without the new time it just leaves Recently Deleted sooner.
      const now = new Date();
      await utimes(to, now, now).catch(() => undefined);
    } finally {
      this.invalidate();
    }
  }

  /** Moves every note to Recently Deleted. */
  async deleteAll(): Promise<void> {
    for (const note of await this.readAll()) await this.delete(note.id);
  }

  /** Notes in Recently Deleted, most recently deleted first. */
  async listDeleted(): Promise<DeletedNote[]> {
    const folder = join(this.dir, DELETED_FOLDER);
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    const notes = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(EXTENSION) && !entry.name.startsWith('.'))
        .map(async (entry): Promise<DeletedNote | undefined> => {
          const path = join(folder, entry.name);
          try {
            const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
            return { id: entry.name.slice(0, -EXTENSION.length), text, deletedAt: info.mtimeMs };
          } catch {
            return undefined;
          }
        }),
    );
    return notes.filter((note): note is DeletedNote => note !== undefined).sort((a, b) => b.deletedAt - a.deletedAt);
  }

  /** Brings a note back from Recently Deleted, under a new name if its old one is taken. */
  async restore(id: string): Promise<Note> {
    const from = this.deletedPathOf(id);
    await mkdir(this.dir, { recursive: true });
    const to = await this.freePath(this.dir, id);
    try {
      await rename(from, to);
    } finally {
      this.invalidate();
    }
    return this.read(basename(to, EXTENSION));
  }

  /** Deletes a note in Recently Deleted for good, by moving it to the system Trash. */
  async purge(id: string): Promise<void> {
    await this.trashFile(this.deletedPathOf(id));
  }

  /** Moves notes deleted longer ago than `maxAgeMs` from Recently Deleted to the system Trash. */
  async purgeOlderThan(maxAgeMs: number, now = Date.now()): Promise<number> {
    const expired = (await this.listDeleted()).filter((note) => now - note.deletedAt > maxAgeMs);
    for (const note of expired) {
      await this.purge(note.id).catch((error: unknown) =>
        console.warn('[notes] Could not purge a deleted note:', error),
      );
    }
    return expired.length;
  }

  /** Deletes a note for good, but only if there's nothing in it. */
  async discardIfEmpty(id: string): Promise<boolean> {
    const note = await this.get(id);
    if (!note || note.text.trim()) return false;
    try {
      await rm(this.pathOf(id), { force: true });
    } finally {
      this.invalidate();
    }
    return true;
  }

  async watch(): Promise<void> {
    if (this.watcher) return;
    await mkdir(this.dir, { recursive: true });
    try {
      this.watcher = watch(this.dir, () => {
        this.invalidate();
        this.announce();
      });
    } catch (error) {
      console.warn('[notes] Could not watch the notes folder:', error);
    }
  }

  unwatch(): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.invalidate();
    // A change still waiting to be announced would reach windows that are already gone.
    this.announce.cancel();
  }

  private async read(id: string): Promise<Note> {
    const path = this.pathOf(id);
    const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return {
      id,
      text,
      createdAt: createdAtFromId(id) ?? (info.birthtimeMs || info.mtimeMs),
      updatedAt: info.mtimeMs,
    };
  }

  private async write(id: string, text: string): Promise<void> {
    const path = this.pathOf(id);
    const temporary = join(this.dir, `.${id}.${randomBytes(4).toString('hex')}.tmp`);
    await writeFile(temporary, text);
    await rename(temporary, path);
  }
}
