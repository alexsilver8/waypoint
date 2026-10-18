// Timestamps: type a Unix timestamp (seconds, milliseconds, microseconds or nanoseconds, told
// apart by length), an ISO 8601 or RFC 2822 date, or nothing for now, and copy it in the
// format you need.
import { formatMoment, parseMoment } from './time.js';

/** @typedef {import('@waypoint/api').Extension} Extension */
/** @typedef {import('@waypoint/api').ExtensionContext} Context */
/** @typedef {import('@waypoint/api').ListView} ListView */

/** @type {Record<import('./time.js').Source, string>} */
const READ_AS = {
  now: 'Now',
  seconds: 'From Unix seconds',
  milliseconds: 'From Unix milliseconds',
  microseconds: 'From Unix microseconds',
  nanoseconds: 'From Unix nanoseconds',
  date: 'From the date you typed',
};

/**
 * @param {Context} ctx
 * @returns {ListView}
 */
function convertView(ctx) {
  const input = ctx.query || ctx.argument || '';
  const now = new Date();
  const moment = parseMoment(input, now);
  const base = {
    type: /** @type {const} */ ('list'),
    title: 'Timestamps',
    searchPlaceholder: 'A timestamp like 1760184000, a date like 2026-10-11T14:30Z, or now…',
    filtering: false,
  };
  if (!moment) {
    return {
      ...base,
      emptyText: `Couldn't read “${input.trim()}” as a date. Try 1760184000, 2026-10-11T14:30:00Z or now.`,
      sections: [],
    };
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const formats = formatMoment(moment.date, { now, timeZone });
  return {
    ...base,
    sections: [
      {
        title: READ_AS[moment.source],
        items: formats.map((format) => ({
          id: format.id,
          title: format.value,
          subtitle: format.label,
          icon: { builtin: format.id === 'relative' ? 'refresh' : 'text', tint: 'teal' },
          keywords: [format.label],
          actions: [
            { type: 'copy', text: format.value, title: 'Copy' },
            { type: 'paste', text: format.value, title: 'Paste' },
          ],
        })),
      },
    ],
  };
}

/** @type {Extension} */
export default {
  commands: {
    convert: { view: convertView },
  },
};
