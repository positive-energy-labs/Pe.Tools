export interface DevAgentSkillDefinition {
  name: string;
  content: string;
}

export const devAgentWorkflowSkills: DevAgentSkillDefinition[] = [
  {
    name: "pe-steer",
    content: `---
name: pe-steer
description: Clarify Pe.Tools intent before implementation by grilling scope, vocabulary, product boundaries, and durable capture. Use when the user says grill me, think this through, I don't know, what should this be, I don't like this, or when a request is vague, strategic, overloaded, philosophical, likely to sprawl, or likely to create reusable project truth.
metadata:
  goal: true
---

# pe-steer

Use when the problem is misalignment: unclear outcome, overloaded language, competing scopes, product philosophy, or a conversation that should leave durable intent behind.

pe-steer is the strongest docs-first skill. It should turn vague intent into shared language, an implementation boundary, or a clear stop.

## Dispatch

- If the user says "grill me", interrogate one unresolved branch at a time until the next material decision is clear.
- If the user is vague, state the likely outcome and ask the smallest clarifying question only when the answer changes the work.
- If the user says "I don't like this", review the current work against the stated intent before editing.
- If the request uses overloaded Pe.Tools language, resolve the term against existing docs before inventing new vocabulary.
- If the request implies durable philosophy, boundaries, proof rules, or repeated failure modes, capture that before implementation.
- If the request is already concrete and non-durable, route to the narrow skill or implement directly.

## Context Resolution

Use Pe.Tools docs as the resolver substrate:

1. Nearest AGENTS.md for durable agent behavior, cautions, and shared language.
2. Relevant _GOALS.md for intent, north star, and non-goals.
3. Relevant _DEV.md for conceptual model and architecture shape.
4. docs/features/<feature>/ when a capability spans packages.
5. Generated contracts, schemas, host-operation docs, and source when they are current truth.
6. If truth is missing, treat that as signal and capture it in the nearest proper Pe doc.

Do not introduce CONTEXT.md, CONTEXT-MAP.md, or ADR conventions unless an explicit future design pass replaces the Pe-native taxonomy.

## Loop

1. Name the likely outcome and smallest useful scope.
2. Resolve existing vocabulary and context before coining new terms.
3. Walk the decision tree one branch at a time. Do not ask broad preference questions when code/docs can answer them.
4. State the recommendation with tradeoffs.
5. Ask only big intent questions or questions that materially change scope, architecture, or proof.
6. End with a concrete next action, a routed skill, or a repo-local capture summary.

## Durability Checkpoint

Before implementation, decide whether steering resolved durable reusable knowledge.

Capture when the session resolved:

- shared language or renamed concepts
- product/workflow boundaries
- repeated failure modes
- north-star intent or non-goals
- architecture rules or public-seam guidance
- verification/proof-lane rules

If capture is needed:

- In Build/default mode, update the nearest durable doc first, then implement.
- In Plan/read-only mode, make the doc update the first step of the submitted plan and do not pretend capture happened.

If no doc update is needed, say: No durable capture needed: <reason>.

Prefer concise shared language over long transcripts. Do not create MEMORY.md; recurring memory belongs in AGENTS.md.`,
  },
  {
    name: "pe-diagnose",
    content: `---
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
2. Read the relevant package AGENTS.md, feature _DEV.md/_GOALS.md, and docs/ENVIRONMENT.md when commands or proof lanes matter.
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

After live-loop coordination establishes a trustworthy lane, probe with the smallest script, host operation, or focused test that observes the changed behavior. Dev-agent sync should use the non-focus Pe.RiderBridge lane; if sync reports runtime freshness stale or unproven, or behavior still diverges after a nominal bridge invocation, return to pe-live-loop instead of treating stale live state as source evidence.

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

If no doc update is needed, say: No durable capture needed: <reason>.`,
  },
  {
    name: "pe-live-loop",
    content: `---
name: pe-live-loop
description: Coordinate fragile Pe.Tools live Revit, Rider, RRD, hot reload, active document, Windows feedback loops, and black-box Pea product tests that depend on active model state. Use when the user mentions Revit session state, Rider build, hot reload, RRD restart, AttachedRrd, runtime freshness, active/open document setup, modal UI, installed lane, auth/login, visual confirmation, works in build but not Revit, product test Pea, ask Pea, black-box Pea, don't seed Pea, check Pea's work, BIM manager questions, or whether Pea/host ops can discover project patterns from the active model.
metadata:
  goal: true
---

# pe-live-loop

Use when progress depends on human-maintained live state: Rider/IDE builds, RRD restart or document setup, modal Revit behavior, installed-product lane switches, auth/login, visual confirmation, or black-box Pea product behavior against the active model.

## Dispatch

- If the user asks to product-test Pea against live project questions, preserve the distinction between Pea's unseeded operator behavior and dev-agent's independent verification of model facts.
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

Treat Pea's response, tool choices, errors, and silence as product evidence. Treat dev-agent host operations or scripts as independent verification, not as a substitute for Pea's answer. Report the gap between what Pea discovered unaided and what the model evidence supports.

## Handoff Packet

Use this shape when pausing for user action:

~~~text
Current hypothesis:
Required user action:
Exact command/action:
Expected result:
If it fails:
Next agent step after output:
~~~

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

If no doc update is needed, say: No durable capture needed: <reason>.`,
  },
  {
    name: "pe-tdd",
    content: `---
name: pe-tdd
description: Build Pe.Tools behavior with a red-green-refactor loop through the narrowest meaningful public seam. Use when the user asks for TDD, tests first, red green refactor, add behavior with tests, regression test, test seam, narrow public interface, or when a bug fix needs durable behavior proof.
metadata:
  goal: true
---

# pe-tdd

Use when adding or changing behavior with a useful test seam.

## Dispatch

- If the behavior and seam are clear, write or update the focused failing test first.
- If the seam is unclear, identify the externally visible behavior before editing production code.
- If proof requires live Revit/RRD state, coordinate through pe-live-loop before claiming green.
- If no meaningful test seam exists, say so and identify the missing seam.

## Loop

1. Define the externally visible behavior and the smallest vertical slice.
2. Pick the narrowest meaningful public seam. Prefer dependency-in/result-out interfaces.
3. Write or update a failing behavior test first when practical.
4. Run the focused test and confirm the failure is meaningful.
5. Implement the minimum production change.
6. Run the focused test to green.
7. Refactor only when it improves locality, depth, naming, duplication, or primitive obsession.
8. Run the nearest compile/typecheck and any affected smoke checks.

Mock only at system boundaries. Do not test implementation details when behavior can be tested through a stable interface.

## Durability Checkpoint

Capture only when the work establishes a reusable test-seam rule, proof pattern, or missing-seam finding. Otherwise say: No durable capture needed: <reason>.`,
  },
  {
    name: "pe-architecture",
    content: `---
name: pe-architecture
description: Improve Pe.Tools architecture by resolving where code should live, product boundaries, module seams, interface depth, locality, and deterministic-vs-latent design. Use when the user asks where should this live, this feels tangled, design an interface, boundary question, Pea vs dev-agent, desktop vs DA, document-owned vs session-owned, typed host operation vs script, or whether logic belongs in code, docs, skills, or Pea workflows.
metadata:
  goal: true
---

# pe-architecture

Use for module/interface design, refactoring direction, product-boundary questions, or code that feels shallow, tangled, or hard for agents to navigate.

## Dispatch

- If the question is "where should this live", inspect current package boundaries and nearest docs before proposing a target.
- If code feels tangled, identify the public interface and the volatility hidden behind it.
- If Pea/dev-agent, desktop/DA, document/session, host operation/bridge, or build/runtime lanes are involved, name the boundary before changing source.
- If the decision resolves a durable boundary rule, capture it before moving code.
- If the problem is actually vague intent, use pe-steer first.

## Vocabulary

Use Module, Interface, Implementation, Depth, Seam, Adapter, Leverage, and Locality. Avoid overloaded boundary language unless the repo already uses a specific term.

## Context Resolution

1. Read the nearest AGENTS.md for package cautions and shared language.
2. Read feature _DEV.md/_GOALS.md when the architecture crosses packages.
3. Inspect neighboring implementations before inventing abstractions.
4. Prefer generated contracts and public seams as current truth.
5. Consider how release packaging orchestration and distribution will be impacted
6. Keep Pea implications in dev-agent context docs until a Pea-specific design pass updates operator skills.

## Loop

1. Identify the module and its current public interface.
2. Read neighboring implementations and docs before proposing shape changes.
3. Find where a smaller interface could hide more implementation depth.
4. Prefer feature locality and explicit contracts over broad abstractions.
5. Preserve product boundaries, especially Pea vs dev-agent and desktop vs DA shells.
6. Propose at most a few candidate changes, ranked by leverage and risk.
7. Implement only the smallest approved/obvious slice, then prove it with focused checks.

## Pe.Tools Boundary Checks

Before proposing architecture changes, name which boundary is involved:

- Pea vs dev-agent: deployed operator workbench vs repo coding agent.
- Desktop shell vs automation shell: Pe.App/RRD startup vs Design Automation worker startup over shared DA-safe packages.
- Document-owned vs session-owned Revit behavior: Document/FamilyDocument collect/capture/apply vs UIApplication/open-active-navigation behavior.
- Public host operation vs private bridge: generated Pe.Host operation contracts are the product surface; private bridge frames are not.
- Source package vs product/install layout: package-local code units are not the same as installed runtime roots or generated artifacts.
- Build/package proof vs live runtime proof: NoRrdContact artifacts do not prove AttachedRrd freshness.
- Deterministic code vs latent workflow: stable data/auth/offline/core logic belongs in code; judgment-heavy orchestration can live in skills/workflows over deterministic Pe surfaces.

If a proposed seam crosses one of these boundaries, keep the public contract small and push volatility behind an adapter or document-owned helper.

## Harness Projection Judgment

Use after a Revit harness stress test or talk_to_pea feedback identifies friction.

Ask:

1. Is the missing shape a reusable projection/data join, enriched metadata/validation, or just a one-off convenience wrapper?
2. Would it make multiple realistic user questions cheaper, safer, or more reliable?
3. Can it live as optional fields or a bounded projection on an existing operation instead of a new domain endpoint?
4. Does it preserve generic Revit posture instead of encoding one office/workflow unless profile-driven?
5. What should not be added because it would grow context, optionality, or wrapper sprawl faster than user value?

High-leverage candidates are usually compact active-context/model inventory summaries, printed sheet/context catalogs, Project Browser provenance for views/sheets/schedules, schedule fields/filter/placement/empty-state metadata, row-to-element handles, reverse element-to-schedule membership, visible/selected element parameter snippets, generic parameter audit summaries, and stricter examples/validation for nested request shapes.

Do not create compatibility shims in this greenfield repo unless they are a temporary compile bridge.

## Durability Checkpoint

Before implementation or file moves, decide whether the architecture decision established reusable project truth.

Capture before source changes when the session resolved a product boundary, ownership rule, public interface rule, proof-lane boundary, deterministic-vs-latent boundary, or reusable projection judgment.

If no doc update is needed, say: No durable capture needed: <reason>.`,
  },
  {
    name: "pe-codify-work",
    content: `---
name: pe-codify-work
description: Turn Pe.Tools conversations into repo-local durable artifacts such as PRDs, RFCs, refactor plans, issue-equivalent briefs, context docs, or AFK-ready task plans. Use when the user asks to codify, document this, write a PRD, make a plan, create an RFC, capture context, prepare AFK work, or preserve decisions without GitHub.
metadata:
  goal: true
---

# pe-codify-work

Use when the desired output is durable local work definition: PRD, refactor RFC, implementation plan, issue-equivalent brief, or AFK-ready task list.

## Dispatch

- If the conversation resolved durable project truth, update the nearest durable doc instead of creating a new artifact by default.
- If the user needs a temporary continuation record, use docs/context/.
- If the artifact is really a handoff, keep it short and consider pe-handoff.
- If the artifact would define future implementation, include verification criteria and stop conditions.

## Loop

1. Identify the artifact type and its home:
   - feature intent: docs/features/<feature>/_GOALS.md
   - feature implementation context: docs/features/<feature>/_DEV.md
   - package behavior: nearest AGENTS.md
   - package understanding/intent: local _DEV.md / _GOALS.md
   - temporary handoff/research: docs/context/
2. Read existing docs first and update in place when possible.
3. Consider consolidating, restructuring, or pruning existing docs.
4. Keep the artifact outcome-focused, bounded, verifiable, and repo-local.
5. Replace stale TODO prose with durable intent or delete it.
6. Include verification criteria and known risks/blockers.
7. Avoid GitHub issues/PRs/comments unless the user explicitly asks.

## Placement Rules

- Put durable agent behavior, workflow cautions, and shared language in the nearest AGENTS.md.
- Put conceptual orientation in _DEV.md only when the area has a non-obvious mental model.
- Put desired end state, UX/DX intent, integration goals, and non-goals in _GOALS.md.
- Put cross-package capability docs under docs/features/<feature>/ only when one package-local doc cannot own the story.
- Put temporary handoffs, research notes, and AFK context under docs/context/ and treat them as disposable.
- Delete stale root markdown after migrating the useful content; do not preserve history by default.
- Do not create a feature doc just because a topic feels important; create one when it spans ownership seams and needs a durable orchestration point.

Prefer concise docs that future agents can act on over exhaustive conversation history.

## Durability Checkpoint

The artifact itself is often the durable capture. Before finishing, confirm whether it updated the correct durable doc or explain why it belongs in temporary context instead.`,
  },
  {
    name: "pe-handoff",
    content: `---
name: pe-handoff
description: Create concise Pe.Tools handoff or resume context for another agent, later session, or AFK continuation. Use when the user says handoff, pause here, continue later, resume this, give the next agent context, summarize current state, or prepare an exact next-step packet.
metadata:
  goal: true
---

# pe-handoff

Use when work is pausing, changing hands, or needs an AFK-ready continuation record.

## Dispatch

- If the user asks to resume, first find current task state, prior handoff, recent diff, and relevant docs.
- If the user asks to pause or transfer, summarize only what the next agent needs to act.
- If durable project truth emerged, point to or update durable docs instead of burying it in a handoff.
- If the context is temporary, save it under docs/context/ only when a file is actually needed.

## Loop

1. Summarize the objective, current state, and exact next step.
2. List changed files, relevant commands run, and verification status.
3. Include blockers, risks, assumptions, and any user decisions.
4. Point to existing durable docs instead of duplicating them.
5. Save temporary context under docs/context/ when a file is needed.
6. Redact secrets and avoid copying noisy logs unless essential.

Keep the handoff short enough that the next agent can start immediately.

## Durability Checkpoint

If the handoff contains reusable intent, boundaries, workflow rules, or failure modes, capture or point to the durable doc before finishing. Otherwise say: No durable capture needed: handoff is temporary continuation context.`,
  },
  {
    name: "pe-write-skill",
    content: `---
name: pe-write-skill
description: Create or revise Pe.Tools agent skills after repeated workflow use proves a named routing surface is needed. Use when the user asks to add a skill, improve a skill, fix trigger reliability, fatten a skill, slash skill behavior, automatic skill activation, skill descriptions, modes or dispatch, resolver logic, scripts/assets in skills, or Pea vs dev-agent skill boundaries.
metadata:
  goal: true
---

# pe-write-skill

Use when creating or revising agent skills for Pe.Tools workflows.

## Dispatch

- If the issue is trigger reliability, rewrite descriptions as blunt routing metadata with literal user phrases and failure-mode smells.
- If the user mentions /skill, treat it as override/debug UX; optimize first for automatic activation from natural language.
- If a workflow is frequent, harmful by default, or has many fragile micro-steps, consider fattening an existing skill before adding a new one.
- If the request is a general resolver problem, embed resolver logic in the thin router and relevant fat skills; do not create a resolver skill yet.
- If scripts/assets sound useful, require proof that deterministic repeated helper logic is safer as a reviewed file than as regenerated shell or prose.
- If Pea operator skills are implicated, capture the implication here unless a Pea-specific design pass intentionally updates bundled Pea skills.

## Skill Philosophy

- Thin harness, fat high-traffic skills.
- Descriptions are routing tables, not elegant prose.
- Dispatch/modes are internal state machines for the agent, not required user vocabulary.
- Skills are latent workflow programs. In this pass they are pure markdown orchestration over existing tools/docs.
- Scripts/assets are future additions for deterministic repeated helper functions only.
- Resolver behavior lives in the always-loaded router plus existing fat skills until repeated pain proves a standalone resolver skill is needed.
- Pea bundled skills and dev-agent project skills must remain separate.

## Source of Truth

- Dev-agent skill source lives in source/pe-tools/apps/pe-code/src/skills.ts.
- Repo-local .mastracode/skills copies are regenerated by dev-agent bootstrap and should not be hand-edited as source.
- Pea bundled operator skills live separately from pe-code skills and must not receive repo-development posture by accident.

## Loop

1. Confirm the workflow is repeated enough to deserve a skill instead of ordinary instructions, docs, or a one-off plan.
2. Gather use cases, failure modes, literal user phrases, and source references first.
3. Prefer improving an existing skill over adding a new one.
4. Write a trigger description that names the workflow, user phrases, failure-mode smells, and repo-specific smells.
5. Add a lightweight Dispatch or Modes section only when it helps internal routing.
6. Add context-resolution and durability checkpoints for fat skills.
7. Keep scripts/assets out unless deterministic repeated helper logic has proved the need.
8. Review generated skill content for product-boundary leaks before installing or regenerating it.

Skills are guidance, not tools. Do not encode command execution that belongs in repo verification wrappers or Pea product tools.

## Durability Checkpoint

Skill design decisions are usually durable. Capture changes to skill philosophy, source-of-truth rules, Pea/dev-agent separation, or trigger-routing policy in docs/features/dev-agent-context before or alongside skill source changes.

If no doc update is needed, say: No durable capture needed: <reason>.`,
  },
];
