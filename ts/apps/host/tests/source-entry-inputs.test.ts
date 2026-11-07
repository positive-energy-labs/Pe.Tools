import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Script } from "node:vm";
import ts from "typescript";
import { Effect } from "effect";
import { expect, vi } from "vite-plus/test";
import { effectTest } from "./effect-test.ts";
import { hostInputs } from "../src/host-program.ts";
import { admitBuild, admittedReceiptStamps } from "../src/receipt-export.ts";
import { receiptBuildStamp } from "../src/build-stamp.ts";
import {
  openRecordingWriter,
  openRecordingReader,
  nativeCatalogIdentity,
} from "../src/native-recording.ts";

const sandbox = vi.hoisted(() => ({ root: "", installed: false, sea: false }));
vi.mock("node:sea", () => ({ isSea: () => sandbox.sea }));
// Synthetic SEA identity must not ask runtime-owner to treat this test's Node process as installed.
vi.mock("@pe/runtime", async (original) => ({
  ...(await original<typeof import("@pe/runtime")>()),
  readOrCreateInstallId: () => "7f183ae6-a157-4eb4-838a-931b950a0bdf",
}));
vi.mock("../src/host-ownership.ts", async (original) => {
  const actual = await original<typeof import("../src/host-ownership.ts")>();
  return {
    ...actual,
    hostOwnership: {
      ...actual.hostOwnership,
      get rootPath() {
        return sandbox.root;
      },
      get lane() {
        return sandbox.installed ? "installed" : "dev";
      },
    },
  };
});

const source = (file: string) =>
  ts.createSourceFile(
    file,
    readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
function find<T extends ts.Node>(
  node: ts.Node,
  select: (node: ts.Node) => node is T,
): T | undefined {
  if (select(node)) return node;
  return ts.forEachChild(node, (child) => find(child, select));
}
const root = source("host-program.ts");
const program = find(
  root,
  (node): node is ts.VariableDeclaration =>
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === "hostProgram",
);
if (!program?.initializer || !ts.isArrowFunction(program.initializer))
  throw Error("Missing hostProgram root");
const automatic = program.initializer.parameters[2]!.initializer!.getText(root);

// Evaluate the actual raw caller argument, outside Vite's baked defines, then run the real
// input factory. Neither source entry is imported: their process/server/tray roots never start.
for (const file of ["dev.ts", "host-main.ts"]) {
  const entry = source(file);
  const call = find(
    entry,
    (node): node is ts.CallExpression =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "hostProgram",
  );
  const choice = call?.arguments[2];
  const select = new Script(`(${choice?.getText(entry) ?? "undefined"}) ?? (${automatic})`);
  effectTest(`${file} records source launches and keeps installed/baked identity strict`, () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "pe-source-entry-"))),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
      );
      sandbox.root = dir;
      const selection = select.runInNewContext({ selection: undefined });
      expect(selection).toEqual({ kind: "live", capture: "automatic" });
      expect((yield* hostInputs(admittedReceiptStamps().host, selection)).source).toEqual({
        kind: "live",
        capturing: true,
      });

      const metadata = { version: "dev", build: "a".repeat(12), commit: "a".repeat(40) };
      for (const sea of [false, true]) {
        sandbox.sea = sea;
        vi.stubGlobal("__PE_HOST_RECEIPT_BUILD__", metadata);
        const inputs = yield* hostInputs(admittedReceiptStamps().host, selection);
        expect(inputs.source).toEqual({ kind: "live", capturing: true });
        expect(inputs.lane.kind === "live" && inputs.lane.captureStore).toBeDefined();
      }
      vi.unstubAllGlobals();
      expect(admittedReceiptStamps().host).toBeNull(); // SEA cannot derive source identity.
      sandbox.sea = false;
      sandbox.installed = true;
      expect(admittedReceiptStamps().host).toBeNull();
      sandbox.installed = false;
      vi.stubGlobal("__PE_HOST_RECEIPT_BUILD__", {});
      expect(admittedReceiptStamps().host).toBeNull(); // Malformed baked identity cannot fall back.
      vi.unstubAllGlobals();
    }),
  );
}

effectTest("two dirty source builds at one HEAD refuse each other's recordings", () =>
  Effect.gen(function* () {
    const dir = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "pe-source-stamp-"))),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
    );
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
    git("init", "-q");
    yield* Effect.promise(() => writeFile(join(dir, "source.ts"), "first"));
    git("add", "source.ts");
    git("-c", "user.name=Proof", "-c", "user.email=proof@example.test", "commit", "-qm", "source");
    const clean = receiptBuildStamp("dev", dir);
    yield* Effect.promise(() => writeFile(join(dir, "source.ts"), "dirty one"));
    const first = receiptBuildStamp("dev", dir);
    yield* Effect.promise(() => writeFile(join(dir, "source.ts"), "dirty two"));
    const second = receiptBuildStamp("dev", dir);
    yield* Effect.promise(() => writeFile(join(dir, "new.ts"), "new source"));
    const third = receiptBuildStamp("dev", dir);
    expect(new Set([clean.build, first.build, second.build, third.build]).size).toBe(4);
    expect([first.commit, second.commit, third.commit]).toEqual([
      clean.commit,
      clean.commit,
      clean.commit,
    ]);
    const identity = (stamp: typeof first) => ({
      build: JSON.stringify(stamp),
      catalog: nativeCatalogIdentity(),
    });
    const bounds = { maxBytes: 1_000_000, maxTakings: 100 };
    const recording = join(dir, "recording");
    yield* openRecordingWriter(recording, identity(first), bounds);
    expect(
      (yield* Effect.flip(openRecordingReader(recording, identity(second), bounds))).problem,
    ).toBe("recording.mismatch");
  }),
);

effectTest(
  "K4: automatic capture that cannot open its store keeps live startup with truthful stopped provenance",
  () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "pe-source-entry-"))),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
      );
      // A product root under a file: the recordings directory cannot be created (I/O).
      const blocker = join(dir, "not-a-directory");
      yield* Effect.promise(() => writeFile(blocker, ""));
      sandbox.root = join(blocker, "root");
      const metadata = { version: "dev", build: "a".repeat(12), commit: "a".repeat(40) };
      const inputs = yield* hostInputs(admitBuild("host", metadata, randomUUID(), randomUUID()), {
        kind: "live",
        capture: "automatic",
      });
      expect(inputs.source).toEqual({
        kind: "live",
        capturing: false,
        truncated: { at: 1, stoppedAt: expect.any(Number), reason: "setup" },
      });
      expect(inputs.lane.kind === "live" && inputs.lane.captureStore).toBeFalsy();
      // Missing identity is never guessed into a recording.
      expect(
        (yield* Effect.flip(hostInputs(null, { kind: "live", capture: "automatic" }))).problem,
      ).toBe("recording.identity");
    }),
);
