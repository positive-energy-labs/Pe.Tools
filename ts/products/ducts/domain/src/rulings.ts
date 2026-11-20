/** The rulings that remain after healing (pressure-drop ledger, 2026-10-20): an `ignore` verdict (leave an open end out, object to an inferred join, keep a default) and a unit's role, `fan` or `passive` (a ruling over the role proposed from its design flow, `unit-roles.ts`). */
import {
  ductsDesign,
  stagedValues,
  type DuctsApplyInput,
  type DuctsDesign,
} from "@pe/duct-systems-contract/ducts";
import { type DuctAssumption } from "@pe/ducts-contract/system-work";
import { neutralFansWork } from "@pe/fans-contract/fans";

import { elementSubject, workElementId } from "./work-subject.ts";
import type { DuctSnapshot } from "./types.ts";

type Store = DuctSnapshot["store"];
export type RulingSegment = "assumptions" | "roles";

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

const EMPTY = ductsDesign(null, neutralFansWork);
const memo = new WeakMap<object, WeakMap<object, WeakMap<object, DuctsDesign>>>();
const NO_STORE = {};

/** The Work as every reader sees it: stored rulings under Work's own deltas. Identity-stable. */
export function withStoredRulings(
  doc: DuctsDesign | null,
  store: Store,
  snapshot: { readonly nodes: readonly { readonly id: number; readonly uniqueId: string }[] },
): DuctsDesign | null {
  const verdicts = Object.entries(store?.verdicts ?? {});
  const roles = Object.entries(store?.roles ?? {}).flatMap(([id, value]) => {
    const node = snapshot.nodes.find((n) => n.id === Number(id));
    return node ? [[elementSubject(node), value] as const] : [];
  });
  const deletes = Object.values(doc?.assumptions ?? {}).some((cell) => cell.edit?.delete);
  if (!verdicts.length && !roles.length && !deletes) return doc;
  const base = doc ?? EMPTY;
  const bySnapshot = memo.get(base) ?? memo.set(base, new WeakMap()).get(base)!;
  const byStore =
    bySnapshot.get(snapshot) ?? bySnapshot.set(snapshot, new WeakMap()).get(snapshot)!;
  const hit = byStore.get(store ?? NO_STORE);
  if (hit) return hit;
  const assumptions = Object.fromEntries(
    Object.entries(base.assumptions).map(([key, cell]) => [
      key,
      cell.edit?.delete ? { ...cell, edit: null } : cell,
    ]),
  );
  // Model-store rulings are calculation inputs, never persisted Work edits. They have no caller
  // stamp: retain that absence rather than inventing an author for evidence read from the model.
  const storedAssumptions = Object.fromEntries(
    verdicts
      .filter(([key, { verdict }]) => keeps(verdict) && !base.assumptions[key]?.edit)
      .map(([key, { verdict }]) => [
        key,
        {
          ...base.assumptions[key],
          edit: { value: { kind: "verdict", verdict: verdict as "ignore" } },
        },
      ]),
  );
  const storedRoles = Object.fromEntries(
    roles
      .filter(([id, { role }]) => isRole(role) && !base.roles[id]?.edit)
      .map(([id, { role }]) => [
        id,
        {
          ...base.roles[id],
          edit: { value: { role } },
        },
      ]),
  );
  const effective = {
    ...base,
    assumptions: { ...assumptions, ...storedAssumptions },
    roles: { ...base.roles, ...storedRoles },
  } as DuctsDesign;
  byStore.set(store ?? NO_STORE, effective);
  return effective;
}

/** What a write would change in the store's rulings: Work's edit deltas that differ from it. */
export function pendingRulings(
  doc: DuctsDesign | null,
  store: Store,
  snapshot: Pick<DuctSnapshot, "nodes" | "segments">,
): RulingDelta[] {
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
    const from = roleOf(storedRuling(store, "roles", String(workElementId(snapshot, key))));
    const to = roleOf(cell.edit.value.role);
    if (to !== from) out.push({ segment: "roles", key, from, to });
  }
  return out.sort((a, b) => a.segment.localeCompare(b.segment) || a.key.localeCompare(b.key));
}

/** The store's whole ruling set after a write, from the edit cells of the Work as read (`withStoredRulings`): every `ignore` verdict and every role, stamped `at` unless the store already holds that same ruling, which keeps its own time. */
export function storeRulings(
  edit: {
    assumptions: Record<string, DuctAssumption>;
    roles: Record<string, { role: string }>;
  },
  store: Store,
  at: string,
  snapshot: Pick<DuctSnapshot, "nodes" | "segments">,
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
    Object.entries(edit.roles)
      .map(([key, value]) => [String(workElementId(snapshot, key)), value] as const)
      .flatMap(([id, { role }]) =>
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

/** The rung a person's choice stages on a ruling cell, against the store: choosing what the store holds clears the delta (`null`); taking a stored ruling back stages a delete on an assumption; a role is always a choice (`fan` or `passive`), so ruling the proposed one keeps it as a ruling; `unstage` clears a pending ruling the store never held. */
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

/**
 * What the /duct-systems door sends (D9, P19): the staged rule tables and the verdict set over the store, and no
 * element row. `cells` are the Work cells this write lands. A verdict the store does not keep stays Work's; fan
 * roles are the /fans apply's and are neither read nor sent here.
 */
export function rulingsRequest(
  design: DuctsDesign,
  snapshot: Pick<DuctSnapshot, "nodes" | "segments" | "store" | "slots">,
  appliedAt: string,
) {
  const store = snapshot.store,
    own = { ...design, roles: {} };
  const { verdicts } = storeRulings(
    stagedValues(withStoredRulings(own, store, snapshot), own),
    store,
    appliedAt,
    snapshot,
  );
  const rules = stagedValues(own, own).rules;
  const deltas = pendingRulings(own, store, snapshot);
  const input: DuctsApplyInput = {
    slots: { ...snapshot.slots, requiredEsp: snapshot.slots.requiredEsp ?? "" },
    fittings: [],
    terminals: [],
    components: [],
    equipment: [],
    terminalFlows: [],
    equipmentFlows: [],
    store: { version: 2, workRevision: store?.workRevision ?? 0, appliedAt, rules, verdicts },
    // The native store overlays per key (K3): a verdict Work takes back is removed only by naming it here.
    storeDeletes: {
      verdicts: Object.keys(store?.verdicts ?? {}).filter((key) => !(key in verdicts)),
    },
  };
  return {
    input,
    cells: [
      ...Object.keys(rules).map((key) => ["rules", key] as const),
      ...deltas
        .filter((delta) => delta.to !== null || design.assumptions[delta.key]?.edit?.delete)
        .map((delta) => ["assumptions", delta.key] as const),
    ],
    nothingToWrite: !Object.keys(rules).length && !deltas.length,
  };
}
