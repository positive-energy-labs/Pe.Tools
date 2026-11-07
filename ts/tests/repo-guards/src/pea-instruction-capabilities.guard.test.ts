import { expect, test } from "vite-plus/test";
import { buildCapabilities } from "../../../packages/mcps/src/pea/capabilities.ts";
import { builtinPeaSkillSnapshots } from "../../../packages/mcps/src/pea/skill-publication.ts";
import { peaAgentInstructions } from "../../../packages/mcps/src/pea/instructions.ts";

test("every concrete capability key in Pea instructions resolves in the catalog", () => {
  const catalog = new Set(buildCapabilities({ ops: [], routes: [], packages: [],
    skills: builtinPeaSkillSnapshots() }).map((row) => row.key));
  // Parameterized keys describe protocol shapes, not catalog rows.
  const named = [...peaAgentInstructions.matchAll(/\b(?:route|op|skill|script|page|member):(?:@[a-zA-Z0-9_/-]+|[a-zA-Z][a-zA-Z0-9_.-]*)/g)]
    .map(([key]) => key.replace(/\.$/, ""));
  expect([...new Set(named)].filter((key) => !catalog.has(key))).toEqual([]);
});
