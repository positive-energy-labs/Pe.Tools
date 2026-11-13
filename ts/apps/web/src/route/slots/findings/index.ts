import { FINDINGS_DOORS, type Finding, type Mark } from "@pe/agent-contracts/slots";
import { handle } from "@pe/agent-contracts/handle";
import { resolveMark, type Captured } from "../picture/index.ts";

/*
 * The kernel seam for findings (ADR 0035 rule 9): one Work per document under owner key
 * `findings`, keyed by SubjectRef. Pea and a person write the same Work through the host's
 * `findings.write`; the host's Work journal is the per-author undo (`RouteWorkspace.step` with
 * `own`, derived on the history door). The picture draws one mark per finding on the subject's own
 * geometry. Nothing to declare on a route.
 */

/** The mark the picture draws for a finding: its own `mark`, else a ring on the subject's geometry. */
export function findingMark(finding: Finding, captured: readonly Captured[]): Mark {
  const own: Mark = finding.mark ?? { kind: "ring", at: finding.subject };
  // Nothing captured the subject: the mark stays on its SubjectRef for the picture to resolve later.
  return resolveMark(own, captured) ?? own;
}

/**
 * The kernel's verbs: on every route, declared by none, never placed. The shell's
 * `mount.kernelVerb(key)` only reads this table and binds the route's own Work handle; the host
 * addresses the admitted document's findings Work and stamps the author from the caller. `route()`,
 * the Pod surface, imports only the key type from this file (pod-surface.guard.test.ts).
 */
export const kernelVerbs = {
  [FINDINGS_DOORS.write]: {
    handle: handle(FINDINGS_DOORS.write),
    label: "Write finding",
    input: (_context: unknown, supplied: unknown) => ({ finding: supplied }),
  },
} as const;
export type KernelVerbKey = keyof typeof kernelVerbs;
