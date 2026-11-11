import { FINDINGS_DOORS, type Finding, type Mark } from "@pe/agent-contracts/slots";
import { catalogAction } from "../../typed-actions.ts";
import type { Captured } from "../picture/index.ts";

/*
 * The kernel seam for findings (ADR 0035 rule 9): one Work per document under owner key
 * `findings`, keyed by SubjectRef. Pea and a person write the same Work through the host's
 * `findings.write`; the host's Work journal is the per-author undo (`RouteWorkspace.step` with
 * `own`, derived on the history door). The picture draws one mark per finding on the subject's own
 * geometry. Nothing to declare on a route.
 */

/** The mark the picture draws for a finding: its own `mark`, else a ring on the subject's geometry. */
export function findingMark(finding: Finding, captured: readonly Captured[]): Mark {
  void finding;
  void captured;
  // Not drawn until a real scene capture carries the subject: today's fans capture has no ref per port.
  throw Error("not implemented: needs slice 8 Captured SubjectRef per port");
}

/**
 * The route command a person's row verb (`FindingVerb`) runs: `findings.write` with the row's
 * finding. The mount binds the route's own Work handle; the host takes its binding to address the
 * same document's findings Work and stamps the author from the caller.
 */
export const findingCommand = {
  ...catalogAction(FINDINGS_DOORS.write),
  label: "Write finding",
  input: (_context: unknown, supplied: unknown) => ({ finding: supplied }),
};
