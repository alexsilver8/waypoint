import { describe, expect, it } from 'vitest';
import {
  expandPlaceholders,
  findPlaceholders,
  formatDate,
  offsetDate,
  placeholderList,
  valuesWithClipboard,
} from './placeholders';

// Sunday 18 October 2026, 14:05:09 local time.
const now = new Date(2026, 9, 18, 14, 5, 9);

describe('findPlaceholders', () => {
  it('finds the placeholders and their options, and nothing else in braces', () => {
    expect(findPlaceholders('https://x.com/{argument name="term" default="cats"}?d={date}&j={"a":1}')).toEqual([
      { name: 'argument', options: { name: 'term', default: 'cats' } },
      { name: 'date', options: {} },
    ]);
    expect(findPlaceholders('{selection} {Argument} {argument')).toEqual([]);
  });
});

describe('placeholderList', () => {
  it('writes the placeholders out as a hint says them', () => {
    expect(placeholderList(['clipboard', 'date', 'uuid'])).toBe('{clipboard}, {date} and {uuid}');
    expect(placeholderList(['date'])).toBe('{date}');
    expect(placeholderList([])).toBe('');
  });
});

describe('expandPlaceholders', () => {
  it('fills in each kind', () => {
    const text = '{argument}|{clipboard}|{uuid}|{date format="yyyy-MM-dd"}|{time format="HH:mm"}';
    expect(expandPlaceholders(text, { argument: 'hi', clipboard: () => 'copied', now, uuid: () => 'u-1' })).toBe(
      'hi|copied|u-1|2026-10-18|14:05',
    );
  });

  it('uses the locale for dates and times without a format', () => {
    const values = { now, locale: 'en-GB' };
    expect(expandPlaceholders('{date}', values)).toBe('18 Oct 2026');
    expect(expandPlaceholders('{time}', values)).toBe('14:05');
    expect(expandPlaceholders('{datetime}', values)).toBe('18 Oct 2026, 14:05');
  });

  it('falls back to the system locale when the one given is malformed', () => {
    expect(() => expandPlaceholders('{date}', { now, locale: 'not a locale!' })).not.toThrow();
  });

  it('moves dates by an offset', () => {
    expect(expandPlaceholders('{date format="yyyy-MM-dd" offset="+1d"}', { now })).toBe('2026-10-19');
    expect(expandPlaceholders('{datetime format="d MMM HH:mm" offset="-1w +2h"}', { now, locale: 'en-GB' })).toBe(
      '11 Oct 16:05',
    );
    // An offset it can't read, or one past the dates there are, leaves the placeholder as written.
    expect(expandPlaceholders('Due {date format="yyyy-MM-dd" offset="tomorrow"}', { now })).toBe(
      'Due {date format="yyyy-MM-dd" offset="tomorrow"}',
    );
    expect(expandPlaceholders('{date offset="+300000y"} and {date format="yyyy" offset="+1y"}', { now })).toBe(
      '{date offset="+300000y"} and 2027',
    );
    expect(expandPlaceholders('{datetime format="MMMM" offset="-99999999999999999999d"}', { now })).toBe(
      '{datetime format="MMMM" offset="-99999999999999999999d"}',
    );
  });

  it('uses the default of {argument} when nothing was typed', () => {
    expect(expandPlaceholders('q={argument default="news"}', {})).toBe('q=news');
    expect(expandPlaceholders('q={argument default="news"}', { argument: 'cats' })).toBe('q=cats');
    expect(expandPlaceholders('q={argument}', {})).toBe('q=');
  });

  it('reads the clipboard once, and only when it is used', () => {
    let reads = 0;
    const clipboard = () => {
      reads += 1;
      return 'x';
    };
    expect(expandPlaceholders('{clipboard}{clipboard}', { clipboard })).toBe('xx');
    expect(reads).toBe(1);
    expandPlaceholders('{date}', { clipboard });
    expect(reads).toBe(1);
  });

  it('makes a new uuid for each {uuid}', () => {
    const [a, b] = expandPlaceholders('{uuid} {uuid}').split(' ');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it('leaves out placeholders it was not asked to fill in, and encodes values', () => {
    expect(expandPlaceholders('{argument} {clipboard}', { clipboard: () => 'a b' }, { names: ['clipboard'] })).toBe(
      '{argument} a b',
    );
    expect(expandPlaceholders('/search?q={argument}', { argument: 'a&b c' }, { encode: encodeURIComponent })).toBe(
      '/search?q=a%26b%20c',
    );
    // Text that can't be percent-encoded, like half of an emoji, leaves the placeholder as written.
    expect(
      expandPlaceholders(
        '/q={clipboard}&d={date format="yyyy"}',
        { clipboard: () => '\ud83d', now },
        { encode: encodeURIComponent },
      ),
    ).toBe('/q={clipboard}&d=2026');
  });

  it('can show placeholders it leaves out some other way', () => {
    expect(
      expandPlaceholders(
        '{argument name="q"} {uuid}',
        { uuid: () => 'u' },
        {
          names: ['uuid'],
          unfilled: (placeholder) => `<${placeholder.options.name}>`,
        },
      ),
    ).toBe('<q> u');
  });

  it('keeps JSON and other braces as they are', () => {
    expect(expandPlaceholders('{"name": "{clipboard}"} {cursor}', { clipboard: () => 'Ada' })).toBe(
      '{"name": "Ada"} {cursor}',
    );
  });
});

describe('formatDate', () => {
  it('formats every token', () => {
    expect(formatDate(now, 'yyyy yy MMMM MMM MM M dd d EEEE EEE', 'en-US')).toBe(
      '2026 26 October Oct 10 10 18 18 Sunday Sun',
    );
    expect(formatDate(now, 'HH H hh h mm ss a', 'en-US')).toBe('14 14 02 2 05 09 PM');
    expect(formatDate(new Date(2026, 0, 5, 0, 7), 'h:mm a, d/M')).toBe('12:07 AM, 5/1');
  });

  it('keeps quoted text', () => {
    expect(formatDate(now, "EEEE 'at' HH:mm, 'o''clock' ''", 'en-US')).toBe("Sunday at 14:05, o'clock '");
  });
});

describe('offsetDate', () => {
  it('reads years, months, weeks, days, hours and minutes', () => {
    expect(offsetDate(now, '+1y-1M')?.toISOString()).toBe(new Date(2027, 8, 18, 14, 5, 9).toISOString());
    expect(offsetDate(now, '2w 3d')?.getDate()).toBe(4);
    expect(offsetDate(now, '-90m')?.getHours()).toBe(12);
    expect(offsetDate(now, '+1x')).toBeNull();
    // Past what a Date can hold.
    expect(offsetDate(now, '+300000y')).toBeNull();
    expect(offsetDate(now, '-9999999999999999w')).toBeNull();
  });
});

describe('valuesWithClipboard', () => {
  it('reads the clipboard first, only when a text uses it', async () => {
    let reads = 0;
    const read = async () => {
      reads += 1;
      return 'copied';
    };
    expect(await valuesWithClipboard(['{date}', 'plain'], read)).toEqual({});
    const values = await valuesWithClipboard(['{date}', 'Re: {clipboard}'], read);
    expect(expandPlaceholders('{clipboard}', values)).toBe('copied');
    expect(reads).toBe(1);
  });

  it('fills in nothing when the clipboard can’t be read', async () => {
    const values = await valuesWithClipboard(['{clipboard}'], () => Promise.reject(new Error('busy')));
    expect(expandPlaceholders('[{clipboard}]', values)).toBe('[]');
  });
});
