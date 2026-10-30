import { z } from "zod";
import {
  canonicalRouteInput,
  stagedParameterProfile,
  type ParameterLinksDocument,
  type ReadingRequest,
} from "@pe/agent-contracts";
import type { Readings } from "#/readings";
import type { FieldOption, FieldOptionStatus } from "#/host/field-options";
import { subscriptionSource } from "#/shell/readings-use";
import type { UseSource } from "#/shell/readings";
import type { ParameterLinksPage } from "./graph";

const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().nullish(),
  metadata: z.record(z.string(), z.string()).nullish(),
});
export type OptionList = { items: FieldOption[]; status: FieldOptionStatus };
export type ProfileOptions = Readonly<Record<string, OptionList>>;
export const optionKey = (key: string, context: Record<string, string> = {}) =>
  canonicalRouteInput([key, context]);
export const emptyOptions: OptionList = { items: [], status: "pending" };
export const profileOptions = (
  options: ProfileOptions,
  key: string,
  context: Record<string, string> = {},
) => options[optionKey(key, context)] ?? emptyOptions;

/** All option demand is scoped to the mounted profile, including unsaved category/parameter edits. */
export function parameterLinksOptionsSource(resources?: Readings): UseSource<ProfileOptions> {
  const profileOf = (scope: { page: unknown; work: unknown }) =>
    (scope.page as ParameterLinksPage).buffer?.profile ??
    (scope.work ? stagedParameterProfile(scope.work as ParameterLinksDocument) : null);
  return {
    kind: "use",
    key: profileOf,
    async open(ctx, deliver) {
      const target = ctx.target.kind === "document" ? ctx.target.ref : null;
      const profile = profileOf(ctx);
      if (!target || !profile?.definitions.length)
        return deliver({ kind: "complete", value: {}, revision: 0 });
      const values: Record<string, OptionList> = {};
      const started = new Set<string>();
      const releases: (() => void)[] = [];
      let serial = 0;
      let scheduling = false;
      let reschedule = false;
      const publish = () => {
        if (!ctx.signal.aborted)
          deliver({ kind: "complete", value: { ...values }, revision: ++serial });
      };
      const demand = (key: string, context: Record<string, string> = {}) => {
        const id = optionKey(key, context);
        if (started.has(id)) return values[id] ?? emptyOptions;
        started.add(id);
        values[id] = emptyOptions;
        void Promise.resolve(
          subscriptionSource({
            request: (): ReadingRequest => ({ kind: "field-options", target, key, context }),
            decode: (value) => z.object({ items: z.array(optionSchema) }).parse(value),
            resources,
          }).open(ctx, (publication) => {
            if (ctx.signal.aborted) return;
            if (publication.kind === "complete")
              values[id] = { items: publication.value.items, status: "ready" };
            else if (publication.kind === "failure")
              values[id] = { items: values[id]?.items ?? [], status: "failed" };
            else if (publication.kind === "stale" || publication.kind === "pending")
              values[id] = { items: values[id]?.items ?? [], status: "pending" };
            else return;
            schedule();
            publish();
          }),
        )
          .then((release) => {
            if (!release) return;
            if (ctx.signal.aborted) release();
            else releases.push(release);
          })
          .catch(() => {
            if (ctx.signal.aborted) return;
            values[id] = { items: values[id]?.items ?? [], status: "failed" };
            publish();
          });
        return values[id]!;
      };
      const schedule = () => {
        if (scheduling) {
          reschedule = true;
          return;
        }
        scheduling = true;
        do {
          reschedule = false;
          const categories = demand("category-ids");
          for (const definition of profile.definitions) {
            if (!definition.sourceCategoryId) continue;
            const category = String(definition.sourceCategoryId);
            demand("element-unique-ids", { CategoryId: category });
            const assignments = profile.assignments.filter(
              (assignment) => assignment.definitionId === definition.id && assignment.enabled,
            );
            const ids = assignments.some((assignment) => !assignment.sourceElementUniqueIds.length)
              ? []
              : [
                  ...new Set(
                    assignments.flatMap((assignment) => assignment.sourceElementUniqueIds),
                  ),
                ];
            const source = demand("parameter-identities", {
              CategoryId: category,
              ParameterScope: "instanceThenType",
              ...(ids.length ? { ElementUniqueIds: ids.join("\n") } : {}),
            });
            const ref = definition.sourceParameter;
            const selected = source.items.find(
              (option) =>
                (ref.identity?.key && option.metadata?.key === ref.identity.key) ||
                (ref.sharedGuid && option.metadata?.sharedGuid === ref.sharedGuid) ||
                (ref.name && option.metadata?.name?.toLowerCase() === ref.name.toLowerCase()),
            );
            const targetCategory =
              definition.relationship === "sameElement"
                ? category
                : categories.items.find(
                    (option) => option.metadata?.builtInCategory === "OST_ElectricalCircuit",
                  )?.value;
            if (!targetCategory || targetCategory === "0") continue;
            demand("parameter-identities", {
              CategoryId: targetCategory,
              ParameterScope: "instance",
            });
            demand("parameter-identities", {
              CategoryId: targetCategory,
              ParameterScope: "instance",
              WritableOnly: "true",
              ...(selected?.metadata?.storageType
                ? { StorageType: selected.metadata.storageType }
                : {}),
              ...(selected?.metadata?.dataTypeId
                ? { DataTypeId: selected.metadata.dataTypeId }
                : {}),
            });
          }
        } while (reschedule);
        scheduling = false;
      };
      schedule();
      publish();
      return () => {
        for (const release of releases.splice(0)) release();
      };
    },
  };
}
