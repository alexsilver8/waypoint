// Bundles the declaration files tsc emits for src/index.ts into one file that doesn't refer to
// anything outside itself, so the published package can carry types that live in the app
// (src/shared/types.ts and src/shared/extension-api.ts).
//
// The modules are few and written for this, so it's done with text, and refuses anything it
// doesn't expect rather than guessing:
// - imports from and re-exports of modules within the bundle are dropped, since everything is
//   then in one scope with the same names (an import may not rename);
// - `import type * as ns` is resolved by dropping `ns.`, and `export type X = ns.X` with it;
// - every module's exports are the bundle's exports, so a name may be declared in two modules
//   only as a type in one and a value in the other (`Action`, `Icon`), which TypeScript merges;
// - anything imported from outside the bundle is an error.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const FROM = /^(import|export)\b([^;]*?)\bfrom '([^']+)';\n?/gm;
const DECLARATION =
  /^(?:export )?(?:declare )?(type|interface|const|let|var|function|class|enum|namespace) ([A-Za-z_$][\w$]*)/gm;
const VALUE_KINDS = new Set(['const', 'let', 'var', 'function', 'class', 'enum', 'namespace']);

/**
 * The declaration file a relative specifier in `from` points at.
 * @param {string} from
 * @param {string} specifier
 */
function locate(from, specifier) {
  const base = resolve(dirname(from), specifier.replace(/\.(m|c)?js$/, ''));
  for (const candidate of [`${base}.d.ts`, `${base}/index.d.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`${from}: can't find the declarations of "${specifier}".`);
}

/**
 * Reads one module: what it depends on, and its text with those dependencies taken out.
 * @param {string} file
 * @returns {{ dependencies: string[], text: string }}
 */
function parse(file) {
  let text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  /** @type {string[]} */
  const dependencies = [];
  /** @type {string[]} */
  const namespaces = [];
  text = text.replace(FROM, (_statement, keyword, clause, specifier) => {
    if (!specifier.startsWith('.')) {
      throw new Error(`${file}: "${specifier}" is outside the package, so the declarations can't refer to it.`);
    }
    dependencies.push(locate(file, specifier));
    const body = clause.trim();
    const namespace = /^type \* as ([\w$]+)$/.exec(body);
    if (keyword === 'import' && namespace?.[1]) namespaces.push(namespace[1]);
    else if (/\bas\b/.test(body.replace(/^type \*|^\*/, ''))) {
      throw new Error(`${file}: "${body}" renames, which the bundle can't follow; import names as they are.`);
    } else if (keyword === 'import' && !/^(type )?\{[^}]*\}$/.test(body)) {
      throw new Error(`${file}: unexpected import "${body}".`);
    }
    return '';
  });
  for (const namespace of namespaces) {
    text = text.replace(new RegExp(`(?<![\\w$.\\-/])${namespace.replace('$', '\\$')}\\.(?=[A-Za-z_$])`, 'g'), '');
  }
  // `export type X = ns.X` named a type here so the builder `X` could be exported with it.
  text = text.replace(/^(?:\/\*\*(?:[^*]|\*(?!\/))*\*\/\n)?export type ([\w$]+) = \1;\n/gm, '');
  text = text.replace(/^export \{\};\n?/gm, '');
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (/\bimport\(/.test(code)) throw new Error(`${file}: an import() type is left; give the type a name instead.`);
  return { dependencies, text: text.trim() };
}

/**
 * Returns the bundled declarations for `entry` (an emitted index.d.ts), after `header`. Errors
 * name files relative to `root`.
 * @param {string} entry
 * @param {{ root?: string, header?: string }} [options]
 * @returns {string}
 */
export function bundleDeclarations(entry, { root = dirname(entry), header = '' } = {}) {
  /** @type {Map<string, { dependencies: string[], text: string }>} */
  const modules = new Map();
  /** @type {string[]} */
  const order = [];
  /** @param {string} file */
  const visit = (file) => {
    if (modules.has(file)) return;
    const module = parse(file);
    modules.set(file, module);
    for (const dependency of module.dependencies) visit(dependency);
    order.push(file);
  };
  visit(entry);
  // The entry first, for its comment; the order of declarations doesn't matter.
  order.unshift(...order.splice(order.indexOf(entry), 1));

  /** @type {Map<string, { file: string, space: string }>} */
  const declared = new Map();
  const texts = order.map((file) => /** @type {string} */ (modules.get(file)?.text));
  for (const [index, file] of order.entries()) {
    /** @type {Map<string, string>} */
    const names = new Map();
    for (const [, kind = '', name = ''] of texts[index]?.matchAll(DECLARATION) ?? []) {
      if (!names.has(name)) names.set(name, VALUE_KINDS.has(kind) ? 'value' : 'type');
    }
    for (const [name, space] of names) {
      const earlier = declared.get(name);
      if (earlier && earlier.space === space) {
        throw new Error(
          `"${name}" is declared in both ${relative(root, earlier.file)} and ${relative(root, file)}; rename one.`,
        );
      }
      declared.set(name, { file, space });
    }
  }

  // Without the `export {}`, everything declared at the top level of a .d.ts would be exported.
  return `${header}${texts.filter(Boolean).join('\n\n')}\n\nexport {};\n`;
}
