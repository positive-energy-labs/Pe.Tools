import { z } from "zod";
import type { DuctsApply, DuctsAssignFan, DuctsHeal } from "@pe/host-contracts/generated";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { healPlan } from "@pe/ducts-domain/heal";
import { healSystems, healWords, networkWord, outcomeWords } from "@pe/ducts-domain/words";
import {
  canonicalRouteInput,
  ductsHealInputSchema,
  type DuctsRouteDocument,
} from "@pe/agent-contracts";
import type { VerbPresentation, VerbScope } from "#/shell/verbs";
import { subjectNamer } from "./subject-text";
import type { PricingResult } from "./pricing-job";

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
const snapshotOf = (scope: VerbScope) => scope.readings.ducts?.value as DuctSnapshot | undefined;

export const healReviewBasis = (scope: VerbScope) =>
  canonicalRouteInput({
    target: scope.snapshot.target,
    work: scope.snapshot.work?.handle,
    network: scope.readings.ducts?.basis?.sourceVersion ?? scope.readings.ducts?.version,
  });

export function previewedHeal(scope: VerbScope, request: z.output<typeof ductsHealInputSchema>) {
  const review = scope.page.heal as HealReview | null;
  if (review?.mode !== "preview" || !request.groups.some((g) => g.group === review.group))
    return null;
  if (!scope.readings.ducts?.current || review.basis !== healReviewBasis(scope))
    throw Error("The network or Work changed since the heal preview; preview again");
  return review;
}

export function plannedHeal(request: z.output<typeof ductsHealInputSchema>, evidence: unknown) {
  const response = responseOf<DuctsHeal.Res.Response>(evidence);
  const planned = {
    ...request,
    groups: request.groups
      .map((group) => ({
        ...group,
        items: (group.items ?? []).filter((item) =>
          response.groups.some(
            (g) =>
              g.group === group.group &&
              g.items.some((i) => i.key === item.key && i.outcome === "planned"),
          ),
        ),
      }))
      .filter((group) => group.items.length),
  };
  if (!planned.groups.length) throw Error("Nothing passed the heal preview");
  return planned;
}

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
          return `${name(id!) ?? "duct element"} (element ${id}, end ${index}, ${size})`;
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
  const pricing = scope.readings.pricing?.value as PricingResult | undefined;
  const heal: HealReview = {
    group,
    response,
    basis: healReviewBasis(scope),
    request: {
      groups: response.groups
        .map((group) => ({
          group: group.group,
          items: group.items
            .filter((item) => item.outcome === "planned")
            .map((item) => {
              const target = targets.find((t) => t.key === item.key)!;
              return {
                key: item.key,
                kind: item.kind === "join" ? ("join" as const) : ("cap" as const),
                end: target.end,
                ...(target.other ? { other: target.other } : {}),
              };
            }),
        }))
        .filter((group) => group.items.length),
    },
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
