import { z } from "zod";
import type { DuctsApply, DuctsAssignFan, DuctsHeal } from "@pe/host-contracts/generated";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { HealView as HealPlan } from "@pe/ducts-domain/pricing-view";
import { healSystems, healWords, networkWord, outcomeWords } from "@pe/ducts-domain/words";
import { ductsHealInputSchema } from "@pe/agent-contracts";
type ReviewEvidence = {
  readonly heal?: import("@pe/agent-contracts").Immutable<Pick<HealPlan,"groups">> | null;
  readonly page?: { readonly stage?: "network" | "sheet" };
  readonly work?:
    | import("@pe/agent-contracts").Immutable<import("@pe/agent-contracts").DuctsRouteDocument>
    | null;
  readonly readings: {
    readonly ducts?: { readonly value?: unknown };
    readonly sheetSnapshot?: { readonly value?: unknown };
    readonly fansWork?: {
      readonly value?: import("@pe/agent-contracts").Immutable<
        import("@pe/agent-contracts").FansDocument
      >;
    };
  };
};
import { elementLabeler as subjectNamer } from "@pe/ducts-domain/element-label";

export const healReviewSchema = z.object({
  group: z.string(),
  mode: z.enum(["preview", "apply"]),
  // Evidence remains host-owned; the picture consumes the typed targets and words below.
  response: z.unknown(),
  basis: z.string(),
  request: ductsHealInputSchema.extend({
    groups: z.array(ductsHealInputSchema.shape.groups.element),
  }),
  before: z.object({
    esp: z.number().nullable(),
    roots: z.array(z.number()),
    ids: z.array(z.number()),
  }),
  targets: z.array(
    z.object({
      key: z.string(),
      end: z.string(),
      other: z.string().optional(),
      how: z.enum(["cap", "connect", "union", "extend"]),
      ids: z.array(z.number()),
      findings: z.array(z.string()),
      outcome: z.string(),
    }),
  ),
  sentence: z.string(),
  rows: z.array(z.string()),
});
export type HealReview = z.infer<typeof healReviewSchema>;
const responseOf = <T>(result: unknown): T => {
  const envelope = result as { response?: T; value?: T };
  return envelope.response ?? envelope.value ?? (result as T);
};
// Domain readonly sweep reached 28 files; domain snapshot inputs remain mutable.
const snapshotOf = (scope: ReviewEvidence) =>
  (scope.page?.stage === "sheet"
    ? scope.readings.sheetSnapshot?.value
    : scope.readings.ducts?.value) as DuctSnapshot | undefined;

export function presentHeal(result: unknown, scope: ReviewEvidence) {
  const response = responseOf<DuctsHeal.Res.Response>(result);
  const snapshot = snapshotOf(scope);
  const name = snapshot ? subjectNamer(snapshot) : () => null;
  const plan = scope.heal ?? null;
  const targets = response.groups.flatMap((group) =>
    group.items.map((item) => {
      const proposed = plan?.groups
        .find((g) => g.group === group.group)
        ?.items.find((i) => i.key === item.key);
      return {
        key: item.key,
        end: proposed?.end ?? item.key.replace(/^(cap|join):/, "").split("|")[0]!,
        other: proposed?.other,
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
function intentAuthor(scope: ReviewEvidence): "pea" | "human" | "unknown" {
  const by = (scope.work as { writeIntent?: { edit?: { by?: string } } } | null | undefined)
    ?.writeIntent?.edit?.by;
  return by === "pea" || by === "human" ? by : "unknown";
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
  fanStatic: "fan static",
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
    seal?: { caller?: { kind?: string } };
    derivedRequest?: import("@pe/agent-contracts").DuctsApplyInput;
    receipt?: { result?: { derivedRequest?: import("@pe/agent-contracts").DuctsApplyInput } };
  };
  const caller = envelope.seal?.caller?.kind;
  const author: "human" | "pea" | null = caller === "human" || caller === "pea" ? caller : null;
  const request = envelope.derivedRequest ?? envelope.receipt?.result?.derivedRequest;
  const snapshot =
    snapshotOf(scope) ?? (scope.readings.sheetSnapshot?.value as DuctSnapshot | undefined);
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
          ? slots.fanStatic
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
    // A slot entry names the slot the value resolver now reads (after), not only the record's old name.
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
          author: author ?? ("unknown" as const),
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
          author: author ?? ("unknown" as const),
        },
      };
    }
    // Write review is an audit: show a searchable id here. element-label.ts stays id-free elsewhere.
    const element = `${write.elementLabel ?? name(write.id) ?? "element"} · ${write.id}`;
    const group = write.kind === "component" &&
      !scope.readings.fansWork?.value?.componentDrops?.[String(write.id)]?.edit
        ? "Computed losses written back" : "Your edits";
    const changes = write.changes?.length ? write.changes : [{
      parameter: write.parameter ?? slot ?? write.kind, before: write.before, after: write.after ?? next,
    }];
    return changes.map((change, index) => {
      const label = `${element} · ${change.parameter}${write.scope ? ` (${write.scope})` : ""}`;
      const reported = change.parameter === "Specific Loss" && write.reportedPressureDropInWg != null
        ? ` (reported effective pressure: ${write.reportedPressureDropInWg} in-wg)` : "";
      const before = `${spoken(change.before) ?? "unavailable"}${reported}`;
      const after = write.outcome === "refused" ? "not written" : spoken(change.after) ?? "unavailable";
      const remedy = write.outcome === "refused" && /neither|missing|no .*parameter/i.test(write.reason ?? "")
        ? "; add the missing parameter to the family or map to an existing writable parameter" : "";
      return {
        row: `${label}: ${before} → ${after} · source: ${source} · ${tail}${remedy}`,
        cell: {
          key: changes.length === 1 ? key : `${key}:${index}`,
          label, group, before,
          after: `${after} · ${source} · ${tail}${remedy}`,
          author: author ?? fanAuthor(scope, write.kind, write.id!),
        },
      };
    });
  });
  return {
    sentence: response.writes.length
      ? `${response.writes.length} Revit target${response.writes.length === 1 ? "" : "s"}: ${outcomeWords(response)}`
      : "Nothing to write: no native targets were derived from this Work in the selected scope.",
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
/** The Work cell's stamped author; "unknown" when Work does not hold that value (derived or Revit's). */
function fanAuthor(scope: ReviewEvidence, kind: string, id: number): "pea" | "human" | "unknown" {
  const segment = FAN_SEGMENT[kind as keyof typeof FAN_SEGMENT];
  const work = scope.readings.fansWork?.value as
    | Readonly<Record<string, Readonly<Record<string, { edit?: { by?: string } }>> | undefined>>
    | null
    | undefined;
  const by = segment ? work?.[segment]?.[String(id)]?.edit?.by : undefined;
  return by === "pea" || by === "human" ? by : "unknown";
}

export const fanWords = (response: DuctsAssignFan.Res.Response) =>
  response.outcome === "refused"
    ? `refused: ${response.reason ?? "refused"}`
    : (response.check ?? response.outcome);
export function presentFan(result: unknown, scope: ReviewEvidence) {
  const response = responseOf<DuctsAssignFan.Res.Response>(result);
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
