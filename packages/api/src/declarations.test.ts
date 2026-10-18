// The published declarations must say what the source says. The build writes dist/index.d.ts
// from the app's src/shared types and the helpers; these tests build it afresh and check that it
// stands on its own and that every export matches its source, type for type.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, typecheck } from '../scripts/build.mjs';
import { bundleDeclarations } from '../scripts/declarations.mjs';
import * as source from './index';

const packageDir = resolve(import.meta.dirname, '..');

interface Exported {
  name: string;
  space: 'type' | 'value';
  /** How many type parameters it takes. */
  parameters: number;
}

/** How many type parameters the list starting with `<` at `start` has. */
function countParameters(text: string, start: number): number {
  let depth = 0;
  let count = 1;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (char === '>' && text[i - 1] === '=') continue;
    if ('<([{'.includes(char ?? '')) depth++;
    else if ('>)]}'.includes(char ?? '') && --depth === 0) return count;
    else if (char === ',' && depth === 1) count++;
  }
  throw new Error('Unclosed type parameters.');
}

/** What a TypeScript file exports by declaring it. */
function declaredExports(text: string): Exported[] {
  return [...text.matchAll(/^export (?:declare )?(type|interface|const|function|class) ([\w$]+)/gm)].map((match) => {
    const end = (match.index ?? 0) + match[0].length;
    return {
      name: match[2] ?? '',
      space: match[1] === 'type' || match[1] === 'interface' ? 'type' : 'value',
      parameters: text[end] === '<' ? countParameters(text, end) : 0,
    };
  });
}

/** What a source module exports, following its `export * from` to the modules it passes on. */
function sourceExports(file: string, seen = new Set<string>()): Exported[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const text = readFileSync(file, 'utf8');
  const passed = [...text.matchAll(/^export (?:type )?\* from '([^']+)';$/gm)].flatMap((match) =>
    sourceExports(resolve(dirname(file), `${match[1]}.ts`), seen),
  );
  return [...declaredExports(text), ...passed];
}

const key = (entry: Exported) => `${entry.space} ${entry.name}`;
const names = (entries: Exported[]) => [...new Set(entries.map(key))].sort();

let outDir: string;
let published: string;

beforeAll(async () => {
  outDir = await build(mkdtempSync(join(tmpdir(), 'waypoint-api-dist-')));
  published = readFileSync(join(outDir, 'index.d.ts'), 'utf8');
}, 60_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('the published declarations', () => {
  it("don't refer to any other file", () => {
    const code = published.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bfrom\s*['"]|\bimport\(|\brequire\(/);
    expect(published).not.toMatch(/\/\/\/\s*<reference/);
    expect(readFileSync(join(outDir, 'index.d.cts'), 'utf8')).toBe(published);
  });

  it('export the same names as the source', () => {
    expect(names(declaredExports(published))).toEqual(names(sourceExports(join(packageDir, 'src/index.ts'))));
  });

  it('say the same as the source, for every type and value', () => {
    const exported = sourceExports(join(packageDir, 'src/index.ts'));
    const checks = exported.map(({ name, space, parameters }) => {
      const args = parameters > 0 ? `<${Array(parameters).fill('any').join(', ')}>` : '';
      return space === 'type'
        ? `Equal<Published.${name}${args}, Source.${name}${args}>`
        : `Equal<typeof Published.${name}, typeof Source.${name}>`;
    });
    const lines = [
      `import type * as Published from ${JSON.stringify(join(outDir, 'index.js'))};`,
      `import type * as Source from ${JSON.stringify(join(packageDir, 'src/index'))};`,
      'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;',
      'type Expect<T extends true> = T;',
      'export type Names = Expect<Equal<keyof typeof Published, keyof typeof Source>>;',
      ...checks.map((check, index) => `export type Check${index} = Expect<${check}>;`),
    ];
    const dir = mkdtempSync(join(tmpdir(), 'waypoint-api-same-'));
    try {
      writeFileSync(join(dir, 'check.ts'), lines.join('\n'));
      typecheck(dir, {
        compilerOptions: { strict: true, noEmit: true, module: 'ESNext', moduleResolution: 'bundler', types: [] },
        files: ['check.ts'],
      });
    } catch (error) {
      // Name what differs: tsc only gives the line of the check.
      throw new Error(
        (error as Error).message.replace(
          /check\.ts\((\d+),\d+\)/g,
          (found, line) => `${found} ${lines[Number(line) - 1]}`,
        ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the published code', () => {
  const sample = (api: typeof source) =>
    api.list({
      items: [
        api.item({
          title: 'a',
          icon: api.Icon.builtin('globe', 'blue'),
          actions: [api.Action.copy('a', { shortcut: 'mod+shift+c' })],
        }),
      ],
    });

  it('exports the same as the source, as an ES module and as CommonJS', async () => {
    const esm = (await import(pathToFileURL(join(outDir, 'index.js')).href)) as typeof source;
    const cjs = createRequire(import.meta.url)(join(outDir, 'index.cjs')) as typeof source;
    expect(Object.keys(esm).sort()).toEqual(Object.keys(source).sort());
    expect(Object.keys(cjs).sort()).toEqual(Object.keys(source).sort());
    expect(sample(esm)).toEqual(sample(source));
    expect(sample(cjs)).toEqual(sample(source));
  });
});

describe('bundleDeclarations', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'waypoint-api-bundle-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Writes declaration files and bundles the first. */
  function bundle(files: Record<string, string>): string {
    const root = mkdtempSync(join(dir, 'case-'));
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), text);
    }
    return bundleDeclarations(join(root, Object.keys(files)[0] ?? ''));
  }

  it('inlines the modules it imports, and keeps their own declarations private', () => {
    const text = bundle({
      'index.d.ts': "export type * from './types';\nexport * from './icons';\nexport { Icon } from './icons';\n",
      'types.d.ts': 'interface Base { id: string; }\nexport type Icon = Base & { emoji: string };\nexport {};\n',
      'icons.d.ts':
        "import type * as api from './types';\n/** The type. */\nexport type Icon = api.Icon;\nexport declare const Icon: { emoji(emoji: string): api.Icon };\n",
    });
    expect(text).toBe(
      'interface Base { id: string; }\nexport type Icon = Base & { emoji: string };\n\n' +
        'export declare const Icon: { emoji(emoji: string): Icon };\n\nexport {};\n',
    );
  });

  it('refuses what it cannot follow', () => {
    expect(() => bundle({ 'index.d.ts': "export * from 'other-package';\n" })).toThrow('outside the package');
    expect(() =>
      bundle({ 'index.d.ts': "import type { A as B } from './a';\n", 'a.d.ts': 'export type A = 1;\n' }),
    ).toThrow('renames');
    expect(() =>
      bundle({
        'index.d.ts': "export * from './a';\nexport * from './b';\n",
        'a.d.ts': 'export type Thing = 1;\n',
        'b.d.ts': 'export interface Thing { a: 1 }\n',
      }),
    ).toThrow('"Thing" is declared in both');
    expect(() => bundle({ 'index.d.ts': "export declare const a: import('./b').B;\n" })).toThrow('import() type');
  });
});
