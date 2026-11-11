import { z } from "zod";
import { subjectRefCodeSchema } from "../subject-ref.ts";
import type { RouteStateSpec } from "../route-state.ts";
import { workCommand } from "../command.ts";
import { markSchema } from "./picture.ts";

/*
 * Findings (ADR 0035 rule 9): one Work per document under owner key `findings` on the existing
 * bindings, keyed by SubjectRef, with kinds that declare their verdicts and a `place` in the
 * route's attention codec. Pea and a person write the same Work; undo is the Work journal per
 * document (ADR 0030 rule 9). Pointers keep their noun; a keep verb turns one into a finding.
 * Implicit kernel module: a route declares nothing. Owner: slice 9. Scaffold: contract only.
 */

/** Each kind names the verdicts it admits. A `note` admits none. Closed; only the kernel adds one. */
export const FINDING_KINDS = {
  note: [],
  claim: ["yes", "no", "not-this"],
  check: ["pass", "fail"],
} as const;
export type FindingKind = keyof typeof FINDING_KINDS;
export type FindingVerdict<K extends FindingKind = FindingKind> = (typeof FINDING_KINDS)[K][number];

export const FINDINGS_OWNER = "findings" as const;
/** The two catalog doors. `write` lands in the document's findings Work; `list` reads it. */
export const FINDINGS_DOORS = { list: "findings.list", write: "findings.write" } as const;

const findingFields = z.strictObject({
  id: z.string().min(1),
  subject: subjectRefCodeSchema,
  kind: z.enum(Object.keys(FINDING_KINDS) as [FindingKind, ...FindingKind[]]),
  text: z.string().min(1),
  by: z.enum(["person", "pea"]),
  at: z.iso.datetime(),
  verdict: z.string().optional(),
  /** The route's attention codec text for where this finding lands (what `Pointer.place` carries). */
  place: z.record(z.string(), z.string()),
  /** The mark the picture draws for it; absent = the subject's own geometry. */
  mark: markSchema.optional(),
});
const declaredVerdict = (f: { kind: FindingKind; verdict?: string | undefined }) =>
  f.verdict === undefined || (FINDING_KINDS[f.kind] as readonly string[]).includes(f.verdict);
const verdictError = { error: "a verdict must be one the finding's kind declares; a note declares none" };
export const findingSchema = findingFields.refine(declaredVerdict, verdictError);
export type Finding = z.output<typeof findingSchema>;

export const findingsWorkSchema = z.strictObject({
  findings: z.record(z.string(), findingSchema).default({}).meta({ title: "findings" }),
});
export type FindingsWork = z.output<typeof findingsWorkSchema>;

/** The Work registration: one per document, owner key `findings`, on the existing bindings. */
export const findingsWork = {
  route: FINDINGS_OWNER,
  title: "Findings",
  description: "What Pea and people found on this document's subjects, with verdicts where the kind declares them",
  schema: findingsWorkSchema,
  schemaVersion: 1,
  editable: [["findings", "*"]],
  authoredThrough: FINDINGS_DOORS.write,
} satisfies RouteStateSpec<typeof findingsWorkSchema>;

/** What a caller sends to `findings.write`: the host stamps `by` from the caller and `at` on arrival. */
export const findingInputSchema = findingFields.omit({ by: true, at: true }).refine(declaredVerdict, verdictError);
export type FindingInput = z.output<typeof findingInputSchema>;

/**
 * The two doors, each bound to a Work handle at this document (`workCommand`): the findings handle,
 * or a route's own handle, from which the host takes the binding and addresses the findings Work.
 */
export const findingsCommands = {
  [FINDINGS_DOORS.list]: workCommand(FINDINGS_OWNER, {
    says: "List this document's findings, oldest first, optionally only those on one subject (a SubjectRef code).",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({ subject: subjectRefCodeSchema.optional() }),
    dirties: [],
  }),
  [FINDINGS_DOORS.write]: workCommand(FINDINGS_OWNER, {
    says: "Write one finding on a subject of this document (a note, a yes/no/not-this claim, or a pass/fail check) into its findings Work. Writing the same id replaces it. Never changes Revit.",
    needs: "project-document",
    effect: "command",
    input: z.strictObject({ finding: findingInputSchema }),
    dirties: [],
  }),
} as const;
