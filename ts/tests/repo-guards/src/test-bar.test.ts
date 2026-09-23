/**
 * THE TEST BAR (ruling 2026-09-22, crusade C8). A test is canon only if it drives a surface a user
 * or agent touches, or pins a public contract. Its lane is its path:
 *
 *   SURFACE   apps/host/tests/**            the host speaks HTTP
 *             apps/web/src/routes/-*.test.tsx  a rendered route
 *   CONTRACT  a web or host test that parses through @pe/agent-contracts or @pe/host-contracts
 *   SCAFFOLD  any other web test, and any test in a lane that fakes its world: `vi.mock(`,
 *             `vi.spyOn(`, `vi.fn(`, `toHaveBeenCalled`, `renderHook(`, or an `as never` cast.
 *             An empty Effect context cast and a spy on `console.log` (a CLI's output) are plumbing.
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
/** Plumbing, not a forged world: an empty Effect context, and a CLI's printed output. */
const PLUMBING = /Context\.empty\(\) as never|vi\.spyOn\(console, "log"\)/g;
const SURFACE_LANE = /^apps\/host\/tests\/|^apps\/web\/src\/routes\/-[^/]+\.test\.tsx$/;
const CONTRACT =
  /from "@pe\/(agent|host)-contracts[^"]*"[\s\S]*\.parse\(|\.parse\([\s\S]*from "@pe\/(agent|host)-contracts/;

// ponytail: a ceiling, not an allowlist. Held for the web sweep (three contract-pinning web tests
// outside the routes lane included); sweep, then delete this constant and assert zero.
const SCAFFOLD_CEILING = 16;

type Kind = "SURFACE" | "CONTRACT" | "SCAFFOLD";

function classify(rel: string, text: string): Kind {
  if (FAKE.test(text.replace(PLUMBING, ""))) return "SCAFFOLD";
  if (CONTRACT.test(text)) return "CONTRACT";
  if (SURFACE_LANE.test(rel)) return "SURFACE";
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
