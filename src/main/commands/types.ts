import type { CommandImplementation, ExtensionManifest } from '../../shared/types';

/** A built-in extension: same manifest as third-party ones, but runs in the main process. */
export interface BuiltinExtension {
  manifest: ExtensionManifest;
  commands: Record<string, CommandImplementation>;
  /**
   * Commands only its own items run, like opening one quicklink, left out of the root search.
   * Items reach them with an `open-command` action, the argument saying which one.
   */
  unlisted?: string[];
}
