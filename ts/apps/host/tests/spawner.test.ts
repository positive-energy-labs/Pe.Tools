import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { afterAll, expect, test, vi } from "vite-plus/test";
import { adapterCommand, openAdapter, stopChild } from "../src/harness/adapter.ts";
import { CHILD_EXIT_GRACE, Spawner, type ChildLaunch } from "../src/harness/spawner.ts";
import { effectTest } from "./effect-test.ts";

// ADR 0029 phase 4. The children here are real processes (the tree kill is the thing proven); the
// grace window runs on TestClock. A fixture that ignores stdin EOF stays up until its scope kills it.
const dir = mkdtempSync(join(tmpdir(), "pe-spawner-"));
const script = (name: string, body: string) => {
  const file = join(dir, name);
  writeFileSync(file, body);
  return file;
};
const stubborn = script("stubborn.js", "setInterval(() => {}, 1000);\n");
const obedient = script(
  "obedient.js",
  "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));\n",
);
// cmd -> node (this) -> node (grandchild): the pids a /T walk must reach from cmd's pid.
const parent = script(
  "parent.js",
  `const g = require("node:child_process").spawn(process.execPath, [${JSON.stringify(stubborn)}], { stdio: "ignore" });
console.log(JSON.stringify({ node: process.pid, grandchild: g.pid }));
setInterval(() => {}, 1000);
`,
);
const report = script(
  "report.js",
  `console.log(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: process.env }));
process.stdin.resume(); process.stdin.on('end', () => process.exit(0));
`,
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const real = (ms: number) => Effect.promise(() => new Promise<void>((r) => setTimeout(r, ms)));
/** A condition on real processes: polled on the wall clock, never the TestClock. */
const eventually = (what: string, check: () => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i++) {
      if (check()) return;
      yield* real(25);
    }
    throw new Error(`never: ${what}`);
  });
const firstLine = (stream: Stream.Stream<Uint8Array, unknown>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runHead,
    Effect.map((line) => (line._tag === "Some" ? line.value : "")),
  );
const spawner = Layer.build(Spawner.live).pipe(Effect.map((c) => Context.get(c, Spawner)));
const node = (...args: string[]): ChildLaunch => ({
  command: process.execPath,
  args,
  cwd: dir,
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
});

effectTest(
  "tree: closing the handle's scope kills cmd, its node and the grandchild",
  () =>
    Effect.gen(function* () {
      const { spawn } = yield* spawner;
      const scope = yield* Scope.make();
      const handle = yield* spawn({
        ...node(),
        command: "cmd",
        args: ["/c", process.execPath, parent],
      }).pipe(Scope.provide(scope));
      const { node: nodePid, grandchild } = JSON.parse(yield* firstLine(handle.stdout));
      const pids = [handle.pid, nodePid, grandchild];
      expect(new Set(pids).size).toBe(3);
      expect(pids.map(alive)).toEqual([true, true, true]);
      // The fixture ignores stdin EOF, so the close waits out the grace window: TestClock owns it.
      const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
      yield* real(200);
      expect(yield* Effect.sync(() => closing.pollUnsafe())).toBeUndefined();
      yield* TestClock.adjust(CHILD_EXIT_GRACE);
      yield* Fiber.join(closing);
      yield* eventually("the tree is gone", () => !pids.some(alive));
    }),
  60_000,
);

effectTest(
  "scope close: a child that ignores stdin is killed exactly at the grace window",
  () =>
    Effect.gen(function* () {
      const { spawn } = yield* spawner;
      const scope = yield* Scope.make();
      const handle = yield* spawn(node(stubborn)).pipe(Scope.provide(scope));
      const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
      yield* real(200);
      yield* TestClock.adjust("1999 millis");
      yield* real(200);
      expect(alive(handle.pid)).toBe(true);
      expect(closing.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 millis");
      yield* Fiber.join(closing);
      yield* eventually("the child is gone", () => !alive(handle.pid));
    }),
  60_000,
);

effectTest(
  "scope close: a child that honours stdin EOF exits inside the grace window, clock untouched",
  () =>
    Effect.gen(function* () {
      const { spawn } = yield* spawner;
      const scope = yield* Scope.make();
      const handle = yield* spawn(node(obedient)).pipe(Scope.provide(scope));
      const exited = yield* Effect.forkChild(handle.exitCode);
      yield* Scope.close(scope, Exit.void);
      expect(yield* Fiber.join(exited)).toBe(0);
      expect(alive(handle.pid)).toBe(false);
    }),
  60_000,
);

effectTest(
  "spawner scope: closing the Spawner kills a child whose own scope is still open",
  () =>
    Effect.gen(function* () {
      const owner = yield* Scope.make();
      const { spawn } = Context.get(yield* Layer.buildWithScope(Spawner.live, owner), Spawner);
      const open = yield* Scope.make();
      const handle = yield* spawn(node(stubborn)).pipe(Scope.provide(open));
      expect(alive(handle.pid)).toBe(true);
      const closing = yield* Effect.forkChild(Scope.close(owner, Exit.void));
      yield* real(200);
      yield* TestClock.adjust(CHILD_EXIT_GRACE);
      yield* Fiber.join(closing);
      yield* eventually("the child is gone", () => !alive(handle.pid));
    }),
  60_000,
);

// The previous shape (c510da4b `openAdapter`): spawn(command, args, { cwd, env: { ...env, ...launch.env } }).
// Launch config decoding and the whole-env contract are unchanged: nothing of the host's own env leaks.
effectTest(
  "launch: argv, cwd and env reach the child as the previous spawn shape delivered them",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("PE_HARNESS_ADAPTER_CLAUDE", report);
      vi.stubEnv("PE_SPAWNER_PARENT_ONLY", "leak");
      yield* Effect.addFinalizer(() => Effect.sync(() => vi.unstubAllEnvs()));
      const env = {
        PATH: "",
        USERPROFILE: dir,
        LOCALAPPDATA: dir,
        SystemRoot: process.env.SystemRoot,
        ANTHROPIC_BASE_URL: "http://127.0.0.1:1/v1",
        ANTHROPIC_API_KEY: "sk-fixture",
        UNSET: undefined,
      };
      const launch = adapterCommand("claude", dir, env);
      expect(launch).toEqual({ command: process.execPath, args: [report], cwd: dir, env });
      const { spawn } = yield* spawner;
      const scope = yield* Scope.make();
      const handle = yield* spawn(launch).pipe(Scope.provide(scope));
      const seen = JSON.parse(yield* firstLine(handle.stdout));
      yield* Scope.close(scope, Exit.void);
      expect(seen.argv).toEqual([]); // node's argv is [exec, script]; slice(2) is the adapter's own args
      expect(seen.cwd.toLowerCase()).toBe(dir.toLowerCase());
      const defined = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));
      const lower = (o: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
      // Windows adds its own HOMEDRIVE, USERNAME, WINDIR, ... to any env; the host's own never leaks in.
      expect(lower(seen.env)).toMatchObject(lower(defined));
      expect(lower(seen.env)).not.toHaveProperty("pe_spawner_parent_only");
    }),
  60_000,
);

// openAdapter / stopChild: the Promise island over the Spawner, as threads.ts and providers.ts call it.
const adapterFixture = async (file: string) => {
  vi.stubEnv("PE_HARNESS_ADAPTER_CLAUDE", file);
  const env = { PATH: "", USERPROFILE: dir, LOCALAPPDATA: dir, SystemRoot: process.env.SystemRoot };
  return openAdapter("claude", dir, env, () => ({
    sessionUpdate: async () => {},
    requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
  }));
};
const exits = (child: { once: (e: "exit", f: (...a: unknown[]) => void) => unknown }) =>
  new Promise<unknown[]>((resolve) => child.once("exit", (...a) => resolve(a)));

test("openAdapter: stopChild ends stdin, the child exits, and the exit event follows", async () => {
  const opened = await adapterFixture(obedient);
  const exit = exits(opened.child);
  await vi.waitFor(() => expect(opened.child.pid).toBeGreaterThan(0));
  const pid = opened.child.pid!;
  expect(alive(pid)).toBe(true);
  await stopChild(opened.child);
  expect(await exit).toEqual([0, null]);
  expect(alive(pid)).toBe(false);
  vi.unstubAllEnvs();
}, 30_000);

test("openAdapter: a child that dies on its own reports its exit code and the stderr tail", async () => {
  const dies = script("dies.js", "console.error('no auth'); process.exit(3);\n");
  const opened = await adapterFixture(dies);
  expect(await exits(opened.child)).toEqual([3, null]);
  expect(opened.stderr()).toContain("no auth");
  await stopChild(opened.child);
  vi.unstubAllEnvs();
}, 30_000);
