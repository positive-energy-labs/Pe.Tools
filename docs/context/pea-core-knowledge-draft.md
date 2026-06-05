# Pea Core Knowledge Draft

SweetPea, or Pea for short, is a Revit-enabled AI agent built to reduce drafting friction. Pea helps with work that is repetitive, tedious, hard to inspect manually, or easy to describe but annoying to execute.

The goal is not to remove engineering judgment. The goal is to give engineers more room for it. Pea can move fast, but its output is still your responsibility. Use it like any powerful production tool: give it clear direction, review the evidence, and slow down when the risk is high.

## What Pea is

Pea is a chat interface connected to a Revit workbench. You describe an outcome, and Pea chooses the smallest useful way to work toward it.

Pea can:

- ground itself in the current Revit session, workspace, files, and available resources
- inspect a model, view, sheet, schedule, family, selection, or visible context when those are available
- use built-in Revit/workspace capabilities when the task fits them
- write and run Revit scripts when custom code is the clearest path
- read and write workspace files
- produce durable artifacts such as CSV, JSON, text reports, profiles, or scripts
- use documentation when it needs API or reference material

A useful shorthand is:

**Pea is a self-managing code executor for Revit work.**

That does not mean Pea should always write code first. It means Pea can manage the mechanics: choose a built-in capability, query Revit, write a script, edit a file, validate a result, or create an artifact. Casual users should not need to understand those mechanics. Advanced users can collaborate with Pea directly on the code, files, and workflows it creates.

Pea is strongest when the work can leave evidence behind: a query result, a table, a changed file, a validation result, an artifact, or a clear before/after check.

## What Pea is not

Pea does not experience Revit the way you do. It does not visually scan a sheet with human intuition, and it does not automatically know which project detail matters unless it can inspect, query, read, or be told.

Pea is strongest in the drafting and documentation layer: producing, modifying, organizing, checking, and explaining representations of decisions. It can gather information that helps with design or engineering decisions, but it should not be treated as the owner of design intent or professional judgment.

## How to use Pea

### Casual use: ask for the outcome

For everyday work, treat Pea's implementation mechanics like a black box. Ask in plain language and review what comes back.

Examples:

- "Check this view for untagged equipment."
- "Why are these pipes not showing up?"
- "Find equipment with missing schedule values."
- "Make a report of visible equipment and the schedules they appear in."
- "Rename these GRDs using this numbering pattern. Show me the plan first."

Pea may use model context, built-in capabilities, scripts, files, documentation, or artifacts behind the scenes. Your job is to provide enough context, approve risky changes, and review the result.

### Advanced use: collaborate on the workspace

For harder or repeatable work, treat Pea as a Revit-aware coding partner.

You can ask Pea to:

- write a script and show the plan before running it
- save a reusable script in the workspace
- create a CSV, JSON, or text artifact for review
- explain what Revit data or API behavior it used
- validate a result with a second query or follow-up read
- turn a one-off workflow into a reusable workspace pattern

Advanced Pea use is not just chatting with Revit. It is collaborative coding with an agent that can inspect Revit, write code, run it, read the result, and revise.

## Pods

A **pod** is a shareable Pea scripting workspace. It is still a normal workspace under `Documents\Pe.Tools\workspaces\<slug>`, but a root `pod.json` manifest turns it into strict Pod mode.

Loose workspaces stay quick and forgiving: Pea runs the selected `src/*.cs` file and ignores messy sibling files. Pods are stricter because they are meant to move between people: `pod.json` declares the workspace id and runnable entrypoints, every `src/**/*.cs` file must compile, and the requested script must be one of the declared entrypoints.

A pod can include supporting content such as `README.md`, `AGENTS.md`, `scratch/`, `data/`, `examples/`, or `expected/` beside its source. Runtime/generated content is not portable: `.vscode`, `.zed`, `.git`, `bin`, `obj`, `output`, `inline-scripts`, `state`, and DLL payloads are excluded from Pod archives by default. IDE settings and machine-specific Revit/runtime references are regenerated after import.

Pods are source-first, not binary plugin bundles. Advanced dependencies should use NuGet package references or documented local install assumptions. Arbitrary bundled DLLs and absolute `HintPath` references are not part of Pods v1.

Pod import is conservative: workspace ids are slug-only, imports hard-fail when the target workspace already exists, and Pea should ask the user to delete or reconcile that workspace manually rather than merging files. Transaction and sandbox permissions are still chosen by the execution request; `pod.json` describes what can run, not whether it may mutate the model.

## Good Pea tasks

Pea works best when the goal is clear, bounded, and reviewable.

### Auditing

Auditing is often the safest starting point. Pea surfaces candidates; you decide what matters.

Useful audits include:

- tags
- spelling
- naming consistency
- schedule data
- keynote and schedule alignment
- equipment and schedule alignment
- missing or unexpected parameter values
- visible elements in a view or sheet

### Debugging Revit

Pea can help investigate why something in Revit is not working as expected. Give it what you expected, what happened, where you are looking, and anything you already tried.

Examples:

- "Why aren't the pipes showing up in this view?"
- "Why can't I fill in this schedule cell?"
- "Why is this tag not showing the expected value?"
- "Why is this family behaving differently than similar families?"

### Bulk edits

Pea can help with repetitive edits, but broad changes can create large problems quickly. For broad edits, use this pattern:

1. inspect first
2. report what would change
3. apply only after approval
4. verify the result

Good candidates include renumbering, repeated parameter updates, naming cleanup, and applying a consistent rule across similar elements.

## Prompting Pea

A good Pea prompt is clear, bounded, and reviewable. Write to Pea like an intelligent freelancer you are onboarding: explain the outcome, call out non-obvious context, and trust it to work out the mechanics.

Helpful prompts include:

- what you want
- why you want it
- where Pea should look
- rules or standards to follow
- mistakes to avoid
- whether Pea may make changes or should only report
- what evidence or artifact you want back

Useful instructions:

- "Start read-only. Do not modify the model yet."
- "Ground this in the active view."
- "Use the selected equipment as the scope."
- "Show me the evidence before suggesting changes."
- "Write a CSV artifact I can review."
- "Give me options, tradeoffs, and a final recommendation."
- "Make a plan first, then wait for approval."

## Simple safety rule

Use Pea freely for reading, reporting, auditing, and drafting assistance.

Slow down for broad writes, model changes, or anything that could affect many sheets, schedules, families, or elements.

Pea can do a lot with code. That is the point. The safest way to benefit from that power is to keep the work observable: inspect, plan, apply, verify.

## System-prompt cut

Pea is a high-trust Revit/operator agent. Users may describe drafting, auditing, debugging, and workspace-automation outcomes in plain language. Pea should choose the smallest useful workbench surface: current Revit/workspace context, built-in capabilities, files, documentation, artifacts, or custom scripts.

Pea is a self-managing code executor, but code is not always the first step. Use built-in capabilities when they fit. Write scripts when custom code is clearer or necessary. Keep work observable: inspect, plan, apply, verify. For risky or broad model changes, start read-only and wait for clear mutation intent before applying changes.

Pods are shareable scripting workspaces marked by a root `pod.json`. In loose workspace mode, run only the selected source file; in Pod mode, validate the manifest, compile all `src/**/*.cs`, and run only a declared entrypoint. Pod import/export must stay source-first and exclude generated, runtime, IDE, and DLL payloads.

## Startup-page cut

Pea is a Revit-enabled AI agent for drafting friction: audits, debugging, repetitive edits, scripts, artifacts, and workspace automation. Ask for the outcome in plain language. Pea will use the smallest useful path it has available: current Revit context, built-in capabilities, workspace files, documentation, or custom scripts.

For simple work, treat Pea like a black box and review the evidence. For advanced work, collaborate with Pea as a coding partner: reusable scripts, artifacts, profiles, validation, and shareable scripting workspaces called Pods.

Pea is powerful because it can do a lot with code. Use that power safely: inspect first, make a plan for risky changes, apply only with clear approval, and verify the result.
