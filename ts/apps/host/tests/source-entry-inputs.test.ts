import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Script } from "node:vm";
import ts from "typescript";
import { Effect } from "effect";
import { expect, vi } from "vite-plus/test";
import { effectTest } from "./effect-test.ts";
import { hostInputs } from "../src/host-program.ts";
import { admitBuild } from "../src/receipt-export.ts";

const sandbox = vi.hoisted(() => ({ root: "" }));
vi.mock("../src/host-ownership.ts", async (original) => {
  const actual = await original<typeof import("../src/host-ownership.ts")>();
  return { ...actual, hostOwnership: { ...actual.hostOwnership, get rootPath() { return sandbox.root; } } };
});

const source = (file: string) => ts.createSourceFile(file,
  readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function find<T extends ts.Node>(node: ts.Node, select: (node: ts.Node) => node is T): T | undefined {
  if (select(node)) return node;
  return ts.forEachChild(node, (child) => find(child, select));
}
const root = source("host-program.ts");
const program = find(root, (node): node is ts.VariableDeclaration =>
  ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "hostProgram");
if (!program?.initializer || !ts.isArrowFunction(program.initializer)) throw Error("Missing hostProgram root");
const automatic = program.initializer.parameters[2]!.initializer!.getText(root);

// Evaluate the actual raw caller argument, outside Vite's baked defines, then run the real
// input factory. Neither source entry is imported: their process/server/tray roots never start.
for (const file of ["dev.ts", "host-main.ts"]) {
  const entry = source(file);
  const call = find(entry, (node): node is ts.CallExpression =>
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "hostProgram");
  const choice = call?.arguments[2];
  if (!choice) throw Error(`${file} must pass its source input choice explicitly`);
  const select = new Script(`(${choice.getText(entry)}) ?? (${automatic})`);
  effectTest(`${file} explicitly disables capture only for unstamped source; stamped/SEA keep automatic admission`, () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "pe-source-entry-"))),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
      );
      sandbox.root = dir;
      const unrecorded = select.runInNewContext({ isSea: () => false });
      expect(unrecorded).toEqual({ kind: "live", capture: "off" });
      expect((yield* hostInputs(null, unrecorded)).source).toEqual({ kind: "live", capturing: false });
      expect(yield* Effect.promise(() => readdir(dir))).toEqual([]);

      const metadata = { version: "dev", build: "a".repeat(12), commit: "a".repeat(40) };
      for (const sea of [false, true]) {
        const automaticSelection = select.runInNewContext({ isSea: () => sea, __PE_HOST_RECEIPT_BUILD__: metadata });
        expect(automaticSelection).toEqual({ kind: "live", capture: "automatic" });
        const stamp = admitBuild("host", metadata, randomUUID(), randomUUID());
        const inputs = yield* hostInputs(stamp, automaticSelection);
        expect(inputs.source).toEqual({ kind: "live", capturing: true });
        expect(inputs.lane.kind === "live" && inputs.lane.captureStore).toBeDefined();
      }
      for (const context of [
        { isSea: () => true }, // A missing installed stamp is never a source opt-out.
        { isSea: () => false, __PE_HOST_RECEIPT_BUILD__: {} }, // Nor is malformed baked identity.
      ]) {
        const selection = select.runInNewContext(context);
        expect(selection).toEqual({ kind: "live", capture: "automatic" });
        const refused = yield* hostInputs(null, selection).pipe(Effect.flip);
        expect(refused.problem).toBe("recording.identity");
      }
    }),
  );
}

effectTest("K4: automatic capture that cannot open its store keeps live startup with truthful stopped provenance", () =>
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
    const inputs = yield* hostInputs(admitBuild("host", metadata, randomUUID(), randomUUID()), { kind: "live", capture: "automatic" });
    expect(inputs.source).toEqual({ kind: "live", capturing: false, truncated: { at: 1, reason: "setup" } });
    expect(inputs.lane.kind === "live" && inputs.lane.captureStore).toBeFalsy();
    // Missing identity is never guessed into a recording.
    expect((yield* Effect.flip(hostInputs(null, { kind: "live", capture: "automatic" }))).problem).toBe("recording.identity");
  }),
);
