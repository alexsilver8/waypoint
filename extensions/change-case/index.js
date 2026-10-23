// Change Case: type or paste some text and get it back in every common case, then paste the one
// you want. Also offered under "Use “…” with", so text typed in the launcher is one ↵ away.
import { cases, splitWords } from './case.js';

/** @typedef {import('@waypoint-org/api').Extension} Extension */
/** @typedef {import('@waypoint-org/api').ExtensionContext} Context */
/** @typedef {import('@waypoint-org/api').ListItem} ListItem */
/** @typedef {import('@waypoint-org/api').ListView} ListView */

const PREVIEW_LENGTH = 200;

/** @param {string} text */
const oneLine = (text) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH - 1)}…` : line;
};

/**
 * One case: the text in it on the left, the case's name underneath, and the whole of it in the
 * preview. ↵ pastes it into the app you were in, ⌘↵ copies it.
 * @param {ReturnType<typeof cases>[number]} result
 * @param {string} text What was typed, so the case it's already in says so.
 * @param {number} words
 * @returns {ListItem}
 */
function item({ id, label, value, group }, text, words) {
  return {
    id,
    title: oneLine(value) || '(empty)',
    subtitle: label,
    ...(value === text.trim() ? { accessory: 'As typed' } : {}),
    icon: { builtin: 'text', tint: group === 'code' ? 'blue' : 'purple' },
    detail: {
      title: label,
      body: value,
      metadata: [
        { label: 'Words', value: String(words) },
        { label: 'Length', value: `${[...value].length} characters` },
      ],
    },
    actions: [
      { type: 'paste', text: value, title: 'Paste' },
      { type: 'copy', text: value, title: 'Copy' },
    ],
  };
}

/**
 * @param {Context} ctx
 * @returns {ListView}
 */
function changeView(ctx) {
  const text = ctx.query || ctx.argument || '';
  const words = splitWords(text).length;
  if (words === 0) {
    return {
      type: 'list',
      title: 'Change Case',
      searchPlaceholder: 'Type or paste text…',
      filtering: false,
      emptyText: 'Type or paste text to see it in every case.',
      sections: [],
    };
  }
  const results = cases(text);
  /** @param {'code' | 'text'} group @param {string} title */
  const section = (group, title) => ({
    title,
    items: results.filter((result) => result.group === group).map((result) => item(result, text, words)),
  });
  return {
    type: 'list',
    title: 'Change Case',
    searchPlaceholder: 'Type or paste text…',
    filtering: false,
    sections: [section('code', 'For code'), section('text', 'For text')],
  };
}

/** @type {Extension} */
export default {
  commands: {
    change: { view: changeView },
  },
};
