# Observability

PostHog-only, no auth: the project API key is a public write-only ingest key read from
`Documents\Pe.Tools\settings\Global\settings.json`:

```json
{ "posthog": { "apiKey": "phc_...", "host": "https://us.i.posthog.com" } }
```

No key → all capture is a no-op. Two implementations, same event shapes:

- TS: `source/pe-tools/packages/runtime/src/analytics.ts` (host + pea runtime)
- C#: `source/Pe.App/Analytics/PostHogAnalytics.cs` (Revit add-in)

## Events

| Event | Source | Notes |
|---|---|---|
| `app_boot` | Revit add-in startup, host startup | version fleet + DAU denominator |
| `pea_prompt` | `createRuntimeController` (all surfaces) | full prompt, `surface: tui\|web\|test\|acp` |
| `tool_call` | runtime session events (`tool_end`) | full event payload |
| `agent_turn` / `agent_error` | runtime session events (`agent_end`/`error`) | carries model usage/tokens when reported |
| `host_op` | host `POST /call` dispatch | full input/output, duration, error kind |
| `ribbon_click` | AdWindows `ItemExecuted`, filtered to `Pe.App.Commands` | carries `doc_title` |
| `$exception` | Serilog Error/Fatal sink (Revit) | PostHog error tracking |

Payloads are size-bounded at 256KB/side with `*_truncated: true` + byte size — truncation is
itself a tuning signal, not silent loss.

## Deferred (re-entry triggers)

- Approval/edit/reject loop events — when pea stabilizes (best cost signal once real).
- posthog-js in the web SPA; doc-title hashing; payload privacy hardening — external users.
- OTLP log streaming; posthog-node client — if file logs + events stop being enough.
- GitHub auto-issues from feedback events — when weekly skimming stops scaling.
