# Pea Runtime Review Findings

## Status

Compressed review brief for Pea/Peco runtime hardening. Treat this as investigation context, not architecture authority. Promote durable rules into package docs, feature docs, or `AGENTS.md` when they become settled design.

Last compressed: 2026-06-17.

## Review Intent

Review Pea/Peco runtime behavior adversarially around product boundaries, startup/thread ownership, history replay, queue/continuation behavior, and installed payload viability.

Primary split:

- Pea is the curated Revit/operator product runtime.
- Peco is repo/dev tooling for developing and proving Pe.Tools.
- Shared runtime mechanics belong below both products; product policy belongs above the shared runtime.

## Solved Findings

### Installed payload boot failure

Installed Pea could build successfully but fail at startup because a required native storage sidecar was not staged. The payload pack lane now stages the native sidecar and boot-smokes the staged executable, so installed-lane packaging catches this class of failure.

### Beta TUI fallback

`pea beta-tui` could disable the line-mode fallback even though OpenTUI remains fragile in some Windows/zellij paths. The beta TUI options now keep fallback enabled, making line mode the reliable default escape path.

### ACP replay turn collapse

Persisted ACP replay could collapse multiple user or assistant turns into one transcript row because replayed chunks lacked stable message ids. Replay now preserves or derives deterministic message ids so transcript turn boundaries survive reload.

### Queue return semantics

The runtime could report `queued: true` for busy states where no real follow-up queue was used. Queue results now distinguish actual queued follow-ups from immediate sends, and the runtime ledger records the path taken.

### Startup thread side effects

Generic runtime creation could implicitly select or create startup threads. Startup selection is now explicit policy; draft sessions can exist without a backing thread until prompt/materialization.

### Thread lock visibility

Thread lists now carry lock state and workbench loading blocks visibly locked threads before mutation. Current-owner owned threads remain selectable, and same-thread load is allowed as refresh/replay behavior.

### Kernel-ledger history replay

History replay depended on adapter event side effects and could silently look empty when durable history was unavailable. Runtime history now prefers the kernel/session ledger, workbench snapshots load transcript state directly, and materialized sessions fail loudly when required ledger support is missing.

### Stale deleted/closed history

Deleted or closed sessions could leave in-memory or persisted kernel history available through old ids. Cleanup now clears session/thread aliases and stale kernel ledger state when ownership ends.

### Session-owned send identity

Session sends and queues could run against whatever harness thread happened to be current. Kernel session operations now reassert the materialized session identity, ignore caller-supplied thread/resource overrides, and refuse to hijack another active running thread.

### Runtime event replay

Kernel runtime/debug events were not fully projected through workbench snapshots, and some event payloads were not guaranteed JSON-safe. Snapshot replay now includes deterministic debug events from the kernel ledger, and runtime event payloads are sanitized before durable storage/projection.

### Protocol-only transcript recovery

Older protocol-only histories could load as empty snapshots or duplicate transcript rows depending on replay path. Snapshot and fallback replay now recover uncovered protocol transcript chunks while suppressing chunks already covered by direct kernel messages.

### Continuation and approval boundaries

Cancellation and close could leave stale resume decisions or queued ACP work able to affect a later prompt/session. Cancel now clears pending decisions, late decisions after cancel are ignored, queued work checks session ownership/generation before running, and permission failures fail closed by recording a cancelled decision.

### Product controls

Model/access changes could be projected optimistically without proving runtime state changed. ACP/workbench extension paths now carry model/access changes through shared runtime/control surfaces, and read-only access blocks declared mutating tools and mutating Host operations.

## Active Risks

### Product boundary still needs hardening

Pea should not inherit broad Peco/dev behavior accidentally. Keep tightening product-only imports, CLI exposure, bundled skills, tool profiles, and native dependency shape until Pea's installed graph is explainable from product intent.

### Startup policy still needs final product defaults

The generic runtime policy is explicit, but product defaults still need a settled rule per surface: new draft, continue most recent, or explicit load. Do not let stock TUI, web, ACP, and beta TUI each invent startup semantics.

### Queue semantics may need a Pe-owned queue

The current behavior is more honest, but Pe does not yet own a full queue for non-running busy/suspended states. If strict single-flight behavior is required, add an explicit runtime queue with visible state, cancellation, and replay.

### Web transport snapshot/event race remains separate

Browser command responses return full state while SSE also streams deltas. Because transcript deltas are not idempotent, the web workbench still needs an exactly-once snapshot/event policy before treating it as a hardened product surface.

### Test suite should stay sparse

The runtime now has enough regression proof to guard the core spine. Future tests should be added only for high-signal behavior seams: startup/lock policy, ledger replay, continuation boundaries, product policy, and transport state consistency.

## Investigation Queue

1. Define final startup policy per product surface.
2. Harden Pea/Peco product boundaries and import/tool exposure.
3. Decide whether Pe needs an explicit runtime-owned queue beyond Mastra follow-up.
4. Fix or specify web snapshot/SSE exactly-once behavior.
5. Promote settled installed-payload requirements into build docs after native sidecar policy is final.
