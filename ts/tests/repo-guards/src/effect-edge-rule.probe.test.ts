import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { tsRoot } from "./effect-islands-census.ts";

// ADR 0029 rule 2: one fixture per way around `pe/effect-edge`, each of which must be flagged, and
// the legal markings, which must not be. Runs the real oxlint over real files with the real rule.
const pnpm = resolve(tsRoot, "node_modules/.pnpm");
const oxlint = join(
  pnpm,
  readdirSync(pnpm).find((name) => name.startsWith("oxlint@"))!,
  "node_modules/oxlint/bin/oxlint",
);
const plugin = resolve(tsRoot, "scripts/oxlint-effect-edge.js").replaceAll("\\", "/");

const head = `import { Effect } from "effect";\ndeclare const p: Effect.Effect<void>;\n`;
const flagged: Record<string, [source: string, diagnostics: number]> = {
  "alias-import": [
    `import { Effect as E } from "effect";\ndeclare const p: any;\nE.runPromise(p);\n`,
    1,
  ],
  "namespace-import": [
    `import * as Eff from "effect/Effect";\ndeclare const p: any;\nEff.runSync(p);\n`,
    1,
  ],
  "named-import": [
    `import { runPromise } from "effect/Effect";\ndeclare const p: any;\nrunPromise(p);\n`,
    2,
  ],
  destructure: [`${head}const { runPromise } = Effect;\nrunPromise(p);\n`, 2],
  "computed-literal": [`${head}Effect["runPromise"](p);\n`, 1],
  "computed-dynamic": [`${head}declare const k: "runSync";\nEffect[k](p);\n`, 1],
  "run-callback": [`${head}Effect.runCallback(p);\n`, 1],
  "with-variants": [
    `${head}declare const c: any;\nEffect.runPromiseWith(c)(p);\nEffect.runForkWith(c)(p);\nEffect.runSyncExitWith(c)(p);\nEffect.runCallbackWith(c)(p);\n`,
    4,
  ],
  "managed-runtime": [
    `declare const rt: { runPromise(p: unknown): Promise<void> };\nrt.runPromise(1);\n`,
    1,
  ],
  "run-main": [
    `import { NodeRuntime } from "@effect/platform-node";\ndeclare const p: any;\nNodeRuntime.runMain(p);\n`,
    1,
  ],
  "fiber-run-in": [
    `import { Fiber } from "effect";\ndeclare const f: any, s: any;\nFiber.runIn(f, s);\n`,
    1,
  ],
  "alias-carried-out": [
    `${head}// effect-edge: island, phase 5\nexport const run = Effect.runPromise;\nrun(p);\n`,
    1,
  ],
  "string-marker": [
    `${head}Effect.runPromise(p); const s = "// effect-edge: island, phase 5";\nvoid s;\n`,
    1,
  ],
  "template-marker": [
    `${head}const s = \`\n// effect-edge: island, phase 5\n\`;\nvoid s;\nEffect.runPromise(p);\n`,
    1,
  ],
  "marker-two-lines-up": [`${head}// effect-edge: island, phase 5\n\nEffect.runPromise(p);\n`, 1],
  "marker-trails-code": [
    `${head}void 0; // effect-edge: island, phase 5\nEffect.runPromise(p);\n`,
    1,
  ],
  "block-comment-marker": [`${head}/* effect-edge: island, phase 5 */ Effect.runPromise(p);\n`, 1],
  "unknown-reason": [`${head}// effect-edge: because I said so\nEffect.runPromise(p);\n`, 1],
  "edge-in-wrong-file": [`${head}// effect-edge: process-main\nEffect.runPromise(p);\n`, 1],
  "no-reason": [`${head}// effect-edge:\nEffect.runPromise(p);\n`, 1],
};
const allowed: Record<string, string> = {
  "island-same-line": `${head}Effect.runPromise(p); // effect-edge: island, phase 5\n`,
  "island-line-above": `${head}// effect-edge: island, phase 5\nEffect.runPromise(p);\n`,
  "island-after-operator": `${head}export const x = true\n  ? // effect-edge: island, phase 5\n    Effect.runPromise(p)\n  : 0;\n`,
  "alias-island": `import { Effect as E } from "effect";\ndeclare const p: any;\n// effect-edge: island, phase 5\nE.runPromise(p);\n`,
  "edge-in-its-file": `${head}// effect-edge: process-main\nEffect.runPromise(p);\n`,
  clean: `${head}export const x = Effect.gen(function* () {\n  yield* p;\n  return 1;\n});\n`,
};

let dir: string;
let byFile: Map<string, number>;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "effect-edge-probe-"));
  mkdirSync(join(dir, "f"));
  for (const [name, [source]] of Object.entries(flagged))
    writeFileSync(join(dir, "f", `${name}.ts`), source);
  for (const [name, source] of Object.entries(allowed))
    writeFileSync(join(dir, "f", `${name}.ts`), source);
  // `edge-in-its-file` is the one fixture the process-main edge is legal in.
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      jsPlugins: [plugin],
      rules: {
        "pe/effect-edge": ["error", { edgeFiles: { "process-main": ["f/edge-in-its-file.ts"] } }],
      },
    }),
  );
  let out = "";
  try {
    out = execFileSync(
      process.execPath,
      [oxlint, "-c", "config.json", "-A", "all", "-D", "pe/effect-edge", "-f", "json", "f"],
      {
        cwd: dir,
        encoding: "utf8",
      },
    );
  } catch (error) {
    out = (error as { stdout: string }).stdout; // exit 1 when diagnostics exist
  }
  if (!out.startsWith("{")) throw new Error(out);
  byFile = new Map();
  for (const d of JSON.parse(out).diagnostics as { code: string; filename: string }[])
    if (d.code === "pe(effect-edge)") {
      const name = d.filename.replace(/^f[\/]/, "").replace(/\.ts$/, "");
      byFile.set(name, (byFile.get(name) ?? 0) + 1);
    }
}, 60_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("pe/effect-edge closes every way around the marker", () => {
  for (const [name, [, diagnostics]] of Object.entries(flagged))
    it(`flags ${name}`, () => {
      expect(byFile.get(name) ?? 0).toBeGreaterThanOrEqual(1);
      expect(byFile.get(name)).toBe(diagnostics);
    });
  for (const name of Object.keys(allowed))
    it(`passes ${name}`, () => expect(byFile.get(name) ?? 0).toBe(0));
});
