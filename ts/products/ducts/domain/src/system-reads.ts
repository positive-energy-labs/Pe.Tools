/**
 * The network stage reads Revit systems, never the document (kaitpw 2026-10-29): the whole read
 * outgrew the bridge's 16 MiB frame on cloud Chadds. Each `systems` read answers its systems'
 * groups whole in the document read's shape, so the reads join into one snapshot the panes price as
 * before; "read every system" walks the rest of the roster a few systems per read.
 */
import type { DuctSnapshot } from "./types.ts";

/** Requested IDs are completion evidence even when Revit returns no system or no network. */
export type NetworkSnapshot = DuctSnapshot & {
  sourceVersion?: string;
  systemReads?: { completed: number[]; missing: number[] };
};

export function systemReadCoverage(snapshot: NetworkSnapshot | null, roster: DuctSnapshot) {
  const completed = new Set(
    snapshot?.systemReads?.completed ?? snapshot?.systems.map((system) => system.id),
  );
  const missing = new Set(snapshot?.systemReads?.missing);
  const absent = roster.systems.filter(
    (system) => completed.has(system.id) && missing.has(system.id),
  );
  const empty = roster.systems.filter(
    (system) =>
      completed.has(system.id) &&
      !missing.has(system.id) &&
      !snapshot?.groups.some((group) => group.systemNames.includes(system.name)),
  );
  return {
    read: completed.size,
    of: roster.systems.length,
    report: [
      absent.length
        ? `${absent.length} systems returned nothing: ${absent.map((system) => system.name).join(", ")}`
        : null,
      empty.length
        ? `${empty.length} systems have no duct network: ${empty.map((system) => system.name).join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/**
 * Systems per read. Cloud Chadds has 367 systems; 16 of them read 0.7 MB in 1.5 s (2026-10-29).
 * ponytail: a fixed count, not a byte budget; sixteen systems on one huge shared network could
 * still pass 16 MiB. Shrink it, or split a failed read, when one does.
 */
export const SYSTEMS_PER_READ = 16;

/** The next read: the first `size` wanted systems not read yet, in wanted order (open ones first). */
export const nextSystemsRead = (
  wanted: readonly number[],
  read: ReadonlySet<number>,
  size = SYSTEMS_PER_READ,
): number[] => [...new Set(wanted)].filter((id) => !read.has(id)).slice(0, size);

const byKey = <T>(items: Iterable<T>, key: (item: T) => string | number) => [
  ...new Map([...items].map((item) => [key(item), item] as const)).values(),
];

type Candidates = NonNullable<DuctSnapshot["airflowCandidates"]>;

/** One candidate per slot and side; group coverage once per group, totals summed. */
const mergeCandidates = (lists: readonly (Candidates | null | undefined)[]): Candidates | null => {
  if (lists.every((list) => list == null)) return null;
  const merged = new Map<string, Candidates[number]>();
  for (const candidate of lists.flatMap((list) => list ?? [])) {
    const key = `${candidate.where}:${candidate.slot}`;
    const prior = merged.get(key);
    merged.set(
      key,
      prior
        ? {
            ...prior,
            have: prior.have + candidate.have,
            of: prior.of + candidate.of,
            groups: byKey([...prior.groups, ...candidate.groups], (g) => g.groupId),
          }
        : candidate,
    );
  }
  return [...merged.values()].sort(
    (a, b) => b.have - a.have || a.slot.localeCompare(b.slot) || a.where.localeCompare(b.where),
  );
};

type Coverage = Pick<DuctSnapshot, "walk" | "reach">;
type Walk = NonNullable<Coverage["walk"]>;
/**
 * The unread entry a part with no walk and no reach leaves in the merged reach (P-047). It names no
 * element (`connector` -1), so `coverageOf` reads it as lost for every fan; `complete: false` alone
 * was disowned once the reach named another fan's peer.
 */
export const BLIND_PART = { elementId: -1, connector: -1 };
const refKey = (p: { elementId: number; connector: number }) => `${p.elementId}:${p.connector}`;
/**
 * Coverage over several reads, in the wire shape `coverageOf` (sheet/coverage.ts) reads back as the
 * `read`/`lost` union, so no part's loss can merge away (P-021, P-012, P-033): unread peers union, a
 * walk is truncated if any part's was and keeps every part's candidates and counts, a reach is
 * complete only if every part's was, and a part carrying neither walk nor reach makes the merged
 * reach incomplete and leaves `BLIND_PART` in it. The last part's walk identity (`startId`) stands.
 * ponytail: hops, elements and open ends are sums, so two walks over shared ducts count them twice.
 */
export function mergeCoverage(parts: readonly Coverage[]): Coverage {
  const walks = parts.flatMap((p) => (p.walk ? [p.walk] : []));
  const reaches = parts.flatMap((p) => (p.reach ? [p.reach] : []));
  const blind = parts.some((p) => p.walk == null && p.reach == null);
  const walk = walks.reduce<Walk | undefined>(
    (a, w) =>
      a
        ? {
            ...w,
            hops: a.hops + w.hops,
            elementsReached: a.elementsReached + w.elementsReached,
            openEnds: a.openEnds + w.openEnds,
            candidates: byKey([...a.candidates, ...w.candidates], refKey),
            truncated: a.truncated || w.truncated,
            elapsedMs: a.elapsedMs + w.elapsedMs,
            unreadPeers: byKey([...a.unreadPeers, ...w.unreadPeers], refKey),
          }
        : w,
    undefined,
  );
  return {
    walk: walk ?? parts.at(-1)?.walk,
    reach:
      reaches.length || blind
        ? {
            complete: !blind && reaches.every((r) => r.complete),
            unreadPeers: byKey(
              [...reaches.flatMap((r) => r.unreadPeers), ...(blind ? [BLIND_PART] : [])],
              refKey,
            ),
          }
        : parts.at(-1)?.reach,
  };
}

/**
 * Several `systems` reads as one snapshot, later parts winning. Elements, groups, flows, issues and
 * systems join by id, so a group two reads share (each answers it whole) counts once.
 * ponytail: layer coverage and an airflow candidate's document-wide have/of are sums, so a group
 * two reads share counts twice there; per-group coverage, which a chosen system reads, is exact.
 */
export function mergeSnapshots(parts: readonly DuctSnapshot[]): DuctSnapshot | null {
  const last = parts.at(-1);
  if (!last) return null;
  if (parts.length === 1) return last;
  const layers = new Map<string, DuctSnapshot["layers"][number]>();
  for (const layer of parts.flatMap((p) => p.layers)) {
    const prior = layers.get(layer.key);
    layers.set(
      layer.key,
      prior
        ? {
            ...prior,
            coverage: {
              have: prior.coverage.have + layer.coverage.have,
              of: prior.coverage.of + layer.coverage.of,
            },
          }
        : layer,
    );
  }
  const readAt = parts.map((p) => p.document.readAt).sort();
  return {
    ...last,
    ...mergeCoverage(parts),
    document: {
      ...last.document,
      readAt: readAt.at(-1)!,
      elapsedMs: parts.reduce((sum, p) => sum + p.document.elapsedMs, 0),
    },
    // The document read lists groups by their least element id, the id's number.
    groups: byKey(
      parts.flatMap((p) => p.groups),
      (g) => g.id,
    ).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))),
    nodes: byKey(
      parts.flatMap((p) => p.nodes),
      (n) => n.id,
    ),
    segments: byKey(
      parts.flatMap((p) => p.segments),
      (s) => s.id,
    ),
    flows: byKey(
      parts.flatMap((p) => p.flows),
      (f) => f.segmentId,
    ),
    issues: byKey(
      parts.flatMap((p) => p.issues),
      (i) => i.id,
    ),
    layers: [...layers.values()],
    systems: byKey(
      parts.flatMap((p) => p.systems),
      (s) => s.id,
    ).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    airflowCandidates: mergeCandidates(parts.map((p) => p.airflowCandidates)),
    fanFlowCandidates: mergeCandidates(parts.map((p) => p.fanFlowCandidates)),
  };
}
