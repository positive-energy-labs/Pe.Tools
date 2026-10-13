/**
 * Mention — a stable pointer the user puts in a prompt with `@`. It never retargets the thread; it
 * carries a capability row's key plus a timestamped snapshot of the facts Pea needs, so the first
 * hop lands aligned. Every door (web composer, `pea find`, `pe_find`) finds mentionable things in
 * the one capability catalog and builds a mention with `mentionOf`.
 */
import { z } from "zod";
import {
  capabilityKindSchema,
  type Capability,
  type CapabilityCatalog,
  type CapabilityRecent,
} from "./capability.ts";
import { contributionKindSchema, parseContributionKey } from "./contribution.ts";

const factSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const mentionSchema = z
  .object({
    /** A capability key, not a document address or an effect receipt id. */
    key: z.string().min(1),
    kind: capabilityKindSchema,
    /** What the chip and the `@token` in the text say. */
    title: z.string(),
    /** A small snapshot, read when the mention was made; ids Pea can pass straight to pe_read/pe_do. */
    facts: z.record(z.string(), factSchema),
    /** When `facts` were read (ISO). A stale snapshot says so; Pea reads the key again when it matters. */
    takenAt: z.string(),
  })
  .strict()
  .refine(({ key, kind }) => {
    const reference = parseContributionKey(key);
    return contributionKindSchema.safeParse(kind).success
      ? reference?.kind === kind
      : reference === null;
  }, "Mention kind must match its canonical contribution key");
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

/** Product lifetimes only; SDK openIds remain in Machine's separate document evidence. */
export const machineAttachments = (machine: CapabilityCatalog["machine"]) => [
  ...(machine.revit.sessions ?? []).flatMap((session) =>
    session.attachment ? [session.attachment] : [],
  ),
  ...machine.revit.unclassifiedAttachments,
];

/** Open documents of every answering session as capability rows, so one search finds them. */
export function documentRows(catalog: Pick<CapabilityCatalog, "machine">): Capability[] {
  // A session with no id has no key to point through; `doc:/<openId>` would not parse back.
  return machineAttachments(catalog.machine).flatMap(({ session: sessionId, documents }) =>
    (documents ?? []).map((document) => ({
      key: documentKey(sessionId ?? "", document.openId),
      kind: "document" as const,
      title: document.title,
      finds: [document.address ?? "", document.isFamilyDocument ? "family" : "project"].filter(
        Boolean,
      ),
      description:
        `${document.isFamilyDocument ? "Family" : "Project"} document open in Revit ${catalog.machine.revit.sessions?.find((row) => row.attachment?.session === sessionId)?.row.year ?? ""}`.trim(),
      needs: "nothing" as const,
      mutates: false,
      actor: "any" as const,
      input: {},
      source: "inventory",
      rank: document.isActive ? 1 : 0,
    })),
  );
}

/** `recent:<path>` for a local file, `recent:cloud:<region>/<projectGuid>/<modelGuid>` for a cloud model. */
export const recentKey = (recent: CapabilityRecent) =>
  recent.isCloud && recent.modelGuid
    ? `recent:cloud:${recent.region}/${recent.projectGuid}/${recent.modelGuid}`
    : `recent:${recent.path}`;

/** A recent document's path as words: folders and file for a local one; region, project and
 * model for a cloud one (its `{guid}` prefixes and %-escapes gone). */
export function recentSegments(recent: Pick<CapabilityRecent, "path" | "isCloud">): string[] {
  const parts = recent.path
    .replace(/^cld:\/\//, "")
    .split(/[\\/]/)
    .filter(Boolean);
  return recent.isCloud
    ? parts.map((part) => decodeURIComponent(part).replace(/^\{[^}]*\}/, ""))
    : parts;
}

/** A path or a cloud guid, the way two observations of one document compare. */
const sameDocument = (value: string) =>
  value.replace(/\//g, "\\").replace(/[{}]/g, "").toLowerCase();

const inventoryKnown = (machine: CapabilityCatalog["machine"]) =>
  machine.revit.sessions !== null &&
  !!machine.legs.sessions?.observedAtUtc &&
  !!machine.legs.attachments?.observedAtUtc &&
  !machine.legs.sessions.error &&
  !machine.legs.attachments.error &&
  machine.revit.sessions.every(
    (s) => s.documents !== null && !s.documentsLeg.error && s.attachment?.documents !== null,
  ) &&
  machine.revit.unclassifiedAttachments.every((a) => a.documents !== null);

/**
 * Revit's recent documents as capability rows. A recent document that is open now is dropped: its
 * `doc:` row wins. One row per key (a file in several years' lists keeps its most recent entry).
 * They rank below every open document: the SDK's rank 1 (most recent) is -1 here.
 */
export function recentRows(catalog: Pick<CapabilityCatalog, "recents" | "machine">): Capability[] {
  const open = new Set([
    ...machineAttachments(catalog.machine)
      .flatMap((session) => session.documents ?? [])
      .flatMap((document) => (document.address ? [sameDocument(document.address)] : [])),
    ...(catalog.machine.revit.sessions ?? [])
      .flatMap((s) => s.documents ?? [])
      .flatMap((doc) =>
        [doc.path, "modelGuid" in doc ? doc.modelGuid : null]
          .filter((path): path is string => !!path)
          .map(sameDocument),
      ),
  ]);
  const seen = new Set<string>();
  return (
    [...(catalog.recents ?? [])]
      .sort((a, b) => a.rank - b.rank || b.year - a.year)
      // A template is never a document Pea acts on; families stay and say so.
      .filter((recent) => !/\.rte$/i.test(recent.path))
      .filter((recent) => {
        const key = sameDocument(recentKey(recent));
        const isOpen =
          open.has(sameDocument(recent.path)) ||
          (recent.modelGuid !== null && open.has(sameDocument(recent.modelGuid)));
        if (isOpen || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((recent) => ({
        key: recentKey(recent),
        kind: "recent" as const,
        title: recent.title,
        // A local key already carries the path, so its words count once; a cloud key is guids, so its
        // decoded project and model names are the search words. Open documents then win the tie on rank.
        finds: recent.isCloud ? recentSegments(recent) : [],
        description: `Recent ${recent.isCloud ? "cloud model" : /\.rfa$/i.test(recent.path) ? "family file" : "local file"} from Revit ${recent.year}'s recent list; ${inventoryKnown(catalog.machine) ? "not open" : "open state unknown"}. pe_read it for openWith, then resolve an open lifetime before an op can target it.`,
        needs: "nothing" as const,
        mutates: false,
        actor: "any" as const,
        input: {},
        source: "recents",
        rank: -recent.rank,
      }))
  );
}

/** Build the mention for a row, snapshotting the facts a first hop needs. Pure. */
export function mentionOf(
  row: Capability,
  catalog: Pick<CapabilityCatalog, "at" | "machine" | "recents">,
): Mention {
  if (row.kind === "recent") {
    const recent = catalog.recents?.find((entry) => recentKey(entry) === row.key);
    // A local key carries its path; a cloud key only its guids.
    const path =
      recent?.path ??
      (row.key.startsWith("recent:cloud:") ? null : row.key.slice("recent:".length));
    return {
      key: row.key,
      kind: row.kind,
      title: row.title,
      takenAt: catalog.at,
      facts: {
        path,
        cloud: recent?.isCloud ?? null,
        region: recent?.region ?? null,
        projectGuid: recent?.projectGuid ?? null,
        modelGuid: recent?.modelGuid ?? null,
        year: recent?.year ?? null,
        savedYear: recent?.savedYear ?? null,
        open: inventoryKnown(catalog.machine) ? false : null,
        // The source `pe-revit doc open` and the Instances open launch take: a path or `cld://…`.
        openWith: path,
      },
    };
  }
  const doc = parseDocumentKey(row.key);
  if (doc) {
    const session = catalog.machine.revit.sessions?.find(
      (s) => s.attachment?.session === doc.session,
    );
    const document = machineAttachments(catalog.machine)
      .find((s) => s.session === doc.session)
      ?.documents?.find((d) => d.openId === doc.openId);
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
        revit: session ? String(session.row.year) : null,
        custody: session
          ? session.row.case === "observed-active"
            ? "observed"
            : "controlled"
          : null,
      },
    };
  }
  return {
    key: row.key,
    kind: row.kind,
    title: row.title,
    takenAt: catalog.at,
    facts: {
      description: row.description,
      needs: row.needs,
      mutates: row.mutates,
      ...(row.package
        ? { packageId: row.package.id, sourcePath: row.package.path, sha256: row.package.sha256 }
        : {}),
      ...(row.projection?.openUrl ? { openUrl: row.projection.openUrl } : {}),
    },
  };
}

/** The text a mention leaves in the prompt: `@Title`, readable to a person and to Pea. */
export const mentionToken = (mention: Pick<Mention, "title">) => `@${mention.title}`;
