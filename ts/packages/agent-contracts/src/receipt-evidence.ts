import { z } from "zod";
import { addressSchema } from "./target.ts";
import { basisSchema } from "./caller.ts";
import { consumedSchema, commandRefusalSchema } from "./command.ts";
import { effectSchema } from "./run-registry.ts";

// Retained v8 evidence is not fresh authority. Freeze its identity fields independently of live
// DocumentRef/Work encoders; never translate a retained broker id into an SDK label.
const incarnation = z.strictObject({
  pid: z.number().int().positive(),
  startedAt: z.number().int().positive(),
});
export const retainedDocumentRefSchema = z.strictObject({
  session: z.string().min(1),
  openId: z.string().min(1),
  processIncarnation: incarnation.optional(),
});
export type RetainedDocumentRef = z.infer<typeof retainedDocumentRefSchema>;
export const retainedOriginalTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("host") }),
  z.strictObject({
    kind: z.literal("sdk-session"),
    selection: z.union([
      z.strictObject({ id: z.string().min(1) }),
      z.strictObject({ pid: z.number().int().positive() }),
    ]),
  }),
  z.strictObject({
    kind: z.literal("session"),
    session: z.string().min(1),
    processIncarnation: incarnation.optional(),
  }),
  z.strictObject({ kind: z.literal("document"), ref: retainedDocumentRefSchema }),
]);
export type RetainedOriginalTarget = z.infer<typeof retainedOriginalTargetSchema>;

const workFields = {
  route: z.string().min(1).max(100),
  target: z.null(),
  work: z.never().optional(),
  open: z.never().optional(),
};
export const retainedWorkKeySchema = z.discriminatedUnion("binding", [
  z.object({
    ...workFields,
    binding: z.literal("address"),
    target: addressSchema,
    from: retainedDocumentRefSchema.optional(),
  }),
  z.object({ ...workFields, binding: z.literal("open"), open: retainedDocumentRefSchema }),
  z.object({
    ...workFields,
    binding: z.literal("workspace"),
    work: z.string().trim().min(1).max(200),
  }),
  z.object({ ...workFields, binding: z.literal("host") }),
]);
export type RetainedWorkKey = z.infer<typeof retainedWorkKeySchema>;
const handle = z.strictObject({
  key: retainedWorkKeySchema,
  revision: z.number().int().nonnegative(),
});
const [human, pin, acquisition, grant, full, empty] = basisSchema.options;
export const retainedBasisSchema = z.discriminatedUnion("kind", [
  human,
  pin.extend({ lifetime: retainedDocumentRefSchema }),
  acquisition.extend({
    scope: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("document"), lifetime: retainedDocumentRefSchema }),
      z.strictObject({ kind: z.literal("process"), session: z.string() }),
      z.strictObject({ kind: z.literal("release") }),
    ]),
  }),
  grant.extend({ lifetime: retainedDocumentRefSchema }),
  full.extend({ lifetime: retainedDocumentRefSchema }),
  empty,
]);
const [work, member, file, mark, process, ...otherConsumed] = consumedSchema.options;
export const retainedConsumedSchema = z.discriminatedUnion("kind", [
  work.extend({ probe: work.shape.probe.extend({ handle }) }),
  member,
  file,
  mark.extend({
    probe: z.union([
      z.strictObject({ ref: retainedDocumentRefSchema, takenAt: z.string() }),
      z.strictObject({
        ref: retainedDocumentRefSchema,
        sealed: z.strictObject({
          observedSince: z.number().nullable(),
          changedAt: z.number().nullable(),
        }),
      }),
    ]),
  }),
  process.extend({ probe: process.shape.probe.extend({ target: retainedOriginalTargetSchema }) }),
  ...otherConsumed,
]);
const [invalid, revision, stale, ...otherRefusals] = commandRefusalSchema.options;
export const retainedRefusalSchema = z.discriminatedUnion("kind", [
  invalid,
  revision.extend({ handle }),
  stale.extend({ consumed: z.array(retainedConsumedSchema) }),
  ...otherRefusals,
]);
const [document, ...otherEffects] = effectSchema.options;
export const retainedFootprintSchema = z.array(
  z.discriminatedUnion("kind", [
    document.extend({ ref: retainedDocumentRefSchema }),
    ...otherEffects,
  ]),
);
