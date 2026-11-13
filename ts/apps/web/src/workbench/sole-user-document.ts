import { parseTarget } from "#/route/target-codec";
import { machineInventory, resolveCallTarget, type DocumentRequest, type Machine } from "@pe/agent-contracts";

/**
 * A new thread's visible first target: the one user document when exactly one connected Revit has
 * exactly one open, and it is not Pea's. The human's send with the chip showing it adds it
 * (ADR 0021); any other machine leaves the draft with no target.
 */
export function soleUserDocument(machine: Machine | null): DocumentRequest | null {
  if (!machine) return null;
  const revits = [
    ...(machine.revit.sessions ?? []).flatMap((s) => (s.attachment ? [s.attachment] : [])),
    ...machine.revit.unclassifiedAttachments,
  ];
  const [only] = revits;
  if (revits.length !== 1 || only?.documents?.length !== 1) return null;
  const document = only.documents[0];
  if (!document || document.access.kind === "pea") return null;
  const request = {
    kind: "open",
    ref: { session: only.session, openId: document.openId },
  } as const;
  return resolveCallTarget({ needs: "document" }, [request], machineInventory(machine)).kind ===
    "resolved"
    ? request
    : null;
}


/** Whether a `?target` names a document (an address or an exact request), not a session or nothing. */
export const pinsDocument = (target?: string | null) =>
  ["address", "request"].includes(parseTarget(target)?.kind ?? "");

/**
 * The one open document a `?target` pin names; none when the pin is absent, names no open
 * document, or two Revits hold it. Owner ruling 2026-11-13 (row 12): a thread, including a draft
 * with no id yet, binds to the document the URL names; it keeps no binding of its own to manage.
 */
export function pinnedDocument(
  inventory: ReturnType<typeof machineInventory>,
  target?: string | null,
): { kind: "open"; ref: { session: string; openId: string } } | null {
  const parsed = parseTarget(target);
  if (inventory.kind !== "ready") return null;
  if (parsed?.kind === "request") {
    const resolution = resolveCallTarget({ needs: "document" }, [parsed.request], inventory);
    return resolution.kind === "resolved" && resolution.target.kind === "document"
      ? { kind: "open", ref: resolution.target.ref }
      : null;
  }
  if (parsed?.kind !== "address") return null;
  const refs = Object.entries(inventory.sessions).flatMap(([session, found]) =>
    found.kind === "ready"
      ? found.values
          .filter((doc) => doc.address === parsed.address)
          .map((doc) => ({ session, openId: doc.openId }))
      : [],
  );
  const [only, ...others] = refs;
  return only && !others.length ? { kind: "open", ref: only } : null;
}

