import { elementSubject } from "@pe/ducts-domain/work-subject";
import type { DuctsApply, DuctsAssignFan, DuctsHeal } from "@pe/host-contracts/generated";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { HealPlan } from "@pe/ducts-domain/heal";
import { healSystems, healWords, networkWord, outcomeWords } from "@pe/ducts-domain/words";
type ReviewEvidence = {
  readonly heal?: import("@pe/agent-contracts").Immutable<Pick<HealPlan,"groups">> | null;
  readonly page?: { readonly stage?: "network" | "calc" };
  readonly work?:
    | import("@pe/agent-contracts").Immutable<import("@pe/ducts-contract/system-work").DuctsRouteDocument>
    | null;
  readonly readings: {
    readonly ducts?: { readonly value?: unknown };
    readonly calcSnapshot?: { readonly value?: unknown };
    readonly fansWork?: {
      readonly value?: import("@pe/agent-contracts").Immutable<
        import("@pe/fans-contract/fans").FansDocument
      >;
    };
  };
};
import { elementLabeler as subjectNamer } from "@pe/ducts-domain/element-label";

const responseOf = <T>(result: unknown): T => {
  const envelope = result as { response?: T; value?: T };
  return envelope.response ?? envelope.value ?? (result as T);
};
// Domain readonly sweep reached 28 files; domain snapshot inputs remain mutable.
const snapshotOf = (scope: ReviewEvidence) =>
  (scope.page?.stage === "calc"
    ? scope.readings.calcSnapshot?.value
    : scope.readings.ducts?.value) as DuctSnapshot | undefined;

export function presentHeal(result: unknown, scope: ReviewEvidence) {
  const native = responseOf<DuctsHeal.Res.Response & {
    derivedRequest?: DuctsHeal.Req.Request;
  }>(result);
  const request = native.derivedRequest;
  const sealed = native.previewOnly && !native.groups ? request : undefined;
  const groups = sealed?.groups.map((group) => ({
    group: group.group, outcome: "planned", systemsBefore: [], systemsAfter: [],
    items: (group.items ?? []).map((item) => ({ ...item, outcome: "planned", created: [], replaced: [] })),
  }));
  const response: DuctsHeal.Res.Response = groups ? {
    previewOnly: true, groups,
    counts: { planned: groups.reduce((count, group) => count + group.items.length, 0), healed: 0, refused: 0 },
  } : native;
  const snapshot = snapshotOf(scope);
  const name = snapshot ? subjectNamer(snapshot) : () => null;
  const plan = scope.heal ?? null;
  const targets = response.groups.flatMap((group) =>
    group.items.map((item) => {
      const proposed = plan?.groups
        .find((g) => g.group === group.group)
        ?.items.find((i) => i.key === item.key);
      const requested = sealed?.groups.find((g) => g.group === group.group)?.items?.find((i) => i.key === item.key);
      return {
        key: item.key,
        end: requested?.end ?? proposed?.end ?? item.key.replace(/^(cap|join):/, "").split("|")[0]!,
        other: requested?.other ?? proposed?.other,
        how: proposed?.how ?? "cap",
        ids: [...(proposed?.ids ?? []), ...(response.previewOnly ? [] : item.created)],
        findings: proposed?.covers ?? [],
        outcome: item.outcome,
      };
    }),
  );
  const author = intentAuthor(scope);
  const lines = response.groups.flatMap((group) =>
    group.items.map((item) => {
      const target = targets.find((t) => t.key === item.key)!;
      const planned = plan?.groups.some((g) => g.items.some((i) => i.key === item.key));
      const subjects = [target.end, target.other]
        .filter((end): end is string => !!end)
        .map((end) => {
          const [id, index] = end.split(":").map(Number);
          const element = [...(snapshot?.nodes ?? []), ...(snapshot?.segments ?? [])].find(
            (e) => e.id === id,
          );
          const port = element?.connectors.find((c) => c.index === index);
          const size =
            port?.shape === "round"
              ? `${port.diameterIn ?? "?"} in round`
              : `${port?.widthIn ?? "?"}×${port?.heightIn ?? "?"} in`;
          return `${name(id!) ?? "duct element"} (${size})`;
        })
        .join(" to ");
      const tail = `${item.outcome}${item.reason || item.check ? ` · ${item.reason ?? item.check}` : ""}`;
      return {
        row: `${item.kind === "cap" ? "Place a cap on" : `Join by ${item.how ?? target.how}`} ${subjects}: ${tail}`,
        // Before is the snapshot's own finding (healPlan read it as open); absent that, unknown.
        cell: {
          key: item.key,
          label: subjects,
          before: planned ? (item.kind === "cap" ? "open end" : "disconnected") : null,
          after: `${item.kind === "cap" ? "capped" : `joined by ${item.how ?? target.how}`} · ${tail}`,
          author,
        },
      };
    }),
  );
  const rows = lines.map((line) => line.row);
  const group = response.groups[0]?.group ?? "";
  const system = snapshot
    ? (healSystems(
        snapshot,
        targets
          .filter((target) => target.outcome === "planned" || target.outcome === "healed")
          .flatMap((target) =>
            [target.end, target.other]
              .filter((end): end is string => !!end)
              .map((end) => Number(end.split(":")[0])),
          ),
      ) ?? networkWord(snapshot, group))
    : "Duct network";
  const sentence = `${system}: ${healWords(response)}`;
  return { sentence, rows, cells: lines.map((line) => line.cell) };
}

/** Who staged the write scope: the ducts Work writeIntent cell's stamped author. */
function intentAuthor(scope: ReviewEvidence): "pea" | "human" | null {
  const by = (scope.work as { writeIntent?: { edit?: { by?: string } } } | null | undefined)
    ?.writeIntent?.edit?.by;
  return by === "pea" || by === "human" ? by : null;
}

/** DuctApplier names loss methods by token; a review speaks Revit's words. */
const METHODS: Record<string, string> = {
  "no server": "no loss method",
  "not-defined": "Not Defined",
  "pe-server": "Pe loss server",
  "specific-loss": "Specific Loss",
  "specific-coefficient": "Specific Coefficient",
  "ashrae-table": "ASHRAE table",
};
/** The loss record's slot keys (C# `DuctApplier.StoreEntries`), as a person reads them. */
const SLOT_WORDS: Record<string, string> = {
  requiredEsp: "fan static",
  fanFlow: "fan flow",
  componentDrop: "component drop",
  terminalDrop: "terminal drop",
  fittingCoefficient: "fitting coefficient",
  terminalFlow: "terminal flow",
};
const spoken = (value: string | null | undefined) =>
  value?.replace(
    /^(no server|not-defined|pe-server|specific-loss|specific-coefficient|ashrae-table)/,
    (m) => METHODS[m]!,
  );

export function presentLosses(result: unknown, scope: ReviewEvidence) {
  const response = responseOf<DuctsApply.Res.Response>(result);
  const envelope = result as {
    derivedRequest?: import("@pe/duct-systems-contract/ducts").DuctsApplyInput;
    receipt?: { result?: { derivedRequest?: import("@pe/duct-systems-contract/ducts").DuctsApplyInput } };
  };
  const request = envelope.derivedRequest ?? envelope.receipt?.result?.derivedRequest;
  const snapshot =
    snapshotOf(scope) ?? (scope.readings.calcSnapshot?.value as DuctSnapshot | undefined);
  const slots = { ...snapshot?.slots, ...request?.slots };
  const name = snapshot ? subjectNamer(snapshot, { unique: true }) : () => null;
  const lines = response.writes.flatMap((write) => {
    const proposed =
      write.kind === "component"
        ? request?.components?.find((r) => r.id === write.id)
        : write.kind === "terminal"
          ? request?.terminals?.find((r) => r.id === write.id)
          : write.kind === "equipment-flow"
            ? request?.equipmentFlows?.find((r) => r.id === write.id)
            : write.kind === "terminal-flow"
              ? request?.terminalFlows?.find((r) => r.id === write.id)
              : write.kind === "equipment"
                ? request?.equipment?.find((r) => r.id === write.id)
                : write.kind === "fitting"
                  ? request?.fittings?.find((r) => r.id === write.id)
                  : undefined;
    const slot =
      write.kind === "equipment-flow"
        ? slots.fanFlow
        : write.kind === "equipment"
          ? slots.requiredEsp
          : write.kind === "component"
            ? "Specific Loss"
            : write.kind === "terminal"
              ? slots.terminalDrop
              : write.kind === "terminal-flow"
                ? proposed && "slot" in proposed ? proposed.slot : slots.terminalFlow: write.kind === "fitting"
                  ? "Loss Method"
                  : proposed && "slot" in proposed
                    ? proposed.slot
                    : (write.key ?? write.kind);
    const next =
      proposed && "inWg" in proposed
        ? `${proposed.inWg} in-wg`
        : proposed && "cfm" in proposed
          ? `${proposed.cfm} cfm`
          : proposed && "externalStaticInWg" in proposed
            ? `${proposed.externalStaticInWg} in-wg`
            : proposed && "coefficient" in proposed
              ? `C = ${proposed.coefficient}`
              : null;
    const source =
      proposed && "source" in proposed
        ? (proposed.source ?? "Work")
        : proposed && "table" in proposed
          ? proposed.table
          : proposed
            ? "Work"
            : "derived Work";
    const tail = `${write.outcome}${write.reason ? ` · ${write.reason}` : ""}`;
    const before = spoken(write.before) ?? null;
    const key = `${write.kind}:${write.id ?? write.key ?? ""}`;
    // The store row is Pe's provenance record in Project Information; its "absent"/"revision n" are machine words.
    // Store and slot rows have no source cell: they have no author, regardless of caller.
    if (write.id == null && write.kind === "slot") {
      const label = `Pe loss record (Project Information): ${SLOT_WORDS[write.key ?? ""] ?? write.key} slot`;
      return {
        row: `${label} ${before ?? "none"} → ${spoken(write.after) ?? "none"} · ${tail}`,
        cell: {
          key,
          label,
          group: "Pe loss record",
          before,
          after: `${spoken(write.after) ?? "none"} · ${tail}`,
          author: null,
        },
      };
    }
    if (write.id == null) {
      const label = "Pe loss record (Project Information)";
      return {
        row: `${label}: ${write.before === "absent" ? "none yet → created" : `${before ?? "not available"} → updated`} · ${tail}`,
        cell: {
          key,
          label,
          group: "Pe loss record",
          before: write.before === "absent" ? "none yet" : before,
          after: `${write.before === "absent" ? "created" : "updated"} · ${tail}`,
          author: null,
        },
      };
    }
    // Write review is an audit: show a searchable id here. element-label.ts stays id-free elsewhere.
    const element = `${write.elementLabel ?? name(write.id) ?? "element"} · ${write.id}`;
    const group = write.kind === "component" &&
      !scope.readings.fansWork?.value?.componentDrops?.[fanSubject(scope, write.id) ?? ""]?.edit
        ? "Computed losses written back" : "Your edits";
    const changes = write.changes?.length ? write.changes : [{
      parameter: write.parameter ?? slot ?? write.kind, before: write.before, after: write.after ?? next,
    }];
    return changes.map((change, index) => {
      const label = `${element} · ${change.parameter}${write.scope ? ` (${write.scope})` : ""}`;
      const reported = change.parameter === "Specific Loss" && write.reportedPressureDropInWg != null
        ? ` (reported effective pressure: ${write.reportedPressureDropInWg} in-wg)` : "";
      const before = change.before == null ? null : `${spoken(change.before)}${reported}`;
      const after = spoken(change.after) ?? "unavailable";
      const remedy = write.outcome === "refused" && /neither|missing|no .*parameter/i.test(write.reason ?? "")
        ? "; add the missing parameter to the family or map to an existing writable parameter" : "";
      return {
        row: `${label}: ${before ?? "unavailable"} → ${after} · source: ${source} · ${tail}${remedy}`,
        cell: {
          key: changes.length === 1 ? key : `${key}:${index}`,
          label, group, before,
          after: `${after} · ${source} · ${tail}${remedy}`,
          author: fanAuthor(scope, write.kind, write.id!),
        },
      };
    });
  });
  return {
    sentence: (slots.requiredEsp === "" ? "Required ESP writes nowhere. " : "") + (response.writes.length
      ? `${response.writes.length} Revit target${response.writes.length === 1 ? "" : "s"}: ${outcomeWords(response)}`
      : "Nothing to write: no native targets were derived from this Work in the selected scope."),
    rows: lines.map((line) => line.row),
    cells: lines.map((line) => line.cell)
      .sort(
        (a, b) =>
          ["Your edits", "Computed losses written back", "Pe loss record"].indexOf(a.group) -
          ["Your edits", "Computed losses written back", "Pe loss record"].indexOf(b.group),
      ),
  };
}

/** The fan Work segment each native write reads; fittings price from ducts rules, not one cell. */
const FAN_SEGMENT = {
  component: "componentDrops",
  terminal: "terminalDrops",
  "equipment-flow": "equipmentFlows",
  "terminal-flow": "flows",
  equipment: "esp",
} as const;
/** The Work cell's stamped author; null when Work does not hold that value (derived or Revit's). */
function fanAuthor(scope: ReviewEvidence, kind: string, id: number): "pea" | "human" | null {
  const segment = FAN_SEGMENT[kind as keyof typeof FAN_SEGMENT];
  const work = scope.readings.fansWork?.value as
    | Readonly<Record<string, Readonly<Record<string, { edit?: { by?: string } }>> | undefined>>
    | null
    | undefined;
  const key = fanSubject(scope, id);
  const by = segment && key ? work?.[segment]?.[key]?.edit?.by : undefined;
  return by === "pea" || by === "human" ? by : null;
}

function fanSubject(scope: ReviewEvidence, id: number) {
  const snapshot = snapshotOf(scope);
  const element = [...(snapshot?.nodes ?? []), ...(snapshot?.segments ?? [])].find(e => e.id === id);
  return element ? elementSubject(element) : null;
}

export const fanWords = (response: DuctsAssignFan.Res.Response) =>
  response.outcome === "refused"
    ? `refused: ${response.reason ?? "refused"}`
    : (response.check ?? response.outcome);
export function presentFan(result: unknown, scope: ReviewEvidence) {
  const native = responseOf<DuctsAssignFan.Res.Response & {
    derivedRequest?: DuctsAssignFan.Req.Request;
  }>(result);
  const request = native.derivedRequest;
  const response = native.previewOnly && native.systemId == null && request
    ? { ...request, previewOnly: true, outcome: "planned" }
    : native;
  const snapshot = snapshotOf(scope);
  const system = snapshot?.systems.find((s) => s.id === response.systemId)?.name ?? "Duct system";
  const unit = snapshot ? subjectNamer(snapshot)(response.unitId) : null;
  return {
    sentence: `${system}: ${fanWords(response)}`,
    rows: [`Make ${unit ?? "the unit"} the fan of ${system}: ${response.outcome}`],
    // The response names no prior fan; before stays unknown rather than guessed from the snapshot.
    cells: [
      {
        key: `fan:${response.systemId}`,
        label: `${system} fan`,
        before: null,
        after: `${unit ?? "the unit"} · ${response.outcome}`,
        author: intentAuthor(scope),
      },
    ],
  };
}
