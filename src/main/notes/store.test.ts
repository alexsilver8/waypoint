import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NotesStore } from './store';

/** Random bytes for note ids, queued by a test; real ones otherwise. */
const idBytes = vi.hoisted(() => ({ queue: [] as string[] }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomBytes: (size: number) => {
      const next = size === 2 ? idBytes.queue.shift() : undefined;
      return next ? Buffer.from(next, 'hex') : actual.randomBytes(size);
    },
  };
});

function setup() {
  const dir = join(mkdtempSync(join(tmpdir(), 'notes-')), 'notes');
  const trashed: string[] = [];
  const store = new NotesStore(dir, async (path) => {
    trashed.push(path);
  });
  return { dir, store, trashed };
}

describe('NotesStore', () => {
  it('creates notes as Markdown files and lists them newest first', async () => {
    const { dir, store } = setup();
    const first = await store.create('# First');
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await store.create('# Second');
    expect(readFileSync(join(dir, `${first.id}.md`), 'utf8')).toBe('# First');
    expect((await store.list()).map((n) => n.id)).toEqual([second.id, first.id]);
    expect(first.createdAt).toBeGreaterThan(Date.now() - 60_000);
  });

  it('never gives two notes the same file, even when created in the same millisecond', async () => {
    const { dir, store } = setup();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_791_727_005_000);
    try {
      idBytes.queue.push('abcd');
      const existing = await store.create('existing');
      // Every new note first draws the same bytes as `existing`, then new ones.
      idBytes.queue.push('abcd', 'abcd', '1234', 'abcd', '5678');
      const created = await Promise.all([store.create('one'), store.create('two')]);
      const ids = [existing.id, ...created.map((note) => note.id)];
      expect(new Set(ids).size).toBe(3);
      expect(readFileSync(join(dir, `${existing.id}.md`), 'utf8')).toBe('existing');
      expect(created.map((note) => note.text)).toEqual(['one', 'two']);
    } finally {
      now.mockRestore();
      idBytes.queue.length = 0;
    }
  });

  it('has no limit on the number of notes', async () => {
    const { store } = setup();
    await Promise.all(Array.from({ length: 250 }, (_, i) => store.create(`Note ${i}`)));
    expect(await store.list()).toHaveLength(250);
  });

  it('updates notes and moves edited ones to the top', async () => {
    const { store } = setup();
    const a = await store.create('a');
    await store.create('b');
    await new Promise((resolve) => setTimeout(resolve, 15));
    const updated = await store.update(a.id, 'a, edited');
    expect(updated.text).toBe('a, edited');
    expect((await store.list())[0]?.id).toBe(a.id);
  });

  it('picks up Markdown files added by other apps', async () => {
    const { dir, store } = setup();
    await store.list();
    writeFileSync(join(dir, 'Groceries.md'), '- oat milk');
    writeFileSync(join(dir, 'readme.txt'), 'not a note');
    const notes = await store.list();
    expect(notes.map((n) => n.id)).toEqual(['Groceries']);
  });

  it('only discards empty notes', async () => {
    const { dir, store } = setup();
    const kept = await store.create('keep me');
    const empty = await store.create('  \n');
    expect(await store.discardIfEmpty(kept.id)).toBe(false);
    expect(await store.discardIfEmpty(empty.id)).toBe(true);
    expect(existsSync(join(dir, `${empty.id}.md`))).toBe(false);
    expect((await store.list()).map((note) => note.id)).toEqual([kept.id]);
  });

  it('moves deleted notes to Recently Deleted, and brings them back', async () => {
    const { dir, store, trashed } = setup();
    const note = await store.create('# Groceries\n\n- oat milk');
    const before = Date.now();
    await store.delete(note.id);
    expect(await store.list()).toEqual([]);
    expect(existsSync(join(dir, '.deleted', `${note.id}.md`))).toBe(true);
    const [deleted] = await store.listDeleted();
    expect(deleted).toMatchObject({ id: note.id, text: '# Groceries\n\n- oat milk' });
    expect(deleted?.deletedAt).toBeGreaterThanOrEqual(before - 1000);

    const restored = await store.restore(note.id);
    expect(restored).toMatchObject({ id: note.id, text: '# Groceries\n\n- oat milk' });
    expect((await store.list()).map((n) => n.id)).toEqual([note.id]);
    expect(await store.listDeleted()).toEqual([]);
    expect(trashed).toEqual([]);
  });

  it('restores a note under a new name if its old one is taken', async () => {
    const { dir, store } = setup();
    await store.list();
    writeFileSync(join(dir, 'Ideas.md'), 'old ideas');
    await store.delete('Ideas');
    writeFileSync(join(dir, 'Ideas.md'), 'new ideas');
    const restored = await store.restore('Ideas');
    expect(restored).toMatchObject({ id: 'Ideas-2', text: 'old ideas' });
    expect(readFileSync(join(dir, 'Ideas.md'), 'utf8')).toBe('new ideas');
  });

  it('deletes notes for good by moving them from Recently Deleted to the Trash', async () => {
    const { dir, store, trashed } = setup();
    const note = await store.create('gone');
    await store.delete(note.id);
    await store.purge(note.id);
    expect(trashed).toEqual([join(dir, '.deleted', `${note.id}.md`)]);
  });

  it('empties Recently Deleted of notes deleted long enough ago', async () => {
    const { dir, store, trashed } = setup();
    const old = await store.create('old');
    const recent = await store.create('recent');
    await store.delete(old.id);
    await store.delete(recent.id);
    const longAgo = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000);
    utimesSync(join(dir, '.deleted', `${old.id}.md`), longAgo, longAgo);
    expect(await store.purgeOlderThan(60 * 24 * 60 * 60 * 1000)).toBe(1);
    expect(trashed).toEqual([join(dir, '.deleted', `${old.id}.md`)]);
  });

  it('deletes every note at once', async () => {
    const { store } = setup();
    await Promise.all([store.create('one'), store.create('two'), store.create('three')]);
    await store.deleteAll();
    expect(await store.list()).toEqual([]);
    expect(await store.listDeleted()).toHaveLength(3);
  });

  it('rejects ids that would escape the folder', async () => {
    const { store } = setup();
    await expect(store.update('../evil', 'x')).rejects.toThrow('Invalid note id');
    await expect(store.update('a/b', 'x')).rejects.toThrow('Invalid note id');
    await expect(store.update('.hidden', 'x')).rejects.toThrow('Invalid note id');
  });

  it('keeps its listing while watching, and reads again after a change', async () => {
    const { dir, store } = setup();
    await store.watch();
    try {
      const first = await store.create('# First');
      expect((await store.list()).map((n) => n.id)).toEqual([first.id]);
      writeFileSync(join(dir, 'from-elsewhere.md'), '# From elsewhere');
      await vi.waitFor(async () => expect(await store.list()).toHaveLength(2));
    } finally {
      store.unwatch();
    }
  });

  it('announces nothing once it stops watching', async () => {
    const { dir, store } = setup();
    await store.watch();
    const onChange = vi.fn();
    store.on('change', onChange);
    writeFileSync(join(dir, 'late.md'), '# Late');
    await new Promise((resolve) => setTimeout(resolve, 20));
    store.unwatch();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('never keeps a listing read while a note was being changed', async () => {
    const { store } = setup();
    const note = await store.create('# Going');
    await store.watch();
    try {
      expect(await store.list()).toHaveLength(1);
      // Listed while it's being deleted, the note may still be there; listed after, it's gone.
      const [, during] = await Promise.all([store.delete(note.id), store.list()]);
      expect(during.length).toBeLessThanOrEqual(1);
      expect(await store.list()).toHaveLength(0);
    } finally {
      store.unwatch();
    }
  });
});
