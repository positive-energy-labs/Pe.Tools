/**
 * THE TEST BAR (ruling 2026-09-22, crusade C8). A test is canon only if it drives a surface a user
 * or agent touches, or pins a public contract. Every web and host test file lands in one class,
 * first match wins:
 *
 *   SCAFFOLD  it fakes its own world: `vi.mock(`, `vi.spyOn(`, `vi.fn(`, `toHaveBeenCalled`,
 *             `renderHook(` (private route-state), or an `as never` cast that forges a handle.
 *             An empty Effect context cast and a spy on `console.log` (a CLI's output) are plumbing.
 *   SURFACE   it drives a surface: a host test that speaks HTTP (`fetch(`, `.request(`, `listen(`,
 *             `handler(new Request(`),
 *             or a web test that renders a route module (`#/routes/`).
 *   CONTRACT  it parses through `@pe/agent-contracts` or `@pe/host-contracts` (`.parse(`).
 *   SCAFFOLD  anything else: a unit with no surface and no public contract.
 *
 * The census prints every file's class. SCAFFOLD is held at the recorded ceiling until the sweep
 * brings it to zero; a new SCAFFOLD file fails, a removed one lowers the ceiling.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const TS = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ROOTS = ["apps/web/src", "apps/host/tests"];
const FAKE = /vi\.(mock|spyOn|fn)\(|toHaveBeenCalled|renderHook\(|as never\b/;
const HTTP = /fetch\(|\.request\(|listen\(|handler\(new Request\(/;
/** Plumbing, not a forged world: an empty Effect context, and a CLI's printed output. */
const PLUMBING = /Context\.empty\(\) as never|vi\.spyOn\(console, "log"\)/g;
const ROUTE = /from "#\/routes\//;
const CONTRACT =
  /from "@pe\/(agent|host)-contracts[^"]*"[\s\S]*\.parse\(|\.parse\([\s\S]*from "@pe\/(agent|host)-contracts/;

// ponytail: a ceiling, not an allowlist. The 15 are held for the measured, work, actions, and
// options crusades; sweep each after its merge, then delete this constant and assert zero.
const SCAFFOLD_CEILING = 15;

type Kind = "SURFACE" | "CONTRACT" | "SCAFFOLD";

function classify(rel: string, text: string): Kind {
  if (FAKE.test(text.replace(PLUMBING, ""))) return "SCAFFOLD";
  if (rel.startsWith("apps/host/") ? HTTP.test(text) : ROUTE.test(text)) return "SURFACE";
  if (CONTRACT.test(text)) return "CONTRACT";
  return "SCAFFOLD";
}

function tests(dir: string): string[] {
  return readdirSync(join(TS, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.test\.tsx?$/.test(f) && !f.includes("node_modules"))
    .map((f) => relative(TS, join(TS, dir, f)).replaceAll("\\", "/"));
}

it("every web and host test is SURFACE or CONTRACT", () => {
  const census = ROOTS.flatMap(tests)
    .sort()
    .map((rel) => ({ rel, kind: classify(rel, readFileSync(join(TS, rel), "utf8")) }));
  const count = (k: Kind) => census.filter((c) => c.kind === k).length;
  console.log(
    `${census.map((c) => `${c.kind.padEnd(8)} ${c.rel}`).join("\n")}\n` +
      `SURFACE ${count("SURFACE")} · CONTRACT ${count("CONTRACT")} · SCAFFOLD ${count("SCAFFOLD")}`,
  );
  expect(count("SCAFFOLD")).toBeLessThanOrEqual(SCAFFOLD_CEILING);
});
