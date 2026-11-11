import { FINDINGS_DOORS, type Finding, type Mark } from "@pe/agent-contracts/slots";
import { catalogAction } from "../../typed-actions.ts";
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
 * The route command a person's row verb (`FindingVerb`) runs: `findings.write` with the row's
 * finding. The mount (shell/typed-mount.ts) adds it to every route as `finding` and binds the
 * route's own Work handle; the host addresses the admitted document's findings Work and stamps the
 * author from the caller. `route()`, the Pod surface, never imports this file, because the contract
 * is the catalog (pod-surface.guard.test.ts).
 */
export const findingCommand = {
  ...catalogAction(FINDINGS_DOORS.write),
  label: "Write finding", row: true as const,
  input: (_context: unknown, supplied: unknown) => ({ finding: supplied }),
};
