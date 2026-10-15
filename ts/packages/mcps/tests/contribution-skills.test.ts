import { captureDirectory } from "../../../apps/host/src/packages.ts";
import { existsSync } from "node:fs";
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

test("an unreceipted same-named skill stays byte-exact; the product does not publish over it and says how to resolve it", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-skill-shipped-"));
  try {
    const roots = resolvePeaSkillPaths({ productHomePath: home });
    for (const [i, root] of roots.entries()) {
      await mkdir(join(root, "build-pod"), { recursive: true });
      await writeFile(join(root, "build-pod", "SKILL.md"), `older projection ${i}`);
      await writeFile(join(root, "build-pod", "notes.txt"), `mine ${i}`);
    }
    await mkdir(join(roots[0]!, "mine"), { recursive: true });
    await writeFile(join(roots[0]!, "mine", "SKILL.md"), "user skill");
    const publication = await publishPeaSkills({ productHomePath: home, captureDirectory });
    for (const [i, root] of roots.entries()) {
      expect(await readFile(join(root, "build-pod", "SKILL.md"), "utf8")).toBe(
        `older projection ${i}`,
      );
      expect(await readFile(join(root, "build-pod", "notes.txt"), "utf8")).toBe(`mine ${i}`);
      expect(
        JSON.parse(await readFile(join(root, ".pe-projection.json"), "utf8")),
      ).not.toHaveProperty("build-pod");
    }
    expect(publication.skills.some((s) => s.key === "skill:@skills/skills/build-pod")).toBe(false);
    expect(await readFile(join(roots[0]!, "mine", "SKILL.md"), "utf8")).toBe("user skill");
    expect(publication.notices).toEqual(
      roots.map((root) => expect.stringContaining(join(root, "build-pod"))),
    );
    for (const notice of publication.notices) expect(notice).toContain("rename or delete");
    expect(existsSync(join(home, ".backups"))).toBe(false);
    // The diagnostic holds until the user resolves it; then the product publishes.
    expect(
      (await publishPeaSkills({ productHomePath: home, captureDirectory })).notices,
    ).toHaveLength(2);
    for (const root of roots) await rm(join(root, "build-pod"), { recursive: true });
    const resolved = await publishPeaSkills({ productHomePath: home, captureDirectory });
    expect(resolved.notices).toEqual([]);
    const shipped = resolved.skills.find((s) => s.key === "skill:@product/skills/build-pod")!;
    for (const root of roots)
      expect(await readFile(join(root, "build-pod", "SKILL.md"), "utf8")).toBe(shipped.content);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
