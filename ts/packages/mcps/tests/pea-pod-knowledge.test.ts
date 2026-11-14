import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { peaAgentInstructions } from "../src/pea/instructions.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";

const example = join(import.meta.dirname, "../../../../examples/pods/snowdon-ducts");
const skill = (name: string) => bundledPeaSkills.find((s) => s.name === name)!.content;

// What Pea knows about Pods and Pages is one account (pods map, slice 9).
// Red break: put `pe.describe()` back into make-page step 3, define pod.json in a second skill,
// or hand pe.state an `agent: {}` argument in make-page step 4.
test("build-pod is the one home of what a Pod is, and no text teaches a retired Page door", async () => {
  const defining = bundledPeaSkills.filter((s) => s.content.includes("pod.json holds"));
  expect(defining.map((s) => s.name)).toEqual(["build-pod"]);
  for (const name of ["make-page", "write-revit-csharp-script"])
    expect(skill(name), name).toContain("build-pod");
  expect(peaAgentInstructions).toContain("skill:@product/skills/build-pod");
  // The file prohibition is about scratch Pages; a Pod's Page is a file.
  expect(peaAgentInstructions).toContain("never locate, read, or patch a scratch Page's files");
  expect(skill("build-pod")).toContain("pages/<page>/index.html");

  const taught = new Map<string, string>([
    ["instructions", peaAgentInstructions],
    ...bundledPeaSkills.map((s) => [s.name, s.content] as const),
  ]);
  for (const file of ["pages/tour/index.html", "skills/duct-loss/SKILL.md", "AGENTS.md"])
    taught.set(file, await readFile(join(example, file), "utf8"));
  // pe.kernel and pe.describe folded into pe.state (C2); a raw GET of /state and `.state/` in a Pod are gone.
  // The events an agent may append are declared in the Page's HTML, where the host can read them.
  for (const where of ["make-page", "build-pod", "pages/tour/index.html"])
    expect(taught.get(where), where).toContain('id="pe-agent"');
  for (const [where, text] of taught)
    expect(/\bagent\s*[:=]\s*\{/.test(text), `${where} hands pe.state an agent argument`).toBe(
      false,
    );
  for (const [where, text] of taught)
    for (const retired of ["pe.kernel", "pe.describe", "GET /pages/", ".state/"])
      expect(text.includes(retired), `${where} still teaches ${retired}`).toBe(false);
});

// An installed Pea has no checkout, so a door the skills do not name is a door it cannot learn (D39:
// a cold Pea read host source for pe.reading and for whether one Page reads another's log).
// Red break: add a `await pe.<door>(` line to the pe.js header that neither skill names.
test("the Page skills name every door in the pe.js header", async () => {
  const pe = await readFile(
    join(import.meta.dirname, "../../../apps/host/src/pages/pe.js"),
    "utf8",
  );
  const header = pe.slice(0, pe.indexOf("*/"));
  const doors = [...new Set([...header.matchAll(/\bpe\.([a-z]+)\(/g)].map((m) => m[1]))];
  expect(doors).toContain("reading");
  const taught = skill("make-page") + skill("build-pod");
  for (const door of doors) expect(taught, `pe.${door}`).toContain(`pe.${door}`);
  expect(skill("make-page")).toContain("no pe.js door reads another Page's log");
});
