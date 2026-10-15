import type {
  DuctsAnalysisRequest,
  DuctsAnalysisResponse,
  DuctsRouteDocument,
} from "@pe/agent-contracts";
import { proposedStatic, unitOf, type Priced } from "./pricing.ts";
import { groupTree, terminalCfm } from "./topology.ts";
import type { GroupReadiness } from "./readiness.ts";
import type { DuctSnapshot } from "./types.ts";

const space = (node: DuctSnapshot["nodes"][number]) =>
  node.facts.find((fact) => fact.key === "space")?.text ?? null;
const terminal = (node: DuctSnapshot["nodes"][number]) => node.kind === "terminal";

/** One pure assessment for headless and human consumers. Observation coherence is supplied by
 * the acquiring adapter; demand completeness does not require a known existing fan capacity. */
export function assessDucts(
  snapshot: DuctSnapshot,
  work: DuctsRouteDocument | null,
  solved: Pick<Priced, "now" | "next"> & { readiness: Record<string, GroupReadiness> },
  options: {
    selector: DuctsAnalysisRequest["selector"];
    freshness?: Pick<DuctsAnalysisResponse["freshness"], "state" | "reason">;
  } = { selector: { kind: "document" } },
) {
  const { now, next } = solved;
  const freshness = options.freshness ?? {
    state: "unknown",
    reason: "Observation freshness is unknown",
  };
  const terminals = snapshot.nodes.filter(terminal);
  const equipmentIds = [
    ...new Set([
      ...snapshot.nodes.filter((node) => node.kind === "equipment").map((node) => node.id),
      ...snapshot.groups.flatMap((group) => group.rootIds),
    ]),
  ].sort((a, b) => a - b);
  const selector = options.selector;
  let groups = snapshot.groups;
  let selectedTerminals = terminals;
  let state: DuctsAnalysisResponse["selection"]["state"] = "matched";
  if (selector.kind === "equipment")
    groups = groups.filter(
      (group) =>
        group.rootIds.includes(selector.id) || unitOf(snapshot, next, group) === selector.id,
    );
  if (selector.kind === "group") groups = groups.filter((group) => group.id === selector.id);
  if (selector.kind === "terminal" || selector.kind === "space-text") {
    selectedTerminals = terminals.filter((node) =>
      selector.kind === "terminal"
        ? node.id === selector.id
        : space(node)?.toLocaleLowerCase("en-US") === selector.text.toLocaleLowerCase("en-US"),
    );
    const groupIds = new Set(selectedTerminals.map((node) => node.groupId));
    groups = groups.filter((group) => groupIds.has(group.id));
    // Text has no stable Space id/phase/link identity in the native snapshot.
    if (selector.kind === "space-text" && selectedTerminals.length) state = "ambiguous";
  }
  const groupIds = new Set(groups.map((group) => group.id));
  if (selector.kind === "equipment" || selector.kind === "group")
    selectedTerminals = selectedTerminals.filter((node) => groupIds.has(node.groupId ?? ""));
  if (
    !groups.length ||
    ((selector.kind === "terminal" || selector.kind === "space-text") && !selectedTerminals.length)
  )
    state = "not-found";
  if (selector.kind === "equipment" && equipmentIds.includes(selector.id)) state = "matched";
  if (selector.kind === "equipment" && groups.some((group) => group.rootIds.length !== 1))
    state = "ambiguous";
  const reasons = new Map<string, { code: string; count: number; message: string }>();
  const reason = (code: string, count: number, message: string) => {
    if (count) reasons.set(code, { code, count, message });
  };
  const issues = new Map(snapshot.issues.map((issue) => [issue.id, issue]));
  reason(
    "selection",
    state === "matched" ? 0 : 1,
    `Selection is ${state}; space text cannot prove a stable room identity`,
  );
  reason(
    "freshness",
    freshness.state === "fresh" ? 0 : 1,
    freshness.reason ?? "Observation freshness is unknown",
  );
  let topology = 0,
    blockers = 0;
  for (const group of groups) {
    const tree = groupTree(snapshot, group.id);
    if (tree.rooted !== "port" || tree.extraRoots.length || tree.backEdges.length) topology++;
    const ready = solved.readiness[group.id];
    // Fan rating is needed to compare capacity, never to compute required external static.
    blockers +=
      (ready?.walk.length ?? 0) +
      (ready?.budget.filter((key) => issues.get(key)?.kind !== "no-fan-static").length ?? 0);
  }
  reason("topology", topology, "Stand-in roots, multiple roots or loops affect the selected graph");
  reason(
    "unresolved-inputs",
    blockers,
    "Unresolved topology, flow, component-drop or roughness inputs remain",
  );
  const reportedTerminals = groups.reduce((sum, group) => sum + group.terminalCount, 0);
  const fullGroupSelection =
    selector.kind === "document" || selector.kind === "group" || selector.kind === "equipment";
  const expectedTerminals = fullGroupSelection
    ? Math.max(selectedTerminals.length, reportedTerminals)
    : selectedTerminals.length;
  reason(
    "terminal-census-mismatch",
    fullGroupSelection ? Math.abs(reportedTerminals - selectedTerminals.length) : 0,
    "Reported group terminal counts and retained terminal nodes differ; selection coverage is incomplete",
  );
  const reached = selectedTerminals.filter((node) => next.paths[node.id]);
  const dropKnown = (node: DuctSnapshot["nodes"][number]) => {
    const drop = node.terminalDrop;
    // Assigned connector loss has no catalog-source provenance, even under SpecificLoss.
    // A named catalog parameter or a person's staged value can explicitly state zero as well.
    return (
      drop?.catalogDropInWg != null ||
      work?.terminalDrops[String(node.id)]?.staged?.value !== undefined
    );
  };
  const priced = reached.filter(
    (node) => dropKnown(node) && !next.paths[node.id]!.rows.some((row) => row.error),
  );
  reason(
    "terminal-drop-authority",
    selectedTerminals.filter((node) => !dropKnown(node)).length,
    "An assigned connector loss, including SpecificLoss/zero, does not attest catalog provenance; name a catalog parameter or stage an explicit terminal drop",
  );
  reason(
    "unreached-terminals",
    selectedTerminals.length - reached.length,
    "Expected terminals have no calculated path",
  );
  reason(
    "unpriced-terminals",
    reached.length - priced.length,
    "Calculated paths contain unpriced rows or lack stated terminal catalog losses; totals include known arithmetic contributions only",
  );
  reason(
    "unknown-terminal-flow",
    selectedTerminals.filter((node) => terminalCfm(node) == null).length,
    "Terminal design flow is unknown",
  );
  const selectedNodes = snapshot.nodes.filter((node) => groupIds.has(node.groupId ?? ""));
  reason(
    "unreadable-model-store",
    snapshot.storeError ? 1 : 0,
    "The model loss store is unreadable; applied table and provenance choices are unknown",
  );
  reason(
    "native-family-coefficient-parity",
    selectedNodes.filter((node) =>
      node.facts.some(
        (fact) => fact.key === "familyCoefficient" && fact.value != null && fact.value > 0,
      ),
    ).length,
    "Shared arithmetic does not apply the native positive family-coefficient precedence",
  );
  reason(
    "staged-assumptions-not-physical",
    Object.values(work?.assumptions ?? {}).filter((cell) => cell.staged != null).length,
    "Staged assumptions affect readiness but are not all consumed by the numerical solver",
  );
  reason(
    "native-accessory-drop-parity",
    selectedNodes.filter(
      (node) =>
        node.kind === "accessory" &&
        node.facts.some((fact) => fact.key === "pressureDrop" && fact.value != null),
    ).length,
    "Shared arithmetic prices accessories by table or staged drop; native own-drop precedence is not verified",
  );
  reason(
    "native-negative-coefficient-parity",
    reached.filter((node) => next.paths[node.id]!.rows.some((row) => row.c != null && row.c < 0))
      .length,
    "Native coefficient clamping differs from the current shared arithmetic",
  );
  reason(
    "no-terminal-demand",
    selectedTerminals.length ? 0 : 1,
    "No terminal demand was available for this selection",
  );
  const ownEquipment =
    selector.kind === "document"
      ? equipmentIds
      : selector.kind === "equipment"
        ? equipmentIds.filter((id) => id === selector.id)
        : equipmentIds.filter((unit) =>
            groups.some(
              (group) => group.rootIds.includes(unit) || unitOf(snapshot, next, group) === unit,
            ),
          );
  reason(
    "unserved-equipment",
    ownEquipment.filter(
      (id) =>
        !groups.some((group) => group.rootIds.includes(id) || unitOf(snapshot, next, group) === id),
    ).length,
    "Equipment is present but has no resolved served group; role and demand remain unknown",
  );
  const independentStreams = (unit: number) =>
    new Set(
      snapshot.groups
        .filter((group) => group.rootIds.includes(unit) || unitOf(snapshot, next, group) === unit)
        .flatMap((group) => group.classifications),
    ).size > 1;
  reason(
    "unresolved-fan-circuits",
    ownEquipment.filter(independentStreams).length,
    "Multiple air classifications serve this equipment; the model does not establish a shared physical fan circuit. Classification maxima are retained; their sum is arithmetic, not a verified single-fan ESP",
  );
  const equipment = ownEquipment.map((unit) => ({
    id: unit,
    now: proposedStatic(snapshot, now, unit),
    next: proposedStatic(snapshot, next, unit),
    servedGroupState: groups.some(
      (group) => group.rootIds.includes(unit) || unitOf(snapshot, next, group) === unit,
    )
      ? ("observed" as const)
      : ("unknown" as const),
    requiredEspNowInWg: independentStreams(unit)
      ? null
      : (proposedStatic(snapshot, now, unit)?.total ?? null),
    requiredEspStagedInWg: independentStreams(unit)
      ? null
      : (proposedStatic(snapshot, next, unit)?.total ?? null),
    classificationParts: (proposedStatic(snapshot, next, unit)?.parts ?? []).map((part) => ({
      classification: part.kind,
      nowInWg:
        proposedStatic(snapshot, now, unit)?.parts.find((now) => now.kind === part.kind)?.fan ??
        null,
      stagedInWg: part.fan,
    })),
  }));
  return {
    groups,
    selectedTerminals,
    reached,
    equipment,
    terminalDrops: Object.fromEntries(selectedTerminals.map((node) => [node.id, dropKnown(node)])),
    selection: {
      state,
      total:
        selector.kind === "space-text" || selector.kind === "terminal"
          ? selectedTerminals.length
          : selector.kind === "equipment"
            ? ownEquipment.length
            : groups.length,
      candidates: selectedTerminals.slice(0, 100).map((node) => node.id),
    },
    completeness: {
      basis: "staged-demand",
      verdict: state === "not-found" ? "unknown" : reasons.size ? "partial" : "complete",
      reasons: [...reasons.values()],
      expectedTerminals,
      reachedTerminals: reached.length,
      pricedTerminals: priced.length,
      spaceTextHave: selectedTerminals.filter((node) => space(node)).length,
      spaceTextOf: selectedTerminals.length,
    } satisfies DuctsAnalysisResponse["completeness"],
    coverage: {
      groups: snapshot.groups.length,
      equipment: equipmentIds.length,
      terminals: terminals.length,
      scope:
        "Collected HVAC-connector graph. Equipment without HVAC connectors and stable room identity are outside this snapshot.",
    },
  };
}
