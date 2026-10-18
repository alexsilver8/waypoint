import { describe, expect, it } from 'vitest';
import { slashMatch } from './slash';

describe('slashMatch', () => {
  it('finds a / at the start of a line or after a space, with what follows it', () => {
    expect(slashMatch('/')).toEqual({ offset: 0, query: '' });
    expect(slashMatch('/head')).toEqual({ offset: 0, query: 'head' });
    expect(slashMatch('Groceries /che')).toEqual({ offset: 10, query: 'che' });
  });

  it('leaves slashes that are part of the text alone', () => {
    expect(slashMatch('and/or')).toBeNull();
    expect(slashMatch('https://example.com/')).toBeNull();
    expect(slashMatch('/heading 1')).toBeNull();
  });
});
