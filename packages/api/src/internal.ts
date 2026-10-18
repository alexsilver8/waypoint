// Small runtime helpers the builders share. Nothing here is exported from the package, and no
// public signature may use a type from this file (the declaration bundle leaves it out).

/** The entries that are something, so a list can hold `condition && entry`. */
export function present<T>(values: ReadonlyArray<T | false | 0 | '' | null | undefined> | undefined): T[] {
  return (values ?? []).filter((value): value is T => Boolean(value));
}

/** A copy without the keys whose value is `undefined`, so built objects carry only what was set. */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
