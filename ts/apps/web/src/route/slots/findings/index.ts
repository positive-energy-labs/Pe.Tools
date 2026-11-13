import { FINDINGS_DOORS, type Finding, type Mark } from "@pe/agent-contracts/slots";
import { handle } from "@pe/agent-contracts/handle";
import { catalogAction } from "../../typed-actions.ts";
import { resolveMark, type Captured } from "../picture/index.ts";

/*
 * The kernel seam for findings (ADR 0035 rule 9): one Work per document under owner key
 * `findings`, keyed by SubjectRef. Pea and a person write the same Work through the host's
 * `findings.say`, `findings.rule` and `findings.retract`; the host's Work journal is the per-author
 * undo. The picture draws one mark per finding on the subject's own geometry. Nothing to declare on
 * a route.
 */

/**
 * The kernel's verbs: on every route, declared by none, never placed. Findings is this table's only
 * writer; the shell's `mount.kernelVerb(key)` only reads it. `pointers.dismiss` joins when the
 * kernel draws pointers.
 */
export const kernelVerbs = {
  [FINDINGS_DOORS.say]: { handle: handle(FINDINGS_DOORS.say), label: "Say finding" },
  [FINDINGS_DOORS.rule]: { handle: handle(FINDINGS_DOORS.rule), label: "Rule on finding" },
  [FINDINGS_DOORS.retract]: { handle: handle(FINDINGS_DOORS.retract), label: "Retract finding" },
} as const;
export type KernelVerbKey = keyof typeof kernelVerbs;

/** The mark the picture draws for a finding: its own `mark`, else a ring on the subject's geometry. */
export function findingMark(finding: Finding, captured: readonly Captured[]): Mark {
  const own: Mark = finding.mark ?? { kind: "ring", at: finding.subject };
  // Nothing captured the subject: the mark stays on its SubjectRef for the picture to resolve later.
  return resolveMark(own, captured) ?? own;
}

/**
 * The route command a person's row verb (`FindingVerb`) runs: `findings.say` with the row's
 * finding. The mount (shell/typed-mount.ts) adds it to every route as `finding` and binds the
 * route's own Work handle; the host addresses the admitted document's findings Work and stamps the
 * author from the caller. `route()`, the Pod surface, never imports this file, because the contract
 * is the catalog (pod-surface.guard.test.ts).
 */
export const findingCommand = {
  ...catalogAction(FINDINGS_DOORS.say),
  label: "Write finding", row: true as const,
  input: (_context: unknown, supplied: unknown) => supplied,
};
