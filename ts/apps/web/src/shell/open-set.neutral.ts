/** An open subject set and its one active member, two explicit concepts (kaitpw 2026-11-03).
 * `active` is omitted while it is the first member, so a URL without it means the first; `all`
 * opens the whole roster and its active is the roster's first. */
export type OpenSet<T> =
  | { readonly kind: "ids"; readonly ids: readonly T[]; readonly active?: T }
  | { readonly kind: "all" };
/** The set's moves over a roster, by identity key. Adding never moves the active member, except
 * that the first subject into an empty set is active; removing the active one hands it to its
 * next neighbour, else the previous. */
export function openSet<T>(key: (id: T) => string, roster: readonly T[]) {
  const same = (a: T | undefined, b: T | undefined) =>
    a !== undefined && b !== undefined && key(a) === key(b);
  const members = (value: OpenSet<T>) => (value.kind === "all" ? roster : value.ids);
  const active = (value: OpenSet<T>) =>
    value.kind === "all" ? roster[0] : (value.active ?? value.ids[0]);
  const of = (ids: readonly T[], next: T | undefined): OpenSet<T> =>
    next === undefined || same(ids[0], next) || !ids.some((id) => same(id, next))
      ? { kind: "ids", ids: [...ids] }
      : { kind: "ids", ids: [...ids], active: next };
  const has = (value: OpenSet<T>, id: T) => members(value).some((open) => same(open, id));
  const add = (value: OpenSet<T>, more: readonly T[]): OpenSet<T> =>
    value.kind === "all"
      ? value
      : of(
          [
            ...value.ids,
            ...more.filter((id, i) => !has(value, id) && more.findIndex((m) => same(m, id)) === i),
          ],
          active(value),
        );
  const remove = (value: OpenSet<T>, id: T): OpenSet<T> => {
    const ids = members(value);
    const at = ids.findIndex((open) => same(open, id));
    if (at < 0) return value;
    const was = active(value);
    return of(
      ids.filter((_, i) => i !== at),
      same(was, id) ? (ids[at + 1] ?? ids[at - 1]) : was,
    );
  };
  return {
    members,
    active,
    add,
    remove,
    toggle: (value: OpenSet<T>, id: T) => (has(value, id) ? remove(value, id) : add(value, [id])),
    setActive: (value: OpenSet<T>, id: T) =>
      of(has(value, id) ? members(value) : [...members(value), id], id),
  };
}
