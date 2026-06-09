import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { devAgentInstructions } from "./dev-agent-instructions.js";
import { devAgentWorkflowSkills } from "./dev-agent-skill-content/dev-agent-workflow-skills.js";
import { ensureFileContent, readExisting, type ManagedFileStatus } from "./runtime-skill-files.js";

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

const managedInstructionsStart = "<!-- dev-agent managed instructions:start -->";
const managedInstructionsEnd = "<!-- dev-agent managed instructions:end -->";

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
      "No dev-agent hooks are installed by default. Workflow sequencing belongs in skills and repo verification tools; hooks are reserved for future narrow unsafe-action guardrails.",
  };
}

async function ensureManagedInstructions(instructionsPath: string): Promise<ManagedFileStatus> {
  const existing = await readExisting(instructionsPath);
  const managedBlock = [
    managedInstructionsStart,
    devAgentInstructions.trimEnd(),
    managedInstructionsEnd,
    "",
  ].join("\n");

  const next =
    existing == null || existing.trim().length === 0
      ? managedBlock
      : replaceManagedBlock(existing, managedBlock);

  return ensureFileContent(instructionsPath, next, existing);
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
