import type { Finding, FindingsWork, Mark } from "@pe/agent-contracts/slots";
import type { SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import type { Captured } from "../picture/index.ts";

/*
 * The kernel seam for findings (ADR 0035 rule 9): one Work per document under owner key
 * `findings`, keyed by SubjectRef. Pea and a person write the same Work; each author's undo
 * restores that author's earlier preimage and leaves the other's finding (ADR 0030 rule 9). The
 * picture draws one mark per finding on the subject's own geometry. Nothing to declare on a route.
 */

export interface FindingsStore {
  read(): FindingsWork;
  list(subject?: SubjectRefCode): readonly Finding[];
  write(finding: Finding): void;
  /** Undo that author's last write; the other author's findings stand. */
  undo(by: Finding["by"]): void;
}

/**
 * The in-tab view of one document's findings Work. The host's Work journal (`RouteWorkspace.step`
 * with `own`) is the durable per-author undo; this is the same rule over a local copy.
 */
export function findingsStore(seed: FindingsWork): FindingsStore {
  const findings = structuredClone(seed.findings);
  // Each author's writes, newest last, with the preimage of the id it wrote (undefined: absent).
  const writes: { by: Finding["by"]; id: string; before: Finding | undefined; after: Finding }[] = [];
  return {
    read: () => structuredClone({ findings }),
    list: (subject) => Object.values(findings).filter((f) => subject === undefined || f.subject === subject),
    write(finding) {
      const after = structuredClone(finding);
      writes.push({ by: finding.by, id: finding.id, before: findings[finding.id], after });
      findings[finding.id] = after;
    },
    undo(by) {
      const index = writes.findLastIndex((w) => w.by === by);
      if (index < 0) return;
      const { id, before, after } = writes[index]!;
      // As the host journal does: the other author wrote this id since, so undo would overwrite theirs.
      if (findings[id] !== after) throw Error(`${id} was changed by the other author; undo would overwrite it`);
      writes.splice(index, 1);
      if (before) findings[id] = before;
      else delete findings[id];
    },
  };
}

/** The mark the picture draws for a finding: its own `mark`, else a ring on the subject's geometry. */
export function findingMark(finding: Finding, captured: readonly Captured[]): Mark {
  void finding;
  void captured;
  // Not drawn until a real scene capture carries the subject: today's fans capture has no ref per port.
  throw Error("not implemented: needs slice 8 Captured SubjectRef per port");
}
