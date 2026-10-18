import { createHash } from 'node:crypto';

/** A copied image, as the history keeps it: a PNG file named after `hash` in the images folder. */
export interface ClipboardImageInfo {
  /** Of its size and pixels, so the same picture copied twice is one entry however it was encoded. */
  hash: string;
  width: number;
  height: number;
  /** Size of the PNG file. */
  bytes: number;
}

/** The folder, next to the history file, the images are kept in. */
export const IMAGES_FOLDER = 'clipboard-images';

/** Longer side of the small copy list rows show. They draw icons at 24 px: sharp up to 3× screens. */
export const THUMBNAIL_SIZE = 72;

export interface ImageLimits {
  /** Entries of any kind, as the settings say. */
  maxItems: number;
  /** Images, of those entries. */
  maxImages: number;
  /** All the images' files together. */
  maxTotalBytes: number;
}

/** Plenty of screenshots, without the folder growing past a few hundred megabytes. */
export const IMAGE_LIMITS: Omit<ImageLimits, 'maxItems'> = { maxImages: 100, maxTotalBytes: 500_000_000 };

/** Bigger images aren't kept at all: a photo straight off a camera, not a screenshot. */
export const MAX_IMAGE_BYTES = 25_000_000;

const sha256 = (...chunks: Array<string | Uint8Array>) => {
  const hash = createHash('sha256');
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest('hex');
};

export function imageHash(width: number, height: number, bitmap: Uint8Array): string {
  return sha256(`${width}x${height}:`, bitmap);
}

/** Tells what's on the clipboard from what was there before, without decoding it. */
export function clipboardImageKey(png: Uint8Array): string {
  return `image:${sha256(png)}`;
}

/** Whether a hash read back from disk is one `imageHash` made, so it can't name a file elsewhere. */
export function isImageHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** The image's file and its thumbnail's, in the images folder. */
export function imageFileNames(hash: string): { image: string; thumbnail: string } {
  return { image: `${hash}.png`, thumbnail: `${hash}.thumb.png` };
}

export function imageTitle({ width, height }: { width: number; height: number }): string {
  return `Image (${width}×${height})`;
}

/** Scales an image down to fit `max` on its longer side; smaller ones keep their size. */
export function thumbnailSize(width: number, height: number, max = THUMBNAIL_SIZE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The entries to keep, newest first: at most `maxItems` in all, and older images go once there
 * are `maxImages` newer ones or their files would add up to more than `maxTotalBytes`.
 */
export function keepWithinLimits<T extends { image?: ClipboardImageInfo }>(
  entries: readonly T[],
  { maxItems, maxImages, maxTotalBytes }: ImageLimits,
): T[] {
  const kept: T[] = [];
  let images = 0;
  let bytes = 0;
  for (const entry of entries) {
    if (kept.length >= maxItems) break;
    if (entry.image) {
      if (images >= maxImages || bytes + entry.image.bytes > maxTotalBytes) continue;
      images++;
      bytes += entry.image.bytes;
    }
    kept.push(entry);
  }
  return kept;
}

/** The names of the files `entries` keep in the images folder. */
export function imageFilesOf(entries: Iterable<{ image?: ClipboardImageInfo }>): Set<string> {
  const files = new Set<string>();
  for (const entry of entries) {
    if (!entry.image) continue;
    const { image, thumbnail } = imageFileNames(entry.image.hash);
    files.add(image).add(thumbnail);
  }
  return files;
}
