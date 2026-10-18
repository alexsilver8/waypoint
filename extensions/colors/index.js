// Colors: type a colour as hex, rgb(), hsl(), oklch() or a CSS name, and copy it in any of
// those forms. The preview shows its contrast against white and black text.
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrast, formatColor, parseColor } from './color.js';

/** @typedef {import('@waypoint-org/api').Extension} Extension */
/** @typedef {import('@waypoint-org/api').ExtensionContext} Context */
/** @typedef {import('@waypoint-org/api').ListView} ListView */
/** @typedef {import('@waypoint-org/api').Icon} Icon */
/** @typedef {import('./color.js').Color} Color */

const SWATCHES_KEPT = 200;
const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

/**
 * A small SVG of the colour in the extension's folder, to show as the items' icon. Older ones
 * are removed once there are more than a couple of hundred.
 * @param {Context} ctx
 * @param {string} hex `#rrggbb` or `#rrggbbaa`
 * @returns {Icon}
 */
function swatch(ctx, hex) {
  try {
    const folder = join(ctx.supportPath, 'swatches');
    const file = join(folder, `${hex.slice(1)}.svg`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      file,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="8" fill="${hex}" stroke="#808080" stroke-opacity="0.35"/></svg>`,
      { flag: 'w' },
    );
    const files = readdirSync(folder);
    if (files.length > SWATCHES_KEPT) {
      const byAge = files
        .map((name) => ({ name, time: statSync(join(folder, name)).mtimeMs }))
        .sort((a, b) => a.time - b.time);
      for (const old of byAge.slice(0, files.length - SWATCHES_KEPT)) unlinkSync(join(folder, old.name));
    }
    return { path: file };
  } catch {
    return { builtin: 'sparkles', tint: 'pink' };
  }
}

/** @param {number} ratio */
function rating(ratio) {
  if (ratio >= 7) return `${ratio}:1, AAA`;
  if (ratio >= 4.5) return `${ratio}:1, AA`;
  if (ratio >= 3) return `${ratio}:1, AA for large text only`;
  return `${ratio}:1, too low for text`;
}

/**
 * @param {Context} ctx
 * @returns {ListView}
 */
function convertView(ctx) {
  const input = ctx.query || ctx.argument || '';
  const base = {
    type: /** @type {const} */ ('list'),
    title: 'Colors',
    searchPlaceholder: '#ff6347, rgb(255 99 71), hsl(9 100% 64%), oklch(…) or tomato…',
    filtering: false,
  };
  const color = parseColor(input);
  if (!color) {
    return {
      ...base,
      emptyText: input.trim()
        ? `“${input.trim()}” isn't a colour. Try #ff6347, rgb(255 99 71), hsl(9 100% 64%) or tomato.`
        : 'Type a colour as hex, rgb(), hsl(), oklch() or a CSS name.',
      sections: [],
    };
  }

  const forms = formatColor(color);
  const hex = forms[0]?.value ?? '#000000';
  const icon = swatch(ctx, hex);
  const opaque = { ...color, a: 1 };
  const onWhite = contrast(opaque, WHITE);
  const onBlack = contrast(opaque, BLACK);
  const allForms = forms.map((form) => `- ${form.label}: ${form.value}`).join('\n');
  return {
    ...base,
    sections: [
      {
        items: forms.map((form) => ({
          id: form.id,
          title: form.value,
          subtitle: form.label,
          icon,
          keywords: [form.label],
          detail: {
            title: hex,
            body: `${allForms}${color.a < 1 ? '\n\nContrast is for the colour without its transparency.' : ''}`,
            metadata: [
              { label: 'Contrast with white', value: rating(onWhite) },
              { label: 'Contrast with black', value: rating(onBlack) },
              { label: 'Text on it reads best in', value: onWhite >= onBlack ? 'White' : 'Black' },
            ],
          },
          actions: [
            { type: 'copy', text: form.value, title: 'Copy' },
            { type: 'paste', text: form.value, title: 'Paste' },
            { type: 'copy', text: forms.map((each) => each.value).join('\n'), title: 'Copy All Forms' },
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
