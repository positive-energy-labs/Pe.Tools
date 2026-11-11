import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import {
  subjectCode,
  type DocumentKey,
  type SubjectRefCode,
  type UniqueId,
} from "../../agent-contracts/src/subject-ref.ts";
import type {
  RecordingDiffEntry,
  RecordingDiffKey,
  RecordingDiffSnapshot,
} from "../../agent-contracts/src/recording-diff.ts";
import { diffKeyed } from "./recording-diff.ts";

const document = "doc-a" as DocumentKey;
const element = (uniqueId: string, doc?: string) =>
  subjectCode({ keyKind: "UniqueId", key: uniqueId as UniqueId, ...(doc ? { source: doc as DocumentKey } : {}) });
const key = (id: string): RecordingDiffKey => ({ kind: "element", id: element(id) });
const entry = (
  key: RecordingDiffKey,
  model: RecordingDiffEntry["model"] = {},
): RecordingDiffEntry => ({ key, model, authored: {}, computed: {} });
const snapshot = (entries: readonly RecordingDiffEntry[]): RecordingDiffSnapshot => ({
  point: Object.freeze({ opaque: "caller-owned" }),
  document,
  coverage: {
    kind: "complete",
    scope: "declared-elements",
    evidence: "test-only full enumeration",
    keys: entries.map((e) => e.key),
  },
  entries,
});
const compare = (before: readonly RecordingDiffEntry[], after: readonly RecordingDiffEntry[]) =>
  diffKeyed(snapshot(before), snapshot(after));

it("keeps a section across healing/splitting and separates all three facets", () => {
  const a = { element: element("junction-a"), index: 1 };
  const b = { element: element("junction-b"), index: 2 };
  const before = {
    ...entry({ kind: "section", bounds: [a, b] }, { members: ["duct-a"] }),
    authored: { loss: 0.1 },
    computed: { pressure: 1 },
  };
  const after = {
    ...entry({ kind: "section", bounds: [b, a] }, { members: ["duct-a", "heal-cap"] }),
    authored: { loss: 0.2 },
    computed: { pressure: 2 },
  };
  const result = compare([before], [after]);
  expect(result.kind).toBe("comparable");
  if (result.kind !== "comparable") return;
  expect([result.added, result.removed, result.unchanged]).toEqual([[], [], []]);
  expect(result.changed[0]?.differences.map((d) => d.facet)).toEqual([
    "model",
    "authored",
    "computed",
  ]);
});

it("uses captured UniqueIds across renumbering; reused numeric ids never match different UniqueIds", () => {
  const actual = JSON.parse(
    readFileSync(
      new URL("../../ducts-domain/src/sheet/fixtures/muas-real.json", import.meta.url),
      "utf8",
    ),
  ) as { document: object; nodes: { id: number; uniqueId: string; kind: string }[] };
  const node = actual.nodes[0]!;
  // Projection deliberately omits transient native id. The capture has no canonical document
  // identity or full id-set evidence, so this certifies a core law, not a product adapter.
  const project = (n: typeof node) => entry(key(n.uniqueId), { kind: n.kind });
  expect(compare([project(node)], [project({ ...node, id: node.id + 900 })])).toMatchObject({
    kind: "comparable",
    changed: [],
    added: [],
    removed: [],
    unchanged: [project(node)],
  });
  const reused = project({ ...node, uniqueId: actual.nodes[1]!.uniqueId });
  expect(compare([project(node)], [reused])).toMatchObject({
    kind: "comparable",
    added: [reused],
    removed: [project(node)],
    unchanged: [],
  });
  expect("document" in actual.document).toBe(false);
});

it("refuses crossdocument equal names and either partial side", () => {
  const s = snapshot([entry({ kind: "system", systemName: "SA 1" })]);
  expect(
    diffKeyed(s, {
      ...s,
      document: "doc-b" as DocumentKey,
    }),
  ).toMatchObject({ kind: "incomparable", reason: "cross-document-correspondence-unavailable" });
  const partial = {
    ...s,
    coverage: { kind: "partial", reason: "coarse reader kinds are not a full id-set" },
  } as const;
  for (const [a, b] of [
    [s, partial],
    [partial, s],
  ] as const)
    expect(diffKeyed(a, b)).toMatchObject({ kind: "incomparable", reason: "partial-coverage" });
});

it("rejects duplicates, forged numeric aliases, conflicting documents and unsupported loops", () => {
  const e = entry(key("unique-a"));
  expect(compare([e, { ...e, model: { conflict: true } }], [])).toMatchObject({
    reason: "duplicate-key",
  });
  for (const id of ['["doc-a",null,"123"]', element("unique-a", "other-document")]) {
    expect(
      compare([entry({ kind: "element", id: id as SubjectRefCode })], []),
    ).toMatchObject({ reason: "invalid-identity" });
  }
  expect(compare([entry({ kind: "loop" })], [])).toMatchObject({ reason: "unsupported-loop" });
});

it("permits deletes only after the complete id-set agrees with the entries", () => {
  const a = entry(key("unique-a")),
    b = entry(key("unique-b"));
  const before = snapshot([a, b]);
  expect(diffKeyed(before, snapshot([b]))).toMatchObject({
    kind: "comparable",
    removed: [a],
    unchanged: [b],
  });
  expect(diffKeyed({ ...before, entries: [a] }, snapshot([b]))).toMatchObject({
    reason: "coverage-mismatch",
  });
  expect(
    diffKeyed(before, {
      ...snapshot([b]),
      coverage: { ...before.coverage, kind: "partial", reason: "truncated" },
    }),
  ).toMatchObject({ reason: "partial-coverage" });
});

it("diffs exact _PE_DuctLosses rulings per authored key, including removal", () => {
  const k = key("terminal-unique");
  const before = {
    ...entry(k, { catalogDropInWg: 0.5 }),
    authored: {
      _PE_DuctLosses: {
        terminals: { "terminal-unique": { inWg: 0.2 } },
        criteria: { allowanceInWg: 0.1 },
        verdicts: { "join:unique-a:1|unique-b:0": { verdict: "connect" } },
      },
    },
    computed: { pressure: 0.7 },
  };
  const after = {
    ...before,
    authored: {
      _PE_DuctLosses: {
        terminals: { "terminal-unique": { inWg: 0.3 } },
        verdicts: { "join:unique-a:1|unique-b:0": { verdict: "ignore" } },
      },
    },
  };
  const result = compare([before], [after]);
  expect(result.kind).toBe("comparable");
  if (result.kind !== "comparable") return;
  expect(result.changed[0]?.differences).toEqual([
    {
      facet: "authored",
      path: ["_PE_DuctLosses", "criteria", "allowanceInWg"],
      before: 0.1,
      after: undefined,
    },
    {
      facet: "authored",
      path: ["_PE_DuctLosses", "terminals", "terminal-unique", "inWg"],
      before: 0.2,
      after: 0.3,
    },
    {
      facet: "authored",
      path: ["_PE_DuctLosses", "verdicts", "join:unique-a:1|unique-b:0", "verdict"],
      before: "connect",
      after: "ignore",
    },
  ]);
});

it("keeps port indices and path endpoints in identity, and rejects malformed bounds", () => {
  const fan = { element: element("fan-a"), index: 2 };
  const terminal = element("terminal-a");
  const a = entry({ kind: "path", fan, terminal });
  const b = entry({ kind: "path", fan, terminal: element("terminal-b") });
  expect(compare([a], [b])).toMatchObject({ kind: "comparable", added: [b], removed: [a] });
  const ports = [
    entry({ kind: "port", port: fan }),
    entry({ kind: "port", port: { ...fan, index: 1 } }),
  ];
  expect(compare(ports, ports)).toMatchObject({ kind: "comparable", changed: [] });
  for (const index of [-1, 0.5, Number.NaN])
    expect(compare([entry({ kind: "port", port: { ...fan, index } })], [])).toMatchObject({
      reason: "invalid-identity",
    });
  expect(compare([entry({ kind: "section", bounds: [fan, fan] })], [])).toMatchObject({
    reason: "invalid-identity",
  });
});

it("distinguishes JSON shapes and absent keys from null and empty objects", () => {
  const e = entry(key("unique-a"), { empty: {}, nil: null, array: [] });
  const result = compare([e], [{ ...e, model: { empty: [], array: {} } }]);
  expect(result.kind).toBe("comparable");
  if (result.kind !== "comparable") return;
  expect(result.changed[0]?.differences).toEqual([
    { facet: "model", path: ["array"], before: [], after: {} },
    { facet: "model", path: ["empty"], before: {}, after: [] },
    { facet: "model", path: ["nil"], before: null, after: undefined },
  ]);
  expect(
    compare([entry(key("unique-a"), {})], [entry(key("unique-a"), { empty: {} })]),
  ).toMatchObject({
    changed: [{ differences: [{ path: ["empty"], before: undefined, after: {} }] }],
  });
});

it("orders keys deterministically and ignores object insertion order without mutating inputs", () => {
  const a = Object.freeze(entry(key("unique-a"), { a: 1, b: 2 }));
  const b = Object.freeze(entry(key("unique-b")));
  expect(compare([b, a], [{ ...a, model: { b: 2, a: 1 } }, b])).toMatchObject({
    kind: "comparable",
    changed: [],
    unchanged: [a, b],
  });
  expect(compare([], [b, a])).toMatchObject({ added: [a, b] });
});
