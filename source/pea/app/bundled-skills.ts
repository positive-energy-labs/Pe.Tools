import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bundledPeaSkills } from "./bundled-skill-content/pea-workflow-skills.js";

export async function ensureBundledPeaSkills(projectPath: string): Promise<void> {
  const skillsRoot = join(projectPath, ".pea", "skills");
  await mkdir(skillsRoot, { recursive: true });

  for (const skill of bundledPeaSkills) {
    const skillDirectory = join(skillsRoot, skill.name);
    const skillPath = join(skillDirectory, "SKILL.md");
    const content = `${skill.content.trimEnd()}\n`;
    await mkdir(skillDirectory, { recursive: true });
    if (await readExisting(skillPath) === content)
      continue;

    await writeFile(skillPath, content, "utf-8");
  }
}

async function readExisting(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}
