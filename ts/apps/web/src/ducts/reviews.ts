import { z } from "zod";
import type { DuctsApply, DuctsAssignFan, DuctsHeal } from "@pe/host-contracts/generated";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { healPlan } from "@pe/ducts-domain/heal";
import { healWords, networkWord, outcomeWords } from "@pe/ducts-domain/words";
import type { DuctsRouteDocument } from "@pe/agent-contracts";
import type { VerbPresentation, VerbScope } from "#/shell/verbs";
import { subjectNamer } from "./subject-text";
import type { PricingResult } from "./pricing-job";

export const healReviewSchema = z.object({
  group: z.string(),
  mode: z.enum(["preview", "apply"]),
  // Evidence remains host-owned; the picture consumes the typed targets and words below.
  response: z.unknown(),
  before: z.object({
    esp: z.number().nullable(),
    roots: z.array(z.number()),
    ids: z.array(z.number()),
  }),
  targets: z.array(
    z.object({
      key: z.string(),
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
const snapshotOf = (scope: VerbScope) => scope.readings.ducts?.value as DuctSnapshot | undefined;

export function presentHeal(result: unknown, scope: VerbScope): VerbPresentation {
  const response = responseOf<DuctsHeal.Res.Response>(result);
  const snapshot = snapshotOf(scope);
  const name = snapshot ? subjectNamer(snapshot) : () => null;
  const plan = snapshot
    ? healPlan(snapshot, scope.snapshot.work?.doc as DuctsRouteDocument | null)
    : null;
  const targets = response.groups.flatMap((group) =>
    group.items.map((item) => {
      const proposed = plan?.groups
        .find((g) => g.group === group.group)
        ?.items.find((i) => i.key === item.key);
      return {
        key: item.key,
        ids: [...(proposed?.ids ?? []), ...(response.previewOnly ? [] : item.created)],
        findings: proposed?.covers ?? [],
        outcome: item.outcome,
      };
    }),
  );
  const rows = response.groups.flatMap((group) =>
    group.items.map((item) => {
      const target = targets.find((t) => t.key === item.key)!;
      const subjects = target.ids.map((id) => name(id) ?? "duct element").join(" to ");
      return `${item.how ?? item.kind}${subjects ? ` ${subjects}` : ""}: ${item.outcome}${item.reason || item.check ? ` · ${item.reason ?? item.check}` : ""}`;
    }),
  );
  const group = response.groups[0]?.group ?? "";
  const sentence = `${snapshot ? networkWord(snapshot, group) : "Duct network"}: ${healWords(response)}`;
  const pricing = scope.readings.pricing?.value as PricingResult | undefined;
  const heal: HealReview = {
    group,
    response,
    targets,
    sentence,
    rows,
    mode: response.previewOnly ? "preview" : "apply",
    before: {
      esp: pricing?.priced?.next.byGroup[group]?.fan ?? null,
      roots: snapshot?.groups.find((g) => g.id === group)?.rootIds ?? [],
      ids: [...new Set(targets.flatMap((t) => t.ids))],
    },
  };
  return {
    sentence,
    rows,
    page: { heal, layers: [...new Set([...((scope.page.layers as string[]) ?? []), "findings"])] },
  };
}

export function presentLosses(result: unknown, scope: VerbScope): VerbPresentation {
  const response = responseOf<DuctsApply.Res.Response>(result);
  const snapshot = snapshotOf(scope);
  const name = snapshot ? subjectNamer(snapshot) : () => null;
  return {
    sentence: outcomeWords(response),
    rows: response.writes.map(
      (write) =>
        `${write.kind.replaceAll("-", " ")} ${(write.id == null ? null : name(write.id)) ?? "duct element"}: ${write.outcome}${write.before != null || write.after != null ? ` · ${write.before ?? "none"} → ${write.after ?? "none"}` : ""}${write.reason ? ` · ${write.reason}` : ""}`,
    ),
  };
}

export const fanWords = (response: DuctsAssignFan.Res.Response) =>
  response.outcome === "refused"
    ? `refused: ${response.reason ?? "refused"}`
    : (response.check ?? response.outcome);
export function presentFan(result: unknown, scope: VerbScope): VerbPresentation {
  const response = responseOf<DuctsAssignFan.Res.Response>(result);
  const snapshot = snapshotOf(scope);
  const system = snapshot?.systems.find((s) => s.id === response.systemId)?.name ?? "Duct system";
  const unit = snapshot ? subjectNamer(snapshot)(response.unitId) : null;
  return {
    sentence: `${system}: ${fanWords(response)}`,
    rows: [`Make ${unit ?? "the unit"} the fan of ${system}: ${response.outcome}`],
  };
}
