import { z } from "zod";
import { subjectRefCodeSchema } from "../subject-ref.ts";
import type { RouteStateSpec } from "../route-state.ts";
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

export const findingSchema = z
  .strictObject({
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
  })
  .refine(
    (f) => f.verdict === undefined || (FINDING_KINDS[f.kind] as readonly string[]).includes(f.verdict),
    { error: "a verdict must be one the finding's kind declares; a note declares none" },
  );
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
} satisfies RouteStateSpec<typeof findingsWorkSchema>;
