---
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

If no doc update is needed, say: No durable capture needed: <reason>.
