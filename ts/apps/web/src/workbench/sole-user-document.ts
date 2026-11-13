import { machineInventory, resolveCallTarget, type DocumentRequest, type Machine } from "@pe/agent-contracts";

/**
 * A new thread's visible first target: the one user document when exactly one connected Revit has
 * exactly one open, and it is not Pea's. The human's send with the chip showing it adds it
 * (ADR 0021); any other machine leaves the draft with no target.
 */
export function soleUserDocument(machine: Machine | null): DocumentRequest | null {
  const revits = machine
    ? [
        ...(machine.revit.sessions ?? []).flatMap((s) => (s.attachment ? [s.attachment] : [])),
        ...machine.revit.unclassifiedAttachments,
      ]
    : [];
  const only = revits.length === 1 && revits[0]!.documents?.length === 1 ? revits[0]! : null;
  const document = only?.documents?.[0];
  if (!document || document.access.kind === "pea") return null;
  const request = {
    kind: "open",
    ref: { session: only!.session, openId: document.openId },
  } as const;
  return resolveCallTarget({ needs: "document" }, [request], machineInventory(machine!)).kind ===
    "resolved"
    ? request
    : null;
}

