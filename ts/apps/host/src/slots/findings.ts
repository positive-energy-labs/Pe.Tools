import type { Finding } from "@pe/agent-contracts/slots";
import type { DocumentRef } from "@pe/agent-contracts";

/*
 * The host side of findings (ADR 0035 rule 9): two catalog doors over one Work per document under
 * owner key `findings` on the existing bindings. `findings.write` is a Work write (the host stamps
 * `by`), never a ModelWrite; `findings.list` is a Read. Pea reaches both through the catalog.
 * Owner: slice 9.
 */

export function findingsList(document: DocumentRef, subject?: string): Promise<readonly Finding[]> {
  void document;
  void subject;
  throw Error("not implemented: slice 9 (findings.list reads the document's findings Work)");
}

export function findingsWrite(document: DocumentRef, finding: Finding): Promise<{ readonly revision: number }> {
  void document;
  void finding;
  throw Error("not implemented: slice 9 (findings.write lands in the document's findings Work)");
}
