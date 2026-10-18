// Encode & Decode: type or paste text and pick what you need. Base64, URL and HTML encoded
// forms, what it decodes to when it is one of those, a JWT's header and claims, and hashes.
// Also offered under "Use “…” with", so a token pasted into the launcher is one ↵ away.
import {
  base64Decode,
  base64Encode,
  base64UrlEncode,
  decodeJwt,
  hashes,
  htmlDecode,
  htmlEncode,
  jwtTimes,
  urlDecode,
  urlEncode,
} from './transforms.js';

/** @typedef {import('@waypoint/api').Extension} Extension */
/** @typedef {import('@waypoint/api').ExtensionContext} Context */
/** @typedef {import('@waypoint/api').ListItem} ListItem */
/** @typedef {import('@waypoint/api').ListView} ListView */
/** @typedef {import('@waypoint/api').Tint} Tint */

const PREVIEW_LENGTH = 200;

/** @param {string} text */
const oneLine = (text) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH - 1)}…` : line;
};

/**
 * One result: the value on the left, what it is underneath, the whole of it in the preview.
 * @param {string} id
 * @param {string} label
 * @param {string} value
 * @param {Tint} tint
 * @param {{ note?: string, metadata?: Array<{ label: string, value: string }> }} [extra]
 * @returns {ListItem}
 */
function result(id, label, value, tint, { note, metadata } = {}) {
  return {
    id,
    title: oneLine(value) || '(empty)',
    subtitle: label,
    icon: { builtin: 'text', tint },
    keywords: [label],
    detail: {
      title: label,
      body: note ? `${value}\n\n${note}` : value,
      metadata: [...(metadata ?? []), { label: 'Length', value: `${[...value].length} characters` }],
    },
    actions: [
      { type: 'copy', text: value, title: 'Copy' },
      { type: 'paste', text: value, title: 'Paste' },
    ],
  };
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * "in 3 hours", "2 days ago".
 * @param {Date} date
 * @param {Date} now
 */
function fromNow(date, now) {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  /** @type {Array<[Intl.RelativeTimeFormatUnit, number]>} */
  const units = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return relative.format(seconds, 'second');
}

/**
 * The decoded JWT: claims in the list, header and claims in the preview.
 * @param {import('./transforms.js').Jwt} jwt
 * @returns {ListItem}
 */
function jwtItem(jwt) {
  const now = new Date();
  const payload = JSON.stringify(jwt.payload, null, 2);
  const header = JSON.stringify(jwt.header, null, 2);
  const times = jwtTimes(jwt.payload);
  const expiry = times.find((time) => time.claim === 'exp');
  const subject = typeof jwt.payload.sub === 'string' ? jwt.payload.sub : undefined;
  return {
    id: 'jwt',
    title: subject ? `JWT for ${oneLine(subject)}` : 'JWT claims',
    subtitle: `${String(jwt.header.alg)} token`,
    accessory: expiry ? (expiry.date < now ? 'Expired' : `Expires ${fromNow(expiry.date, now)}`) : '',
    icon: { builtin: 'lock', tint: expiry && expiry.date < now ? 'red' : 'purple' },
    keywords: ['jwt', 'token', 'claims'],
    detail: {
      title: 'JSON Web Token',
      body: `# Claims\n${payload}\n\n# Header\n${header}\n\nThe signature isn't checked: that needs the key it was signed with.`,
      metadata: times.map((time) => ({
        label: time.label,
        value: `${time.date.toISOString().replace('.000Z', 'Z')} (${fromNow(time.date, now)})`,
      })),
    },
    actions: [
      { type: 'copy', text: payload, title: 'Copy Claims' },
      { type: 'copy', text: header, title: 'Copy Header' },
    ],
  };
}

/**
 * @param {Context} ctx
 * @returns {ListView}
 */
function transformView(ctx) {
  const text = ctx.query || ctx.argument || '';
  if (!text.trim()) {
    return {
      type: 'list',
      title: 'Encode & Decode',
      searchPlaceholder: 'Type or paste text, Base64, a URL or a JWT…',
      filtering: false,
      emptyText: 'Type or paste text to encode, decode or hash it.',
      sections: [],
    };
  }

  /** @type {ListItem[]} */
  const decoded = [];
  const jwt = decodeJwt(text);
  if (jwt) decoded.push(jwtItem(jwt));
  const fromBase64 = jwt ? undefined : base64Decode(text);
  if (fromBase64 !== undefined) decoded.push(result('from-base64', 'Decoded from Base64', fromBase64, 'green'));
  const fromUrl = urlDecode(text);
  if (fromUrl !== undefined) decoded.push(result('from-url', 'Decoded from URL encoding', fromUrl, 'green'));
  const fromHtml = htmlDecode(text);
  if (fromHtml !== undefined) decoded.push(result('from-html', 'Decoded from HTML entities', fromHtml, 'green'));

  const encoded = [
    result('base64', 'Base64', base64Encode(text), 'blue'),
    result('base64url', 'Base64 (URL-safe)', base64UrlEncode(text), 'blue'),
    result('url', 'URL encoded', urlEncode(text), 'blue'),
    result('html', 'HTML entities', htmlEncode(text), 'blue'),
  ].filter((item) => item.title !== oneLine(text));

  const digests = hashes(text).map((hash) =>
    result(`hash-${hash.name}`, hash.name, hash.value, 'gray', {
      note:
        hash.name === 'MD5' || hash.name === 'SHA-1'
          ? `${hash.name} is fine for checksums, not for security.`
          : undefined,
    }),
  );

  return {
    type: 'list',
    title: 'Encode & Decode',
    searchPlaceholder: 'Type or paste text, Base64, a URL or a JWT…',
    filtering: false,
    sections: [
      { title: 'Decoded', items: decoded },
      { title: 'Encoded', items: encoded },
      { title: 'Hashes of the text', items: digests },
    ],
  };
}

/** @type {Extension} */
export default {
  commands: {
    transform: { view: transformView },
  },
};
