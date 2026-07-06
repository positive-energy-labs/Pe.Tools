// Hand-authored vocabulary for the runtime op catalog (/ops entries): intent, cost
// tier, visibility, error kinds, request examples. Keep aligned with the C# records
// in Pe.Shared.HostContracts.Operations.
import { Schema } from "effect";

export const hostOperationIntentSchema = Schema.Literals(["Read", "Mutate"]);
export type HostOperationIntent = Schema.Schema.Type<typeof hostOperationIntentSchema>;

export const hostOperationCostTierSchema = Schema.Literals([
  "Cheap",
  "Bounded",
  "Expensive",
  "Mutation",
]);
export type HostOperationCostTier = Schema.Schema.Type<typeof hostOperationCostTierSchema>;

export const hostOperationVisibilitySchema = Schema.Literals([
  "DefaultVisible",
  "EscalationVisible",
  "ExpertOnly",
]);
export type HostOperationVisibility = Schema.Schema.Type<typeof hostOperationVisibilitySchema>;

export const hostErrorKindSchema = Schema.Literals([
  "Disconnected",
  "BridgeBusy",
  "InvalidRequest",
  "Conflict",
  "HostFailure",
]);
export type HostErrorKind = Schema.Schema.Type<typeof hostErrorKindSchema>;

export const hostOperationRequestExampleSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  json: Schema.String,
});
export type HostOperationRequestExample = Schema.Schema.Type<
  typeof hostOperationRequestExampleSchema
>;

export const hostOperationDefinitionSchema = Schema.Struct({
  key: Schema.String,
  requestTypeName: Schema.optional(Schema.String),
  responseTypeName: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  searchTerms: Schema.optional(Schema.Array(Schema.String)),
  intent: Schema.optional(hostOperationIntentSchema),
  requiresActiveDocument: Schema.optional(Schema.Boolean),
  costTier: Schema.optional(hostOperationCostTierSchema),
  visibility: Schema.optional(hostOperationVisibilitySchema),
  requestExamples: Schema.optional(Schema.Array(hostOperationRequestExampleSchema)),
  safeDefaultRequestJson: Schema.optional(Schema.NullOr(Schema.String)),
  callGuidance: Schema.optional(Schema.Array(Schema.String)),
});
export type HostOperationDefinition = Schema.Schema.Type<typeof hostOperationDefinitionSchema>;
