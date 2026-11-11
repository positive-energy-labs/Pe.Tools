import type { Finding, Mark } from "@pe/agent-contracts/slots";
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
