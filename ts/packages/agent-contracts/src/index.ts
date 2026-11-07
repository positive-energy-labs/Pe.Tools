export * from "./api-schemas.ts";
export * from "./route-module.ts";
// Attention projects admitted codecs (ADR 0030 rule 10); the shell takes them through the barrel.
export type { RouteBindings } from "./route-bodies.ts";
export { admittedBuiltinKeys } from "./admitted-builtin-keys.ts";
export * from "./write-intent.ts";
export * from "./catalog-work.ts";

export * from "./work-value.ts";

export type { PodRouteAuthoring } from "./pod-authoring.ts";
export {
  field,
  manyField,
  manyCodec,
  resolveMany,
  decodePageField,
  sortField,
  keyedSetField,
  orderedListField,
} from "./route-field.ts";

export * from "./duct-catalog.ts";
export * from "./input-lane.ts";
export * from "./recording-points.ts";

export type { Immutable, RouteGraphJson } from "./route-kernel-data.ts";
export type { BodyBindings, WorkPatch, PaneContext, BodyContext, ReadingSnapshot } from "./route-kernel-bodies.ts";
export type { HostRouteModule, HostAdmittedRoute, HostWorkRegistration } from "./host-route-admission.ts";
export { jsonCodec, identityCodecs } from "./route-kernel-codecs.ts";
export { captureHostModule } from "./host-route-admission.ts";
export type { KernelServices, ResolvedRead } from "./route-kernel-environment.ts";
export { commandCatalogAxes } from "./command-axes.ts";
export { ductsPictureFields } from "./routes/picture.ts";
export { ductsAddress } from "./routes/ducts.ts";
export { threadListFields } from "./routes/shared.ts";

export type { InvocationToken, IdentityId, Many } from "./route-kernel-page.ts";
export type { LayoutJson } from "./route-kernel-data.ts";
export type { EntryContract, WorkHistoryPort } from "./route-kernel-bodies.ts";
export type { WorkJournalDoor, WorkScope } from "./work-journal-door.ts";
export { workFingerprintSchema, type RouteFingerprint } from "./route-kernel-admission.ts";
export { bare } from "./route-field.ts";
export { subjectSchema, focusSelectionSchema } from "./route-kernel-codecs.ts";
export { workFeedFailureMessage } from "./work-journal-door.ts";
export type { WorkFeedFailure } from "./work-journal-door.ts";
export { presentationSchema } from "./route-kernel-bodies.ts";
export * from "./history.ts";
