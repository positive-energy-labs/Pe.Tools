/**
 * The verdict half of Work's `assumptions`: one key (an issue id or a `proximity:` finding id), one
 * answer (capped, connect, ignore). The inbox's rows stage these; numeric overrides live in their
 * own cells on the tree rows. An `ignore` the model's store holds is the base: choosing it again
 * clears the delta, taking it back stages a delete (`rulingRung`, ducts-domain `rulings.ts`).
 */
import {
  transitionPatches,
  type DuctAssumption,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { rulingRung, type RulingSegment } from "@pe/ducts-domain/rulings";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

type Verdict = Extract<DuctAssumption, { kind: "verdict" }>["verdict"];

/** The patches one ruling choice makes on its Work cell, against the rulings the store holds. */
export const rulingPatches = (
  doc: DuctsRouteDocument | null,
  store: DuctSnapshot["store"],
  segment: RulingSegment,
  key: string,
  choice: string | null,
): RouteStatePatch[] => {
  const rung = rulingRung(store, segment, key, choice);
  const cell = (doc?.[segment] as Record<string, object> | undefined)?.[key] ?? {};
  return transitionPatches(
    [segment],
    key,
    cell,
    rung === "unstage" ? { kind: "unstage" } : { kind: "stage", rung },
  );
};

/** The patches one verdict choice makes on an assumption's cell: stage it, or take it back for `unset`. */
export const verdictPatches = (
  doc: DuctsRouteDocument | null,
  issueId: string,
  choice: Verdict | "unset",
  store: DuctSnapshot["store"] = null,
): RouteStatePatch[] =>
  rulingPatches(doc, store, "assumptions", issueId, choice === "unset" ? null : choice);
