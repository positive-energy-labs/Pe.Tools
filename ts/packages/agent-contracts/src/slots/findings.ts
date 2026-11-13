import { z } from "zod";
import { subjectRefCodeSchema } from "../subject-ref.ts";
import type { RouteStateSpec } from "../route-state.ts";
import { workCommand } from "../command.ts";
import { markSchema } from "./picture.ts";

/*
 * Findings (ADR 0035 rule 9, amended by ADR 0042 rule 5): one Work per document under owner key
 * `findings` on the existing bindings, keyed by SubjectRef. A finding is a statement plus a ruling:
 * `said` is stamped once by `findings.say` and never patched; `verdict` is the ruling, stamped by
 * whoever rules. Pea and a person write the same Work. Implicit kernel module: a route declares
 * nothing. The host's doors are apps/host/src/slots/findings.ts.
 *
 * A finding has no `place` (ADR 0042 rule 5 supersedes that clause of ADR 0035 rule 9): nothing read
 * it, and `SubjectRef.sub` carries a port or a field. It returns, with the reader that draws it, when
 * a finding about an empty spot (a location that is no subject and no part of one) is needed. Until
 * then every finding is on a subject.
 */

/** Each kind names the verdicts it admits. A `note` admits none. Closed; only the kernel adds one. */
export const FINDING_KINDS = {
  note: [],
  claim: ["yes", "no", "not-this"],
  check: ["pass", "fail"],
} as const;
export type FindingKind = keyof typeof FINDING_KINDS;

export const FINDINGS_OWNER = "findings" as const;
export const FINDINGS_DOORS = {
  list: "findings.list",
  say: "findings.say",
  rule: "findings.rule",
  retract: "findings.retract",
} as const;

/** Who and when, stamped by the host from the caller and its clock. Never caller-supplied. */
const stampSchema = z.strictObject({ by: z.enum(["pea", "person"]), at: z.iso.datetime() });
export type Stamp = z.output<typeof stampSchema>;

const base = {
  /** Host-minted. */
  id: z.string().min(1),
  subject: subjectRefCodeSchema,
  text: z.string().min(1),
  said: stampSchema,
  /** The mark the picture draws for it; absent = the subject's own geometry. */
  mark: markSchema.optional(),
};
/** A note has no `verdict` key at all; a claim or a check may carry one of its kind's values. */
export const findingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("note"), ...base }),
  z.strictObject({ kind: z.literal("claim"), ...base, verdict: stampSchema.extend({ value: z.enum(FINDING_KINDS.claim) }).optional() }),
  z.strictObject({ kind: z.literal("check"), ...base, verdict: stampSchema.extend({ value: z.enum(FINDING_KINDS.check) }).optional() }),
]);
export type Finding = z.output<typeof findingSchema>;

export const findingsWorkSchema = z.strictObject({
  findings: z.record(z.string(), findingSchema).default({}).meta({ title: "findings" }),
});

/** The Work registration: one per document, owner key `findings`, on the existing bindings. */
export const findingsWork = {
  route: FINDINGS_OWNER,
  title: "Findings",
  description: "What Pea and people said about this document's subjects, with a ruling where the kind admits one",
  schema: findingsWorkSchema,
  // 2: a statement plus a ruling. Version 1 Work (flat `by`/`at`, `place`) is set aside, not migrated.
  schemaVersion: 2,
  // No generic cell: every write is one of the three doors.
  editable: [],
  authoredThrough: `${FINDINGS_DOORS.say} (or ${FINDINGS_DOORS.rule}, ${FINDINGS_DOORS.retract})`,
} satisfies RouteStateSpec<typeof findingsWorkSchema>;

const kindSchema = z.enum(Object.keys(FINDING_KINDS) as [FindingKind, ...FindingKind[]]);
/** Whether `kind` admits `verdict`; a note admits none. */
export const admitsVerdict = (kind: FindingKind, verdict: string): boolean =>
  (FINDING_KINDS[kind] as readonly string[]).includes(verdict);

const sayInput = z
  .strictObject({
    subject: subjectRefCodeSchema,
    kind: kindSchema,
    text: z.string().min(1),
    mark: markSchema.optional(),
    /** Optional: the sayer may rule at once, or anyone may rule later through `findings.rule`. */
    verdict: z.string().optional(),
  })
  .refine((f) => f.verdict === undefined || admitsVerdict(f.kind, f.verdict), {
    path: ["verdict"],
    error: "a verdict must be one the finding's kind admits; a note admits none",
  });
/** What a caller sends to `findings.say`. The host mints the id and stamps the author and the time. */
export type FindingInput = z.output<typeof sayInput>;

/**
 * The four doors (`workCommand`). The host addresses the findings Work of the admitted document from
 * the target, never from the handle; a findings handle gives only its revision, the compare-and-set.
 */
export const findingsCommands = {
  [FINDINGS_DOORS.list]: workCommand(FINDINGS_OWNER, {
    says: "List this document's findings, oldest first, optionally only those on one subject (a SubjectRef code). Each has who said it (said) and, once ruled, who ruled it (verdict).",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({ subject: subjectRefCodeSchema.optional() }),
    dirties: [],
  }),
  [FINDINGS_DOORS.say]: workCommand(FINDINGS_OWNER, {
    says: "Say one finding on a subject of this document: a note, a claim (ruled yes, no or not-this) or a check (ruled pass or fail). The verdict is optional and may come later through findings.rule. Returns the id the host minted. Never changes Revit.",
    needs: "project-document",
    effect: "command",
    input: sayInput,
    dirties: [],
  }),
  [FINDINGS_DOORS.rule]: workCommand(FINDINGS_OWNER, {
    says: "Rule on a claim or a check by id: value is one its kind admits, or null to withdraw the ruling. The statement and who said it stay as they were. Never changes Revit.",
    needs: "project-document",
    effect: "command",
    input: z.strictObject({ id: z.string().min(1), value: z.string().nullable() }),
    dirties: [],
  }),
  [FINDINGS_DOORS.retract]: workCommand(FINDINGS_OWNER, {
    says: "Remove one finding by id. Either author may retract any finding; it is one step and can be undone. Never changes Revit.",
    needs: "project-document",
    effect: "command",
    input: z.strictObject({ id: z.string().min(1) }),
    dirties: [],
  }),
} as const;
