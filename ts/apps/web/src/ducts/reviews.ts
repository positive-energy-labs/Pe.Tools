import { z } from "zod";
import type { DuctsApply, DuctsAssignFan, DuctsHeal } from "@pe/host-contracts/generated";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { healPlan } from "@pe/ducts-domain/heal";
import { healSystems, healWords, networkWord, outcomeWords } from "@pe/ducts-domain/words";
import { ductsHealInputSchema, ductsDesign, neutralFansWork } from "@pe/agent-contracts";
import type { BodyContext } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { ductsData, schemas, entries } from "./neutral.ts";
type ReviewContext = BodyContext<
  typeof ductsData,
  typeof schemas,
  typeof entries,
  typeof ductsData.verbs.losses
>;
type ReviewEvidence = {
  readonly page?: Partial<Omit<ReviewContext["page"], "stage">> & {
    readonly stage?: "network" | "sheet";
  };
  readonly work?: ReviewContext["work"] | null;
  readonly readings: {
    readonly [K in keyof ReviewContext["readings"]]?: Pick<ReviewContext["readings"][K], "value">;
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
  const plan = snapshot
    ? // U4 wires the real fans Work here.
      healPlan(snapshot, ductsDesign(scope.work ?? null, neutralFansWork))
    : null;
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
  const rows = response.groups.flatMap((group) =>
    group.items.map((item) => {
      const target = targets.find((t) => t.key === item.key)!;
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
      return `${item.kind === "cap" ? "Place a cap on" : `Join by ${item.how ?? target.how}`} ${subjects}: ${item.outcome}${item.reason || item.check ? ` · ${item.reason ?? item.check}` : ""}`;
    }),
  );
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
  return { sentence, rows };
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
    derivedRequest?: import("@pe/agent-contracts").DuctsApplyInput;
    receipt?: { result?: { derivedRequest?: import("@pe/agent-contracts").DuctsApplyInput } };
  };
  const request = envelope.derivedRequest ?? envelope.receipt?.result?.derivedRequest;
  const snapshot =
    snapshotOf(scope) ?? (scope.readings.sheetSnapshot?.value as DuctSnapshot | undefined);
  const slots = { ...snapshot?.slots, ...request?.slots };
  const name = snapshot ? subjectNamer(snapshot) : () => null;
  return {
    sentence: response.writes.length
      ? `${response.writes.length} Revit target${response.writes.length === 1 ? "" : "s"}: ${outcomeWords(response)}`
      : "Nothing to write: no native targets were derived from this Work in the selected scope.",
    rows: response.writes.map((write) => {
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
      // The store row is Pe's provenance record in Project Information; its "absent"/"revision n" are machine words.
      // A slot entry names the slot the value resolver now reads (after), not only the record's old name.
      if (write.id == null && write.kind === "slot")
        return `Pe loss record (Project Information): ${SLOT_WORDS[write.key ?? ""] ?? write.key} slot ${spoken(write.before) ?? "none"} → ${spoken(write.after) ?? "none"} · ${tail}`;
      if (write.id == null)
        return `Pe loss record (Project Information): ${write.before === "absent" ? "none yet → created" : `${spoken(write.before) ?? "not available"} → updated`} · ${tail}`;
      return `${name(write.id) ?? "element"} · ${slot ?? write.kind}: ${spoken(write.before) ?? "not available"} → ${spoken(write.after) ?? next ?? "derived from Work"} · source: ${source} · ${tail}`;
    }),
  };
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
  };
}
