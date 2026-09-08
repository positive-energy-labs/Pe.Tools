import { z } from "zod";
import { capabilityNeedsSchema } from "./capability.ts";
import { addressSchema, sameAddress } from "./reading.ts";

// The bridge identity already includes process incarnation. SDK labels are recovery choices,
// never execution identities. openId must be minted for each Document lifetime by Revit.
export const documentRefSchema = z.strictObject({
  session: z.string().min(1),
  openId: z.string().min(1),
});
export type DocumentRef = z.infer<typeof documentRefSchema>;

export const documentRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("open"), ref: documentRefSchema }),
  z.strictObject({
    kind: z.literal("named"),
    session: z.string().min(1),
    address: addressSchema,
  }),
]);
export type DocumentRequest = z.infer<typeof documentRequestSchema>;

/** `needs` comes from the host's capability record, never from untrusted call input.
 * A call override never rewrites thread scope or authored work. */
export const callTargetSchema = z.discriminatedUnion("needs", [
  z.strictObject({ needs: z.literal("nothing") }),
  z.strictObject({ needs: z.literal("session"), target: z.string().min(1) }),
  z.strictObject({
    needs: capabilityNeedsSchema.exclude(["nothing", "session"]),
    target: documentRequestSchema.optional(),
  }),
]);
export type CallTarget = z.infer<typeof callTargetSchema>;

export const targetInventorySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("checking") }),
  z.strictObject({ kind: z.literal("failed"), message: z.string() }),
  z.strictObject({
    kind: z.literal("ready"),
    // Absence is authoritative only in a complete registry snapshot. A bridge outage keeps
    // the session here with checking/failed documents until process closure is confirmed.
    sessions: z.record(
      z.string().min(1),
      z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("checking") }),
        z.strictObject({ kind: z.literal("failed"), message: z.string() }),
        z.strictObject({
          kind: z.literal("ready"),
          // All open documents, including inactive, cloud and unsaved documents.
          values: z.array(
            z.strictObject({
              openId: z.string().min(1),
              address: addressSchema.nullable(),
              kind: z.enum(["project", "family"]),
            }),
          ),
        }),
      ]),
    ),
  }),
]);
export type TargetInventory = z.infer<typeof targetInventorySchema>;

export type TargetResolution =
  | {
      kind: "resolved";
      target:
        | { kind: "host" }
        | { kind: "session"; session: string }
        | { kind: "document"; ref: DocumentRef };
    }
  | { kind: "checking" }
  | { kind: "failed"; message: string }
  | {
      kind: "choose";
      reason: "missing" | "session-gone" | "document-closed" | "wrong-document-kind" | "ambiguous";
    };

/** Callers retain the request for recovery; this function never chooses another session. */
export function resolveCallTarget(
  call: CallTarget,
  defaultDocument: DocumentRequest | null,
  inventory: TargetInventory,
): TargetResolution {
  if (call.needs === "nothing") return { kind: "resolved", target: { kind: "host" } };
  const request =
    call.needs === "session"
      ? { kind: "session" as const, session: call.target }
      : (call.target ?? defaultDocument);
  if (!request) return { kind: "choose", reason: "missing" };
  if (inventory.kind !== "ready") return inventory;
  const session = request.kind === "open" ? request.ref.session : request.session;
  const found = Object.hasOwn(inventory.sessions, session)
    ? inventory.sessions[session]
    : undefined;
  if (!found) return { kind: "choose", reason: "session-gone" };
  if (request.kind === "session") return { kind: "resolved", target: { kind: "session", session } };
  if (found.kind !== "ready") return found;
  const documents = found.values.filter((doc) =>
    request.kind === "open"
      ? doc.openId === request.ref.openId
      : doc.address !== null && sameAddress(doc.address, request.address),
  );
  if (documents.length === 0) return { kind: "choose", reason: "document-closed" };
  if (documents.length > 1) return { kind: "choose", reason: "ambiguous" };
  const document = documents[0]!;
  if (
    (call.needs === "family-document" && document.kind !== "family") ||
    (call.needs === "project-document" && document.kind !== "project")
  ) {
    return { kind: "choose", reason: "wrong-document-kind" };
  }
  return {
    kind: "resolved",
    target: { kind: "document", ref: { session, openId: document.openId } },
  };
}
