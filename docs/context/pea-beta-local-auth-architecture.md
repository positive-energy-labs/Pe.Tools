# Pea beta local auth architecture

## Status

Dense context note for the five-person beta shape. Disposable until promoted into Pea feature docs.

## Beta goal

Remove the user-hostile PowerShell bootstrap/install path while adding enough Pea Cloud authority for beta login, sponsored model access, and Observational Memory without prematurely building full Pea Cloud identity, org, resource, and app-shell infrastructure.

## Recommended beta shape

Pea is an installed local companion with a local runtime and loopback control gateway. A hosted/static Pea web app may be the main chat UI, but hosted web/auth exists as presentation, login broker, and server-side Gateway authority, not as the running agent backend.

```text
Hosted/static Pea web UI
  -> browser-safe localhost Pea gateway over ACP-shaped session/update transport
  -> local Pea runtime owns Revit / Pe.Host / tools / ACP session lifecycle
  -> hosted Pea/WorkOS login only when auth is needed
  -> Pea Cloud token/Gateway proxy for model calls and OM
  -> Mastra Gateway or model provider
```

Local Pea owns Revit/tool/stream lifecycle. Pea Cloud owns Gateway credentials, model policy, and Gateway OM routing. The browser tab must not be the ongoing model-call proxy. If hosted Pea is the main chat interface, it remains a reconnectable controller/view over local Pea; tab closure or refresh must not kill the local runtime.

## Core decisions

- Browser UI is a controller/view, not backend transport.
  - Why: Pea runs a local Revit-attached agent loop; tab closure, refresh, throttling, multiple tabs, or auth expiry must not kill backend execution.
- Hosted Pea web can be the primary chat UI only through a browser-safe localhost gateway.
  - Why: hosted UI gives the best install/update surface, but local Pea must still own ACP session lifecycle, Revit authority, tools, model routing, reconnect behavior, and cancellation.
- Local Pea owns Revit/session/tool/stream lifecycle; Pea Cloud may own model transport and Gateway OM.
  - Why: Revit authority is local and stateful, while centralized model/OM control requires server-held Gateway credentials and stable thread/resource routing.
- Gateway OM is a desired beta capability, not an afterthought.
  - Why: Pea already benefits from OM; Gateway OM adds centralized continuity and model-plane observability, but it must be scoped as memory over conversations, not source-of-truth Revit state.
- Hosted auth is acceptable as a login broker.
  - Why: OAuth/WorkOS is browser-native; using it once to mint local authorization is much simpler than making the browser proxy model traffic.
- Use redirect/callback handoff rather than ongoing hosted-page-to-localhost API calls.
  - Why: avoids making CORS/browser lifetime part of runtime auth; localhost CORS is manageable but should not be the main integration seam.
- Prefer `WorkOS callback -> Pea Cloud -> localhost callback`, not direct `WorkOS callback -> localhost`.
  - Why: Pea Cloud can hold WorkOS secrets, validate org membership, issue Pea-scoped credentials, and keep WorkOS details out of the installed app.
- Localhost callback uses a one-time code, not a durable credential in the URL.
  - Why: URL tokens leak easily; one-time codes limit damage and let local Pea exchange over a controlled channel.
- Do not send Mastra Gateway `msk_...` or provider keys to browser or installed Pea unless Mastra supports constrained end-user keys.
  - Why: Gateway credentials are model, memory, and billing authority; compromise should not expose shared beta infrastructure.
- Use a thin Pea Cloud Gateway proxy for the preferred beta.
  - Why: lets Pea sponsor model access, enforce kill switch/rate limits/model policy, and attach stable OM `resource`/`thread` IDs while keeping Gateway/provider secrets server-side.
- Keep local user/provider key mode only as an escape hatch.
  - Why: it avoids central billing/security work but weakens centralized model control and makes OM/routing behavior less product-consistent.

## Concrete beta auth flow

```text
1. User opens installed/local Pea.
2. Local Pea starts/uses loopback server.
3. Local Pea opens hosted Pea login URL with state + localhost callback.
4. Hosted page performs WorkOS login.
5. WorkOS returns to Pea Cloud.
6. Pea Cloud verifies user/org and creates one-time local connection code.
7. Pea Cloud redirects browser to localhost callback with code + state.
8. Local Pea validates state and exchanges code with Pea Cloud.
9. Pea Cloud returns short-lived Pea token and resource policy.
10. Local Pea stores/refreshes token, owns local runtime/tool execution, and sends model traffic through the Pea Cloud Gateway proxy.
```

## Runtime credential model

| Credential | Holder | Beta purpose |
|---|---|---|
| WorkOS browser session | browser/hosted login page | authenticate human to Pea Cloud |
| One-time connection code | localhost callback only | transfer auth result from hosted login to local Pea |
| Local gateway token | hosted UI + local Pea loopback gateway | authorize one browser control/observe connection to local Pea without exposing runtime/model authority |
| Short-lived Pea token | local Pea | authorize local runtime/Gateway proxy calls |
| Provider key or Mastra Gateway `msk_...` | Pea Cloud | model/Gateway access; never browser-proxied or installed-client stored |
| Gateway `resource` / `thread` IDs | Pea Cloud derives; local Pea may echo opaque IDs | stable OM scope without exposing provider/Gateway authority |

## Two viable beta variants

### A. Preferred OM/model-control beta

```text
Installed local Pea + hosted WorkOS login + short-lived Pea token + Pea Cloud Gateway proxy + Gateway OM
```

Pros: no user provider-key burden; central model policy; kill switch/rate limits; consistent OM; closer to long-term cloud-backed auth.
Cons: requires thin Pea Cloud, token issuance, proxy, rate limiting, outage handling, and clear OM disclosure.

### B. Escape-hatch local-key beta

```text
Installed local Pea + hosted/static or local UI over localhost gateway + local/SDK memory + user-entered provider key
```

Pros: fewest cloud moving pieces; easiest to debug during Pea Cloud outages.
Cons: users must manage keys; weaker central model control; less consistent OM/routing telemetry.

## Deferred long-term architecture

Do not build for beta unless needed:

- full Pea Cloud app shell
- cloud-hosted runtime
- browser-mediated model proxy
- direct browser access to Mastra Gateway
- direct installed-client access to shared Gateway/provider secrets
- multi-org/project/shared memory model
- broad WorkOS RBAC/FGA surface
- user-facing cloud memory management UI
- cloud sync of local Revit/session state

## Main risks to remember

- The tempting architecture `local Pea -> browser tab -> Gateway/provider` is possible but fragile because the browser becomes backend infrastructure. Pea should tolerate UI closure/reload; therefore the browser can initiate/auth/observe/steer, but local Pea must execute.
- Gateway OM watches, summarizes, compresses, and stores conversation content while enabled. Treat this as a product/privacy feature with clear beta disclosure, not as invisible telemetry.
- Gateway OM should remember operator conversations and preferences, not become authoritative Revit/project state. Live Revit truth still comes from Pe.Host operations, scripts, logs, and active document context.
