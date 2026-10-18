import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ResolveHookContext } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { transformWithEsbuild } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { API_PACKAGE, OLD_API_PACKAGE, resolveApi } from './api';

const BUNDLED = 'file:///app/out/main/waypoint-api.js';
const context: ResolveHookContext = { conditions: ['node', 'import'], importAttributes: {}, parentURL: undefined };

function missing(code: string) {
  return () => {
    throw Object.assign(new Error(`Cannot find package '${API_PACKAGE}'`), { code });
  };
}

describe('resolveApi', () => {
  it('leaves other specifiers to Node', () => {
    const next = vi.fn(() => ({ url: 'node:fs' }));
    expect(resolveApi('node:fs', context, next, BUNDLED)).toEqual({ url: 'node:fs' });
    expect(next).toHaveBeenCalledWith('node:fs', context);
  });

  it('uses the copy an extension installed', () => {
    const installed = { url: 'file:///ext/node_modules/@waypoint-org/api/dist/index.js', format: 'module' };
    expect(resolveApi(API_PACKAGE, context, () => installed, BUNDLED)).toBe(installed);
  });

  it("uses Waypoint's copy when the extension has none, from import and from require", () => {
    const bundled = { url: BUNDLED, format: 'module', shortCircuit: true };
    expect(resolveApi(API_PACKAGE, context, missing('ERR_MODULE_NOT_FOUND'), BUNDLED)).toEqual(bundled);
    expect(resolveApi(API_PACKAGE, context, missing('MODULE_NOT_FOUND'), BUNDLED)).toEqual(bundled);
  });

  it('gives the old name, @waypoint/api, the same copy', () => {
    const bundled = { url: BUNDLED, format: 'module', shortCircuit: true };
    expect(resolveApi(OLD_API_PACKAGE, context, missing('ERR_MODULE_NOT_FOUND'), BUNDLED)).toEqual(bundled);
  });

  it('passes on other errors, like a broken copy the extension installed', () => {
    expect(() => resolveApi(API_PACKAGE, context, missing('ERR_INVALID_PACKAGE_CONFIG'), BUNDLED)).toThrow(
      'Cannot find package',
    );
  });
});

describe('provideApi', () => {
  let dir: string;

  /** Writes `files` under the test's folder. */
  function write(files: Record<string, string>) {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'waypoint-provide-api-'));
    const { code } = await transformWithEsbuild(readFileSync(join(import.meta.dirname, 'api.ts'), 'utf8'), 'api.ts', {
      format: 'esm',
    });
    write({
      'host/api.mjs': code,
      'host/waypoint-api.mjs': "export const from = 'waypoint';",
      // Loads each extension as the host does, and prints what it got.
      'host/load.mjs': `import { pathToFileURL } from 'node:url';
        import { provideApi } from './api.mjs';
        provideApi(new URL('./waypoint-api.mjs', import.meta.url).href);
        const found = [];
        for (const entry of process.argv.slice(2)) found.push((await import(pathToFileURL(entry).href)).default);
        process.stdout.write(JSON.stringify(found));`,
      'esm/package.json': '{ "type": "module" }',
      'esm/index.js': "import { from } from '@waypoint-org/api'; export default from;",
      'cjs/package.json': '{ "type": "commonjs" }',
      'cjs/index.js': "module.exports = require('@waypoint-org/api').from;",
      'old/package.json': '{ "type": "module" }',
      'old/index.js': "import { from } from '@waypoint/api'; export default from;",
      'own/package.json': '{ "type": "module" }',
      'own/index.js': "import { from } from '@waypoint-org/api'; export default from;",
      'own/node_modules/@waypoint-org/api/package.json':
        '{ "name": "@waypoint-org/api", "type": "module", "exports": "./x.js" }',
      'own/node_modules/@waypoint-org/api/x.js': "export const from = 'its own copy';",
    });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives import and require Waypoint's copy, under either name, unless the extension installed its own", () => {
    const entries = ['esm', 'cjs', 'old', 'own'].map((name) => join(dir, name, 'index.js'));
    // Without pnpm's NODE_PATH, through which `require` would find this repo's packages/api.
    const env = { ...process.env, NODE_PATH: '' };
    const output = execFileSync(process.execPath, [join(dir, 'host/load.mjs'), ...entries], { encoding: 'utf8', env });
    expect(JSON.parse(output)).toEqual(['waypoint', 'waypoint', 'waypoint', 'its own copy']);
  });
});
