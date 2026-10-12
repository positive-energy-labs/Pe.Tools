/**
 * Mention — a stable pointer the user puts in a prompt with `@`. It never retargets the thread; it
 * carries a capability row's key plus a timestamped snapshot of the facts Pea needs, so the first
 * hop lands aligned. Every door (web composer, `pea find`, `pe_find`) finds mentionable things in
 * the one capability catalog and builds a mention with `mentionOf`.
 */
import { z } from "zod";
import type { BridgeSessionListEntry } from "@pe/host-contracts/operation-types";
import type { Capability, CapabilityCatalog } from "./capability.ts";

const factSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const mentionSchema = z
  .object({
    /** The capability row's key: `doc:<session>/<openId>`, `skill:build-pod`, `route:schedules`. */
    key: z.string().min(1),
    kind: z.string(),
    /** What the chip and the `@token` in the text say. */
    title: z.string(),
    /** A small snapshot, read when the mention was made; ids Pea can pass straight to pe_read/pe_do. */
    facts: z.record(z.string(), factSchema),
    /** When `facts` were read (ISO). A stale snapshot says so; Pea reads the key again when it matters. */
    takenAt: z.string(),
  })
  .strict();
export type Mention = z.infer<typeof mentionSchema>;

/** The key of an open Revit document as a capability row. */
export const documentKey = (session: string, openId: string) => `doc:${session}/${openId}`;

/** `doc:<session>/<openId>` → its halves; null for any other key. */
export function parseDocumentKey(key: string): { session: string; openId: string } | null {
  if (!key.startsWith("doc:")) return null;
  const rest = key.slice("doc:".length);
  const slash = rest.indexOf("/");
  return slash <= 0 ? null : { session: rest.slice(0, slash), openId: rest.slice(slash + 1) };
}

/** The bridge's session list as the catalog's session rows: the host catalog and the web's live
 * inventory project it the same way. */
export function catalogSessions(
  list: readonly BridgeSessionListEntry[],
): CapabilityCatalog["sessions"] {
  return list.map((session) => ({
    sessionId: session.sessionId,
    custody: session.custody ?? undefined,
    sdkSessionId: session.sdkSessionId,
    revitVersion: session.revitVersion,
    activeDocumentTitle: session.activeDocumentTitle,
    activeDocument: session.activeDocumentCloudModelGuid ?? session.activeDocumentPath,
    openDocuments:
      session.openDocuments?.map((doc) => ({ ...doc, address: doc.address ?? null })) ?? null,
  }));
}

/** Open documents of every answering session as capability rows, so one search finds them. */
export function documentRows(catalog: Pick<CapabilityCatalog, "sessions">): Capability[] {
  // A session with no id has no key to point through; `doc:/<openId>` would not parse back.
  return catalog.sessions.flatMap(({ sessionId, ...session }) =>
    (sessionId ? (session.openDocuments ?? []) : []).map((document) => ({
      key: documentKey(sessionId ?? "", document.openId),
      kind: "document" as const,
      title: document.title,
      finds: [document.address ?? "", document.isFamilyDocument ? "family" : "project"].filter(
        Boolean,
      ),
      description:
        `${document.isFamilyDocument ? "Family" : "Project"} document open in Revit ${session.revitVersion ?? ""}`.trim(),
      needs: "nothing" as const,
      mutates: false,
      actor: "any" as const,
      input: {},
      source: "inventory",
      rank: document.isActive ? 1 : 0,
    })),
  );
}

/** Build the mention for a row, snapshotting the facts a first hop needs. Pure. */
export function mentionOf(
  row: Capability,
  catalog: Pick<CapabilityCatalog, "at" | "sessions">,
): Mention {
  const doc = parseDocumentKey(row.key);
  if (doc) {
    const session = catalog.sessions.find((s) => s.sessionId === doc.session);
    const document = session?.openDocuments?.find((d) => d.openId === doc.openId);
    return {
      key: row.key,
      kind: row.kind,
      title: row.title,
      takenAt: catalog.at,
      facts: {
        session: doc.session,
        openId: doc.openId,
        address: document?.address ?? null,
        family: document?.isFamilyDocument ?? null,
        active: document?.isActive ?? null,
        revit: session?.revitVersion ?? null,
        custody: session?.custody ?? null,
      },
    };
  }
  return {
    key: row.key,
    kind: row.kind,
    title: row.title,
    takenAt: catalog.at,
    facts: { description: row.description, needs: row.needs, mutates: row.mutates },
  };
}

/** The text a mention leaves in the prompt: `@Title`, readable to a person and to Pea. */
export const mentionToken = (mention: Pick<Mention, "title">) => `@${mention.title}`;
