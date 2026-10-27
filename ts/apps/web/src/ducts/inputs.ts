/**
 * What the tree rows and the rules pane read, derived and never stored: the resolved value of each
 * input either author can edit (terminal flow and drop, a unit's flow, ESP and role) with its source,
 * a group's name from its system and root units, and a rule's fan-out before editing.
 */
import type { FlowSource } from "@pe/ducts-domain/terminal-flows";
import { slotWord } from "./airflow";
import { proposedStatic, type Priced } from "@pe/ducts-domain/pricing";
import { unitFlowIn } from "@pe/ducts-domain/survey";
import { groupTree, type GroupTree } from "@pe/ducts-domain/topology";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

/** A flow's source rung in the words the cell's quiet text uses. */
const flowSourceWord = (source: FlowSource | "override" | "revit" | null) =>
  source == null
    ? null
    : source === "override"
      ? "override"
      : source === "revit"
        ? "Revit"
        : source.startsWith("rooms")
          ? "rooms"
          : "load preview";

export interface Resolved<T> {
  /** The value Pe would use now; null when no rung holds one. */
  value: T | null;
  /** The rung it came from; null when none. */
  word: string | null;
}

export interface TerminalInputs {
  flow: Resolved<number>;
  drop: Resolved<number>;
}

/**
 * A terminal's resolved flow (precedence in `terminalFlows`) and drop (edit, else the priced
 * row's). A flow read from Revit names the parameter it came from (the airflow slot, `airflow.ts`).
 */
export function terminalInputs(
  priced: Priced,
  id: number,
  from: string | null = null,
): TerminalInputs {
  const flow = priced.flows.get(id);
  const edit = priced.edit.terminalDrops[String(id)];
  const row = priced.next.paths[id]?.rows.find((r) => r.id === id && r.kind === "terminal");
  return {
    flow: {
      value: flow?.cfm ?? null,
      word:
        flow?.source === "revit" && from ? slotWord(from) : flowSourceWord(flow?.source ?? null),
    },
    drop: edit
      ? { value: edit.inWg, word: "override" }
      : row?.dp != null
        ? { value: row.dp, word: row.source ? "catalog" : row.leg === "ps" ? "Revit" : "Pe" }
        : { value: null, word: null },
  };
}

export interface EquipmentInputs {
  flow: Resolved<number>;
  esp: Resolved<number>;
  role: Resolved<"fan" | "passive"> & { reason?: string };
}

/**
 * A unit's role as the cell says it: `ruled` (the model's store), `override` (edit), `proposed`
 * from its design flow with the reason (`unit-roles.ts`), else the `default` fan.
 */
function unitRoleInput(
  priced: Priced,
  id: number,
  edit: { role: "fan" | "passive" } | undefined,
): Resolved<"fan" | "passive"> & { reason?: string } {
  const r = priced.roles.get(id);
  if (!r) return edit ? { value: edit.role, word: "override" } : { value: "fan", word: "default" };
  const word = r.why === "edit" ? "override" : r.why;
  return { value: r.role, word, reason: r.reason };
}

/**
 * A unit's resolved flow, external static (edit, else the fan Pe computes) and role (ruled,
 * edit, else proposed). The flow is the one `groups` (the open system's) price it at
 * (`unitFlowIn`): a derived flow sums the grilles it serves there, never another system's.
 */
export function equipmentInputs(
  snapshot: DuctSnapshot,
  priced: Priced,
  id: number,
  groups: readonly string[] | null = null,
): EquipmentInputs {
  const flow = unitFlowIn(priced, id, groups);
  const esp = priced.edit.esp[String(id)];
  const role = priced.edit.roles[String(id)];
  const computed = esp ? null : proposedStatic(snapshot, priced.next, id);
  return {
    flow: {
      value: flow?.cfm ?? null,
      // A derived flow is a reading; writing it requires an explicit edit and host command.
      word:
        flow?.source === "derived"
          ? `sum of ${flow.grilles} grille${flow.grilles === 1 ? "" : "s"}`
          : flowSourceWord(flow?.source ?? null),
    },
    esp: esp
      ? { value: esp.inWg, word: "override" }
      : computed
        ? { value: computed.total, word: "Pe" }
        : { value: null, word: null },
    role: unitRoleInput(priced, id, role),
  };
}

type FanOut = { grilles: number; systems: number };

// Captured topology and rule maps are immutable; a refresh or new pricing supplies new identities.
const fanOutCache = new WeakMap<
  DuctSnapshot,
  { groupOf: Map<number, string>; rules: WeakMap<ReadonlyMap<number, string>, Map<string, FanOut>> }
>();

/**
 * What editing a rule's table would move, before the edit is made: the instances the rule prices (from
 * the priced rows, `ruleOf`), the systems they sit in, and every terminal downstream of any one of
 * them, since each of those grilles' paths carries the fitting.
 */
export function ruleFanOut(
  snapshot: DuctSnapshot,
  ruleOf: ReadonlyMap<number, string>,
  ruleKey: string,
  /** Group trees already built, shared across rules so a pane of rules builds each once. */
  trees: Map<string, GroupTree> = new Map(),
): FanOut {
  let cache = fanOutCache.get(snapshot);
  if (!cache) {
    const groupOf = new Map<number, string>();
    for (const n of snapshot.nodes) if (n.groupId) groupOf.set(n.id, n.groupId);
    for (const s of snapshot.segments) if (s.groupId) groupOf.set(s.id, s.groupId);
    cache = { groupOf, rules: new WeakMap() };
    fanOutCache.set(snapshot, cache);
  }
  let fanOuts = cache.rules.get(ruleOf);
  if (!fanOuts) cache.rules.set(ruleOf, (fanOuts = new Map()));
  const cached = fanOuts.get(ruleKey);
  if (cached) return cached;
  const { groupOf } = cache;
  const instances = [...ruleOf].filter(([, key]) => key === ruleKey).map(([id]) => id);
  const systems = new Set<string>();
  const grilles = new Set<number>();
  for (const id of instances) {
    const group = groupOf.get(id);
    if (!group) continue;
    systems.add(group);
    const tree = trees.get(group) ?? trees.set(group, groupTree(snapshot, group)).get(group)!;
    const stack = [id];
    const seen = new Set<number>();
    while (stack.length) {
      const at = stack.pop()!;
      if (seen.has(at)) continue;
      seen.add(at);
      if (tree.parts.get(at)?.node?.kind === "terminal") grilles.add(at);
      stack.push(...(tree.children.get(at) ?? []));
    }
  }
  const fanOut = { grilles: grilles.size, systems: systems.size };
  fanOuts.set(ruleKey, fanOut);
  return fanOut;
}

/** The fan-out as the chip says it. */
export const fanOutWords = ({ grilles, systems }: { grilles: number; systems: number }) =>
  `moves ${grilles} grille${grilles === 1 ? "" : "s"} in ${systems} system${systems === 1 ? "" : "s"}`;
