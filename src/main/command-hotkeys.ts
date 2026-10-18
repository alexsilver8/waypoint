import { globalShortcut } from 'electron';
import {
  type CommandShortcutInfo,
  canonicalAccelerator,
  commandKey,
  commandRefFromKey,
  type HotkeyPlan,
  isUsableAccelerator,
  LAUNCHER_CLASH,
  planCommandHotkeys,
} from '../shared/command-hotkeys';
import type { CommandRef, Platform } from '../shared/types';
import type { GlobalShortcuts, HotkeyManager, SharedShortcuts } from './hotkey';
import type { CommandInfo } from './registry';

/** What the system says when it won't give a shortcut out. */
export const REFUSED = 'It may be invalid, or another app may already use it.';

export interface CommandHotkeysOptions {
  platform: Platform;
  /** The shortcuts set in settings, by command key. */
  wanted(): Readonly<Record<string, string>>;
  /** The commands there are on this computer, by key, with their titles. */
  commands(): ReadonlyMap<string, string>;
  /** The launcher's working shortcut, which comes first. */
  launcherHotkey(): string | undefined;
  /** A command's shortcut was pressed. */
  onPress(ref: CommandRef): void;
  /** Something set in settings can't be used; say so where it will be seen. */
  onProblem(message: string): void;
  /** Which shortcuts work, or why not, changed. */
  onChange(): void;
  shortcuts?: GlobalShortcuts;
}

/**
 * Registers each command's own global shortcut from the `commandHotkeys` setting, again whenever
 * the settings, the commands or the launcher's shortcut change. A shortcut that clashes with the
 * launcher's or another command's, or that the system refuses, isn't registered: it's reported
 * once, and Settings shows why next to it.
 */
export class CommandHotkeys implements SharedShortcuts {
  /** What the system has now, by command key. Empty while paused. */
  private readonly registered = new Map<string, string>();
  private plan: HotkeyPlan = { register: new Map(), problems: new Map() };
  /** The plan as last told, to tell whether anything changed. */
  private committed = describe(this.plan);
  private paused = false;
  /** Problems already reported, so each is told once until it's fixed. */
  private told = new Set<string>();
  private readonly shortcuts: GlobalShortcuts;

  constructor(private readonly options: CommandHotkeysOptions) {
    this.shortcuts = options.shortcuts ?? globalShortcut;
  }

  /** The shortcut that runs this command now (or will once recording ends), if any. */
  activeFor(key: string): string | undefined {
    return this.plan.register.get(key);
  }

  /** Why the shortcut set for this command doesn't work, if it doesn't. */
  problemFor(key: string): string | undefined {
    return this.plan.problems.get(key);
  }

  usedBy(accelerator: string): string | undefined {
    const key = this.holder(accelerator);
    return key === undefined ? undefined : this.options.commands().get(key);
  }

  /** Told along with the launcher's outcome, by the `sync` that follows. */
  release(accelerator: string): void {
    const key = this.holder(accelerator);
    if (key === undefined) return;
    const registered = this.registered.get(key);
    if (registered) this.shortcuts.unregister(registered);
    this.registered.delete(key);
    this.plan.register.delete(key);
    this.plan.problems.set(key, LAUNCHER_CLASH);
  }

  /** Registers what settings ask for and can have, and lets go of the rest. */
  sync(): void {
    const { wanted, commands, launcherHotkey, platform } = this.options;
    const next = planCommandHotkeys({ wanted: wanted(), commands: commands(), launcher: launcherHotkey(), platform });
    for (const [key, accelerator] of [...this.registered]) {
      if (next.register.get(key) === accelerator) continue;
      this.shortcuts.unregister(accelerator);
      this.registered.delete(key);
    }
    if (!this.paused) this.registerAll(next);
    this.commit(next);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    for (const accelerator of this.registered.values()) this.shortcuts.unregister(accelerator);
    this.registered.clear();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    const next = clonePlan(this.plan);
    this.registerAll(next);
    this.commit(next);
  }

  /**
   * Gives a command a shortcut someone recorded: registered first, then the old one let go, so it
   * keeps its old one if the new one can't be used. Returns why it can't.
   */
  trySet(key: string, accelerator: string): string | undefined {
    const title = this.options.commands().get(key);
    if (title === undefined || !commandRefFromKey(key)) return 'That command isn’t available here.';
    if (!isUsableAccelerator(accelerator)) return 'That isn’t a shortcut a command can use.';
    const { platform, launcherHotkey } = this.options;
    const launcher = launcherHotkey();
    if (launcher && same(launcher, accelerator, platform)) return LAUNCHER_CLASH;
    const holder = this.holder(accelerator);
    if (holder !== undefined && holder !== key) return `${this.options.commands().get(holder)} already uses it.`;
    const previous = this.registered.get(key);
    if (previous && same(previous, accelerator, platform)) {
      // The same keys spelled another way: what the system has already does it.
      this.registered.set(key, accelerator);
    } else if (!this.paused) {
      if (!this.tryRegister(key, accelerator)) return `Couldn’t use ${accelerator}. ${REFUSED}`;
      if (previous) this.shortcuts.unregister(previous);
      this.registered.set(key, accelerator);
    }
    const next = clonePlan(this.plan);
    next.register.set(key, accelerator);
    next.problems.delete(key);
    this.commit(next);
    return undefined;
  }

  /**
   * `commandHotkeys` with this command's shortcut set. A shortcut left behind by a command that
   * isn't here goes, since it would take this one back if that command returned.
   */
  settingsWith(current: Readonly<Record<string, string>>, key: string, accelerator: string): Record<string, string> {
    const commands = this.options.commands();
    const kept = Object.entries(current).filter(
      ([other, keys]) => other === key || commands.has(other) || !same(keys, accelerator, this.options.platform),
    );
    return { ...Object.fromEntries(kept), [key]: accelerator };
  }

  /** The command whose working shortcut presses the same keys, if one does. */
  private holder(accelerator: string): string | undefined {
    for (const [key, held] of this.plan.register) {
      if (same(held, accelerator, this.options.platform)) return key;
    }
    return undefined;
  }

  private tryRegister(key: string, accelerator: string): boolean {
    const ref = commandRefFromKey(key);
    if (!ref) return false;
    try {
      return this.shortcuts.register(accelerator, () => this.options.onPress(ref));
    } catch {
      // An accelerator the system can't read throws.
      return false;
    }
  }

  /** Registers what the plan needs that isn't yet; what the system refuses becomes a problem. */
  private registerAll(plan: HotkeyPlan): void {
    for (const [key, accelerator] of [...plan.register]) {
      if (this.registered.get(key) === accelerator) continue;
      if (this.tryRegister(key, accelerator)) {
        this.registered.set(key, accelerator);
      } else {
        plan.register.delete(key);
        plan.problems.set(key, REFUSED);
      }
    }
  }

  /** Takes the plan, tells about problems that are new, and says if anything changed. */
  private commit(next: HotkeyPlan): void {
    const committed = describe(next);
    const changed = committed !== this.committed;
    this.plan = next;
    this.committed = committed;
    const wanted = this.options.wanted();
    const problems = [...next.problems].map(([key, reason]) => ({ key, reason, accelerator: wanted[key] ?? '' }));
    const fresh = problems.filter((problem) => !this.told.has(told(problem)));
    this.told = new Set(problems.map(told));
    if (fresh.length > 0) this.options.onProblem(problemMessage(fresh, this.options.commands()));
    if (changed) this.options.onChange();
  }
}

function same(a: string, b: string, platform: Platform): boolean {
  return canonicalAccelerator(a, platform) === canonicalAccelerator(b, platform);
}

function clonePlan(plan: HotkeyPlan): HotkeyPlan {
  return { register: new Map(plan.register), problems: new Map(plan.problems) };
}

function describe(plan: HotkeyPlan): string {
  return JSON.stringify([[...plan.register], [...plan.problems]]);
}

function told(problem: { key: string; reason: string; accelerator: string }): string {
  return `${problem.key}\u0000${problem.accelerator}\u0000${problem.reason}`;
}

/** One toast for however many shortcuts couldn't be used. */
export function problemMessage(
  problems: Array<{ key: string; reason: string; accelerator: string }>,
  commands: ReadonlyMap<string, string>,
): string {
  const [first] = problems;
  const titleOf = (key: string) => commands.get(key) ?? key;
  if (problems.length === 1 && first) {
    // The footer has room for a line, so what matters comes first.
    return `${first.accelerator} for ${titleOf(first.key)} isn’t working. ${first.reason}`;
  }
  const titles = problems.map((problem) => titleOf(problem.key));
  const list = `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
  return `The shortcuts for ${list} aren’t working. Settings → Extensions says why.`;
}

/**
 * Sets or clears a command's shortcut someone recorded in Settings, and saves it. Returns why it
 * couldn't be used, in which case the old one keeps working. Recording paused every shortcut;
 * this resumes them.
 */
export function changeCommandHotkey(
  launcher: HotkeyManager,
  hotkeys: CommandHotkeys,
  settings: {
    get(): { commandHotkeys: Record<string, string> };
    update(patch: { commandHotkeys: Record<string, string> }): unknown;
  },
  rawKey: unknown,
  accelerator: unknown,
): string | undefined {
  launcher.resume();
  const ref = typeof rawKey === 'string' ? commandRefFromKey(rawKey) : undefined;
  if (!ref) return 'That isn’t a command.';
  const key = commandKey(ref);
  const current = settings.get().commandHotkeys;
  if (accelerator === null) {
    const { [key]: _removed, ...rest } = current;
    settings.update({ commandHotkeys: rest });
    return undefined;
  }
  if (typeof accelerator !== 'string' || !accelerator.trim()) return 'That isn’t a shortcut.';
  const error = hotkeys.trySet(key, accelerator);
  if (error) return error;
  settings.update({ commandHotkeys: hotkeys.settingsWith(current, key, accelerator) });
  return undefined;
}

/** Every command with its shortcut and what's wrong with it, as Settings → Extensions lists them. */
export function commandShortcutList(
  commands: readonly CommandInfo[],
  wanted: Readonly<Record<string, string>>,
  hotkeys: Pick<CommandHotkeys, 'problemFor'>,
): CommandShortcutInfo[] {
  return commands.map(({ ref, manifest, icon, extension }) => {
    const key = commandKey(ref);
    const hotkey = wanted[key];
    const error = hotkeys.problemFor(key);
    return {
      key,
      title: manifest.title,
      ...(icon ? { icon } : {}),
      extension: { name: extension.name, title: extension.title },
      ...(hotkey ? { hotkey } : {}),
      ...(error ? { error } : {}),
    };
  });
}

/** The commands there are, by key, with their titles. */
export function commandTitles(commands: readonly CommandInfo[]): Map<string, string> {
  return new Map(commands.map(({ ref, manifest }) => [commandKey(ref), manifest.title]));
}
