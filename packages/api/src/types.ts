// The extension API's types come from the app's own source, src/shared/extension-api.ts and
// src/shared/types.ts, so they're written in one place. The build copies them into
// dist/index.d.ts, and declarations.test.ts checks the published file says the same.
export type * from '../../../src/shared/extension-api';
