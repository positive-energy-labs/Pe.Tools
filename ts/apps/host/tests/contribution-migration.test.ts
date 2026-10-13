import { expect, test } from "vite-plus/test";
import { migrateContributionEvents } from "../src/harness/contribution-migration.ts";
import { createHarnessThreads } from "../src/harness/threads.ts";
import type { Providers } from "../src/harness/providers.ts";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mapping = [
  { oldKey: "pod:renamed.run", key: "script:@snowdon-ducts/src/Census.cs", kind: "script" },
  { oldKey: "page:@renamed/pages/tour", key: "page:@snowdon-ducts/pages/tour", kind: "page" },
  { oldKey: "skill:make-page", key: "skill:@product/skills/make-page", kind: "skill" },
] as const;
const mention = (key: string) => ({
  key,
  kind: "pod",
  title: "old title",
  facts: {},
  takenAt: "then",
});
const journal = () =>
  [
    JSON.stringify({
      kind: "prompt",
      text: "pod:renamed.run is historical text",
      mentions: mapping.map((m) => mention(m.oldKey)),
      seq: 1,
      at: "then",
    }),
    ' {"kind":"update","update":{"sessionUpdate":"tool_call","rawInput":{"key":"pod:renamed.run"}},"seq":2,"at":"then"} ',
    JSON.stringify({ kind: "turn_end", receipt: { key: "pod:renamed.run" }, seq: 3, at: "then" }),
  ].join("\n") + "\n";

test("one cut migrates typed mentions only and preserves historical traffic byte for byte", () => {
  const input = journal();
  const result = migrateContributionEvents(input, mapping);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  const lines = result.journal.split("\n");
  expect(JSON.parse(lines[0]!).mentions.map((m: { key: string }) => m.key)).toEqual(
    mapping.map((m) => m.key),
  );
  expect(JSON.parse(lines[0]!).text).toBe("pod:renamed.run is historical text");
  expect(lines.slice(1)).toEqual(input.split("\n").slice(1));
  expect(migrateContributionEvents(result.journal, mapping)).toMatchObject({
    ok: true,
    changed: 0,
    journal: result.journal,
  });
});

test("the existing thread store preflights every journal before its explicit one-cut write", async () => {
  const root = mkdtempSync(join(tmpdir(), "pe-mention-cut-"));
  for (const id of ["one", "two"]) {
    mkdirSync(join(root, id));
    writeFileSync(join(root, id, "meta.json"), JSON.stringify({ id, harness: "codex", title: id }));
    writeFileSync(join(root, id, "events.jsonl"), journal());
  }
  const store = createHarnessThreads({
    root,
    worldRoot: root,
    providers: { get: () => undefined, keys: () => [] } as unknown as Providers,
    mcpServer: () => ({ name: "unused", command: "unused", args: [], env: [] }),
  });
  try {
    expect(store.migrateContributions([])).toMatchObject({ ok: false });
    for (const id of ["one", "two"])
      expect(readFileSync(join(root, id, "events.jsonl"), "utf8")).toBe(journal());
    expect(store.migrateContributions(mapping)).toMatchObject({ ok: true, changed: 6 });
    expect(store.migrateContributions(mapping)).toMatchObject({ ok: true, changed: 0 });
    for (const id of ["one", "two"]) {
      expect(JSON.parse(readFileSync(join(root, id, "meta.json"), "utf8"))).toEqual({
        id,
        harness: "codex",
        title: id,
      });
      expect(
        readFileSync(join(root, id, "events.jsonl"), "utf8")
          .split("\n")
          .slice(1),
      ).toEqual(journal().split("\n").slice(1));
    }
  } finally {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test.each(
  [
    [],
    [...mapping, { ...mapping[0]!, key: "script:@other/src/Census.cs" }],
    [...mapping, { oldKey: "pod:other.run", key: mapping[0]!.key, kind: "script" as const }],
    [...mapping, { oldKey: mapping[1]!.key, key: "page:@other/pages/tour", kind: "page" as const }],
    [
      ...mapping,
      { oldKey: "doc:session/open", key: "page:@other/pages/tour", kind: "page" as const },
    ],
  ].map((entries) => [entries]),
)("missing, ambiguous or colliding migration mapping refuses the entire journal", (entries) => {
  const input = journal();
  expect(migrateContributionEvents(input, entries)).toMatchObject({ ok: false, journal: input });
});
