/**
 * Claims and the scene subject are scoped to groups (ruling 2 of 2026-10-20): `claims` stay keyed
 * by claim id, `subject` is keyed by group id, and a claim shows only on the groups that hold its
 * element ids. Pure; a claim with ids in two groups belongs to both.
 */

/** A claim belongs to a group iff any of its ids is an element of that group. */
export function claimsForGroup<C extends { ids: readonly number[] }>(
  claims: Readonly<Record<string, C>>,
  groupElementIds: ReadonlySet<number> | readonly number[],
): Record<string, C> {
  const group = groupElementIds instanceof Set ? groupElementIds : new Set(groupElementIds);
  return Object.fromEntries(
    Object.entries(claims).filter(([, claim]) => claim.ids.some((id) => group.has(id))),
  );
}
