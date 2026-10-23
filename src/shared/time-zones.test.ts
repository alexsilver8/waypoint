import { describe, expect, it } from 'vitest';
import {
  answerTimeQuery,
  cityOf,
  describeDifference,
  findPlace,
  instantOf,
  parseClock,
  parseTimeQuery,
  type TimeQuery,
  zoneOffset,
} from './time-zones';

/** A Friday afternoon in Zurich: 14:14 UTC, 16:14 CEST, 23:14 in Tokyo, 10:14 in New York. */
const now = new Date('2026-10-23T14:14:00Z');
const zurich = 'Europe/Zurich';

const place = (text: string) => findPlace(text)?.zone;

describe('findPlace', () => {
  it.each([
    ['tokyo', 'Asia/Tokyo'],
    ['Tokyo', 'Asia/Tokyo'],
    ['new york', 'America/New_York'],
    ['New  York', 'America/New_York'],
    ['nyc', 'America/New_York'],
    ['dublin', 'Europe/Dublin'],
    ['zurich', 'Europe/Zurich'],
    ['zürich', 'Europe/Zurich'],
    ['geneva', 'Europe/Zurich'],
    ['são paulo', 'America/Sao_Paulo'],
    ['sao paulo', 'America/Sao_Paulo'],
    ['los angeles', 'America/Los_Angeles'],
    ['sf', 'America/Los_Angeles'],
    ['mumbai', 'Asia/Kolkata'],
    ['kolkata', 'Asia/Kolkata'],
    ['calcutta', 'Asia/Calcutta'],
    ['ho chi minh city', 'Asia/Ho_Chi_Minh'],
    ['utc', 'UTC'],
    ['GMT', 'UTC'],
    ['pst', 'America/Los_Angeles'],
    ['EST', 'America/New_York'],
    ['cet', 'Europe/Paris'],
    ['jst', 'Asia/Tokyo'],
    ['aest', 'Australia/Sydney'],
  ])('%j is %s', (text, zone) => {
    expect(place(text)).toBe(zone);
  });

  it.each([['machine'], ['go'], [''], ['the morning'], ['center'], ['wake'], ['usa'], ['pm'], ['in']])(
    '%j is no place',
    (text) => {
      expect(findPlace(text)).toBeNull();
    },
  );

  it('knows cities whatever the system calls their zone', () => {
    expect(zoneOffset(place('buenos aires') as string, now)).toBe(-180);
    expect(zoneOffset(place('argentina') as string, now)).toBe(-180);
    expect(zoneOffset(place('kyiv') as string, now)).toBe(180);
  });

  it('names cities as the zone does, and abbreviations with the city they are read as', () => {
    expect(findPlace('new york')?.name).toBe('New York');
    expect(findPlace('nyc')?.name).toBe('New York');
    expect(findPlace('mumbai')?.name).toBe('Kolkata');
    expect(findPlace('pst')).toEqual({ zone: 'America/Los_Angeles', name: 'Pacific Time (Los Angeles)' });
  });

  it('says how it read an abbreviation more than one zone uses', () => {
    expect(findPlace('cst')).toEqual({
      zone: 'America/Chicago',
      name: 'Central Time (Chicago)',
      note: 'CST taken as Central Time (Chicago)',
    });
    expect(findPlace('ist')?.note).toBe('IST taken as India Standard Time (Kolkata)');
    expect(findPlace('bst')?.zone).toBe('Europe/London');
  });
});

describe('parseClock', () => {
  it.each([
    ['3pm', { hour: 15, minute: 0 }],
    ['3 pm', { hour: 15, minute: 0 }],
    ['3PM', { hour: 15, minute: 0 }],
    ['3.30pm', { hour: 15, minute: 30 }],
    ['3:30 p.m.', { hour: 15, minute: 30 }],
    ['12am', { hour: 0, minute: 0 }],
    ['12pm', { hour: 12, minute: 0 }],
    ['12:30am', { hour: 0, minute: 30 }],
    ['15:00', { hour: 15, minute: 0 }],
    ['09:05', { hour: 9, minute: 5 }],
    ['0:00', { hour: 0, minute: 0 }],
    ['noon', { hour: 12, minute: 0 }],
    ['midnight', { hour: 0, minute: 0 }],
  ])('%j is %j', (text, clock) => {
    expect(parseClock(text)).toEqual(clock);
  });

  it.each([['3'], ['15'], ['24:00'], ['13pm'], ['0pm'], ['3:60'], ['3pm tokyo'], ['']])('%j is not a time', (text) => {
    expect(parseClock(text)).toBeNull();
  });
});

describe('parseTimeQuery', () => {
  const tokyo = { zone: 'Asia/Tokyo', name: 'Tokyo' };
  const london = { zone: 'Europe/London', name: 'London' };
  const newYork = { zone: 'America/New_York', name: 'New York' };

  it.each([
    ['time in tokyo', { time: null, from: null, to: tokyo }],
    ['Time in Tokyo', { time: null, from: null, to: tokyo }],
    ['time at tokyo', { time: null, from: null, to: tokyo }],
    ['time tokyo', { time: null, from: null, to: tokyo }],
    ['tokyo time', { time: null, from: null, to: tokyo }],
    ['tokyo time now', { time: null, from: null, to: tokyo }],
    ['current time in new york', { time: null, from: null, to: newYork }],
    ["what's the time in new york", { time: null, from: null, to: newYork }],
    ['what time is it in new york', { time: null, from: null, to: newYork }],
    ['new york time', { time: null, from: null, to: newYork }],
    ['3pm in tokyo', { time: { hour: 15, minute: 0 }, from: null, to: tokyo }],
    ['3 pm to tokyo', { time: { hour: 15, minute: 0 }, from: null, to: tokyo }],
    ['15:00 in tokyo', { time: { hour: 15, minute: 0 }, from: null, to: tokyo }],
    ['15:00 london in new york', { time: { hour: 15, minute: 0 }, from: london, to: newYork }],
    ['3pm london time in new york', { time: { hour: 15, minute: 0 }, from: london, to: newYork }],
    ['3pm in london to new york', { time: { hour: 15, minute: 0 }, from: london, to: newYork }],
    ['london 3pm in new york', { time: { hour: 15, minute: 0 }, from: london, to: newYork }],
    ['noon in tokyo', { time: { hour: 12, minute: 0 }, from: null, to: tokyo }],
    ['midnight london in tokyo', { time: { hour: 0, minute: 0 }, from: london, to: tokyo }],
  ])('%j', (input, expected) => {
    expect(parseTimeQuery(input)).toEqual(expected);
  });

  it('reads abbreviations on either side', () => {
    const query = parseTimeQuery('9am pst to cet') as TimeQuery;
    expect(query.time).toEqual({ hour: 9, minute: 0 });
    expect(query.from?.zone).toBe('America/Los_Angeles');
    expect(query.to.zone).toBe('Europe/Paris');
    expect(parseTimeQuery('time in utc')?.to.zone).toBe('UTC');
  });

  it.each([
    [''],
    ['time'],
    ['time machine'],
    ['screen time'],
    ['go to london'],
    ['flights to tokyo'],
    ['tokyo'],
    ['3 in tokyo'],
    ['3pm in the morning'],
    ['3pm'],
    ['3pm tokyo'],
    ['meet 5pm to 6pm'],
    ['5 km to mi'],
    ['10:30 in'],
    ['1 in 3'],
    ['time in usa'],
    ['nowhere 3pm in tokyo'],
  ])('%j is not a time question', (input) => {
    expect(parseTimeQuery(input)).toBeNull();
  });
});

describe('zoneOffset', () => {
  it('knows standard and daylight time', () => {
    expect(zoneOffset('Asia/Tokyo', now)).toBe(540);
    expect(zoneOffset('Europe/Zurich', now)).toBe(120);
    expect(zoneOffset('Europe/Zurich', new Date('2026-10-26T12:00:00Z'))).toBe(60);
    expect(zoneOffset('America/New_York', now)).toBe(-240);
    expect(zoneOffset('America/New_York', new Date('2026-11-02T12:00:00Z'))).toBe(-300);
    expect(zoneOffset('Asia/Kolkata', now)).toBe(330);
    expect(zoneOffset('UTC', now)).toBe(0);
  });
});

describe('instantOf', () => {
  it('finds the moment it is a given time on the day it is now there', () => {
    expect(instantOf({ hour: 15, minute: 0 }, 'Europe/London', now).toISOString()).toBe('2026-10-23T14:00:00.000Z');
    expect(instantOf({ hour: 9, minute: 0 }, 'America/Los_Angeles', now).toISOString()).toBe(
      '2026-10-23T16:00:00.000Z',
    );
    // Late on Friday evening in Tokyo, so "3pm in Tokyo" is earlier that day; on Saturday it's Saturday's.
    expect(instantOf({ hour: 15, minute: 0 }, 'Asia/Tokyo', now).toISOString()).toBe('2026-10-23T06:00:00.000Z');
    const saturdayInTokyo = new Date('2026-10-23T15:30:00Z');
    expect(instantOf({ hour: 15, minute: 0 }, 'Asia/Tokyo', saturdayInTokyo).toISOString()).toBe(
      '2026-10-24T06:00:00.000Z',
    );
  });

  it('works out daylight saving by the day, not the moment', () => {
    // Europe moves its clocks back on Sunday 25 October 2026, 03:00 → 02:00 CEST → CET.
    const saturday = new Date('2026-10-24T12:00:00Z');
    const sunday = new Date('2026-10-25T12:00:00Z');
    expect(instantOf({ hour: 15, minute: 0 }, zurich, saturday).toISOString()).toBe('2026-10-24T13:00:00.000Z');
    expect(instantOf({ hour: 15, minute: 0 }, zurich, sunday).toISOString()).toBe('2026-10-25T14:00:00.000Z');
    // Early on the Sunday, before the change, 3pm that day is still after it.
    const earlySunday = new Date('2026-10-24T23:30:00Z');
    expect(instantOf({ hour: 15, minute: 0 }, zurich, earlySunday).toISOString()).toBe('2026-10-25T14:00:00.000Z');
  });
});

describe('describeDifference', () => {
  it.each([
    [0, 'you', 'the same time as you'],
    [480, 'you', '8 hours ahead of you'],
    [-360, 'you', '6 hours behind you'],
    [60, 'London', '1 hour ahead of London'],
    [330, 'you', '5 hours 30 minutes ahead of you'],
    [-345, 'you', '5 hours 45 minutes behind you'],
    [45, 'you', '45 minutes ahead of you'],
  ])('%d minutes from %s: %s', (minutes, from, expected) => {
    expect(describeDifference(minutes, from)).toBe(expected);
  });
});

describe('answerTimeQuery', () => {
  const ask = (input: string, at = now, zone = zurich) => {
    const query = parseTimeQuery(input);
    if (!query) throw new Error(`Not a time question: ${input}`);
    return answerTimeQuery(query, at, zone);
  };

  it('tells the time somewhere now, with the day and how far ahead it is', () => {
    expect(ask('time in tokyo')).toMatchObject({
      time: '11:14 PM',
      day: 'Fri, Oct 23',
      zoneName: 'Japan Standard Time',
      fromName: 'Zurich',
      fromTime: '4:14 PM',
      fromDay: 'Fri, Oct 23',
      difference: '7 hours ahead of you',
      instant: now,
    });
    expect(ask('new york time')).toMatchObject({
      time: '10:14 AM',
      zoneName: 'Eastern Daylight Time',
      difference: '6 hours behind you',
    });
    expect(ask('time in mumbai').difference).toBe('3 hours 30 minutes ahead of you');
    expect(ask('time in paris').difference).toBe('the same time as you');
  });

  it('moves a time here to another place, into the next day when it is one', () => {
    expect(ask('3pm in tokyo')).toMatchObject({
      time: '10:00 PM',
      day: 'Fri, Oct 23',
      fromTime: '3:00 PM',
      fromDay: 'Fri, Oct 23',
      difference: '7 hours ahead of you',
    });
    expect(ask('9pm in tokyo')).toMatchObject({ time: '4:00 AM', day: 'Sat, Oct 24', fromDay: 'Fri, Oct 23' });
    expect(ask('3pm in sf')).toMatchObject({ time: '6:00 AM', day: 'Fri, Oct 23', difference: '9 hours behind you' });
  });

  it('moves a time between two other places', () => {
    expect(ask('15:00 london in new york')).toMatchObject({
      time: '10:00 AM',
      day: 'Fri, Oct 23',
      fromName: 'London',
      fromTime: '3:00 PM',
      difference: '5 hours behind London',
    });
    expect(ask('9am pst to cet')).toMatchObject({
      time: '6:00 PM',
      fromName: 'Pacific Time (Los Angeles)',
      fromTime: '9:00 AM',
      zoneName: 'Central European Summer Time',
      difference: '9 hours ahead of Pacific Time (Los Angeles)',
    });
  });

  it('uses the offsets on the day asked about, across a daylight saving change', () => {
    // The US changes its clocks a week after Europe: for that week New York is only 5 hours behind Zurich.
    const between = new Date('2026-10-28T12:00:00Z');
    expect(ask('time in new york', between).difference).toBe('5 hours behind you');
    expect(ask('time in new york', new Date('2026-11-04T12:00:00Z')).difference).toBe('6 hours behind you');
    // 9am in Los Angeles on the day Europe has changed and the US hasn't.
    expect(ask('9am pst to cet', between)).toMatchObject({
      time: '5:00 PM',
      zoneName: 'Central European Standard Time',
    });
  });

  it('formats for the locale it is given', () => {
    const query = parseTimeQuery('time in tokyo') as TimeQuery;
    expect(answerTimeQuery(query, now, zurich, 'en-GB')).toMatchObject({ time: '23:14', day: 'Fri 23 Oct' });
  });

  it('knows where "you" are from the local zone', () => {
    expect(ask('time in tokyo', now, 'America/New_York')).toMatchObject({
      fromName: 'New York',
      fromTime: '10:14 AM',
      difference: '13 hours ahead of you',
    });
    expect(ask('time in tokyo', now, 'UTC').fromName).toBe('UTC');
  });
});

describe('cityOf', () => {
  it('takes the last part of a zone, with spaces', () => {
    expect(cityOf('America/New_York')).toBe('New York');
    expect(cityOf('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(cityOf('UTC')).toBe('UTC');
  });
});
