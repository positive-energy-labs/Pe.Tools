/**
 * The rulings that remain after healing (pressure-drop ledger, 2026-10-20): an `ignore` verdict
 * (leave an open end out, object to an inferred join, keep a default) and a unit's role, `fan` or
 * `passive` (a ruling over the role proposed from its design flow, `unit-roles.ts`).
 * They persist in the model's `_PE_DuctLosses` store (v2 `verdicts`, `roles`), so two people on
 * one model see the same network; Work holds only pending deltas over them. A edit value is a
 * delta, and a edit `{ delete: true }` on an assumption takes a stored verdict back.
 *
 * `withStoredRulings` is the one view every reader prices and triages: the stored rulings as
 * edit cells under Work's own, delete rungs gone. `pendingRulings` names what a write would
 * change in the store; `storeRulings` is the whole ruling set the write sends; `rulingRung` is
 * what a person's choice stages.
 */
import {
  ductsDocumentSchema,
  type DuctAssumption,
  type DuctsRouteDocument,
} from "@pe/agent-contracts";

import type { DuctSnapshot } from "./types.ts";
import type { RosterRuling } from "./roster.ts";

type Store = DuctSnapshot["store"];
export type RulingSegment = "assumptions" | "roles";
export type StoreRulingSegment = RulingSegment | "roster";

/** Store shape only; the C# writer does not persist roster rulings yet. Keys are unitId:portIndex. */
export type RosterStore = { roster: Record<string, RosterRuling> };
export type StoreRulingDelta =
  | RulingDelta
  | {
      segment: "roster";
      key: string;
      from: RosterRuling | null;
      to: RosterRuling | null;
    };

/** One change a write makes to the store's rulings; null is no ruling (an unruled end, a proposed role). */
export interface RulingDelta {
  segment: RulingSegment;
  key: string;
  from: string | null;
  to: string | null;
}

/** The verdicts the store keeps: `ignore` only. Any other edit verdict stays Work's. */
export const STORED_VERDICTS = ["ignore"] as const;
/** The roles the store keeps: both, since a role is proposed and a ruling may confirm either. */
const isRole = (role: string | undefined | null): role is "fan" | "passive" =>
  role === "fan" || role === "passive";
const roleOf = (role: string | undefined | null) => (isRole(role) ? role : null);
const keeps = (verdict: string | undefined | null) =>
  (STORED_VERDICTS as readonly string[]).includes(verdict ?? "");

/** The store's ruling at a key: a verdict on an issue or finding id, or a unit's role. */
export const storedRuling = (store: Store, segment: RulingSegment, key: string) =>
  (segment === "assumptions" ? store?.verdicts?.[key]?.verdict : store?.roles?.[key]?.role) ?? null;

const EMPTY = ductsDocumentSchema.parse({});
const memo = new WeakMap<object, WeakMap<object, DuctsRouteDocument>>();
const NO_STORE = {};

/** The Work as every reader sees it: stored rulings under Work's own deltas. Identity-stable. */
export function withStoredRulings(
  doc: DuctsRouteDocument | null,
  store: Store,
): DuctsRouteDocument | null {
  const verdicts = Object.entries(store?.verdicts ?? {});
  const roles = Object.entries(store?.roles ?? {});
  const deletes = Object.values(doc?.assumptions ?? {}).some((cell) => cell.edit?.delete);
  if (!verdicts.length && !roles.length && !deletes) return doc;
  const base = doc ?? EMPTY;
  const byStore = memo.get(base) ?? memo.set(base, new WeakMap()).get(base)!;
  const hit = byStore.get(store ?? NO_STORE);
  if (hit) return hit;
  const assumptions = Object.fromEntries(
    Object.entries(base.assumptions).map(([key, cell]) => [
      key,
      cell.edit?.delete ? { ...cell, edit: null } : cell,
    ]),
  );
  for (const [key, { verdict }] of verdicts)
    if (keeps(verdict) && !base.assumptions[key]?.edit)
      assumptions[key] = {
        ...base.assumptions[key],
        edit: { value: { kind: "verdict", verdict: verdict as "ignore" } },
      };
  const rolesOut = { ...base.roles };
  for (const [id, { role }] of roles)
    if (isRole(role) && !base.roles[id]?.edit)
      rolesOut[id] = { ...base.roles[id], edit: { value: { role } } };
  const effective = { ...base, assumptions, roles: rolesOut } as DuctsRouteDocument;
  byStore.set(store ?? NO_STORE, effective);
  return effective;
}

/** What a write would change in the store's rulings: Work's edit deltas that differ from it. */
export function pendingRulings(doc: DuctsRouteDocument | null, store: Store): RulingDelta[] {
  const out: RulingDelta[] = [];
  for (const [key, cell] of Object.entries(doc?.assumptions ?? {})) {
    if (!cell.edit) continue;
    const from = storedRuling(store, "assumptions", key);
    const value = cell.edit.value;
    const to = cell.edit.delete
      ? null
      : value?.kind === "verdict" && keeps(value.verdict)
        ? value.verdict
        : // A verdict the store does not keep over a stored one takes that one back.
          value?.kind === "verdict"
          ? null
          : from;
    if (to !== from) out.push({ segment: "assumptions", key, from, to });
  }
  for (const [key, cell] of Object.entries(doc?.roles ?? {})) {
    if (!cell.edit) continue;
    const from = roleOf(storedRuling(store, "roles", key));
    const to = roleOf(cell.edit.value.role);
    if (to !== from) out.push({ segment: "roles", key, from, to });
  }
  return out.sort((a, b) => a.segment.localeCompare(b.segment) || a.key.localeCompare(b.key));
}

/**
 * The store's whole ruling set after a write, from the edit cells of the Work as read
 * (`withStoredRulings`): every `ignore` verdict and every role, stamped `at` unless the store
 * already holds that same ruling, which keeps its own time.
 */
export function storeRulings(
  edit: {
    assumptions: Record<string, DuctAssumption>;
    roles: Record<string, { role: string }>;
  },
  store: Store,
  at: string,
) {
  const verdicts = Object.fromEntries(
    Object.entries(edit.assumptions).flatMap(([key, value]) =>
      value.kind === "verdict" && keeps(value.verdict)
        ? [
            [
              key,
              {
                verdict: value.verdict,
                ruledAt:
                  store?.verdicts?.[key]?.verdict === value.verdict
                    ? store.verdicts[key]!.ruledAt
                    : at,
              },
            ] as const,
          ]
        : [],
    ),
  );
  const roles = Object.fromEntries(
    Object.entries(edit.roles).flatMap(([id, { role }]) =>
      isRole(role)
        ? [
            [
              id,
              {
                role,
                ruledAt: store?.roles?.[id]?.role === role ? store.roles[id]!.ruledAt : at,
              },
            ] as const,
          ]
        : [],
    ),
  );
  return { verdicts, roles };
}

/**
 * The rung a person's choice stages on a ruling cell, against the store: choosing what the store
 * holds clears the delta (`null`); taking a stored ruling back stages a delete on an assumption;
 * a role is always a choice (`fan` or `passive`), so ruling the proposed one keeps it as a ruling;
 * `unstage` clears a pending ruling the store never held.
 */
export function rulingRung(
  store: Store,
  segment: RulingSegment,
  key: string,
  choice: string | null,
): { value: unknown } | { delete: true } | "unstage" {
  const stored = storedRuling(store, segment, key);
  const held = segment === "roles" ? roleOf(stored) : stored;
  if (choice === held) return "unstage";
  if (choice === null) return segment === "assumptions" ? { delete: true } : "unstage";
  return segment === "assumptions"
    ? { value: { kind: "verdict", verdict: choice } }
    : { value: { role: choice } };
}
