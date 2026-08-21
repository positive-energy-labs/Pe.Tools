# Queue provenance — ruled spec

Status: ruled 2026-08-18 (kaitpw approved the reconciled proposal). Build is Owed; this file is
the spec and dies into the ledger when the work lands.

## Problem

The single Revit UI thread keeps one in-flight op per session over a bounded FIFO queue
(host ledger, 2026-07-08). Every Revit-touching op funnels through the SDK-owned queue, and
nothing about who asked survives the trip — `/call` carries a session id and nothing else.
Concurrent callers are now normal: a web route iterating UI, a second agent tuning an algorithm,
a pea chat, several fetch-heavy routes — all on one session. The observed failure: "this page
feels really slow, fix it" when the page is fine and the queue holds a multi-minute collection
from another caller.

## Ruled design

Never touches the SDK; all Pe.Tools-side.

1. **Origin on every call.** One header, `x-pe-origin`: `<lane>:<name>[#<id>]` — web routes
   stamp their route id (`web:/schedule-grid`), pea stamps its thread (`pea:chat#<threadId>`),
   scripts and agents pass a name (`script:<runSlug>`, `agent:takeoff-tuning`). **Lenient:** a
   missing header becomes `unknown` and is counted — origin is attribution, not authorization;
   fail-fast belongs on contracts, not telemetry. No registry, no validation.
2. **QueueLedger** in `Pe.Revit.Global`, wrapping the existing queue call sites: records
   `{opKey, origin, enqueuedAt, startedAt?, elapsedMs}` per session plus the last N completions
   with durations, and the `unknown`-origin count.
3. **Self-attribution on every response** — the payoff feature, no polling: the host stamps
   `x-pe-queue-wait-ms` and `x-pe-queue-behind: <origin-of-blocker>` headers, and the response
   envelope carries `queuedMs`/`execMs` so every existing log path can tell "slow op" from
   "busy queue".
4. **`revit.queue.snapshot`** op answering **from QueueLedger memory, never through the queue it
   inspects**: in-flight + queued entries + recent completions for a session.

## Follow-ons (not in the first cut)

- Queue transitions on the `GET /events` SSE relay; a depth `FactChip` on web surfaces.
- Snapshot across all sessions at once (fleet view) — first cut matches the
  one-session-per-call wire posture.
- 423-when-full body naming the queue contents.

## Non-goals (until proven needed)

Priorities, preemption, per-lane quotas, cancellation — FIFO stays FIFO. An origin registry or
auth semantics on the tag. A dedicated queue UI route.
