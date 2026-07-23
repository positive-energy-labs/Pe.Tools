# Observability

PostHog-only, no auth: the project API key is a public write-only ingest key. Resolution order
(both clients, must stay identical):

1. **Installed product manifest** (authoritative — the key rides the release):
   `%LOCALAPPDATA%\Positive Energy\Pe.Tools\product.payloads.json` →
   `{ "telemetry": { "posthog": { "apiKey": "phc_...", "host": "https://us.i.posthog.com" } } }`
2. **Settings fallback** (dev/override): `Documents\Pe.Tools\settings\Global\settings.json` →
   `{ "posthog": { "apiKey": "phc_...", "host": "..." } }`

No key → all capture is a no-op. Two implementations, same event shapes:

- TS: `source/pe-tools/packages/runtime/src/analytics.ts` (host + pea runtime)
- C#: `source/Pe.App/Analytics/PostHogAnalytics.cs` (Revit add-in)

Both post to `/i/v0/e/` — the same route the SDK's install-failure telemetry
(`Pe.Revit.Sdk` `Telemetry.cs`, `install_failure` / `field_report` / `msi_bootstrap_failure`
events) uses, so one PostHog project carries product usage AND install-failure diagnostics.

## Events

| Event | Source | Notes |
|---|---|---|
| `app_boot` | Revit add-in startup, host startup | version fleet + DAU denominator |
| `pea_prompt` | `createRuntimeController` (all surfaces) | full prompt, `surface: tui\|web\|test\|acp` |
| `tool_call` | runtime session events (`tool_end`) | full event payload |
| `agent_turn` / `agent_error` | runtime session events (`agent_end`/`error`) | carries model usage/tokens when reported |
| `host_op` | host `POST /call` dispatch | input, ok/error kind+message, duration — outputs deliberately not captured (op+input reproduce them) |
| `ribbon_click` | AdWindows `ItemExecuted`, filtered to `Pe.App.Commands` | carries `doc_title`; retires as buttons migrate into Tasks |
| `palette_action` | the Do palette's tab actions (`CmdPltCommands`) | tab=commands\|tasks\|scripts, item id, ok; the funnel ribbon buttons migrate into |
| `$exception` | Serilog Error/Fatal sink (Revit) | PostHog error tracking |

Payloads are size-bounded at 256KB/side with `*_truncated: true` + byte size — truncation is
itself a tuning signal, not silent loss.

## Deferred (re-entry triggers)

- Approval/edit/reject loop events — when pea stabilizes (best cost signal once real).
- posthog-js in the web SPA; doc-title hashing; payload privacy hardening — external users.
- OTLP log streaming; posthog-node client — if file logs + events stop being enough.
- GitHub auto-issues from feedback events — when weekly skimming stops scaling.
- Opt-out surface — deliberate non-goal at internal-beta scale (the SDK CLI honors
  `PE_NO_TELEMETRY` for its own install events; the product clients do not read it).
