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

export const hostOperationNeedsSchema = Schema.Literals([
  "nothing",
  "document",
  "project-document",
  "family-document",
]);
export type HostOperationNeeds = Schema.Schema.Type<typeof hostOperationNeedsSchema>;

/** Source vocabulary of C# OpActor; product eligibility projects to actual principals. */
export const hostOperationActorSchema = Schema.Literals(["any", "human"]);
export type HostOperationActor = Schema.Schema.Type<typeof hostOperationActorSchema>;

export const hostErrorKindSchema = Schema.Literals([
  "Disconnected",
  "BridgeBusy",
  "InvalidRequest",
  "Conflict",
  "CatalogLookup",
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
  actor: Schema.optional(hostOperationActorSchema),
  usesTransactions: Schema.optional(Schema.Boolean),
  needs: hostOperationNeedsSchema,
  costTier: Schema.optional(hostOperationCostTierSchema),
  visibility: Schema.optional(hostOperationVisibilitySchema),
  requestExamples: Schema.optional(Schema.Array(hostOperationRequestExampleSchema)),
  requestSchemaJson: Schema.optional(Schema.String),
  responseSchemaJson: Schema.optional(Schema.String),
  safeDefaultRequestJson: Schema.optional(Schema.NullOr(Schema.String)),
  callGuidance: Schema.optional(Schema.Array(Schema.String)),
});
export type HostOperationDefinition = Schema.Schema.Type<typeof hostOperationDefinitionSchema>;
