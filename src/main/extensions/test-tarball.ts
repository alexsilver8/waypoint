/** For tests: builds .tar.gz files the way npm and GitHub do, and ones they never would. */
import { gzipSync } from 'node:zlib';

export interface TestEntry {
  name: string;
  /** `0` a file (the default), `5` a folder, `2` a symlink, `x` a pax header, `g` a global one. */
  type?: string;
  data?: string | Buffer;
  mode?: number;
  linkname?: string;
}

function header({ name, type = '0', mode = 0o644, linkname = '' }: TestEntry, size: number): Buffer {
  const block = Buffer.alloc(512);
  block.write(name.slice(0, 100), 0, 'utf8');
  block.write(`${mode.toString(8).padStart(7, '0')}\0`, 100, 'ascii');
  block.write('0000000\0', 108, 'ascii');
  block.write('0000000\0', 116, 'ascii');
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
  block.write('00000000000\0', 136, 'ascii');
  block.write(type, 156, 'ascii');
  block.write(linkname, 157, 'utf8');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
}

/** A pax record, `<length> <key>=<value>\n`, whose length counts itself. */
export function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (`${length}${body}`.length !== length) length++;
  return `${length}${body}`;
}

export function tarball(entries: TestEntry[], { gzip = true } = {}): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '');
    blocks.push(header(entry, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  const tar = Buffer.concat(blocks);
  return gzip ? gzipSync(tar) : tar;
}
