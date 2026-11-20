import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { peaAgentInstructions } from "../../../../packages/mcps/src/pea/instructions.ts";
import { bundledPeaSkills } from "../../../../packages/mcps/src/pea/skills.ts";

const example = join(import.meta.dirname, "../../../../../examples/pods/snowdon-ducts");
const skill = (name: string) => bundledPeaSkills.find((s) => s.name === name)!.content;

test("Page authoring teaches the path rule", () => {
  for (const name of ["make-page", "build-pod"])
    expect(skill(name)).toContain(
      "Bare paths and leading / resolve from the Pod root; ./ and ../ resolve beside the Page's index.html.",
    );
});

test("Page authoring distinguishes browser proof from static checks", () => {
  expect(skill("make-page")).toContain(
    "A Page no browser has rendered is reported as untested, with what was and was not checked.",
  );
});

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
  const pe = await readFile(join(import.meta.dirname, "../../src/pages/pe.js"), "utf8");
  const header = pe.slice(0, pe.indexOf("*/"));
  const doors = [...new Set([...header.matchAll(/\bpe\.([a-z]+)\(/g)].map((m) => m[1]))];
  expect(doors).toContain("reading");
  const taught = skill("make-page") + skill("build-pod");
  for (const door of doors) expect(taught, `pe.${door}`).toContain(`pe.${door}`);
  expect(skill("make-page")).toContain("no pe.js door reads another Page's log");
});

// Documentation is bundled without a host-source dependency. Compare its words with the owning
// comments here instead of adding a runtime loader or a second document for installed Pea.
test("Page skills carry the source contract, not just door names", async () => {
  const pe = await readFile(join(import.meta.dirname, "../../src/pages/pe.js"), "utf8");
  const plain = (text: string) => text.replace(/`/g, "").replace(/\s+/g, " ").trim();
  const taught = plain(skill("make-page") + skill("build-pod"));
  // Mutants: an exported pe.untaught = async () => {}, or a changed script option/default.
  for (const [, door] of pe.matchAll(/pe\.(\w+) = (?:async )?\(/g)) {
    if (["kernel", "describe"].includes(door!)) continue; // explicit retired refusals
    expect(taught, `exported pe.${door}`).toContain(`pe.${door}`);
  }
  const scriptSignature = pe.match(/pe\.script = async (\(keyOrPath, .*?\)) =>/)![1]!;
  expect(taught).toContain(`pe.script${scriptSignature}`);
  const stateOptions = pe.match(/const (\{ reduce, base, render .*? \}) = options/)![1]!;
  expect(taught).toContain(stateOptions);
  // Mutants: change the documented target shape, refusal, or script result contract.
  for (const marker of ["The document this page's binding names, as the host", "Run C# in Revit"]) {
    const start = pe.indexOf(marker);
    expect(start, marker).toBeGreaterThanOrEqual(0);
    const comment = plain(pe.slice(start, pe.indexOf("*/", start)).replace(/^\s*\* ?/gm, ""));
    if (marker.startsWith("Run C#")) {
      expect(taught).toContain(comment.slice(comment.indexOf("input is one JSON object")));
    } else expect(taught).toContain(comment);
  }
  const shape = pe.match(/The bound document `(.*?)`, after `pe.target\(\)`/)![1]!;
  expect(plain(skill("make-page"))).toContain(
    `pe.doc: The bound document ${shape}, after pe.target().`,
  );
});
