import { decode, documentKeySchema } from "../../agent-contracts/src/subject-ref.ts";
import type {
  DiffJson,
  DiffPort,
  RecordingDiffEntry,
  RecordingDiffKey,
  RecordingDiffSnapshot,
  RecordingDiffResult,
  RecordingDiffIncomparableReason,
  RecordingFacetDifference,
} from "../../agent-contracts/src/recording-diff.ts";

const object = (v: DiffJson | undefined): v is { readonly [key: string]: DiffJson } =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const canonical = (v: DiffJson | undefined): string | undefined =>
  object(v)
    ? `{${Object.keys(v)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
        .join(",")}}`
    : Array.isArray(v)
      ? `[${v.map(canonical).join(",")}]`
      : JSON.stringify(v);

function differences(
  before: DiffJson | undefined,
  after: DiffJson | undefined,
  facet: RecordingFacetDifference["facet"],
  path: readonly string[],
  out: RecordingFacetDifference[],
): void {
  if (
    (object(before) && (object(after) || after === undefined)) ||
    (object(after) && before === undefined)
  ) {
    const a = object(before) ? before : {},
      b = object(after) ? after : {};
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    if (!keys.length && (before === undefined || after === undefined))
      out.push({ facet, path, before, after });
    for (const k of keys)
      differences(
        Object.hasOwn(a, k) ? a[k] : undefined,
        Object.hasOwn(b, k) ? b[k] : undefined,
        facet,
        [...path, k],
        out,
      );
  } else if (canonical(before) !== canonical(after)) out.push({ facet, path, before, after });
}

/** Pure, request-local working sets only. Input owners bound snapshot bytes/entries;
 * no retained state, IO, time, or inferred cross-document authority (ADR 0031 §8). */
export function diffKeyed(
  before: RecordingDiffSnapshot,
  after: RecordingDiffSnapshot,
): RecordingDiffResult {
  const refuse = (reason: RecordingDiffIncomparableReason): RecordingDiffResult => ({
    kind: "incomparable",
    reason,
    coverage: { before: before.coverage, after: after.coverage },
  });
  if (before.coverage.kind === "partial" || after.coverage.kind === "partial")
    return refuse("partial-coverage");
  if (
    !documentKeySchema.safeParse(before.document).success ||
    !documentKeySchema.safeParse(after.document).success
  )
    return refuse("invalid-identity");
  // No saved correspondence Work authority is admitted by this port. Equal names cannot supply it.
  if (before.document !== after.document)
    return refuse("cross-document-correspondence-unavailable");
  if (
    !before.coverage.scope.trim() ||
    before.coverage.scope !== after.coverage.scope ||
    !before.coverage.evidence.trim() ||
    !after.coverage.evidence.trim()
  )
    return refuse("coverage-mismatch");

  let failure: RecordingDiffIncomparableReason | null = null;
  const document = before.document;
  const decoded = new Map<string, boolean>();
  // An element is in this document when its host (placement host, else source, else omitted) is it.
  const element = (id: string): boolean => {
    if (!decoded.has(id)) {
      const r = decode(id);
      const at = r.ok ? (r.value.placement?.host ?? r.value.source) : null;
      decoded.set(id, r.ok && r.value.keyKind === "UniqueId" && (at === undefined || at === document));
    }
    return decoded.get(id)!;
  };
  const port = (p: DiffPort): string | null =>
    p && element(p.element) && Number.isSafeInteger(p.index) && p.index >= 0
      ? JSON.stringify([p.element, p.index])
      : null;
  const key = (k: RecordingDiffKey): string | null => {
    let parts: unknown = null;
    switch (k.kind) {
      case "element":
        if (element(k.id)) parts = k.id;
        break;
      case "port":
        parts = port(k.port);
        break;
      case "system":
        if (typeof k.systemName === "string" && k.systemName.trim()) parts = k.systemName;
        break;
      case "section": {
        const a = k.bounds?.length === 2 ? port(k.bounds[0]) : null;
        const b = k.bounds?.length === 2 ? port(k.bounds[1]) : null;
        if (a !== null && b !== null && a !== b) parts = [a, b].sort();
        break;
      }
      case "path": {
        const fan = port(k.fan);
        if (fan !== null && element(k.terminal)) parts = [fan, k.terminal];
        break;
      }
      case "loop":
        failure = "unsupported-loop";
        return null;
    }
    if (parts === null) {
      failure = "invalid-identity";
      return null;
    }
    return JSON.stringify([k.kind, parts]);
  };
  const index = (s: RecordingDiffSnapshot): Map<string, RecordingDiffEntry> | null => {
    if (s.coverage.kind !== "complete") return null;
    const entries = new Map<string, RecordingDiffEntry>();
    for (const e of s.entries) {
      const id = key(e.key);
      if (id === null) return null;
      if (entries.has(id)) {
        failure = "duplicate-key";
        return null;
      }
      entries.set(id, e);
    }
    const full = new Set<string>();
    for (const k of s.coverage.keys) {
      const id = key(k);
      if (id === null) return null;
      if (full.has(id)) {
        failure = "duplicate-key";
        return null;
      }
      full.add(id);
    }
    if (full.size !== entries.size || [...full].some((id) => !entries.has(id))) {
      failure = "coverage-mismatch";
      return null;
    }
    return entries;
  };
  const left = index(before),
    right = index(after);
  if (!left || !right) return refuse(failure ?? "coverage-mismatch");
  const added: RecordingDiffEntry[] = [],
    removed: RecordingDiffEntry[] = [],
    unchanged: RecordingDiffEntry[] = [];
  const changed: {
    before: RecordingDiffEntry;
    after: RecordingDiffEntry;
    differences: RecordingFacetDifference[];
  }[] = [];
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const a = left.get(id),
      b = right.get(id);
    if (!a) {
      added.push(b!);
      continue;
    }
    if (!b) {
      removed.push(a);
      continue;
    }
    const changes: RecordingFacetDifference[] = [];
    for (const facet of ["model", "authored", "computed"] as const)
      differences(a[facet], b[facet], facet, [], changes);
    if (changes.length) changed.push({ before: a, after: b, differences: changes });
    else unchanged.push(b);
  }
  return { kind: "comparable", added, removed, changed, unchanged };
}
