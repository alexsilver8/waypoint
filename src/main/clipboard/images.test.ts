import { describe, expect, it } from 'vitest';
import {
  type ClipboardImageInfo,
  clipboardImageKey,
  imageFileNames,
  imageFilesOf,
  imageHash,
  imageTitle,
  isImageHash,
  keepWithinLimits,
  thumbnailSize,
} from './images';

const pixels = (...values: number[]) => new Uint8Array(values);

interface Entry {
  id: string;
  image?: ClipboardImageInfo;
}

const text = (id: string): Entry => ({ id });

function image(hash: string, bytes = 1000): Entry {
  return { id: hash, image: { hash, width: 10, height: 10, bytes } };
}

describe('imageHash', () => {
  it('is the same for the same pixels and size, and a valid file name', () => {
    const hash = imageHash(2, 1, pixels(1, 2, 3, 4, 5, 6, 7, 8));
    expect(imageHash(2, 1, pixels(1, 2, 3, 4, 5, 6, 7, 8))).toBe(hash);
    expect(isImageHash(hash)).toBe(true);
  });

  it('tells apart different pixels, and the same pixels in another shape', () => {
    const bitmap = pixels(1, 2, 3, 4, 5, 6, 7, 8);
    expect(imageHash(2, 1, bitmap)).not.toBe(imageHash(2, 1, pixels(1, 2, 3, 4, 5, 6, 7, 9)));
    expect(imageHash(2, 1, bitmap)).not.toBe(imageHash(1, 2, bitmap));
  });
});

describe('clipboardImageKey', () => {
  it('can’t be mistaken for the same text', () => {
    expect(clipboardImageKey(pixels(1, 2))).toMatch(/^image:[0-9a-f]{64}$/);
    expect(clipboardImageKey(pixels(1, 2))).not.toBe(clipboardImageKey(pixels(2, 1)));
  });
});

describe('isImageHash', () => {
  it('only takes what imageHash makes, so a hand-edited history can’t name other files', () => {
    expect(isImageHash('../../secret')).toBe(false);
    expect(isImageHash('ABC')).toBe(false);
    expect(isImageHash(42)).toBe(false);
    expect(isImageHash('a'.repeat(64))).toBe(true);
  });
});

describe('imageFileNames', () => {
  it('names the image and its thumbnail after the hash', () => {
    expect(imageFileNames('abc')).toEqual({ image: 'abc.png', thumbnail: 'abc.thumb.png' });
  });
});

describe('imageTitle', () => {
  it('says the size', () => {
    expect(imageTitle({ width: 1280, height: 720 })).toBe('Image (1280×720)');
  });
});

describe('thumbnailSize', () => {
  it('fits the longer side and keeps the shape', () => {
    expect(thumbnailSize(1280, 720, 96)).toEqual({ width: 96, height: 54 });
    expect(thumbnailSize(300, 3000, 96)).toEqual({ width: 10, height: 96 });
  });

  it('leaves small images and slivers usable', () => {
    expect(thumbnailSize(20, 10, 96)).toEqual({ width: 20, height: 10 });
    expect(thumbnailSize(10_000, 1, 96)).toEqual({ width: 96, height: 1 });
  });
});

describe('keepWithinLimits', () => {
  const limits = { maxItems: 10, maxImages: 2, maxTotalBytes: 5000 };

  it('keeps at most maxItems entries, newest first', () => {
    const entries = [text('a'), image('b'), text('c')];
    expect(keepWithinLimits(entries, { ...limits, maxItems: 2 })).toEqual([text('a'), image('b')]);
  });

  it('drops older images beyond maxImages, but not the text around them', () => {
    const entries = [image('1'), text('text'), image('2'), image('3'), text('older text')];
    expect(keepWithinLimits(entries, limits)).toEqual([image('1'), text('text'), image('2'), text('older text')]);
  });

  it('drops older images once their files would add up to too much', () => {
    const entries = [image('1', 3000), image('2', 3000), image('3', 1000)];
    expect(keepWithinLimits(entries, limits)).toEqual([image('1', 3000), image('3', 1000)]);
  });
});

describe('imageFilesOf', () => {
  it('lists each image’s file and thumbnail', () => {
    expect(imageFilesOf([image('a'), text('text')])).toEqual(new Set(['a.png', 'a.thumb.png']));
  });
});
