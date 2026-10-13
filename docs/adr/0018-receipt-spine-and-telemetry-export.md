# 0018: One receipt spine, and a closed telemetry export

Date: 2026-10-13. Status: Accepted 2026-10-13. Decided by: kaitpw ("they look good to me"; item 1 split "50/50"; item 17 A). Source: [telemetry rulings](C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/review-20261012/round3/TELEMETRY-RULINGS.md:76) and [wave-4 plan](C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/review-20261012/round3/WAVE4-PLAN.md:38). Item numbers below are the rulings sheet's 1-17.

## Context

Two vendor senders (`ts/packages/runtime/src/analytics.ts`, `dotnet/Pe.App/Analytics/PostHogAnalytics.cs`) post `MACHINE\user` identity, `doc_title`, serialized operation inputs and raw exception text, and callers can override component and version. Direct capture sites (`bridge.ts`, `call-route.ts`, `pe-routes.ts`) and the branch-only notices feed each tell a separate completion story. One action's queued, started, finished and refused facts cannot be joined across web, host and Revit. PROVEN[source, worktree `ac455854`, 2026-10-13]; delivery and PostHog project settings UNPROVEN.

## Decision

1. **Receipt spine (D18 A, item 2).** One receipt schema and reader (`ts/packages/agent-contracts/src/receipts.ts`). Telemetry export, notices, bay rows and background jobs are subscribers; none settles an action. ActionJournal and SDK native receipts keep their physical stores and authority; the spine references them. HTTP success, a click, absent telemetry or a turn ending never certifies a mutation.
2. **Identity and stamps (items 3, 4).** Opaque `install_id` is the distinct id, plus process and browser session ids and opaque action/request ids. Every event carries immutable build, version, lane and a closed component (`host|web|revit|pea|tray|installer`) assigned at trusted boundaries; callers cannot override them.
3. **What leaves the machine (item 1, Yes part).** Opaque ids, exact component/build/version/lane, timestamps and durations, closed phase/outcome/fault codes and aggregate counts, sent only through the host's single PostHog client (items 6, 7, 8): browser reports go through the host (typed diagnostics on `/pe/feedback`), C# mirrors event ids as constants and forwards typed facts. Selected successes and failures both ship now; rings and a durable forwarding queue are deferred (item 5).
4. **What never leaves automatically.** `doc_title`, model/element/work content, operation inputs and results, usernames and hostnames, paths, raw URLs, messages and stacks, credentials, replay, raw logs, IP/GeoIP and person updates. Local receipts keep the exact target for explicit inspection.
5. **Feedback exception (item 1, owner split).** UI feedback keeps exporting its content (comment, URL, selector, component names, HTML, rect, viewport, picture): it is an explicit human act and the base of the software-factory signal. Only a verified human submit may carry it; diagnostics cannot claim the exception.
6. **MCP usage stats.** The host's `/mcp` door is wrapped once with `@posthog/mcp` `instrument`. `beforeSend` strips `$mcp_parameters`, `$mcp_response`, `$mcp_intent` and exception message text; it keeps tool name, duration, `$mcp_is_error`, `$mcp_input_keys`, client name/version and protocol version. `context: false` and `enableConversationId: false` so Pea's doors are unchanged (AX); `serverBuild` is the exact build; `identify` is the opaque install id; our request id is the join key.
7. **Dev lane (item 9).** Lane selects configuration before keys are read: dev emits only with the explicit preferences key and never falls back to the installed manifest key.
8. **Faults (items 10-16).** Bounded loading and failure behavior is proven before instrumentation. Fatal handling is local record first, 2 s flush deadline, nonzero exit. Expected 4xx and refusals are counted; thrown errors, 5xx and stream faults are fault events. `$exception` gets a stable type/module fingerprint with allowlisted frames. Private release-bound source maps are uploaded. Replay stays off. Sentry is deferred until fixed grouping still fails or an issue-to-PR workflow is requested.
9. **Installed CLI (item 17 A).** The installed SDK CLI shim ships self-contained, so no machine needs a .NET runtime for update checks.

## Consequences

- Growth is accepted where it buys joins, fault paths and notices; the plan forecasts net +120 to +940 production LOC, not a new telemetry framework.
- The host is the only egress and key holder. With the host down, remote browser delivery is unavailable and the UI says so; a missing row is UNPROVEN delivery, never success.
- Dashboards that read `doc_title`, `input`, `error_message` or `MACHINE\user` break by design; per-person analytics wait on a later ruling.
- The branch notices feed is reused for presentation only; its source becomes receipts. `@posthog/mcp` is a beta pin whose defaults conflict with this ADR, so the `beforeSend` rebuild and a tools/list off/on byte comparison are standing tests.
- Feedback content leaves the machine by design; its bounds and explicit submit are the only guard, so reopen this ADR before replay or any non-explicit content capture.
- Proof is gated: deterministic privacy and AX vectors first, then a PostHog read-back of one joined dev incident, then an installed rerun. Implementation status lives in the host ledger, not here.
