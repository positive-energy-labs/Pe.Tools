// SHIM: deleted at graft when host-ops.generated.ts carries pod.*, family.*, families.*, schedule.*
import { Schema } from "effect";

/** A pod member, everywhere: manifest `id` plus the member's pod-relative path. */
export const podMemberSchema = Schema.Struct({ pod: Schema.String, path: Schema.String });
export type PodMember = Schema.Schema.Type<typeof podMemberSchema>;

/** The exact member bytes an apply consumed. */
export const podMemberSourceSchema = Schema.Struct({
  pod: Schema.String,
  path: Schema.String,
  sha256: Schema.String,
});
export type PodMemberSource = Schema.Schema.Type<typeof podMemberSourceSchema>;

export const memberIssueSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  path: Schema.String,
  severity: Schema.Literals(["error", "warning", "info"]),
  suggestion: Schema.optional(Schema.NullOr(Schema.String)),
});
export type MemberIssue = Schema.Schema.Type<typeof memberIssueSchema>;

const dependencySchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  sha256: Schema.String,
});

export const podListResponseSchema = Schema.Struct({
  pods: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      version: Schema.String,
      folder: Schema.String,
      entrypoints: Schema.Array(Schema.String),
      members: Schema.Array(
        Schema.Struct({
          path: Schema.String,
          sha256: Schema.String,
          schema: Schema.NullOr(Schema.String),
        }),
      ),
      diagnostics: Schema.Array(memberIssueSchema),
    }),
  ),
  /** Folders whose `pod.json` could not name a pod; they list nothing else. */
  unreadable: Schema.Array(Schema.Struct({ folder: Schema.String, message: Schema.String })),
});
export type PodList = Schema.Schema.Type<typeof podListResponseSchema>;

export const podMemberReadResponseSchema = Schema.Struct({
  content: Schema.String,
  sha256: Schema.String,
});

export const podMemberWriteRequestSchema = Schema.Struct({
  pod: Schema.String,
  path: Schema.String,
  content: Schema.String,
  /** Absent: create, refusing an existing path. Present: replace only these exact bytes. */
  expectedSha256: Schema.optional(Schema.String),
});
export type PodMemberWriteRequest = Schema.Schema.Type<typeof podMemberWriteRequestSchema>;

export const podMemberWriteResponseSchema = Schema.Struct({
  pod: Schema.String,
  path: Schema.String,
  sha256: Schema.String,
});
export type PodMemberWriteResponse = Schema.Schema.Type<typeof podMemberWriteResponseSchema>;

export const podMemberComposeRequestSchema = Schema.Struct({
  pod: Schema.String,
  path: Schema.String,
  /** The unsaved draft; absent composes the saved bytes. */
  content: Schema.optional(Schema.NullOr(Schema.String)),
  /** A schema the editor already holds; lets structural validation run with no session. */
  schemaJson: Schema.optional(Schema.String),
});
export type PodMemberComposeRequest = Schema.Schema.Type<typeof podMemberComposeRequestSchema>;

export const podMemberComposeResponseSchema = Schema.Struct({
  sha256: Schema.String,
  schemaUrl: Schema.NullOr(Schema.String),
  composed: Schema.NullOr(Schema.String),
  diagnostics: Schema.Array(memberIssueSchema),
  dependencies: Schema.Array(dependencySchema),
  schemaValidation: Schema.Literals(["passed", "failed", "not-run", "no-schema", "unavailable"]),
  semanticValidation: Schema.Literals(["passed", "failed", "not-run", "unavailable"]),
});
export type PodMemberComposeResponse = Schema.Schema.Type<typeof podMemberComposeResponseSchema>;

/* ── Bridge op shapes the host consumes (C# owns them; see dogma Ops). ── */

export type BridgeMemberCompose = {
  readonly composed: string | null;
  readonly diagnostics: readonly {
    code: string;
    message: string;
    path?: string | null;
    severity: string;
  }[];
  readonly dependencies: readonly { id: string; path: string; sha256: string }[];
};
export type BridgeSettingsSchema = { readonly schemaJson?: string | null };
export type BridgeSettingsValidate = {
  readonly issues: readonly {
    code?: string;
    message: string;
    path?: string | null;
    severity?: string;
  }[];
};
export type FfChange = { section: string; key: string; kind: string; mappedFrom?: string | null };
export type FamilyPlan = { planHash: string; changes: FfChange[]; familyId: number };
export type FamiliesPlan = {
  diagnostics: { code: string; path: string; message: string }[];
  families: { familyId: number; familyName: string; planHash: string }[];
};
export type SpecCapture = { spec: string };
export type FamiliesCapture = {
  specs: { familyId: number; familyName: string; spec: string; coverage: unknown }[];
};
export type RunReceipt = {
  runId: string;
  podId: string;
  memberPath: string;
  memberSha256: string;
  operation: string;
  planHash?: string | null;
  outcome: string;
  outputs: string[];
};
