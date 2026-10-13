import { captureDirectory } from "../../../apps/host/src/packages.ts";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

test("an unreceipted older copy of a shipped skill is backed up and replaced, never refused", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-skill-shipped-"));
  try {
    const roots = resolvePeaSkillPaths({ productHomePath: home });
    for (const [i, root] of roots.entries()) {
      await mkdir(join(root, "build-pod"), { recursive: true });
      await writeFile(join(root, "build-pod", "SKILL.md"), `older projection ${i}`);
    }
    await mkdir(join(roots[0]!, "mine"), { recursive: true });
    await writeFile(join(roots[0]!, "mine", "SKILL.md"), "user skill");
    const publication = await publishPeaSkills({ productHomePath: home, captureDirectory });
    const shipped = publication.skills.find((s) => s.key === "skill:@product/skills/build-pod")!;
    for (const root of roots)
      expect(await readFile(join(root, "build-pod", "SKILL.md"), "utf8")).toBe(shipped.content);
    expect(publication.skills.some((s) => s.key === "skill:@skills/skills/build-pod")).toBe(false);
    expect(await readFile(join(roots[0]!, "mine", "SKILL.md"), "utf8")).toBe("user skill");
    expect(publication.notices).toHaveLength(1);
    const backups = await readdir(join(home, ".backups", "skills"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^build-pod-\d{8}T\d{6}Z$/);
    expect(publication.notices[0]).toContain(backups[0]!);
    const kept = join(home, ".backups", "skills", backups[0]!);
    const copies = await Promise.all(
      (await readdir(kept)).map((d) => readFile(join(kept, d, "SKILL.md"), "utf8")),
    );
    expect(copies.sort()).toEqual(["older projection 0", "older projection 1"]);
    // Idempotent: the receipt now owns the path, so a second publication backs nothing up.
    expect((await publishPeaSkills({ productHomePath: home, captureDirectory })).notices).toEqual(
      [],
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
