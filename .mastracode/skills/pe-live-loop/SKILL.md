---
name: pe-live-loop
description: Coordinate fragile Pe.Tools live Revit, Rider, RRD, hot reload, active document, Windows feedback loops, and black-box Pea product tests that depend on active model state. Use when the user mentions Revit session state, Rider build, hot reload, RRD restart, AttachedRrd, runtime freshness, active/open document setup, modal UI, installed lane, auth/login, visual confirmation, works in build but not Revit, product test Pea, ask Pea, black-box Pea, don't seed Pea, check Pea's work, BIM manager questions, or whether Pea/host ops can discover project patterns from the active model.
metadata:
  goal: true
---

# pe-live-loop

Use when progress depends on human-maintained live state: Rider/IDE builds, RRD restart or document setup, modal Revit behavior, installed-product lane switches, auth/login, visual confirmation, or black-box Pea product behavior against the active model.

## Dispatch

- If the user asks to product-test Pea against live project questions, preserve the distinction between Pea's unseeded operator behavior and Peco's independent verification of model facts.
- If runtime freshness is unknown and attached proof matters, collect a read-only live loop context before mutating anything.
- If runtime code changed and sync is recommended, call live_rrd_sync explicitly and report whether it proved action invocation only or loaded-runtime freshness.
- If live_rrd_sync/live loop context recommends live_rrd_restart, use the restart primitive and wait for Host/Revit bridge readiness before attached proof.
- If the needed action is genuinely user-owned, ask for exactly one manual action and give the expected result.
- If autonomous proof is enough, prefer FreshRevitProcess and avoid RRD.
- If the live lane is trustworthy and the remaining problem is a bug, route back to pe-diagnose.

## Context Resolution

1. Identify the changed package, proof lane, RRD health, active document/model, product lane, and last proof.
2. Read docs/ENVIRONMENT.md and nearest AGENTS.md when command policy or RRD cautions matter.
3. Use live loop context for the read-only live-runtime decision packet.
4. Use Pea product tools such as pe_status or pe_logs only when you specifically need a product-facing primitive.
5. Treat log deltas as correlation evidence, not health proof by themselves.
6. Tend to feeback loop blockers by managing process, opening documents, etc. Prioritize using host's primitives and diagnostics

## Loop

1. Name the verification lane: source compile, package/artifact, AttachedRrd, FreshRevitProcess, installed lane, or Pea black-box product test.
2. Refresh live loop facts with live loop context when host/Revit/Rider evidence matters.
3. When runtime code changed and live loop context recommends sync, call live_rrd_sync explicitly. Prefer the direct Pe.RiderBridge lane.
4. When live loop context or sync diagnostics recommend restart, use live_rrd_restart and wait for Host/Revit bridge readiness before attached proof.
5. State current loop state and uncertainty: changed package, build freshness, sync verdict/action status, RRD health, active document/model, product lane, and last proof.
6. Split responsibilities:
   - agent-owned: inspect source, edit code, run safe terminal checks, plan commands, prepare scripts/probes, interpret output, maintain environment/log context
   - user-owned only when needed: Rider/IDE build, RRD restart, open/select Revit documents, resolve modal UI, install MSI, switch product lane, complete auth/login, confirm visual result
7. Ask for exactly one manual action when human maintenance is the blocker.
8. Provide a compact handoff packet with expected result and next branch.
9. Resume from pasted output or user confirmation; do not restart diagnosis from scratch.
10. Stop claiming proof at the strongest verified boundary only.

## Pea Black-Box Product Tests

Use this posture when the task is to evaluate whether Pea can answer realistic project questions from the active model without being seeded with firm standards, hidden parameter names, browser paths, sheet numbers, or repo/tooling context.

Treat Pea's response, tool choices, errors, and silence as product evidence. Treat Peco host operations or scripts as independent verification, not as a substitute for Pea's answer. Report the gap between what Pea discovered unaided and what the model evidence supports.

## Handoff Packet

Use this shape when pausing for user action:

```text
Current hypothesis:
Required user action:
Exact command/action:
Expected result:
If it fails:
Next agent step after output:
```

## Guardrails

- Keep live loop context read-only: it can recommend sync, restart, log review, or FreshRevitProcess, but it must not mutate the signal file, invoke Rider, run tests, or restart anything.
- Do not keep retrying live probes when RRD freshness is unknown, stale, unproven, or sync failed. A successful Pe.RiderBridge action sequence is not by itself proof that Revit loaded the changed behavior.
- Do not use terminal interactive builds unless the user explicitly accepts the RRD/HR baseline risk.
- Do not claim AttachedRrd proof from isolated builds, package artifacts, docs, stale logs, or a sync result with sourceDeltaVerdict=unproven even when the loaded graph is fresh.
- Prefer FreshRevitProcess proof when autonomous verification is enough; promote it for Hot Reload ambiguity, member-shape changes, WPF/BAML/resource changes, restart-required messages, or suspected Rider baseline loss.
- Keep manual requests small, observable, and reversible whenever possible.

## Durability Checkpoint

Before finishing, decide whether the loop revealed durable proof-lane knowledge.

Capture before further source implementation when the session resolved a repeated RRD/Rider/Hot Reload failure mode, a new proof-lane rule, a user-owned session boundary, or a reusable live-validation handoff pattern.

If no doc update is needed, say: No durable capture needed: <reason>.
