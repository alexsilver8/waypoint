/**
 * Lets extensions use `@waypoint-org/api` without installing it. When Node can't find the package
 * from an extension's folder, `import … from '@waypoint-org/api'` and `require('@waypoint-org/api')` get
 * the copy built into Waypoint (out/main/waypoint-api.js, from packages/api). A copy the
 * extension installed in its own node_modules is found first, so that one wins. Extensions written
 * before the package moved to npm import it as `@waypoint/api`, which gets the same copy.
 */
import { type ResolveFnOutput, type ResolveHookContext, registerHooks } from 'node:module';

export const API_PACKAGE = '@waypoint-org/api';

/** The name the package had before it was published; someone else holds that scope on npm. */
export const OLD_API_PACKAGE = '@waypoint/api';

/** What Node throws when nothing answers to a specifier: from `import`, and from `require`. */
const NOT_FOUND = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND']);

type NextResolve = (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput;

/** Resolves as Node would, except that a missing `@waypoint-org/api` (or `@waypoint/api`) resolves to `url`. */
export function resolveApi(
  specifier: string,
  context: ResolveHookContext,
  nextResolve: NextResolve,
  url: string,
): ResolveFnOutput {
  if (specifier !== API_PACKAGE && specifier !== OLD_API_PACKAGE) return nextResolve(specifier, context);
  try {
    return nextResolve(specifier, context);
  } catch (error) {
    if (!NOT_FOUND.has(String((error as NodeJS.ErrnoException | undefined)?.code))) throw error;
    // An ES module; `require` loads it too (Node 22.12 and later can require ES modules).
    return { url, format: 'module', shortCircuit: true };
  }
}

/** Makes `@waypoint-org/api` resolve to `url` for the rest of this process, unless installed. */
export function provideApi(url: string): void {
  registerHooks({ resolve: (specifier, context, nextResolve) => resolveApi(specifier, context, nextResolve, url) });
}
