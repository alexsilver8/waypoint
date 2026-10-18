import { describe, expect, it } from 'vitest';
import { formatBytes } from './bytes';

describe('formatBytes', () => {
  it('uses decimal units with one decimal under 100', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1_234_567)).toBe('1.2 MB');
    expect(formatBytes(240_000_000_000)).toBe('240 GB');
  });

  it('stops at terabytes', () => {
    expect(formatBytes(5_000_000_000_000_000)).toBe('5000 TB');
  });
});
