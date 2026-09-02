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
    name: "survey-revit-model",
    content: String.raw`---
name: survey-revit-model
description: Survey what is open before touching it. Use when the user asks what is in the model, what is open, selected, loaded, visible, or scheduled, asks for an audit or a report, or pastes a Revit problem without an instruction. Reads only; it ends by naming the next move.
---

# Survey Revit Model

Writes are off. The product is a map of what is actually there, in the user's words, with the difference between what they believe and what the model says stated first.

## Method

1. Restate the question in your own words and name the scope: document, view, level, category, or selection.
2. Confirm freshness first: which document is active and whether the session is current.
3. Pace it once wide with the smallest orientation surface (context, catalog, or matrix operations), then zoom into the two or three places that decide the answer.
4. Every line of the report carries its stake: the operation or script that produced it and the document or view it came from. A plausible count is not a stake.
5. Broad inventories go to an artifact; the reply carries the findings and the exceptions.

## Report

Scope, evidence used, findings, what was not inspected, artifacts, and the next move: a change to draft, a diagnosis to run, or a decision the user owns.
`,
  },
  {
    name: "diagnose-revit-behavior",
    content: String.raw`---
name: diagnose-revit-behavior
description: Find the cause of strange Revit behavior before proposing a fix. Use when something is hidden, missing in one view but present in another, different between views, wrong in a linked model, controlled by a template, failing, or slow. Ends with a cause and its evidence; the fix is the user's call.
---

# Diagnose Revit Behavior

The model does not lie and cannot be treated. The only product is the cause, from live state, with the evidence that proves it. A fix before the cause is a guess wearing a change.

## Method

1. Build the smallest reproduction: one element, one view, one question the model can answer now.
2. List the candidate causes and, for each, the inspection that would kill it. Kill the cheap ones first.
3. Inspect live state before generic Revit advice. Distinguish observed facts from hypotheses in every sentence.
4. A hang or timeout is a boundary, not a failure: name what it was waiting on.

## Visibility causes to test, cheapest first

View type and template controls, discipline, detail level and display style, phase and phase filter, design options, worksets, category visibility, view filters and overrides, element hide and isolate, temporary modes, crop, scope box, and section box, plan view range, plan regions and underlay, link visibility, display mode, linked view, and load state, imports and point clouds, graphics settings. View collectors report candidate drawn elements, not pixels on screen; use a view capture when the pixels matter.

## Report

Cause, the evidence that proves it, what would turn it green, and what was not inspected. The user decides the fix.
`,
  },
  {
    name: "settle-intent",
    content: String.raw`---
name: settle-intent
description: Interview the user until a change or a Pod is settled enough to act on. Use before any mutation, layout, migration, or Pod build whose targets, standards, or trade-offs the user has not stated, or when the user asks to align, decide, or be pushed back on. Not for facts you can inspect.
---

# Settle Intent

Decisions are the user's; facts are yours. Do not ask a question an inspection could answer, and do not make an engineering choice you could hand to them.

## Method

- Answer their question first if they asked one.
- Look up the facts in the same round, then ask the whole frontier at once: every open question whose prerequisites are settled, numbered, each with your recommendation, so the user can answer "1. B, 2. yes".
- Stress the boundary: before it settles, test one scenario that forces it against the current model or project standards, and surface every contradiction.
- Read back each verdict as you understood it before acting on it.
- Stop when nothing is left silently assumed and the user confirms. Then name the next move.

Format each question as the title, the question with its choices, and your recommendation on the next line.
`,
  },
  {
    name: "prove-revit-change",
    content: String.raw`---
name: prove-revit-change
description: Verify a change on the real model before calling it done. Use after any mutation, script, or Pod run, before reporting "done", and whenever the user asks whether something really worked or to be skeptical. Ends with a stamped verdict, never with "should work".
---

# Prove Revit Change

Plausibility is not proof. A successful call proves that the call completed; the model is proven by reading it back.

## Method

1. Write the falsifier first: the read, count, capture, or schedule row that would show the change did not land.
2. Read it back from the live document, fresh, after the change. A stale snapshot or the request payload is not a readback.
3. Name the lane: a document readback, a rendered view capture, a schedule value, or a file on disk prove different things. Visual proof is its own lane.
4. Stamp the verdict: PROVEN with what was read and when, FALSIFIED with what broke, or UNPROVEN with why. Fewer than that is void.
5. Rank by consequence: one wrong element outranks twenty cosmetic misses.

## Report

Outcome, evidence, skipped or failed items, and what remains unproven.
`,
  },
  {
    name: "teach-revit-mechanism",
    content: String.raw`---
name: teach-revit-mechanism
description: Teach a Revit or Revit API mechanism the user wants to own. Use when the user asks to learn, understand, or be taught something, or asks the same question a second time. Not for a one-off answer.
---

# Teach Revit Mechanism

The user asked to learn, not to be told. The master corrects the hand and never touches the work.

- Ask one question first if the use is not obvious: what will you do with this? Teach toward that use, in plain words, at their altitude.
- Hand over one short artifact they keep: the load-bearing fifth, a dense example beside its explanation, the rest linked.
- Cite primary sources: Revit API docs, observed model behavior, or a script they can rerun. Never teach from lore.
- Explain by physical shape: document versus view, type versus instance, family versus project, what persists where.
- Check transfer, not recall: they apply it to their own model before it is done.
`,
  },
  {
    name: "write-revit-csharp-script",
    content: String.raw`---
name: write-revit-csharp-script
description: Write and run a C# Revit script when code is the clearest way to inspect, mutate, or experiment against the model. Use for one-off probes, gaps in host operations, and durable multi-step work. Covers inline snippets, workspace files, and Pod rules.
---

# Write Revit C# Script

## Method

- Choose a script when no host operation is the smallest capable surface. Bootstrap the workspace when paths or references are unknown.
- Inline snippets for tiny probes; workspace files for durable or multi-step work.
- Default to ReadOnly. Use WriteTransaction only for an explicit, user-authorized mutation. Use NoTransaction only for APIs that reject an open transaction.
- Treat compiler and runtime diagnostics as steering; fix the first one before rerunning.
- Keep terminal output compact; write artifacts for broad evidence. Return structured results for anything a later step reads.

## Pod rules

A Pod is a shareable scripting workspace: a project file for build and language support, src/ for C# scripts, optional supporting files, and a root pod.json that turns it into strict Pod mode. Loose workspaces run only the selected file. Pods validate the manifest, compile every src/**/*.cs, and run only declared entrypoints. Import and export are source-first and exclude generated, runtime, IDE, machine-specific, and DLL payloads.

## Report

Script path or inline name, permission mode, diagnostics, key output, artifacts, and the verification readback.
`,
  },
  {
    name: "build-pod",
    content: String.raw`---
name: build-pod
description: Turn a repeated workflow or an add-in idea into a shareable Pod. Use when the user says "make this a Pod", "I want a button that", "every week I have to", "share this with my team", or when the same script has run twice. Shape first, then make it real, then delete what did not earn its place.
---

# Build Pod

The user supplies intent and ideas; you handle the code. Nothing that does not connect to the workflow, nothing longer than it must be.

## Loop

1. Name the nouns from the user's workflow, not from the API: what they start with, what they want at the end, what they decide along the way. Settle the intent before anything compounds.
2. Lay out two or three shapes side by side, from the simplest script to the fuller add-in, and say what each makes impossible. The user picks; one shape on the table is always one you would argue against.
3. Bootstrap the workspace, then make the chain real end to end on the real model: one entrypoint, one readback, before any polish. Stubs and placeholders are scaffolding; count them and strike them one per round.
4. Drive the whole workflow by hand with the user on real parts. That is the bar for done, and it gets a proof readback.
5. Purge: delete anything the working Pod does not need. Keep the why in a short README the user can hand to a colleague.

## Report

What the Pod does in the user's words, how to run it, what it will not do, and what remains scaffolding.
`,
  },
  {
    name: "author-pe-settings",
    content: String.raw`---
name: author-pe-settings
description: Author, validate, or debug a Pe settings document such as a Family Foundry profile. Use when the user edits profiles or settings, a run produced diagnostics or artifacts to explain, or validation fails.
---

# Author Pe Settings

Settings and profiles are authored documents with a schema and a validator. Diagnostics drive the repair; the validator is the contract.

## Method

- Use host-reported workspace paths and the available schemas. Edit the files directly.
- Start from produced artifacts and diagnostics before changing a profile. Keep authored intent, generated output, and runtime proof distinct.
- Repair the first diagnostic, revalidate, repeat. Use a focused script only when artifacts do not explain the failure.
- Keep generated proof artifacts separate from source profiles.

## Report

Files changed, validation result, diagnostics fixed or remaining, artifacts inspected, and any follow-up the user owns.
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
3. Terminals to serve, and connect vs near: in finished models terminals are already fed, so drops end about 1.8 in short (near-connect). That is the expected, correct outcome, not a failure. The bound is 6 INCHES: any path end more than 6 in from the connector it serves is unfinished routing, not a stub - never call it done, and never round a missing vertical leg down to a stub.
4. Where the air comes from or goes to: if an endpoint is equipment (fan, AHU), its connector has its own z - Scout prints it. A trunk at elevationFt does not descend to equipment by itself. Either run the trunk band at the equipment connector's z, or close the vertical with the Verbs session (StartAt at the equipment XY, RiseTo the trunk z, Toward the run). Check the reported endpoint z against your trunk z BEFORE calling anything connected.
5. Keep-outs (shafts, pads, future equipment) become constraints.keepOut boxes.

Hand back when the user wants specific fitting families, sloped or insulated duct, sizing calcs, or edits to EXISTING ducts. This ability only places new PEA-TK-PLACE-tagged geometry. Stop and ask when the same intent fails twice - show the refusal diagnosis verbatim.

## The loop - THREE scripts, not ten

Tool calls are your scarcest resource: each one costs a full round trip, and a placement that spreads intent-probe-solve-commit across separate calls will run out of turn before it commits. The library is in-process, so everything after recon fits in ONE script.

1. SCOUT once per level (read-only). Endpoints and terminal ids come from Scout, NEVER from an image. Do not export or read images during recon.

    using Pe.Revit.Placement;
    WriteLine(new DuctPlacer(doc, "L3").Scout());

2. PLACE - one WriteTransaction script that declares the intent inline, probes, solves, and auto-commits when clean. This template is the whole step; fill in the intent and go:

    using Pe.Revit.Placement;
    string intent = """
    { "name": "run1", "system": "Exhaust Air",
      "trunk": { "size": "10x6", "elevationFt": 9.0, "from": [384.5, 660.9], "to": [340.0, 665.0] },
      "branches": { "sizeIn": 6, "terminals": [6085577, 6612609], "connect": true } }
    """;
    var place = new DuctPlacer(doc, "L3");
    WriteLine(place.MapProbe(intent));
    WriteLine(place.SolveAndCommitIfClean(intent));
    // Clean draft -> committed + kept + plan exported, one call. Dirty or refused -> the report
    // names the blocker and the draft stays; edit ONE intent lever and re-run this script.

3. ITERATE or VERIFY. Refused or dirty: edit ONE lever in the intent (elevation first) and re-run script 2 as-is. Committed: read_image the exported plan once to confirm, then report. That is the whole loop.

A failed solve rolls back and the previous draft survives. Commit converts the placeholders that are IN THE MODEL (user hand-drags honored) into real ducts, elbows, takeoffs, and terminal connects, then rechecks collisions. Keep() retags the committed increment PEA-TK-DONE so the next Solve does not delete it. Cleanup deletes every PEA-TK-PLACE element (kept ones stay): new DuctPlacer(doc, "L3").Cleanup();

Bias to a thin first commit: get ONE collision-free draft committed rather than perfecting elevations and clearances first. Refine after the user sees something real. A clean rough-in beats a perfect un-committed plan, and it fits the time you have in one turn.

Commit is a checkpoint, not a finale. On multi-part work (trunk plus branches, several rooms, a vertical leg to equipment) commit each part as soon as its report is clean, call Keep() to lock it in, then Solve the next part - Solve DELETES everything still tagged PEA-TK-PLACE, so an increment you committed but did not Keep() is wiped by the next solve. Kept elements survive interrupted sessions and become ordinary obstacles for later solves; re-solve-to-replace only works on the increment you have NOT kept yet. If you are running out of time, commit and Keep what is clean and report exactly what remains, with the ids you would start from.

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
- ENDPOINT GAP means the trunk does not physically reach an element you declared as from or to - the run is unfinished no matter how clean the collision lines read. Apply its fix line (elevationFt or a Verbs riser) before calling anything connected; gap OK (stub range) is the done state.
- TRUNK REFUSED names the binding constraint and the blockers. Fix cheapest-first: trunk.elevationFt (z is the lever - most collisions are elevation problems, and a HIT repeating along the run means change z, never jog), then add the named group to avoid or a keepOut, then move endpoints to lanes MapProbe shows free, then maxBends, and only last clearanceIn.
- DIFF lines (z 41.17 to 40.17, collisions 1 to 0, len +1.8 ft) are the steering feedback - quote them when asking the user for a decision.

## Verbs escape hatch

For interactive nudging or diagnosing a single leg, use the fluent session (StartAt, Toward, RiseTo, BranchTo, then Preview or Commit) from new DuctPlacer(doc, level).Verbs(). Same probe voice, same marker, same draft medium. Prefer intent JSON for anything past a couple of legs - routine refinement is data edits.

## Hard rules

- Only elements with Comments = PEA-TK-PLACE are yours. Never modify or delete anything else.
- Solve, Commit, and Cleanup run WriteTransaction; Scout, MapProbe, and ExportPlan are read-only.
- read_image the exported plan ONCE after a commit to confirm before reporting success. Never read images during recon or between solve iterations - the report and MapProbe are the truth; images are the final visual check.
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
