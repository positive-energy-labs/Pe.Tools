import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import path from "node:path";
import { productIdentity } from "@pe/host-contracts/contracts";

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
  {
    name: "place-mep-ducts",
    content: String.raw`---
name: place-mep-ducts
description: Lay out ductwork in Revit - rough in a supply, return, or exhaust trunk on a level, branch to air terminals, draft a collision-free layout the user can refine, then commit real ducts and fittings. Use for lay out ductwork, run a duct, rough in supply on a level, route duct to these terminals, duct clash check.
metadata:
  goal: true
---

# Lay Out MEP Ducts: DECLARE -> SOLVE -> DRAFT -> DIFF -> COMMIT

You do not hand-draw ducts. You DECLARE intent as JSON; the Pe.Revit.Placement library routes collision-aware paths on a lattice and DRAFTS native placeholder ducts (visible; the user can drag them); you read the report and a plan image, refine the intent, re-SOLVE and read the DIFF; when it is clean you COMMIT real connected ducts and fittings. Use these five words with the user and repeat them when reporting.

Pe.Revit.Placement is an explicit-reference library already available in the scripting environment. Drive it from short scripts via script_execute - one tiny script per step. Solve, Commit, and Cleanup need permissionMode WriteTransaction; Scout, MapProbe, and ExportPlan are read-only. Every method returns its full report as text: WriteLine it and read it.

    using Pe.Revit.Placement;
    var place = new DuctPlacer(doc, "L3");   // level name or id; plan and 3D views auto-resolve
    WriteLine(place.Scout());                 // recon: terminal ids, connector z, existing duct band, level convention

## Clarify before declaring (ask, do not guess)

1. Level, system (Supply Air / Return Air / Exhaust Air), and zone: which rooms, from where to where.
2. Trunk size (default 12x8 in) and elevation above the level (default 9 ft centerline). Scout prints the level's existing duct band - match it or dodge it deliberately, and say which.
3. Terminals to serve, and connect vs near: in finished models terminals are already fed, so drops end about 1.8 in short (near-connect). That is the expected, correct outcome, not a failure.
4. Keep-outs (shafts, pads, future equipment) become constraints.keepOut boxes.

Hand back when the user wants specific fitting families, sloped or insulated duct, sizing calcs, or edits to EXISTING ducts. This ability only places new PEA-TK-PLACE-tagged geometry. Stop and ask when the same intent fails twice - show the refusal diagnosis verbatim.

## The loop

1. Scout once per level. Endpoints and terminal ids come from Scout, NEVER from an image.
2. DECLARE the intent JSON (schema below) - a first pass is fine - then MapProbe it before solving. Write the intent to a file you can re-read and edit across steps. MapProbe prints an ASCII free-space map of the trunk band derived from your endpoints and terminals: confirm from and to sit in connected open lanes, and move them if not. Plan images lie about routability (view ranges, invisible doors, sealed rooms); the map does not.

    using Pe.Revit.Placement;
    string intent = File.ReadAllText(@"C:\Path\To\intent.json");
    WriteLine(new DuctPlacer(doc, "L3").MapProbe(intent));

3. SOLVE - pass the same intent string in. Solve routes, drafts placeholders, and prints the report plus a DIFF vs the last solve. A failed solve rolls back and the previous draft survives.

    WriteLine(new DuctPlacer(doc, "L3").Solve(intent));

4. Review: ExportPlan, then read_image the PNG. The draft must look like what you promised. An empty-looking plan is usually a view-range artifact - trust the report counts, do not re-solve blindly.

    WriteLine(new DuctPlacer(doc, "L3").ExportPlan(outDir));

5. COMMIT when the report says clear. Commit converts the placeholders that are IN THE MODEL (user hand-drags honored) into real ducts, elbows, takeoffs, and terminal connects, then rechecks collisions.

    WriteLine(new DuctPlacer(doc, "L3").Commit());

6. Cleanup deletes every PEA-TK-PLACE element to abandon or reset: new DuctPlacer(doc, "L3").Cleanup();

Bias to a thin first commit: get ONE collision-free draft and commit it rather than perfecting elevations and clearances first. Refine after the user sees something real. A clean rough-in beats a perfect un-committed plan, and it fits the time you have in one turn.

## The intent (model feet; sizes inches; unknown fields warn; bad values name valid options)

    {
      "name": "L3-west-supply",
      "system": "Supply Air",
      "trunk": {
        "ductType": "Rectangular Duct: Mitered Elbows / Taps",
        "size": "12x8",
        "elevationFt": 9.0,
        "from": [-98, 1.5],
        "to": [-40, 1.5]
      },
      "branches": {
        "ductType": "Round Duct: Taps",
        "sizeIn": 8,
        "stubFt": 1.5,
        "terminals": [1441161, 1442230],
        "connect": true
      },
      "constraints": {
        "avoid": ["mep", "walls", "structure", "equipment", "terminals"],
        "clearanceIn": 2,
        "maxBends": 8,
        "gridFt": 0.5,
        "keepOut": [ { "name": "future shaft", "min": [-70, 0], "max": [-66, 4] } ]
      }
    }

trunk.elevationFt is CENTERLINE feet above the level; match Scout's duct-band line. trunk.from/to are [x,y] model feet or an element handle. terminal ids come from Scout.

## Reading the report (route grammar)

- HIT with an obstacle z-span is a hard collision, named blocker with id and box. Each HIT carries a computed fix line - elevationFt values you can paste, or an avoid or keepOut edit. Values are approximate (bbox math): re-solve to confirm, do not argue with them.
- PASS is a wall penetration while walls is deliberately out of avoid - a human decision; flag it.
- NEAR is clear but within 12 in (TIGHT if under clearanceIn). Watch, do not chase.
- CLEAR, or a VERDICT of clear to commit, means proceed.
- The scan ALWAYS checks every obstacle group PLUS linked models (structure, architecture), regardless of avoid; avoid only steers the router. The report never lies by omission - trust it over your own guess about clearance, and never claim no collisions from a host-only check.
- TRUNK REFUSED names the binding constraint and the blockers. Fix cheapest-first: trunk.elevationFt (z is the lever - most collisions are elevation problems, and a HIT repeating along the run means change z, never jog), then add the named group to avoid or a keepOut, then move endpoints to lanes MapProbe shows free, then maxBends, and only last clearanceIn.
- DIFF lines (z 41.17 to 40.17, collisions 1 to 0, len +1.8 ft) are the steering feedback - quote them when asking the user for a decision.

## Verbs escape hatch

For interactive nudging or diagnosing a single leg, use the fluent session (StartAt, Toward, RiseTo, BranchTo, then Preview or Commit) from new DuctPlacer(doc, level).Verbs(). Same probe voice, same marker, same draft medium. Prefer intent JSON for anything past a couple of legs - routine refinement is data edits.

## Hard rules

- Only elements with Comments = PEA-TK-PLACE are yours. Never modify or delete anything else.
- Solve, Commit, and Cleanup run WriteTransaction; Scout, MapProbe, and ExportPlan are read-only.
- Export and read_image a plan after every draft and every commit; look before reporting success.
- On a Revit-busy error: wait, retry a few times, never stack concurrent runs.
`,
  },
];

export const peaStandardSkillsRoot = path.join(".agents", "skills");
export const peaProductHomeEnvVar = "PE_TOOLS_PRODUCT_HOME";
const peaDocumentsRootEnvVar = "PE_TOOLS_DOCUMENTS_ROOT";
let cachedDocumentsPath: string | null = null;

export interface PeaProductHomeOptions {
  productHomePath?: string;
}

export function resolvePeaProductHomePath(options: PeaProductHomeOptions = {}): string {
  return path.resolve(
    readEnvPath(options.productHomePath) ??
      readEnvPath(process.env[peaProductHomeEnvVar]) ??
      path.join(resolveUserDocumentsPath(), productIdentity.productName),
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

function resolveUserDocumentsPath(): string {
  const override = readEnvPath(process.env[peaDocumentsRootEnvVar]);
  if (override) return override;
  if (cachedDocumentsPath) return cachedDocumentsPath;

  cachedDocumentsPath = readPlatformDocumentsPath();
  return cachedDocumentsPath;
}

function readPlatformDocumentsPath(): string {
  if (platform() === "win32") {
    const knownFolder = readWindowsDocumentsKnownFolder();
    if (knownFolder) return knownFolder;
  }

  return process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, "Documents")
    : path.join(homedir(), "Documents");
}

function readWindowsDocumentsKnownFolder(): string | null {
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "[Environment]::GetFolderPath('MyDocuments')",
      ],
      { encoding: "utf8", timeout: 1_000, windowsHide: true },
    ).trim();
    return output || null;
  } catch {
    return null;
  }
}

function readEnvPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
