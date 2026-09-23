import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { Effect, FileSystem, PlatformError } from "effect";
import { NodeServices } from "@effect/platform-node";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memberWork, settingsRouteState } from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { admitFamilyAction } from "../src/family-actions.ts";
import { writeFileStringAtomic } from "../src/files/index.ts";
import {
  composeMember,
  composedSpec,
  listPods,
  listRuns,
  readMember,
  saveMember,
  writeMember,
  type PodContext,
} from "../src/settings.ts";
import type { RevitBridge } from "../src/bridge.ts";

let root: string;
const member = { pod: "sample", path: "settings/file.json" };
const digest = (raw: string | Uint8Array) => createHash("sha256").update(raw).digest("hex");
const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
const ctx = (): PodContext => ({ podsRoot: root });
// The folder name is an address; the pod is found by its manifest id.
const file = () => join(root, "Renamed In Explorer", "settings", "file.json");
const schema = JSON.stringify({
  type: "object",
  properties: { $schema: { type: "string" }, width: { type: "number" } },
  required: ["width"],
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-pod-members-"));
  await mkdir(join(root, "Renamed In Explorer", "settings"), { recursive: true });
  await writeFile(
    join(root, "Renamed In Explorer", "pod.json"),
    JSON.stringify({
      id: "sample",
      name: "Sample",
      version: "1.0.0",
      entrypoints: [{ id: "run", sourcePath: "src/Run.cs" }],
    }),
  );
});
afterEach(() => rm(root, { recursive: true, force: true }));

test("pods list by manifest id; a bad member never hides its siblings; runs list read-only", async () => {
  await writeFile(file(), '{"$schema":"https://pe/schemas/settings/family.json","width":1}');
  await writeFile(join(root, "Renamed In Explorer", "settings", "broken.json"), "{ nope");
  await mkdir(join(root, "Renamed In Explorer", "output", "run-1"), { recursive: true });
  await writeFile(
    join(root, "Renamed In Explorer", "output", "run-1", "receipt.json"),
    JSON.stringify({
      podId: "sample",
      memberPath: "settings/file.json",
      memberSha256: "abc",
      operation: "family.apply",
      planHash: "p1",
      outcome: "Succeeded",
      outputs: ["apply.json"],
      reason: null,
    }),
  );
  await mkdir(join(root, "Renamed In Explorer", "output", "run-0"), { recursive: true });
  await mkdir(join(root, "Twin"), { recursive: true });
  await writeFile(join(root, "Twin", "pod.json"), JSON.stringify({ id: "sample" }));
  await mkdir(join(root, "Junk"), { recursive: true });
  await writeFile(join(root, "Junk", "pod.json"), "not json");

  const listed = await run(listPods(ctx()));
  const sample = listed.pods.find((pod) => pod.folder === "Renamed In Explorer")!;
  expect(sample).toMatchObject({
    id: "sample",
    name: "Sample",
    entrypoints: [{ id: "run", sourcePath: "src/Run.cs" }],
  });
  // Members only: a run is not a member, and `pod.runs` is where runs answer.
  expect(sample.members).toEqual([
    { path: "settings/broken.json", sha256: expect.any(String), schema: null },
    {
      path: "settings/file.json",
      sha256: digest(await readFile(file())),
      schema: "https://pe/schemas/settings/family.json",
    },
  ]);
  expect(sample.diagnostics[0]?.message).toMatch(/Renamed In Explorer, Twin/);
  expect(listed.unreadable.map((row) => row.folder)).toEqual(["Junk"]);
  // A duplicate id refuses to resolve and names both folders.
  await expect(run(readMember(member, ctx()))).rejects.toMatchObject({
    statusCode: 409,
    note: expect.stringContaining("Renamed In Explorer, Twin"),
  });
});

test("runs list newest first, by member, and a run with no receipt still says so", async () => {
  await mkdir(join(root, "Runs", "output", "run-0"), { recursive: true });
  await mkdir(join(root, "Runs", "output", "run-1"), { recursive: true });
  await writeFile(join(root, "Runs", "pod.json"), JSON.stringify({ id: "runs" }));
  await writeFile(
    join(root, "Runs", "output", "run-1", "receipt.json"),
    JSON.stringify({
      podId: "runs",
      memberPath: "settings/file.json",
      memberSha256: "abc",
      operation: "family.apply",
      planHash: "p1",
      outcome: "Succeeded",
      outputs: ["apply.json"],
      reason: null,
    }),
  );

  // A native run writes its input before any effect; a crash after that leaves input and no receipt.
  await mkdir(join(root, "Runs", "output", "run-2"), { recursive: true });
  const source = {
    kind: "pod-composition",
    origin: "SavedMember",
    pod: "runs",
    path: "settings/file.json",
    sha256: "def",
  };
  await writeFile(
    join(root, "Runs", "output", "run-2", "input.json"),
    JSON.stringify({ operation: "schedule.apply", source, files: [] }),
  );

  const { runs } = await run(listRuns({ pod: "runs" }, ctx()));
  expect(runs).toEqual([
    {
      runId: "run-2",
      receiptPath: "output/run-2/receipt.json",
      receipt: null,
      source,
      error: "The run holds its input but no receipt.json; its outcome is unresolved.",
    },
    {
      runId: "run-1",
      receiptPath: "output/run-1/receipt.json",
      receipt: expect.objectContaining({ operation: "family.apply", outcome: "Succeeded" }),
      error: null,
    },
    {
      runId: "run-0",
      receiptPath: "output/run-0/receipt.json",
      receipt: null,
      error: "The run folder holds no receipt.json.",
    },
  ]);
  expect(
    (await run(listRuns({ pod: "runs", path: "settings/file.json" }, ctx()))).runs.map(
      (r) => r.runId,
    ),
  ).toEqual(["run-2", "run-1"]);
  expect((await run(listRuns({ pod: "runs", path: "other.json" }, ctx()))).runs).toEqual([]);
});

test("an Operation receipt that names a member is refused, not quietly normalized", async () => {
  await mkdir(join(root, "Ops", "output", "capture-run"), { recursive: true });
  await writeFile(join(root, "Ops", "pod.json"), JSON.stringify({ id: "ops" }));
  // A writer regression: a capture consumed Revit, yet this receipt borrows the member it wrote.
  await writeFile(
    join(root, "Ops", "output", "capture-run", "receipt.json"),
    JSON.stringify({
      podId: "ops",
      memberPath: "settings/captured.json",
      memberSha256: "abc",
      origin: "Operation",
      operation: "family.capture",
      planHash: null,
      outcome: "Succeeded",
      outputs: [],
      reason: null,
    }),
  );
  const { runs } = await run(listRuns({ pod: "ops" }, ctx()));
  expect(runs).toEqual([
    {
      runId: "capture-run",
      receiptPath: "output/capture-run/receipt.json",
      receipt: null,
      error:
        "receipt.json is an Operation run that names a member; an operation consumed no member, so its memberPath and memberSha256 must be null.",
    },
  ]);
});

test("a draft run is listed under its member only with its draft label and no saved hash", async () => {
  await mkdir(join(root, "Drafts", "output", "draft-run"), { recursive: true });
  await mkdir(join(root, "Drafts", "output", "legacy-run"), { recursive: true });
  await writeFile(join(root, "Drafts", "pod.json"), JSON.stringify({ id: "drafts" }));
  await writeFile(
    join(root, "Drafts", "output", "draft-run", "receipt.json"),
    JSON.stringify({
      podId: null,
      memberPath: null,
      memberSha256: "draft-bytes-hash",
      origin: "SuppliedDraft",
      operation: "family.apply",
      planHash: null,
      outcome: "Cancelled",
      outputs: [],
      reason: null,
    }),
  );
  await writeFile(
    join(root, "Drafts", "output", "draft-run", "input.json"),
    JSON.stringify({
      operation: "family.apply",
      source: {
        kind: "pod-composition",
        origin: "SuppliedDraft",
        path: "settings/file.json",
        sha256: "draft-bytes-hash",
      },
      files: [],
    }),
  );
  await writeFile(
    join(root, "Drafts", "output", "legacy-run", "receipt.json"),
    JSON.stringify({
      podId: "drafts",
      memberPath: "settings/file.json",
      memberSha256: "x",
      operation: "scripting.execute",
      outcome: "CompilationFailed",
      outputs: [],
    }),
  );
  const { runs } = await run(listRuns({ pod: "drafts", path: "settings/file.json" }, ctx()));
  const draft = runs.find((r) => r.runId === "draft-run")!;
  expect(draft.receipt).toMatchObject({
    podId: null,
    origin: "SuppliedDraft",
    memberPath: null,
    memberSha256: null,
    outcome: "Cancelled",
  });
  // An unreadable receipt cannot name a member, so it lists only in the whole pod's runs.
  const all = (await run(listRuns({ pod: "drafts" }, ctx()))).runs;
  expect(all.find((r) => r.runId === "legacy-run")).toMatchObject({
    receipt: null,
    error: "receipt.json outcome 'CompilationFailed' is not Succeeded, Failed, Cancelled.",
  });
});

test("read returns exact bytes and their sha256; invalid UTF-8 refuses", async () => {
  const raw = "\uFEFF{ broken  \r\n";
  await writeFile(file(), raw);
  expect(await run(readMember(member, ctx()))).toEqual({
    content: raw,
    sha256: digest(await readFile(file())),
    bytesBase64: Buffer.from(await readFile(file())).toString("base64"),
  });
  await writeFile(file(), Buffer.from([0x7b, 0xff, 0x7d]));
  await expect(run(readMember(member, ctx()))).rejects.toMatchObject({ statusCode: 400 });
});

test("write creates once, save replaces only the reviewed bytes, and refuses runs and escapes", async () => {
  const created = await run(writeMember({ ...member, content: '{"a":1}' }, ctx()));
  expect(created).toEqual({ ...member, sha256: digest('{"a":1}') });
  await expect(run(writeMember({ ...member, content: "{}" }, ctx()))).rejects.toMatchObject({
    statusCode: 409,
  });
  await expect(
    run(saveMember({ ...member, content: "{}", expectedSha256: digest("stale") }, ctx())),
  ).rejects.toMatchObject({ statusCode: 409 });
  await run(saveMember({ ...member, content: '{"a":2}', expectedSha256: created.sha256 }, ctx()));
  expect(await readFile(file(), "utf8")).toBe('{"a":2}');
  for (const path of ["output/run/receipt.json", "pod.json", "../escape.json"])
    await expect(
      run(writeMember({ pod: "sample", path, content: "{}" }, ctx())),
    ).rejects.toMatchObject({ statusCode: 400 });
  await expect(
    run(writeMember({ ...member, path: "settings/bad.json", content: "\uD800" }, ctx())),
  ).rejects.toMatchObject({ statusCode: 400 });
  // Two writers of one new member: exactly one wins, and its bytes are what landed.
  const racers = await Promise.allSettled(
    ["x", "y"].map((v) =>
      run(writeMember({ ...member, path: "settings/race.json", content: v }, ctx())),
    ),
  );
  const winner = racers.find((r) => r.status === "fulfilled")!;
  expect(racers.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(digest(await readFile(join(root, "Renamed In Explorer", "settings", "race.json")))).toBe(
    (winner as PromiseFulfilledResult<{ sha256: string }>).value.sha256,
  );
});

test("offline, a $include member renders with a composition notice instead of an error", async () => {
  await writeFile(file(), '{"$schema":"https://pe/s.json","$include":"@global/_fields/Header"}');
  const result = await run(composeMember({ ...member, schemaJson: schema }, ctx()));
  expect(result.diagnostics).toEqual([
    expect.objectContaining({ code: "CompositionNeedsRevit", severity: "info" }),
  ]);
  expect(result).toMatchObject({ composed: null, schemaValidation: "not-run" });
  expect(Buffer.from(result.source.bytesBase64, "base64")).toEqual(await readFile(file()));
});

test("offline structural validation runs from a held schema; parse errors are issues", async () => {
  const draft = '{"$schema":"https://pe/s.json","width":"wide"}';
  const invalid = await run(
    composeMember({ ...member, content: draft, schemaJson: schema }, ctx()),
  );
  expect(invalid.schemaValidation).toBe("failed");
  expect(invalid.diagnostics[0]).toMatchObject({ path: "width", severity: "error" });
  expect(invalid.semanticValidation).toBe("not-run");
  const valid = await run(
    composeMember(
      { ...member, content: '{"$schema":"https://pe/s.json","width":2}', schemaJson: schema },
      ctx(),
    ),
  );
  expect(valid).toMatchObject({ schemaValidation: "passed", semanticValidation: "unavailable" });
  const plain = await run(composeMember({ ...member, content: '{"any":1}' }, ctx()));
  expect(plain).toMatchObject({ schemaValidation: "no-schema", diagnostics: [] });
  const broken = await run(composeMember({ ...member, content: "{" }, ctx()));
  expect(broken.diagnostics[0]?.code).toBe("JsonParseError");
});

test("with a session, the draft composes natively, then schema and semantic checks run", async () => {
  const calls: [string, unknown][] = [];
  const schemaUrl = "http://127.0.0.1:5180/schemas/settings/FamilyFoundry/models.json";
  const draft = JSON.stringify({ $schema: schemaUrl, $preset: "@local/base.json" });
  const withBridge: PodContext = {
    podsRoot: root,
    invokeBridge: (key, payload) => {
      calls.push([key, payload]);
      if (key === "pod.member.compose")
        return Effect.succeed({
          composed: '{"width":3}',
          source: (payload as { source: unknown }).source,
          diagnostics: [
            {
              stage: "Shadowed",
              message: "a preset key is shadowed",
              severity: "Warning",
              source: "settings/base.json",
            },
          ],
          dependencies: [
            {
              id: "sample",
              path: "settings/base.json",
              sha256: "b".repeat(64),
              bytesBase64: Buffer.from("{}").toString("base64"),
            },
          ],
        });
      if (key === "settings.schema") return Effect.succeed({ schemaJson: schema });
      return Effect.succeed({
        isConfigured: true,
        issues: [
          { instancePath: "/width", code: "Unknown", severity: "Error", message: "no such family" },
        ],
      });
    },
  };
  const result = await run(composeMember({ ...member, content: draft }, withBridge));
  expect(calls.map(([key]) => key)).toEqual([
    "pod.member.compose",
    "settings.schema",
    "settings.validate",
  ]);
  expect(calls[0]![1]).toEqual({
    ...member,
    content: draft,
    source: {
      id: "sample",
      path: member.path,
      sha256: digest(draft),
      bytesBase64: Buffer.from(draft).toString("base64"),
      origin: "SuppliedDraft",
    },
  });
  expect(calls[1]![1]).toEqual({ schemaUrl });
  expect(calls[2]![1]).toMatchObject({
    schemaUrl,
    rawContent: draft,
  });
  expect(JSON.parse(result.composed!)).toEqual({ width: 3 });
  expect(result.dependencies).toHaveLength(1);
  expect(result.diagnostics.map((d) => [d.code, d.path, d.severity])).toEqual([
    ["Shadowed", "settings/base.json", "warning"],
    ["Unknown", "/width", "error"],
  ]);
  expect(result.schemaJson).toBe(schema);
  expect(result).toMatchObject({ schemaValidation: "passed", semanticValidation: "failed" });
});

test("composed spec sends the saved read bytes once and keeps saved attribution", async () => {
  const raw = '\uFEFF{ "items": [{ "$include": "@local/base" }] }\r\n';
  await writeFile(file(), raw);
  let composeRequest: unknown;
  const withBridge: PodContext = {
    podsRoot: root,
    invokeBridge: (key, payload) => {
      composeRequest = payload;
      const source = (payload as { source: unknown }).source;
      return Effect.succeed({
        composed: '{"items":[]}',
        source,
        diagnostics: [],
        dependencies: [],
      });
    },
  };

  const result = await run(composedSpec({ ...member, sha256: digest(raw) }, withBridge));

  expect(result.source).toEqual({
    id: "sample",
    path: member.path,
    sha256: digest(raw),
    bytesBase64: Buffer.from(raw).toString("base64"),
    origin: "SavedMember",
  });
  expect(composeRequest).toMatchObject({ content: raw, source: result.source });
});

test("settings.write saves reviewed member Work and republishes the new basis", async () => {
  await writeFile(file(), '{"width":1}');
  const scope = {
    binding: "workspace" as const,
    route: settingsRouteState.route,
    target: null,
    work: memberWork(member),
  };
  const rows = new Map<string, unknown>();
  const work = new RouteWorkspace({
    registrations: [{ spec: settingsRouteState, handlers: {} }],
    store: {
      getState: async ({ targetKey, route }) => rows.get(targetKey + route),
      setState: async ({ targetKey, route, value }) => {
        rows.set(targetKey + route, structuredClone(value));
      },
    },
  });
  const sha256 = digest('{"width":1}');
  const authored = await work.apply(
    scope,
    settingsRouteState.route,
    "human",
    [
      { path: ["basis"], value: { member, rawContent: '{"width":1}', sha256 } },
      { path: ["fields"], value: { "/width": { staged: { value: 5 } } } },
    ],
    0,
  );
  const owner = new ActionJournal(join(root, "journal.json"));
  const admit = (id: string, write: unknown, revision: number) =>
    admitFamilyAction(
      {
        id,
        kind: "workflow",
        key: "settings.write",
        actor: "human",
        destination: { kind: "host" },
        input: { member, write },
        bases: { work: { key: scope, revision } },
      },
      owner,
      new TakeoffCaptures(join(root, "captures")),
      {} as RevitBridge["Service"],
      { workspace: work, podsRoot: root },
    ).then((row) => owner.wait(row.id));
  const saved = await admit("save", { kind: "save", sha256 }, authored.revision!);
  expect(saved.state, JSON.stringify(saved)).toBe("succeeded");
  expect(JSON.parse(await readFile(file(), "utf8"))).toEqual({ width: 5 });
  const after = settingsRouteState.schema.parse(
    (await work.read(scope, settingsRouteState.route))!.doc,
  );
  expect(after.basis?.sha256).toBe(digest(await readFile(file())));
  expect(after.fields["/width"]?.staged).toBeUndefined();
  // The old basis is gone from disk; a second save against it refuses before writing.
  const stale = await admit(
    "stale",
    { kind: "save", sha256 },
    (await work.read(scope, settingsRouteState.route))!.revision,
  );
  expect(stale.state).toBe("failed");
});

test("partial temp write failure cleans only the acquired temp and preserves destination", async () => {
  await writeFile(file(), "original");
  const failure = PlatformError.systemError({
    _tag: "Unknown",
    module: "FileSystem",
    method: "writeAll",
    description: "injected partial write",
  });
  await expect(
    run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* writeFileStringAtomic(file(), "candidate", "test").pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            open: (path, options) =>
              fs.open(path, options).pipe(
                Effect.map((handle) => ({
                  ...handle,
                  writeAll: (bytes) =>
                    handle
                      .writeAll(bytes.subarray(0, 2))
                      .pipe(Effect.andThen(Effect.fail(failure))),
                })),
              ),
          }),
        );
      }),
    ),
  ).rejects.toMatchObject({ note: expect.stringContaining("injected partial write") });
  expect(await readFile(file(), "utf8")).toBe("original");
  expect(await readdir(join(root, "Renamed In Explorer", "settings"))).toEqual(["file.json"]);
});
