/**
 * Times in other places for the launcher: "time in tokyo", "tokyo time", "3pm in tokyo",
 * "15:00 london in new york", "9am pst to cet". Places are the cities of the time zones the
 * system knows (`Intl.supportedValuesOf('timeZone')`), a few more names people use for them, and
 * the common abbreviations. Daylight saving comes from `Intl`, not tables of our own. Only a
 * known place counts, so "time machine" and "go to london" are still searches.
 */

export interface Place {
  /** The IANA time zone, like "Asia/Tokyo". */
  zone: string;
  /** Shown: "Tokyo", "Pacific Time (Los Angeles)". */
  name: string;
  /** For an abbreviation that means more than one zone: how it was read. */
  note?: string;
}

export interface ClockTime {
  hour: number;
  minute: number;
}

export interface TimeQuery {
  /** The time asked about, or `null` for now. */
  time: ClockTime | null;
  /** Where that time is read; `null` for here. */
  from: Place | null;
  to: Place;
}

export interface TimeAnswer {
  /** The time there: "10:14 PM". */
  time: string;
  /** The day there: "Fri, Oct 24". */
  day: string;
  /** What the zone is called then: "Japan Standard Time". */
  zoneName: string;
  /** Where the time was read: "Zurich", "Pacific Time (Los Angeles)". */
  fromName: string;
  fromTime: string;
  fromDay: string;
  /** "8 hours ahead of you", "5 hours behind London", "the same time as London". */
  difference: string;
  /** The moment the answer is about. */
  instant: Date;
}

/** Names for zones beyond the city in the zone's id: `[names..., zone, shown as]`. */
const ALIASES: Array<[...string[], string, string]> = [
  ['utc', 'gmt', 'zulu', 'z', 'UTC', 'UTC'],
  [
    'nyc',
    'new york city',
    'manhattan',
    'boston',
    'washington',
    'washington dc',
    'dc',
    'miami',
    'atlanta',
    'philadelphia',
    'America/New_York',
    'New York',
  ],
  [
    'la',
    'san francisco',
    'sf',
    'seattle',
    'san diego',
    'silicon valley',
    'california',
    'America/Los_Angeles',
    'Los Angeles',
  ],
  ['dallas', 'houston', 'austin', 'minneapolis', 'America/Chicago', 'Chicago'],
  ['salt lake city', 'America/Denver', 'Denver'],
  ['hawaii', 'Pacific/Honolulu', 'Honolulu'],
  ['alaska', 'America/Anchorage', 'Anchorage'],
  ['montreal', 'ottawa', 'America/Toronto', 'Toronto'],
  ['mexico', 'cdmx', 'America/Mexico_City', 'Mexico City'],
  ['brazil', 'brasil', 'sao paulo', 'rio', 'rio de janeiro', 'America/Sao_Paulo', 'São Paulo'],
  ['argentina', 'America/Argentina/Buenos_Aires', 'Buenos Aires'],
  ['uk', 'england', 'britain', 'manchester', 'edinburgh', 'glasgow', 'Europe/London', 'London'],
  ['ireland', 'cork', 'galway', 'Europe/Dublin', 'Dublin'],
  ['france', 'Europe/Paris', 'Paris'],
  ['germany', 'munich', 'frankfurt', 'hamburg', 'cologne', 'Europe/Berlin', 'Berlin'],
  ['switzerland', 'geneva', 'bern', 'basel', 'zuerich', 'Europe/Zurich', 'Zurich'],
  ['spain', 'barcelona', 'Europe/Madrid', 'Madrid'],
  ['italy', 'milan', 'Europe/Rome', 'Rome'],
  ['netherlands', 'holland', 'Europe/Amsterdam', 'Amsterdam'],
  ['portugal', 'porto', 'Europe/Lisbon', 'Lisbon'],
  ['sweden', 'Europe/Stockholm', 'Stockholm'],
  ['norway', 'Europe/Oslo', 'Oslo'],
  ['denmark', 'Europe/Copenhagen', 'Copenhagen'],
  ['finland', 'Europe/Helsinki', 'Helsinki'],
  ['poland', 'krakow', 'Europe/Warsaw', 'Warsaw'],
  ['austria', 'Europe/Vienna', 'Vienna'],
  ['belgium', 'Europe/Brussels', 'Brussels'],
  ['greece', 'Europe/Athens', 'Athens'],
  ['turkey', 'Europe/Istanbul', 'Istanbul'],
  ['russia', 'Europe/Moscow', 'Moscow'],
  ['ukraine', 'kyiv', 'Europe/Kyiv', 'Kyiv'],
  ['israel', 'tel aviv', 'Asia/Jerusalem', 'Jerusalem'],
  ['uae', 'abu dhabi', 'Asia/Dubai', 'Dubai'],
  ['saudi arabia', 'Asia/Riyadh', 'Riyadh'],
  ['egypt', 'Africa/Cairo', 'Cairo'],
  ['south africa', 'cape town', 'Africa/Johannesburg', 'Johannesburg'],
  ['nigeria', 'Africa/Lagos', 'Lagos'],
  ['kenya', 'Africa/Nairobi', 'Nairobi'],
  [
    'india',
    'kolkata',
    'mumbai',
    'bombay',
    'delhi',
    'new delhi',
    'bangalore',
    'bengaluru',
    'hyderabad',
    'chennai',
    'Asia/Kolkata',
    'Kolkata',
  ],
  ['pakistan', 'Asia/Karachi', 'Karachi'],
  ['china', 'beijing', 'shenzhen', 'Asia/Shanghai', 'Shanghai'],
  ['japan', 'osaka', 'kyoto', 'Asia/Tokyo', 'Tokyo'],
  ['korea', 'south korea', 'Asia/Seoul', 'Seoul'],
  ['taiwan', 'Asia/Taipei', 'Taipei'],
  ['thailand', 'Asia/Bangkok', 'Bangkok'],
  ['vietnam', 'hanoi', 'ho chi minh', 'ho chi minh city', 'saigon', 'Asia/Ho_Chi_Minh', 'Ho Chi Minh City'],
  ['indonesia', 'bali', 'Asia/Jakarta', 'Jakarta'],
  ['philippines', 'Asia/Manila', 'Manila'],
  ['malaysia', 'Asia/Kuala_Lumpur', 'Kuala Lumpur'],
  ['australia', 'canberra', 'Australia/Sydney', 'Sydney'],
  ['new zealand', 'wellington', 'Pacific/Auckland', 'Auckland'],
];

/** Words the zone list has as places that people mean as words. */
const NOT_PLACES = new Set(['center', 'general', 'christmas', 'easter', 'wake', 'oral', 'knox', 'canary']);

/** Abbreviations: the zone they're read as, what to call it, and whether other zones use it too. */
const ABBREVIATIONS: Record<string, [zone: string, name: string, ambiguous?: boolean]> = {
  pst: ['America/Los_Angeles', 'Pacific Time'],
  pdt: ['America/Los_Angeles', 'Pacific Time'],
  pt: ['America/Los_Angeles', 'Pacific Time'],
  mst: ['America/Denver', 'Mountain Time'],
  mdt: ['America/Denver', 'Mountain Time'],
  mt: ['America/Denver', 'Mountain Time'],
  cst: ['America/Chicago', 'Central Time', true],
  cdt: ['America/Chicago', 'Central Time'],
  ct: ['America/Chicago', 'Central Time'],
  est: ['America/New_York', 'Eastern Time'],
  edt: ['America/New_York', 'Eastern Time'],
  et: ['America/New_York', 'Eastern Time'],
  ast: ['America/Halifax', 'Atlantic Time', true],
  adt: ['America/Halifax', 'Atlantic Time'],
  akst: ['America/Anchorage', 'Alaska Time'],
  akdt: ['America/Anchorage', 'Alaska Time'],
  hst: ['Pacific/Honolulu', 'Hawaii Time'],
  wet: ['Europe/Lisbon', 'Western European Time'],
  west: ['Europe/Lisbon', 'Western European Time'],
  bst: ['Europe/London', 'British Summer Time', true],
  ist: ['Asia/Kolkata', 'India Standard Time', true],
  cet: ['Europe/Paris', 'Central European Time'],
  cest: ['Europe/Paris', 'Central European Time'],
  eet: ['Europe/Athens', 'Eastern European Time'],
  eest: ['Europe/Athens', 'Eastern European Time'],
  msk: ['Europe/Moscow', 'Moscow Time'],
  gst: ['Asia/Dubai', 'Gulf Standard Time'],
  pkt: ['Asia/Karachi', 'Pakistan Standard Time'],
  jst: ['Asia/Tokyo', 'Japan Standard Time'],
  kst: ['Asia/Seoul', 'Korea Standard Time'],
  hkt: ['Asia/Hong_Kong', 'Hong Kong Time'],
  sgt: ['Asia/Singapore', 'Singapore Time'],
  ict: ['Asia/Bangkok', 'Indochina Time'],
  wib: ['Asia/Jakarta', 'Western Indonesia Time'],
  pht: ['Asia/Manila', 'Philippine Time'],
  aest: ['Australia/Sydney', 'Australian Eastern Time'],
  aedt: ['Australia/Sydney', 'Australian Eastern Time'],
  aet: ['Australia/Sydney', 'Australian Eastern Time'],
  acst: ['Australia/Adelaide', 'Australian Central Time'],
  acdt: ['Australia/Adelaide', 'Australian Central Time'],
  awst: ['Australia/Perth', 'Australian Western Time'],
  nzst: ['Pacific/Auckland', 'New Zealand Time'],
  nzdt: ['Pacific/Auckland', 'New Zealand Time'],
  nzt: ['Pacific/Auckland', 'New Zealand Time'],
  sast: ['Africa/Johannesburg', 'South Africa Standard Time'],
  cat: ['Africa/Maputo', 'Central Africa Time'],
  eat: ['Africa/Nairobi', 'East Africa Time'],
  wat: ['Africa/Lagos', 'West Africa Time'],
  brt: ['America/Sao_Paulo', 'Brasília Time'],
  art: ['America/Argentina/Buenos_Aires', 'Argentina Time'],
};

/** Lowercase letters and digits with single spaces, without accents: "São_Paulo" → "sao paulo". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Whether `Intl` knows the zone, so a name is never offered for one it can't show. */
function known(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The city a zone is named after: "America/New_York" → "New York". */
export function cityOf(zone: string): string {
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}

function supportedZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}

let placesByName: Map<string, Place> | undefined;

/** Every place name, lowercased, to its zone: cities from the system's list first, then aliases. */
function places(): Map<string, Place> {
  if (placesByName) return placesByName;
  const map = new Map<string, Place>();
  for (const zone of supportedZones()) {
    if (/^(Etc|Antarctica)\//.test(zone)) continue;
    const name = cityOf(zone);
    const key = normalize(name);
    if (!key || NOT_PLACES.has(key) || map.has(key)) continue;
    map.set(key, { zone, name });
  }
  for (const alias of ALIASES) {
    const [zone, name] = alias.slice(-2) as [string, string];
    if (!known(zone)) continue;
    for (const key of alias.slice(0, -2)) map.set(key, { zone, name });
  }
  placesByName = map;
  return map;
}

/** The place `text` names, or `null`: a city, one of the aliases, or an abbreviation. */
export function findPlace(text: string): Place | null {
  const key = normalize(text);
  if (!key) return null;
  const place = places().get(key);
  if (place) return place;
  const abbreviation = ABBREVIATIONS[key];
  if (!abbreviation || !known(abbreviation[0])) return null;
  const [zone, name, ambiguous] = abbreviation;
  const shown = `${name} (${cityOf(zone)})`;
  return ambiguous ? { zone, name: shown, note: `${key.toUpperCase()} taken as ${shown}` } : { zone, name: shown };
}

/** "3pm", "3 pm", "15:00", "3.30pm", "noon", "midnight". A bare number isn't a time. */
export function parseClock(text: string): ClockTime | null {
  const lower = text.trim().toLowerCase();
  if (lower === 'noon' || lower === 'midday') return { hour: 12, minute: 0 };
  if (lower === 'midnight') return { hour: 0, minute: 0 };
  const match = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(lower);
  if (!match || (match[2] === undefined && match[3] === undefined)) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const meridiem = match[3]?.[0];
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'p' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

const CLOCK = String.raw`(\d{1,2}(?:[:.]\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)?|noon|midday|midnight)`;
const NOW_IN = /^(?:what(?:'s|s| is) the )?(?:current |local )?time (?:in|at|for) (.+)$/;
const NOW_PLACE = /^(?:what time is it (?:in|at) |time )(.+)$/;
const PLACE_TIME = /^(.+?) time(?: now)?$/;
const CLOCK_FROM_TO = new RegExp(`^${CLOCK}(?: (.+?))? (?:in|to|at) (.+)$`);
const FROM_CLOCK_TO = new RegExp(`^(.+?) ${CLOCK} (?:in|to|at) (.+)$`);

/** A place as typed before or after a time: "london", "london time", "in london". */
function placeIn(text: string | undefined): Place | null {
  if (text === undefined) return null;
  return findPlace(text.replace(/^(?:in|at) /, '').replace(/ time$/, ''));
}

/** What `input` asks about the time somewhere, or `null` if it isn't a time question. */
export function parseTimeQuery(input: string): TimeQuery | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return null;

  const nowIn = NOW_IN.exec(text) ?? NOW_PLACE.exec(text) ?? PLACE_TIME.exec(text);
  if (nowIn) {
    const to = findPlace(nowIn[1] as string);
    if (to) return { time: null, from: null, to };
  }

  const clockFirst = CLOCK_FROM_TO.exec(text);
  if (clockFirst) {
    const time = parseClock(clockFirst[1] as string);
    const from = placeIn(clockFirst[2]);
    const to = placeIn(clockFirst[3]);
    if (time && to && (clockFirst[2] === undefined || from)) return { time, from, to };
  }

  const placeFirst = FROM_CLOCK_TO.exec(text);
  if (placeFirst) {
    const time = parseClock(placeFirst[2] as string);
    const from = placeIn(placeFirst[1]);
    const to = placeIn(placeFirst[3]);
    if (time && from && to) return { time, from, to };
  }
  return null;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  return Number(parts.find((p) => p.type === type)?.value);
}

/** The zone's offset from UTC at `date`, in minutes: Tokyo is 540, New York −240 or −300. */
export function zoneOffset(zone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(date);
  const asUtc = Date.UTC(
    part(parts, 'year'),
    part(parts, 'month') - 1,
    part(parts, 'day'),
    part(parts, 'hour'),
    part(parts, 'minute'),
    part(parts, 'second'),
  );
  return Math.round((asUtc - (date.getTime() - date.getMilliseconds())) / 60_000);
}

/** The moment it's `clock` on the day it is now in `zone`. */
export function instantOf(clock: ClockTime, zone: string, now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const wall = Date.UTC(part(parts, 'year'), part(parts, 'month') - 1, part(parts, 'day'), clock.hour, clock.minute);
  // The offset at that moment, looked up twice in case the first guess lands across a daylight saving change.
  const guess = wall - zoneOffset(zone, new Date(wall)) * 60_000;
  return new Date(wall - zoneOffset(zone, new Date(guess)) * 60_000);
}

function formatTime(date: Date, zone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(date);
}

function formatDay(date: Date, zone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: zone }).format(
    date,
  );
}

function zoneName(date: Date, zone: string, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, { timeZoneName: 'long', timeZone: zone }).formatToParts(date);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? zone;
}

/** "8 hours ahead of you", "5 hours 30 minutes behind London", "the same time as London". */
export function describeDifference(minutes: number, fromName: string): string {
  if (minutes === 0) return `the same time as ${fromName}`;
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  const amount = [
    hours > 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : '',
    rest > 0 ? `${rest} minute${rest === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return minutes > 0 ? `${amount} ahead of ${fromName}` : `${amount} behind ${fromName}`;
}

/**
 * The answer to a time question. `localZone` is where the person is, for times without a place
 * and for "ahead of you"; `now` is passed in so tests don't depend on the day they run.
 */
export function answerTimeQuery(query: TimeQuery, now: Date, localZone: string, locale = 'en-US'): TimeAnswer {
  const fromZone = query.from?.zone ?? localZone;
  const instant = query.time ? instantOf(query.time, fromZone, now) : now;
  const difference = zoneOffset(query.to.zone, instant) - zoneOffset(fromZone, instant);
  return {
    time: formatTime(instant, query.to.zone, locale),
    day: formatDay(instant, query.to.zone, locale),
    zoneName: zoneName(instant, query.to.zone, locale),
    fromName: query.from?.name ?? cityOf(localZone),
    fromTime: formatTime(instant, fromZone, locale),
    fromDay: formatDay(instant, fromZone, locale),
    difference: describeDifference(difference, query.from ? query.from.name : 'you'),
    instant,
  };
}
