import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface BundledPeaSkill {
  name: string;
  content: string;
}

export const bundledPeaSkills: readonly BundledPeaSkill[] = [
  {
    name: "audit-visible-revit-equipment",
    content: String.raw`---
name: audit-visible-revit-equipment
description: Orient an equipment visibility/schedule/electrical review without prescribing a fixed endpoint chain. Use when the user asks about equipment visible in a Revit view, sheet, or current context.
metadata:
  goal: true
---

# Audit Visible Revit Equipment

Use this as orientation, not a recipe.

## Posture

- Establish the scope and freshness requirements.
- Let generated host-operation metadata identify useful context, catalog, matrix, detail, or scripting surfaces.
- Prefer exact provenance over confident inference.
- Use artifacts for broad rows or evidence.
- Name uncertainty, API gaps, or missing model references directly.

## Useful Resources

- pe_status for current host/Revit readiness.
- host_operation_search and host_operation_call for public capabilities.
- script_bootstrap and script_execute when code is the clearer path.
- pe_logs after host/Revit failures.

## Output

Report the scope, evidence used, findings, uncertainty, artifacts, and remaining blockers.
`,
  },
  {
    name: "write-revit-csharp-script",
    content: String.raw`---
name: write-revit-csharp-script
description: Author and run a C# Revit script through the Pe scripting workspace. Use when code is the clearest way to inspect, author, mutate, or experiment against Revit.
metadata:
  goal: true
---

# Write Revit C# Script

Use this as orientation for scripting work.

## Posture

- Choose script execution when code is clearer than an existing public host operation.
- Bootstrap the workspace when paths or references are unknown.
- Use inline snippets for tiny probes and workspace files for durable or multi-step work.
- Default to ReadOnly; use WriteTransaction only for explicit mutations.
- Treat compiler/runtime diagnostics as steering feedback.
- Keep terminal output compact and write artifacts for broad evidence.

## Output

Report the script path or inline name, permission mode, diagnostics, key output, artifacts, and verification result.
`,
  },
  {
    name: "inspect-active-revit-document",
    content: String.raw`---
name: inspect-active-revit-document
description: Inspect the connected Revit document using status, generated host operations, scripts, and artifacts as appropriate.
metadata:
  goal: true
---

# Inspect Active Revit Document

Use this as orientation when the user asks what is open, selected, loaded, visible, scheduled, or present in the active model.

## Posture

- Confirm current host/Revit state when freshness matters.
- Use generated operation metadata to choose the smallest useful public capability.
- Script only when code is the clearer way to answer or verify the question.
- Preserve document/view/selection provenance in the answer.
- Write artifacts for broad inventories.

## Output

Report observed scope, operations or scripts used, findings, artifacts, and any uncertainty.
`,
  },
  {
    name: "author-family-foundry-profile",
    content: String.raw`---
name: author-family-foundry-profile
description: Author or revise a Family Foundry profile/settings document using files, schemas, validators, and diagnostics.
metadata:
  goal: true
---

# Author Family Foundry Profile

Use this as orientation for profile authoring.

## Posture

- Treat profiles as authored settings documents.
- Edit files directly in the workspace.
- Use available schemas and validators as the contract.
- Let diagnostics drive repair.
- Keep generated proof artifacts separate from source profiles.

## Output

Report changed files, validation result, diagnostics fixed or remaining, and any generated artifacts.
`,
  },
  {
    name: "debug-family-foundry-artifacts",
    content: String.raw`---
name: debug-family-foundry-artifacts
description: Debug a Family Foundry run from produced artifacts, diagnostics, and profile inputs.
metadata:
  goal: true
---

# Debug Family Foundry Artifacts

Use this as orientation for artifact-first debugging.

## Posture

- Start from produced artifacts and diagnostics before changing profiles or scripts.
- Preserve the distinction between authored intent, generated output, and runtime proof.
- Use focused repros or scripts only when artifacts do not explain the issue.
- Keep conclusions tied to evidence.

## Output

Report artifacts inspected, suspected cause, evidence, changes made if any, and verification result.
`,
  },
  {
    name: "validate-pe-settings-workspace",
    content: String.raw`---
name: validate-pe-settings-workspace
description: Validate Pe settings workspace documents and repair diagnostics.
metadata:
  goal: true
---

# Validate Pe Settings Workspace

Use this as orientation for settings/profile validation.

## Posture

- Use host-reported workspace paths and available schemas.
- Edit settings files directly.
- Use validators as the source of truth.
- Repair diagnostics and revalidate.
- Keep ordinary file work ordinary; use host operations for schema and validation capabilities.

## Output

Report files checked, validation status, diagnostics fixed or remaining, and any follow-up needed.
`,
  },
];

export const peaStandardSkillsRoot = path.join(".agents", "skills");
export const peaProductHomeEnvVar = "PE_TOOLS_PRODUCT_HOME";

export interface PeaProductHomeOptions {
  productHomePath?: string;
}

export function resolvePeaProductHomePath(options: PeaProductHomeOptions = {}): string {
  return path.resolve(
    options.productHomePath ??
      process.env[peaProductHomeEnvVar] ??
      path.join(homedir(), "Documents", "Pe.Tools"),
  );
}

export function resolvePeaStandardSkillsRoot(options: PeaProductHomeOptions = {}): string {
  return path.join(resolvePeaProductHomePath(options), peaStandardSkillsRoot);
}

export function resolvePeaSkillPaths(options: PeaProductHomeOptions = {}): string[] {
  return [resolvePeaStandardSkillsRoot(options)];
}

export const peaSkillPaths = resolvePeaSkillPaths();

export interface MaterializedPeaSkill {
  name: string;
  path: string;
  status: "created" | "updated" | "unchanged";
}

export async function materializeBundledPeaSkills(
  options: PeaProductHomeOptions = {},
): Promise<MaterializedPeaSkill[]> {
  const skillsRoot = resolvePeaStandardSkillsRoot(options);
  await mkdir(skillsRoot, { recursive: true });

  const materialized: MaterializedPeaSkill[] = [];
  for (const skill of bundledPeaSkills) {
    const skillPath = path.join(skillsRoot, skill.name, "SKILL.md");
    await mkdir(path.dirname(skillPath), { recursive: true });
    const content = `${skill.content.trimEnd()}\n`;
    const existing = await readExisting(skillPath);
    const status = existing == null ? "created" : existing === content ? "unchanged" : "updated";
    if (status !== "unchanged") {
      await writeFile(skillPath, content, "utf-8");
    }
    materialized.push({ name: skill.name, path: skillPath, status });
  }

  return materialized;
}

async function readExisting(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}
