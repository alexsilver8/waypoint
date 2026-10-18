/**
 * Reads the .tar.gz files extensions come in: npm's packages and GitHub's archives of a commit.
 * Only files and folders are kept; links, devices and anything that would land outside the
 * folder it's unpacked into are left out or refused.
 */
import { gunzipSync } from 'node:zlib';

export class TarError extends Error {}

export interface TarFile {
  /** Relative to the archive's top folder, with `/` between parts; see `entryPath`. */
  path: string;
  data: Buffer;
  /** Whether it's marked as a program, like a script an extension runs. */
  executable: boolean;
}

/** What one archive may hold: plenty for any extension, but not a disk's worth. */
export const TAR_LIMITS = { files: 20_000, bytes: 200 * 1024 * 1024 };

const BLOCK = 512;

/**
 * Where an entry goes, relative to the folder it's unpacked into, or `undefined` for the top
 * folder itself. npm packs everything under `package/` and GitHub under `<owner>-<repo>-<commit>/`,
 * so the first part is dropped. Throws for a path that would leave the folder: absolute, with a
 * drive letter, or with `..` in it, written with either kind of slash.
 */
export function entryPath(name: string): string | undefined {
  if (name.includes('\0')) throw new TarError('The archive has a file with a broken name.');
  if (/^[\\/]/.test(name) || /^[A-Za-z]:/.test(name)) {
    throw new TarError(`The archive has a file outside its folder: ${name}`);
  }
  const parts = name.split(/[\\/]+/).filter((part) => part !== '' && part !== '.');
  // A colon is a drive, or a stream of a file, on Windows.
  if (parts.some((part) => part === '..' || part.includes(':'))) {
    throw new TarError(`The archive has a file outside its folder: ${name}`);
  }
  const inside = parts.slice(1);
  return inside.length > 0 ? inside.join('/') : undefined;
}

function field(header: Buffer, start: number, length: number): string {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString('utf8');
}

/** A number in a header: octal text, or big-endian binary when the first byte's top bit is set. */
function number(header: Buffer, start: number, length: number): number {
  if ((header[start] ?? 0) & 0x80) {
    let value = 0;
    for (let i = start + 1; i < start + length; i++) value = value * 256 + (header[i] ?? 0);
    return value;
  }
  const text = field(header, start, length).trim();
  return text ? Number.parseInt(text, 8) : 0;
}

function checksumMatches(header: Buffer): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0);
  return sum === number(header, 148, 8);
}

/** A pax header's `<length> <key>=<value>\n` records. */
function paxRecords(data: Buffer): Record<string, string> {
  const records: Record<string, string> = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(data.subarray(offset, space).toString('utf8'), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return records;
}

/** The files in a .tar.gz (or a plain .tar), checked as `entryPath` says. */
export function readTarball(archive: Buffer, limits = TAR_LIMITS): TarFile[] {
  let tar: Buffer;
  try {
    tar = archive[0] === 0x1f && archive[1] === 0x8b ? gunzipSync(archive, { maxOutputLength: limits.bytes }) : archive;
  } catch (error) {
    throw new TarError(`The archive couldn't be unpacked: ${error instanceof Error ? error.message : error}`);
  }
  const files: TarFile[] = [];
  let longName: string | undefined;
  let pax: Record<string, string> = {};
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    // Two empty blocks end the archive; one is enough to stop.
    if (header.every((byte) => byte === 0)) break;
    if (!checksumMatches(header)) throw new TarError("The archive is damaged, or isn't a tar archive.");
    const type = String.fromCharCode(header[156] ?? 0);
    const size = pax.size ? Number(pax.size) : number(header, 124, 12);
    const start = offset + BLOCK;
    if (!Number.isSafeInteger(size) || size < 0 || start + size > tar.length) {
      throw new TarError('The archive ends early.');
    }
    const data = tar.subarray(start, start + size);
    offset = start + Math.ceil(size / BLOCK) * BLOCK;

    // Headers that describe the next entry.
    if (type === 'x') {
      pax = paxRecords(data);
      continue;
    }
    if (type === 'L') {
      longName = field(data, 0, data.length);
      continue;
    }
    if (type === 'g' || type === 'K') continue;

    const prefix = field(header, 345, 155);
    const name = pax.path ?? longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    const mode = number(header, 100, 8);
    longName = undefined;
    pax = {};
    // Folders are made for the files in them, but are checked all the same.
    const path = entryPath(name);
    // Plain files only (`0`, the old `\0`, and `7`): no links or devices.
    if (type !== '0' && type !== '\0' && type !== '7') continue;
    if (!path) continue;
    files.push({ path, data: Buffer.from(data), executable: (mode & 0o111) !== 0 });
    if (files.length > limits.files) throw new TarError(`The archive has more than ${limits.files} files.`);
  }
  return files;
}
