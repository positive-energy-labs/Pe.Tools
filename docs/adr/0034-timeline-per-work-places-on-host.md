# The Timeline belongs to Work; Places live on the host per device

Status: accepted. Supersedes the Place storage rules of [ADR 0022](0022-independent-tools-work-and-conversations.md) ("Each browser window owns its Places in sessionStorage", "No new host workspace store replaces them"). The rest of ADR 0022 stands.

## Context

The route chrome stacks a History row (`HistoryRail`), a Timeline head (`TimelineHead`), a tab row (Places) and a header per pane. Each answers a part of "where am I and how did I get here". Under them sit three stores with no shared ids: the receipt journal (`action-journal.ts`), the per-Work journal files (`route-workspace.ts` `#inverses`), and the History recording (`recording-points.ts`). [ADR 0030](0030-pea-first-goal-core-plan-statecell.md) and [ADR 0031](0031-recording-at-host-input-services-history-in-the-shell.md) already call History a projection of the Timeline. The code never joined them.

One Place can show several Works. Fans displays its own Work and the Ducts Work, and Ducts displays both (`fans/route.ts` and `ducts/route.ts` `owners`). A Timeline per Place would therefore show one Work's undo in several histories, and it would hide changes made from another Place. A spike on real host data (`.artifacts/tmp/timeline-spike/`) showed this: the "per Place" view hid both History points that read the Ducts Work.

Places in sessionStorage start empty in a second window, are lost when the window closes, and are invisible to Pea. Pea's view lease fails as "ambiguous" when two windows show the same thread (`route-view-store.ts`).

## Decision

kaitpw, 2026-11-09: "ya work makes a lot of sense" and "host per device. cross tab/window sync should be possible, if not now then later".

1. The Timeline belongs to a Work. A Place shows the Timelines of every Work it displays, merged in time order.
2. History points are marks on that Timeline, not a separate record or a separate row of chrome.
3. The URL carries the Place's link. It carries `at` only for a past point. No `at` means the latest point.
4. The host stores Places per device, independent of threads. Opening a tool still creates no chat (ADR 0022). Live sync across windows may come later; one source of truth comes now.

## Consequences

The `HistoryRail` row goes away as separate chrome. One Timeline control in the top bar holds undo, redo, points and Capture.

A point needs a link to the Work steps and receipts around it. The spike found the fields (`reason.receipt`, receipt `snapshots`, ack `receiptId`) but no data that uses them, so this link is unproven.

A host Place store is new persisted state. Two windows on the same device see the same Places. A per-window tab set needs a new decision.

Not decided yet: undo as an appended restore entry in the joined Timeline; thread id on every Timeline entry. Both are Owed in `docs/features/routes/LEDGER.md`.
