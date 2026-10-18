import { describe, expect, it } from 'vitest';
import { scoreItem } from './search';
import { isAbbreviation, matchTitleAndText } from './title-and-text';

const github = { title: 'GitHub Search' };

describe('matchTitleAndText', () => {
  it('splits a search into the words that match the title and the text after them', () => {
    expect(matchTitleAndText('gh waypoint', github)).toMatchObject({ text: 'waypoint', titlePositions: [0, 3] });
    expect(matchTitleAndText('  github   rust lifetimes ', github)).toMatchObject({ text: 'rust lifetimes' });
  });

  it('takes as much of the title as matches well', () => {
    expect(matchTitleAndText('github search cats', github)?.text).toBe('cats');
    expect(matchTitleAndText('gh search cats', github)?.text).toBe('cats');
  });

  it('wants the title’s start or initials, not letters scattered through it', () => {
    expect(matchTitleAndText('gs cats', github)?.text).toBe('cats');
    expect(matchTitleAndText('ih cats', github)).toBeNull();
    expect(matchTitleAndText('i love you', github)).toBeNull();
    expect(matchTitleAndText('search notes', { title: 'Docs Search' })).toBeNull();
  });

  it('counts the text as matched, so initials beat scattered matches of the whole search', () => {
    // "Set Up Waypoint" matches all of "gh waypoint": "gh" in "walkthrough", "waypoint" in its title.
    const setUp = { title: 'Set Up Waypoint', keywords: ['walkthrough'] };
    const whole = scoreItem('gh waypoint', setUp)?.score ?? 0;
    expect(whole).toBeGreaterThan(0);
    expect(matchTitleAndText('gh waypoint', github)?.score).toBeGreaterThan(whole);
    // Something the whole search names exactly still comes first.
    const exact = scoreItem('search notes', { title: 'Search Notes' })?.score ?? 0;
    expect(matchTitleAndText('search notes', { title: 'Search Wikipedia' })?.score).toBeLessThan(exact);
    expect(matchTitleAndText('search notes', { title: 'Search' })?.score).toBeLessThan(exact);
  });

  it('needs both a match and some text', () => {
    expect(matchTitleAndText('gh', github)).toBeNull();
    expect(matchTitleAndText('gh ', github)).toBeNull();
    expect(matchTitleAndText('zz waypoint', github)).toBeNull();
    expect(matchTitleAndText('', github)).toBeNull();
  });
});

describe('isAbbreviation', () => {
  it('accepts word starts, capitals after small letters and runs', () => {
    expect(isAbbreviation('GitHub Search', [0, 3])).toBe(true);
    expect(isAbbreviation('GitHub Search', [0, 1, 2, 3, 4, 5])).toBe(true);
    expect(isAbbreviation('my-docs', [0, 3, 4])).toBe(true);
    expect(isAbbreviation('GitHub Search', [1, 3])).toBe(false);
    expect(isAbbreviation('Docs Search', [5, 6, 7, 8, 9, 10])).toBe(false);
    expect(isAbbreviation('GitHub Search', [])).toBe(false);
  });
});
