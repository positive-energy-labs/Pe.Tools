---
name: pe-diagnose
description: Diagnose broken Pe.Tools behavior through reproduction, hypotheses, logs, source inspection, fixes, and regression proof. Use when the user reports a bug, regression, confusing error, failing script, failing test, failing build behavior, source-vs-product mismatch, why is this happening, fix this failure, works in source but not product, or stale runtime suspicion.
metadata:
  goal: true
---

# pe-diagnose

Use for bugs, regressions, confusing failures, stale runtime behavior, failing scripts/tests, or mismatches between source and product behavior.

## Dispatch

- If proof depends on Rider, RRD, hot reload, active documents, modal Revit UI, installed lane, auth/login, or visual confirmation, route through pe-live-loop first.
- If the user has an error or failing command, reproduce or inspect the exact output before changing code.
- If source and product disagree, separate compile/package proof from live runtime proof before trusting either side.
- If the failure is actually a boundary or seam problem, use pe-architecture after the failure is understood.
- If the failure reveals a reusable proof rule or repeated failure mode, capture it before broad implementation.

## Context Resolution

1. Identify the failing user-visible behavior and the closest trustworthy proof lane.
2. Read the relevant package AGENTS.md, feature \_DEV.md/\_GOALS.md, and docs/ENVIRONMENT.md when commands or proof lanes matter.
3. Inspect logs only after status/sync/script/test output points at host or Revit.
4. Prefer generated host operations and public seams before raw scripts.
5. Use source inspection to test hypotheses, not to browse indefinitely.

## Loop

1. Establish the fastest trustworthy feedback loop before changing code.
2. Reproduce the failure or identify the closest available proof.
3. Separate compile/package proof from live Revit proof:
   - isolated build/package: NoRrdContact compile/artifact proof
   - sync + AttachedRrd: live Rider-driven session refresh through the direct Pe.RiderBridge lane when available; treat unproven bridge results as action-invocation proof only until an attached operation/log verifies behavior
   - FreshRevitProcess: autonomous Revit-backed proof that must not touch RRD, preferred when current UI/session state is not required
4. Form one or two concrete hypotheses from evidence.
5. Inspect source and logs narrowly; instrument only when needed.
6. Fix the root cause, not the symptom.
7. Re-run the same proof, then run a regression-oriented check.
8. If no good test seam exists, say so and identify the missing seam rather than pretending the proof is stronger than it is.

## Pe.Tools Subflows

### Live runtime divergence

Use diagnosis for the root-cause loop once the live verification lane is trustworthy. If proof depends on Rider/IDE build freshness, RRD restart, document setup, modal Revit UI, installed-lane switches, auth/login, or visual confirmation, activate pe-live-loop first and coordinate the human-maintained session boundary before diagnosing deeper.

After live-loop coordination establishes a trustworthy lane, probe with the smallest script, host operation, or focused test that observes the changed behavior. Peco sync should use the non-focus Pe.RiderBridge lane; if sync reports runtime freshness stale or unproven, or behavior still diverges after a nominal bridge invocation, return to pe-live-loop instead of treating stale live state as source evidence.

### AttachedRrd freshness verdict

Use the post-sync runtime freshness verdict as the evidence boundary:

- fresh: loaded Pe/Toon assemblies match their current disk DLLs by MVID/version and no runtime source delta is unproven; proceed with attached probes when the live session matters.
- stale: loaded assemblies differ from disk; do not trust attached behavior until sync/restart resolves it.
- unproven: Host/Revit evidence was insufficient, direct Pe.RiderBridge only proved Rider action invocation, or loadedGraphVerdict is fresh but sourceDeltaVerdict is unproven; verify through attached behavior/logs, recover/apply/restart the live session, or switch to FreshRevitProcess.

Read loadedGraphVerdict and sourceDeltaVerdict separately. Loaded graph freshness means the currently loaded DLL locations match Revit's loaded assemblies; it does not by itself prove current source edits reached RRD.

Treat possible member-shape edits, WPF/BAML/resource changes, Rider restart-required messages, and baseline/MVID loss as reasons to promote FreshRevitProcess or ask for RRD restart even after a nominally fresh graph.

### Fresh Revit proof

Use when autonomous proof should not touch the live Rider-driven RRD session.

1. Prefer the repo test wrapper or pe-dev test with a focused filter and bounded timeout.
2. Use plan-only mode for command planning/smoke checks; do not launch Revit just to test parsing.
3. Treat timeout or launch failures as environment evidence, not product behavior proof.
4. Confirm the owned fresh Revit process was cleaned up before broadening the run.

### Pea black-box product behavior

Use when a source change affects what Pea or an operator would experience.

1. Act through Pea product tools as an operator would: pe_status, host_operation_search/call, script_bootstrap/script_execute, revit_api_search/fetch, and pe_logs.
2. Prefer public host operations before raw scripts; use scripts for API gaps, focused probes, or bounded document mutation.
3. Record observed product behavior, errors, missing affordances, and artifacts.
4. Feed those observations back into normal source changes.
5. Do not ask Pea to inspect or reason about repo source.

### Revit harness stress test

Use when evaluating whether Pea and the typed host surface can answer realistic BIM manager, designer, PM, or architect questions without growing the surface unnecessarily.

1. Start from a normal, imperfect user question, not a tool-shaped prompt. Prefer wording like a project user would actually type: fuzzy names, incomplete context, and practical intent are useful signal.
2. Pick two to five hard questions that force joins users mentally expect: active view, model elements, families/types, parameters, schedules, sheets, rooms/spaces, project browser organization, and issue/printed context.
3. Use talk_to_pea with frame=operator or frame=collaborate first, then continue the same thread with frame=feedback when harness/product friction matters.
4. Establish basic readiness before interpreting failures: fresh host/session/document state when current facts matter, generated operation discovery before scripts, one minimal successful read when possible, and bounded logs only when host/Revit failures suggest them.
5. For each question, record whether current typed operations answered it, how much orchestration/guessing/scripting was needed, what reusable projection or data join would make it easier, and whether that improvement is worth its context and optionality cost.
6. Classify failures as missing capability, weak join, bad model data, unclear user wording, or harness instability.
7. Prefer fewer strong questions over an exhaustive checklist; do not seed project-specific names, browser paths, sheet numbers, parameter names, or repo/tooling knowledge into the user question unless the user supplied them.

## Durability Checkpoint

Before finishing, decide whether the diagnosis revealed durable reusable knowledge.

Capture before broad implementation when the session resolved a repeated failure mode, proof-lane rule, missing test seam, misleading error pattern, source-vs-product mismatch rule, or useful diagnostic workflow.

If no doc update is needed, say: No durable capture needed: <reason>.
