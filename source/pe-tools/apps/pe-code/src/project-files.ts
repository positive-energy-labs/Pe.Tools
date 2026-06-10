import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { instructions } from "./instructions.ts";
import { devAgentWorkflowSkills } from "./skills.ts";

type ManagedFileStatus = "created" | "updated" | "unchanged";

export interface DevAgentProjectFilesSummary {
  configRoot: string;
  instructionsPath: string;
  instructionsInstalled: boolean;
  instructionsSource: "project-root";
  instructionsStatus: ManagedFileStatus;
  skillsRoot: string;
  skills: Array<{
    name: string;
    path: string;
    status: ManagedFileStatus;
  }>;
  commandsRoot: string;
  commandsInstalled: false;
  hooksPath: string;
  hooksInstalled: false;
  hooksDeferredReason: string;
}

// TODO: this is a really bad way to do this. We should be using a context injector instead
const managedInstructionsStart = "<!-- peco managed instructions:start -->";
const managedInstructionsEnd = "<!-- peco managed instructions:end -->";

export async function ensureDevAgentProjectFiles(
  projectPath: string,
): Promise<DevAgentProjectFilesSummary> {
  const mastraCodeRoot = join(projectPath, ".mastracode");
  await mkdir(mastraCodeRoot, { recursive: true });

  const instructionsPath = join(projectPath, "AGENTS.md");
  const instructionsStatus = await ensureManagedInstructions(instructionsPath);

  const skillsRoot = join(mastraCodeRoot, "skills");

  return {
    configRoot: mastraCodeRoot,
    instructionsPath,
    instructionsInstalled: true,
    instructionsSource: "project-root",
    instructionsStatus,
    skillsRoot,
    skills: devAgentWorkflowSkills.map((skill) => ({
      name: skill.name,
      path: `<in-memory>/${skill.name}/SKILL.md`,
      status: "unchanged",
    })),
    commandsRoot: join(mastraCodeRoot, "commands"),
    commandsInstalled: false,
    hooksPath: join(mastraCodeRoot, "hooks.json"),
    hooksInstalled: false,
    hooksDeferredReason:
      "No peco hooks are installed by default. Workflow sequencing belongs in skills and repo verification tools; hooks are reserved for future narrow unsafe-action guardrails.",
  };
}

async function ensureManagedInstructions(instructionsPath: string): Promise<ManagedFileStatus> {
  const existing = await readExisting(instructionsPath);
  const managedBlock = [
    managedInstructionsStart,
    instructions.trimEnd(),
    managedInstructionsEnd,
    "",
  ].join("\n");

  const next =
    existing == null || existing.trim().length === 0
      ? managedBlock
      : replaceManagedBlock(existing, managedBlock);

  return ensureFileContent(instructionsPath, next, existing);
}

async function ensureFileContent(
  path: string,
  content: string,
  knownExisting?: string | null,
): Promise<ManagedFileStatus> {
  const existing = knownExisting ?? (await readExisting(path));
  if (existing === content) return "unchanged";

  await writeFile(path, content, "utf-8");
  return existing == null ? "created" : "updated";
}

async function readExisting(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function replaceManagedBlock(existing: string, managedBlock: string): string {
  const startIndex = existing.indexOf(managedInstructionsStart);
  const endIndex = existing.indexOf(managedInstructionsEnd);
  if (startIndex >= 0 && endIndex > startIndex) {
    const afterEndIndex = endIndex + managedInstructionsEnd.length;
    return `${existing.slice(0, startIndex).trimEnd()}\n\n${managedBlock}${existing.slice(afterEndIndex).trimStart()}`;
  }

  return `${existing.trimEnd()}\n\n${managedBlock}`;
}
