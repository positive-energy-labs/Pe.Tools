import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

// A Pod bundles only what it imports; the evaluator drags effect in through the agent-contracts
// barrel, so the Pod's read door has its own effect-free module (the subject-ref door's rule).
test("the Pod read door imports only zod and effect-free subpaths", () => {
  const source = readFileSync(new URL("../src/reads/door.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^(import|export)( type)? .* from "([^"]+)";$/gm)].map((m) => `${m[2] ? "type " : ""}${m[3]}`);
  expect(imports).toEqual([
    "zod",
    "@pe/agent-contracts/target",
    "@pe/agent-contracts/route-state",
    "@pe/agent-contracts/native-output-read",
    "@pe/host-contracts/catalog",
    "@pe/host-contracts/native-schemas",
    "type @pe/host-contracts/generated",
    "type @pe/host-contracts/operation-types",
    "type ./evaluator.ts",
    "type ./evaluator.ts",
  ]);
  expect(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).exports["./read-graph"]).toBe("./src/reads/door.ts");
});
