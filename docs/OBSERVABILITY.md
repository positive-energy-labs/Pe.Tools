# Observability

PostHog-only, no auth: the project API key is a public write-only ingest key. Current resolution order
(both clients, must stay identical until ADR 0018 lands):

1. **Installed product manifest** (authoritative — the key rides the release):
   `%LOCALAPPDATA%\Positive Energy\Pe.Tools\product.payloads.json` →
   `{ "telemetry": { "posthog": { "apiKey": "phc_...", "host": "https://us.i.posthog.com" } } }`
2. **Settings fallback** (dev/override): `Documents\Pe.Tools\settings\Global\settings.json` →
   `{ "posthog": { "apiKey": "phc_...", "host": "..." } }`

No key → all capture is a no-op. Ruled target (ADR 0018, 2026-10-13): lane selects the
key source first; `dev` reads only the explicit preferences key (no fallback to the installed
manifest), `installed` reads the manifest. The host owns the one PostHog client; the browser and
the add-in forward typed facts to it and hold no key. Current code still has two implementations,
same event shapes:

- TS: `ts/packages/runtime/src/analytics.ts` (host + pea runtime)
- C#: `dotnet/Pe.App/Analytics/PostHogAnalytics.cs` (Revit add-in)

Both post to `/i/v0/e/` — the same route the SDK's install-failure telemetry
(`Pe.Revit.Sdk` `Telemetry.cs`, `install_failure` / `field_report` / `msi_bootstrap_failure`
events) uses, so one PostHog project carries product usage AND install-failure diagnostics.

## Events

| Event | Source | Notes |
|---|---|---|
| `app_boot` | Revit add-in startup, host startup | version fleet + DAU denominator |
| `host_op` | host `POST /call` dispatch | op, ok, duration today; ruled export drops serialized input and error message (ADR 0018) |
| `bridge_queue` | host Revit queue | `phase: queued` only when another op is ahead at enqueue; `phase: started` whenever the gate opens, with `wait_ms`. Both carry `op`, `request_id` (wire id), `session_id`, and `queue_depth` (at enqueue, including this op). Join phases by `request_id`; a blocked op retains its queued event. |
| `ribbon_click` | AdWindows `ItemExecuted`, filtered to `Pe.App.Commands` | `doc_title` leaves export (ADR 0018); retires as buttons migrate into Tasks |
| `palette_action` | the Do palette's tab actions (`CmdPltCommands`) | tab=commands\|tasks\|scripts, item id, ok; the funnel ribbon buttons migrate into |
| `$exception` | Serilog Error/Fatal sink (Revit) | PostHog error tracking; ruled export is a code-only fingerprint, no message or raw stack |
| `ui_feedback` | web feedback picker → host `POST /pe/feedback` | user note on one picked element: comment, url, selector, component + stack names, html, rect, cropped WebP `picture` data URL (≤256KB, else `picture_error`). Awaited: the popover keeps the note until PostHog accepts |

## Export boundary (ADR 0018, ruled 2026-10-13)

Leaves the machine automatically: opaque install/process/browser/request ids, immutable
component/build/version/lane stamps, timestamps, durations, closed phase/outcome/fault codes and
counts. Never automatically: `doc_title`, operation inputs/results, usernames/hostnames, paths,
raw URLs/messages/stacks, credentials, replay, IP/GeoIP. The one exception is `ui_feedback`, an
explicit human submit, which keeps its content. MCP usage stats (`$mcp_tool_call`,
`$mcp_initialize`) export tool name, duration, error flag, declared argument names and client
identity, never parameters, results or intent. Ruled event names not yet emitted: `pea_turn`,
`reading_timeout`, `reading_failure`, `stream_fault`, `host_fault`, `telemetry_dropped`,
`refusal_count`, `update_outcome`. Per-event field allowlist: wave-4 plan section 4.

Payloads are size-bounded at 256KB/side with `*_truncated: true` + byte size — truncation is
itself a tuning signal, not silent loss.

## Deferred (re-entry triggers)

- Approval/edit/reject loop events — when pea stabilizes (best cost signal once real).
- Session replay, flight-recorder rings, a durable forwarding queue, Sentry — ADR 0018 defers them
  (Sentry until fixed grouping still fails or an issue-to-PR workflow is requested).
- OTLP log streaming; posthog-node client — if file logs + events stop being enough.
- GitHub auto-issues from feedback events — when weekly skimming stops scaling.
- Opt-out surface — deliberate non-goal at internal-beta scale (the SDK CLI honors
  `PE_NO_TELEMETRY` for its own install events; the product clients do not read it).
