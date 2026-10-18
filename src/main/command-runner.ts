import { commandItemId, commandKey } from '../shared/command-hotkeys';
import type { CommandRequest, ToastMessage } from '../shared/ipc';
import type { Action, ActionContext, ActionResult, CommandRef, View } from '../shared/types';
import type { CommandInfo } from './registry';

export interface CommandRunnerOptions {
  registry: {
    findCommand(ref: CommandRef): CommandInfo | undefined;
    runAction(action: Action, context: ActionContext): Promise<ActionResult>;
    readonly firstLoad: Promise<void>;
  };
  launcher: {
    readonly inFront: boolean;
    show(): void;
    toast(message: ToastMessage): void;
    runCommand(request: CommandRequest): void;
  };
  /** Copies, pastes and hides as the result says, and returns the rest (`finishAction`). */
  finish(result: ActionResult): Promise<ActionResult>;
  /** Shows a system notification; false where there are none. */
  notify(title: string, body: string): boolean;
}

/** Whether a result needs the launcher to show it: a list, or something done to its search. */
function needsLauncher(result: ActionResult): boolean {
  return Boolean(result.push || result.replace || result.pop || result.clearSearch || result.search !== undefined);
}

/** Asks before running a command a link asked for: any web page can open a link. */
function confirmView({ ref, manifest, icon }: CommandInfo): View {
  return {
    type: 'list',
    title: manifest.title,
    searchPlaceholder: 'Press ↵ to run it, or Esc to cancel',
    sections: [
      {
        items: [
          {
            id: 'run',
            title: `Run ${manifest.title}`,
            subtitle: 'A link asked to run this command',
            ...(icon ? { icon } : {}),
            actions: [{ type: 'open-command', ref, title: 'Run Command' }],
          },
        ],
      },
    ],
  };
}

/**
 * Runs a command from outside the launcher, as if it was picked from the root search: from its
 * own shortcut, `waypoint --command` or a `waypoint://commands/…` link.
 *
 * A `view` command opens the launcher straight into its view, and closes it again if that view is
 * already in front. A `no-view` command runs where it is, without the launcher, so a window command
 * moves the window you're in. What it has to say comes as a notification, which doesn't take the
 * keyboard from that window; a failure, or a toast where there are no notifications, opens the
 * launcher with it instead, so it's never lost.
 */
export class CommandRunner {
  constructor(private readonly options: CommandRunnerOptions) {}

  /** `ask`: for links, which anything can open, a `no-view` command waits for ↵ in the launcher. */
  async run(ref: CommandRef, { ask = false }: { ask?: boolean } = {}): Promise<void> {
    const { registry, launcher } = this.options;
    let command = registry.findCommand(ref);
    if (!command) {
      // At launch, extensions may still be loading.
      await registry.firstLoad;
      command = registry.findCommand(ref);
    }
    if (!command) {
      launcher.show();
      launcher.toast({ text: `There’s no command “${commandKey(ref)}”.`, style: 'failure' });
      return;
    }

    if (ask && command.manifest.mode === 'no-view') {
      launcher.show();
      launcher.runCommand({ ref, toggle: false, result: { push: confirmView(command) } });
      return;
    }
    // In the launcher, it runs there like anything picked in it, with what it says in the footer.
    const inFront = launcher.inFront;
    if (command.manifest.mode === 'view' || inFront) {
      if (!inFront) launcher.show();
      launcher.runCommand({ ref, toggle: inFront });
      return;
    }

    const result = await this.options.finish(
      await registry.runAction({ type: 'open-command', ref }, { rootItemId: commandItemId(ref) }),
    );
    if (needsLauncher(result)) {
      launcher.show();
      launcher.runCommand({ ref, toggle: false, result });
      return;
    }
    if (!result.toast) return;
    const failed = result.toastStyle === 'failure';
    if (!failed && this.options.notify(command.manifest.title, result.toast)) return;
    launcher.show();
    launcher.toast({ text: result.toast, style: failed ? 'failure' : 'success' });
  }
}
