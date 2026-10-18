/**
 * Aliases for single commands: a short word you type in the root search to put that command
 * first, like `lh` for Left Half. One per command, one command per alias, case not counting.
 */
import { commandKey, commandRefFromKey } from './command-hotkeys';

const MAX_ALIAS = 32;

/** How an alias is kept and compared: trimmed and lowercase. */
export function normalizeAlias(alias: string): string {
  return alias.trim().toLowerCase();
}

/** Why `alias` can't be an alias, or `undefined` if it can. */
export function aliasProblem(alias: string): string | undefined {
  const value = normalizeAlias(alias);
  if (!value) return 'Type an alias.';
  if (/\s/.test(value)) return 'An alias can’t have spaces in it.';
  if (value.length > MAX_ALIAS) return 'That alias is too long.';
  return undefined;
}

/**
 * The `commandAliases` setting, keeping the entries that name a command and give it a usable
 * alias. An empty alias is how you'd clear one by hand, so it's dropped without a word. An alias
 * written twice stays with the command written first.
 */
export function normalizeCommandAliases(raw: unknown, problems: string[]): Record<string, string> {
  const aliases: Record<string, string> = {};
  if (raw === undefined) return aliases;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    problems.push('Ignoring invalid value for "commandAliases".');
    return aliases;
  }
  const taken = new Map<string, string>();
  for (const [key, value] of Object.entries(raw)) {
    if (value === '' || value === null) continue;
    const ref = commandRefFromKey(key);
    if (!ref) {
      problems.push(`Ignoring "commandAliases.${key}": name a command as "<extension>/<command>".`);
    } else if (typeof value !== 'string' || aliasProblem(value)) {
      problems.push(`Ignoring invalid alias for "commandAliases.${key}".`);
    } else {
      const alias = normalizeAlias(value);
      const holder = taken.get(alias);
      if (holder !== undefined) {
        problems.push(`Ignoring "commandAliases.${key}": "${holder}" already has the alias "${alias}".`);
      } else {
        taken.set(alias, commandKey(ref));
        aliases[commandKey(ref)] = alias;
      }
    }
  }
  return aliases;
}

/**
 * `commandAliases` with this command's alias set, or cleared with `null` or an empty one, or why
 * it can't be. An alias another command here has is refused, naming that command, as a shortcut
 * is; one left behind by a command that isn't here goes, so it can't take it back later.
 */
export function withCommandAlias(
  current: Readonly<Record<string, string>>,
  key: string,
  alias: string | null,
  commands: ReadonlyMap<string, string>,
): { aliases: Record<string, string> } | { error: string } {
  const { [key]: _previous, ...rest } = current;
  if (alias === null || !alias.trim()) return { aliases: rest };
  if (!commands.has(key)) return { error: 'That command isn’t available here.' };
  const problem = aliasProblem(alias);
  if (problem) return { error: problem };
  const value = normalizeAlias(alias);
  const holder = Object.keys(rest).find((other) => rest[other] === value);
  const title = holder === undefined ? undefined : commands.get(holder);
  if (title !== undefined) return { error: `${title} already has that alias.` };
  const kept = Object.entries(current).filter(([other]) => other !== holder);
  return { aliases: { ...Object.fromEntries(kept), [key]: value } };
}
