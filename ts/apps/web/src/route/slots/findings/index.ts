import type { Finding, FindingsWork, Mark } from "@pe/agent-contracts/slots";
import type { SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import type { Captured } from "../picture/index.ts";

/*
 * The kernel seam for findings (ADR 0035 rule 9): one Work per document under owner key
 * `findings`, keyed by SubjectRef. Pea and a person write the same Work; each author's undo
 * restores that author's earlier preimage and leaves the other's finding (ADR 0030 rule 9). The
 * picture draws one mark per finding on the subject's own geometry. Nothing to declare on a route.
 * Owner: slice 9, which replaces every throw here, `ductClaimSchema` and the rooms notes.
 */

export interface FindingsStore {
  read(): FindingsWork;
  list(subject?: SubjectRefCode): readonly Finding[];
  write(finding: Finding): void;
  /** Undo that author's last write; the other author's findings stand. */
  undo(by: Finding["by"]): void;
}

export function findingsStore(seed: FindingsWork): FindingsStore {
  void seed;
  throw Error("not implemented: slice 9 (findings Work per document, list, write, undo)");
}

/** The mark the picture draws for a finding: its own `mark`, else a ring on the subject's geometry. */
export function findingMark(finding: Finding, captured: readonly Captured[]): Mark {
  void finding;
  void captured;
  throw Error("not implemented: slice 9 (one mark draws on the port's geometry)");
}
