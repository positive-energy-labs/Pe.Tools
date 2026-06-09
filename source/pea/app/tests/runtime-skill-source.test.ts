import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Workspace } from "@mastra/core/workspace";
import { createRuntimeSkillSource } from "../runtime-skill-source.js";

const bundledSkillRoot = ".pea/bundled-skills";

describe("runtime skill source", () => {
  it("composes in-memory bundled skills with user disk skills", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pea-runtime-skill-source-"));
    const userSkillDirectory = join(cwd, ".pea", "skills", "user-skill");
    await mkdir(userSkillDirectory, { recursive: true });
    await writeFile(
      join(userSkillDirectory, "SKILL.md"),
      "---\nname: user-skill\ndescription: User disk skill.\n---\n\n# User Skill\n",
      "utf-8",
    );

    const workspace = new Workspace({
      skills: [bundledSkillRoot, ".pea/skills"],
      skillSource: createRuntimeSkillSource({
        cwd,
        memoryMounts: [
          {
            root: bundledSkillRoot,
            skills: [
              {
                name: "bundled-skill",
                content:
                  "---\nname: bundled-skill\ndescription: Bundled memory skill.\n---\n\n# Bundled Skill\n",
              },
            ],
          },
        ],
      }),
    });

    const skills = await workspace.skills!.list();
    assert.deepEqual(skills.map((skill) => skill.name).sort(), ["bundled-skill", "user-skill"]);

    const bundledSkill = await workspace.skills!.get("bundled-skill");
    assert.equal(bundledSkill?.path, `${bundledSkillRoot}/bundled-skill`);
    assert.match(bundledSkill?.instructions ?? "", /Bundled Skill/);
  });
});
