/**
 * The verdict half of Work's `assumptions`: one key (an issue id or a `proximity:` finding id), one
 * answer (capped, connect, ignore). The inbox's rows stage these; numeric overrides live in their
 * own cells on the tree rows.
 */
import {
  transitionPatches,
  type DuctAssumption,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";

type Verdict = Extract<DuctAssumption, { kind: "verdict" }>["verdict"];

/** The patches one verdict choice makes on an assumption's cell: stage it, or unstage for `unset`. */
export const verdictPatches = (
  doc: DuctsRouteDocument | null,
  issueId: string,
  choice: Verdict | "unset",
): RouteStatePatch[] =>
  transitionPatches(
    ["assumptions"],
    issueId,
    doc?.assumptions[issueId] ?? {},
    choice === "unset"
      ? { kind: "unstage" }
      : { kind: "stage", rung: { value: { kind: "verdict", verdict: choice } } },
  );
