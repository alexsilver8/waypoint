import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));

const { exportFileName } = await import('./ipc');

describe('exportFileName', () => {
  it('names the file after the note, without characters a system refuses', () => {
    expect(exportFileName('Launch plan')).toBe('Launch plan');
    expect(exportFileName('Q3: plans / ideas?')).toBe('Q3 plans ideas');
    expect(exportFileName('...hidden')).toBe('hidden');
    expect(exportFileName('  ')).toBe('Note');
    expect(exportFileName('x'.repeat(300))).toHaveLength(100);
  });
});
