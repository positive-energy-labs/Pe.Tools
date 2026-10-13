import { captureDirectory } from "../../../apps/host/src/packages.ts";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { publishPeaSkills, resolvePeaSkillPaths } from "../src/pea/skills.ts";

test("one admitted user revision and support bytes reach both harnesses", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-skill-cut-"));
  try {
    await mkdir(join(home, "Skills", "office"), { recursive: true });
    const content = "---\nname: office\ndescription: Office rules.\n---\n\nExact bytes.\r\n";
    await writeFile(join(home, "Skills", "office", "SKILL.md"), content);
    await writeFile(join(home, "Skills", "office", "support.txt"), "support\r\n");
    const snapshot = await publishPeaSkills({ productHomePath: home, captureDirectory });
    const skill = snapshot.skills.find((s) => s.key === "skill:@skills/skills/office")!;
    expect(skill.content).toBe(content);
    for (const root of resolvePeaSkillPaths({ productHomePath: home })) {
      expect(await readFile(join(root, "office", "SKILL.md"), "utf8")).toBe(content);
      expect(await readFile(join(root, "office", "support.txt"), "utf8")).toBe("support\r\n");
    }
    await writeFile(join(home, "Skills", "office", "SKILL.md"), "later revision");
    expect(skill.content).toBe(content);
    expect(snapshot.skills.some((s) => s.key === "skill:@product/skills/make-page")).toBe(true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("conflicting personal harness copies refuse publication without overwriting either", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-skill-conflict-"));
  try {
    const roots = resolvePeaSkillPaths({ productHomePath: home });
    for (const [i, root] of roots.entries()) {
      await mkdir(join(root, "office"), { recursive: true });
      await writeFile(join(root, "office", "SKILL.md"), `copy ${i}`);
    }
    await expect(publishPeaSkills({ productHomePath: home, captureDirectory })).rejects.toThrow(
      /conflict/i,
    );
    expect(await readFile(join(roots[0]!, "office", "SKILL.md"), "utf8")).toBe("copy 0");
    expect(await readFile(join(roots[1]!, "office", "SKILL.md"), "utf8")).toBe("copy 1");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a corrupt projection receipt cannot turn skill retirement into a path escape", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-skill-receipt-"));
  try {
    const root = resolvePeaSkillPaths({ productHomePath: home })[0]!;
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, ".pe-projection.json"),
      JSON.stringify({ "../../outside": "a".repeat(64) }),
    );
    await writeFile(join(home, "outside"), "keep");
    await expect(publishPeaSkills({ productHomePath: home, captureDirectory })).rejects.toThrow();
    expect(await readFile(join(home, "outside"), "utf8")).toBe("keep");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
