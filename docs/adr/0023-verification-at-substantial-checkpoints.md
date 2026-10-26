# Verification at substantial checkpoints

Date: 2026-10-26. Status: accepted. Supersedes [ADR 0012](0012-one-verification-entrypoint.md)’s sole-proof and per-change completion requirements; retains its comprehensive command, CI, lane setup, and generated-contract checks.

## Context

The sole-proof rule made broad verification a completion requirement for small changes. Retained sessions show repeated suites over a moving dependency tree, temporary repairs to soon-replaced UI, and green assertions that did not establish the intended experience. The October test purge reduced inventory but retained that cadence. The user explicitly reverses the cadence to support fast, messy discovery.

## Decision

During iteration, exercise the changed behavior through the real UI or a bounded reproducible user flow. Use focused checks to resolve consequential uncertainty immediately. Do not write an implementation-mirroring test or run the full workspace gate for every tweak or checkpoint commit.

Consolidate meaningful durable coverage and use `pnpm verify` at substantial checkpoints: before a worktree merge or release, after accumulated messy changes, and after a few major campaign waves. Scale and coupling determine the seam; the examples are not a rigid counter. The command remains the comprehensive CI entrypoint, not the exclusive source of evidence.

Name a coherent candidate and retain applicable evidence. After a failure, rerun affected stages; widen only when changed dependencies or unresolved failures require it. Record unrelated failures without silently taking over their repair or claiming the integrated candidate is green.

Prefer connected product behavior. Retain focused invariants where the surface cannot expose the failure reliably. An implementation’s own inventory cannot certify completeness, and green assertions do not settle user acceptance.

## Consequences

Small UI iterations can reach user judgment promptly. Broad integration proof remains necessary at substantial crossings. Evidence reuse requires judgment about dependencies and runtime identity; it is not permission to certify untested combinations. Full logs remain artifacts; the conversation receives the decision-relevant result. No test suite or CI command is removed by this decision.

Evidence and limitations: [verification cadence study](../research/2026-10-26-verification-cadence.md).
