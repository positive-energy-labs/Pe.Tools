# Pea beta local auth architecture

## Status

Dense context note for the five-person beta shape. Disposable until promoted into Pea feature docs.

## Beta goal

Remove the user-hostile PowerShell bootstrap/install path without prematurely building full Pea Cloud identity, org, resource, and Gateway infrastructure.

## Recommended beta shape

Pea is an installed local companion with a local web UI/runtime. Hosted web/auth exists only as a login broker and optional model/Gateway proxy authority.

```text
Local Pea UI/runtime
  -> Revit / Pe.Host locally
  -> hosted Pea/WorkOS login only when auth is needed
  -> local Pea owns model calls, tools, memory, and stream lifecycle
```

If central beta model access is needed:

```text
Local Pea runtime
  -> Pea Cloud token/Gateway proxy
  -> Mastra Gateway or model provider
```

The browser tab must not be the ongoing model-call proxy.

## Core decisions

- Browser UI is a controller/view, not backend transport.
  - Why: Pea runs a local Revit-attached agent loop; tab closure, refresh, throttling, multiple tabs, or auth expiry must not kill backend execution.
- Local Pea owns Revit/session/tool/model/memory lifecycle.
  - Why: Revit authority is local and stateful; keeping runtime ownership local avoids cloud/local/browser choreography during every streamed turn.
- Hosted auth is acceptable as a login broker.
  - Why: OAuth/WorkOS is browser-native; using it once to mint local authorization is much simpler than making the browser proxy model traffic.
- Use redirect/callback handoff rather than ongoing hosted-page-to-localhost API calls.
  - Why: avoids making CORS/browser lifetime part of runtime auth; localhost CORS is manageable but should not be the main integration seam.
- Prefer `WorkOS callback -> Pea Cloud -> localhost callback`, not direct `WorkOS callback -> localhost`.
  - Why: Pea Cloud can hold WorkOS secrets, validate org membership, issue Pea-scoped credentials, and keep WorkOS details out of the installed app.
- Localhost callback uses a one-time code, not a durable credential in the URL.
  - Why: URL tokens leak easily; one-time codes limit damage and let local Pea exchange over a controlled channel.
- Mastra Gateway `msk_...` never goes to browser or local Pea.
  - Why: a shared Gateway key is central billing/memory/model authority; beta trust does not justify key exposure.
- For simplest beta, allow local user/provider API key storage instead of Pea Cloud Gateway proxy.
  - Why: avoids central billing/security work entirely; viable for five trusted users if key entry/provisioning is acceptable.
- If avoiding user-provisioned keys, use a thin Pea Cloud Gateway proxy.
  - Why: lets Pea sponsor beta model access while keeping the real provider/Gateway secret server-side.

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
10. Local Pea stores/refreshes token and owns all later runtime/model/tool traffic.
```

## Runtime credential model

| Credential | Holder | Beta purpose |
|---|---|---|
| WorkOS browser session | browser/hosted login page | authenticate human to Pea Cloud |
| One-time connection code | localhost callback only | transfer auth result from hosted login to local Pea |
| Short-lived Pea token | local Pea | authorize local runtime/Gateway proxy calls |
| Provider key or Mastra Gateway `msk_...` | local user store OR Pea Cloud only | model access; never browser-proxied |

## Two viable beta variants

### A. Smallest operational beta

```text
Installed local Pea + local UI + local memory + user-entered provider key
```

Pros: no Pea Cloud required for model calls; fewest moving pieces; easiest to debug.  
Cons: users must enter/manage keys or receive manual provisioning instructions.

### B. Best no-user-key beta

```text
Installed local Pea + hosted WorkOS login + short-lived Pea token + Pea Cloud Gateway proxy
```

Pros: no user provider-key burden; central kill switch/rate limits; closer to long-term cloud-backed auth.  
Cons: requires thin Pea Cloud, token issuance, proxy, rate limiting, and outage handling.

## Deferred long-term architecture

Do not build for beta unless needed:

- full Pea Cloud app shell
- cloud-hosted runtime
- browser-mediated model proxy
- direct browser access to Mastra Gateway
- multi-org/project/shared memory model
- broad WorkOS RBAC/FGA surface
- durable cloud thread/resource management
- cloud sync of local Revit/session state

## Main risk to remember

The tempting architecture `local Pea -> browser tab -> Gateway/provider` is possible but fragile because the browser becomes backend infrastructure. Pea should tolerate UI closure/reload; therefore the browser can initiate/auth/observe/steer, but local Pea must execute.
