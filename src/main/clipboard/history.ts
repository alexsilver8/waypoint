import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { debounce, readJsonFile, writeJsonFile } from '../json-file';
import {
  type ClipboardImageInfo,
  clipboardImageKey,
  IMAGE_LIMITS,
  IMAGES_FOLDER,
  imageFileNames,
  imageFilesOf,
  imageHash,
  isImageHash,
  keepWithinLimits,
  MAX_IMAGE_BYTES,
  thumbnailSize,
} from './images';

export interface ClipboardEntry {
  id: string;
  /** The copied text; empty for an image. */
  text: string;
  /** For a copied image, kept as a PNG file in the images folder. */
  image?: ClipboardImageInfo;
  /** Epoch milliseconds. */
  copiedAt: number;
}

/** An image on the clipboard. Decoding it costs more than reading it, so that waits until it's new. */
export interface ClipboardImage {
  /** As the clipboard holds it. */
  png: Uint8Array;
  /** Its size and pixels, or `undefined` if it isn't an image after all. */
  decode(): DecodedImage | undefined;
}

export interface DecodedImage {
  width: number;
  height: number;
  bitmap: Uint8Array;
  /** The image scaled to `size`, as a PNG. */
  thumbnail(size: { width: number; height: number }): Uint8Array;
}

/** What the history needs from the system clipboard; injected so it can be tested without Electron. */
export interface ClipboardSource {
  readText(): Promise<string>;
  /** The image on the clipboard, if there is one. */
  readImage(): Promise<ClipboardImage | undefined>;
  /** Puts the PNG file at `path` on the clipboard. */
  writeImage(path: string): Promise<void>;
  /** Whether the app that copied the text asked for it not to be recorded (e.g. a password manager). */
  isConcealed(): Promise<boolean>;
}

const POLL_INTERVAL_MS = 750;
const MAX_ENTRY_LENGTH = 200_000;

/** What's on the clipboard, and the `key` that tells it from what was there before. */
interface Seen {
  key: string;
  text: string;
  image?: ClipboardImage;
}

/** Records text and images copied anywhere on the system and keeps the most recent entries. */
export class ClipboardHistory {
  private items: ClipboardEntry[];
  private lastSeen: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private polling = false;
  private keepImages = true;
  private readonly imagesDir: string;
  private readonly save = debounce(() => this.persist(), 1000);

  constructor(
    private readonly path: string,
    private readonly source: ClipboardSource,
    private maxItems: number,
    private readonly now: () => number = Date.now,
  ) {
    this.imagesDir = join(dirname(path), IMAGES_FOLDER);
    this.items = this.load();
    this.removeUnusedImages();
  }

  entries(): readonly ClipboardEntry[] {
    return this.items;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    // Don't record whatever was already on the clipboard before we started.
    this.lastSeen = (await this.read())?.key;
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  setMaxItems(maxItems: number): void {
    this.maxItems = maxItems;
    this.update(this.items);
  }

  /** Whether to record images as well as text. Turning it off keeps the images already saved. */
  setKeepImages(keepImages: boolean): void {
    this.keepImages = keepImages;
  }

  /** Checks the clipboard once; called on an interval while running. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const seen = await this.read();
      if (seen === undefined || seen.key === this.lastSeen) return;
      this.lastSeen = seen.key;
      if (await this.source.isConcealed().catch(() => false)) return;
      if (seen.image) await this.addImage(seen.image);
      else this.add(seen.text);
    } finally {
      this.polling = false;
    }
  }

  /** Takes `text` as seen already, so Waypoint putting it on the clipboard doesn't add it. */
  ignore(text: string): void {
    this.lastSeen = text;
  }

  add(text: string): void {
    if (!text.trim() || text.length > MAX_ENTRY_LENGTH) return;
    this.update([{ id: randomUUID(), text, copiedAt: this.now() }, ...this.items.filter((item) => item.text !== text)]);
  }

  /** The image entry's file and thumbnail, as absolute paths. */
  imageFiles(entry: ClipboardEntry): { image: string; thumbnail: string } | undefined {
    if (!entry.image) return undefined;
    const { image, thumbnail } = imageFileNames(entry.image.hash);
    return { image: join(this.imagesDir, image), thumbnail: join(this.imagesDir, thumbnail) };
  }

  /** Puts an image entry back on the clipboard and makes it the newest. False if it's gone. */
  async copyImage(id: string): Promise<boolean> {
    const entry = this.items.find((item) => item.id === id);
    const files = entry && this.imageFiles(entry);
    if (!entry || !files) return false;
    await this.source.writeImage(files.image);
    // What the clipboard gives back is encoded afresh, so it's read rather than worked out.
    this.lastSeen = (await this.read())?.key;
    this.update([{ ...entry, copiedAt: this.now() }, ...this.items.filter((item) => item !== entry)]);
    return true;
  }

  remove(id: string): void {
    this.update(this.items.filter((item) => item.id !== id));
  }

  clear(): void {
    this.update([]);
  }

  flush(): void {
    this.save.flush();
  }

  /**
   * Keeps what fits of `next` and saves it. Image files nothing keeps any more, whether removed
   * or never kept, are deleted straight away, so a picture you delete doesn't linger on disk.
   */
  private update(next: ClipboardEntry[]): void {
    const kept = keepWithinLimits(next, { maxItems: this.maxItems, ...IMAGE_LIMITS });
    const keptFiles = imageFilesOf(kept);
    for (const file of imageFilesOf([...this.items, ...next])) {
      if (!keptFiles.has(file)) this.removeImageFile(file);
    }
    this.items = kept;
    this.save();
  }

  private async addImage(image: ClipboardImage): Promise<void> {
    if (image.png.length > MAX_IMAGE_BYTES) return;
    const decoded = image.decode();
    if (!decoded) return;
    const { width, height } = decoded;
    const hash = imageHash(width, height, decoded.bitmap);
    const copiedAt = this.now();
    const same = this.items.find((item) => item.image?.hash === hash);
    if (same) {
      // Copied again: its files are there already.
      this.update([{ ...same, id: randomUUID(), copiedAt }, ...this.items.filter((item) => item !== same)]);
      return;
    }
    const files = imageFileNames(hash);
    try {
      await mkdir(this.imagesDir, { recursive: true });
      await writeFile(join(this.imagesDir, files.image), image.png);
      await writeFile(join(this.imagesDir, files.thumbnail), decoded.thumbnail(thumbnailSize(width, height)));
    } catch (error) {
      console.error('[clipboard] Could not save image:', error);
      return;
    }
    const entry: ClipboardEntry = {
      id: randomUUID(),
      text: '',
      image: { hash, width, height, bytes: image.png.length },
      copiedAt,
    };
    this.update([entry, ...this.items]);
  }

  /** What's on the clipboard now. Text comes first: apps that copy text often add a picture of it. */
  private async read(): Promise<Seen | undefined> {
    const text = await this.safeRead();
    if (text === undefined) return undefined;
    if (text.trim() || !this.keepImages) return { key: text, text };
    const image = await this.source.readImage().catch(() => undefined);
    return image ? { key: clipboardImageKey(image.png), text, image } : { key: text, text };
  }

  private async safeRead(): Promise<string | undefined> {
    try {
      return await this.source.readText();
    } catch {
      return undefined;
    }
  }

  private load(): ClipboardEntry[] {
    try {
      const data = readJsonFile(this.path);
      if (!Array.isArray(data)) return [];
      return data.filter(
        (item): item is ClipboardEntry =>
          typeof item?.id === 'string' &&
          typeof item.text === 'string' &&
          typeof item.copiedAt === 'number' &&
          (item.image === undefined || this.isSavedImage(item.image)),
      );
    } catch {
      return [];
    }
  }

  /** Whether an image read from the history file is well-formed and its file still there. */
  private isSavedImage(image: Partial<ClipboardImageInfo>): boolean {
    return (
      isImageHash(image.hash) &&
      typeof image.width === 'number' &&
      typeof image.height === 'number' &&
      typeof image.bytes === 'number' &&
      existsSync(join(this.imagesDir, imageFileNames(image.hash).image))
    );
  }

  /** Clears out images the history no longer has, e.g. ones saved just before Waypoint quit. */
  private removeUnusedImages(): void {
    let files: string[];
    try {
      files = readdirSync(this.imagesDir);
    } catch {
      return;
    }
    const used = imageFilesOf(this.items);
    for (const file of files) if (!used.has(file)) this.removeImageFile(file);
  }

  private removeImageFile(file: string): void {
    try {
      rmSync(join(this.imagesDir, file), { force: true });
    } catch (error) {
      console.error('[clipboard] Could not delete image:', error);
    }
  }

  private persist(): void {
    try {
      writeJsonFile(this.path, this.items);
    } catch (error) {
      console.error('[clipboard] Could not save history:', error);
    }
  }
}
