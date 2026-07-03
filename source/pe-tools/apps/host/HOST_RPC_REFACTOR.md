# Host RPC Refactor Scratchpad

Temporary review note for branch `f/host` commits `c340902..49eeb37`.

Rules for this branch: effectify everything, delete everything, reduce hops,
improve identities. The next large move, after the TS host earns trust, is to
effectify the Mastra side and collapse host + Mastra into one server.

## Prod-readiness review

Current read: promising, not production-ready until final proof is repeated on
the exact branch tip.

Good:

- `source/Pe.Host` is deleted; the installed process name stays `Pe.Host.exe`,
  but the executable is produced by `apps/host`.
- Web, tools, and TS host callers route through generated Effect RPC contracts
  instead of `@pe/host-client` / `@pe/host-generated` wrapper stacks.
- Bridge execution is smaller: TS host owns sessions/routing, Revit executes
  generated bridge operation keys, and local/admin operations are TS-owned.
- Settings document IO is no longer a separate second-phase spec: TS host now
  owns tree/open/save/validate/compose behavior with Ajv validation, hash version
  tokens, safe path resolution, and focused tests.
- Cold C# settings document composition code was deleted from
  `Pe.Shared.StorageRuntime`. The remaining C# storage runtime role is storage
  roots, module/document identity, state/output/log files, APS settings lookup,
  and schema metadata still needed by Revit-side codegen/runtime consumers.
- Prior migration notes record passing TS checks/tests, C# builds, codegen sync,
  host pack, installer pack, and settings/APS focused tests.

Not ready until proved:

- Connected-Revit acceptance is still the main missing proof. No branch review
  should call this production-ready without an AttachedRrd or FreshRevitProcess
  smoke of real bridge calls, settings reads, scripting, and APS token access.
- Installed lane needs a final smoke proving the installed TS-built
  `Pe.Host.exe` is the process launched by `Pe.App`, not a source dev server or
  stale artifact.
- `/api/settings/document/open` is deleted. The C# settings document client now
  posts an Effect NDJSON RPC request to `settings.document.open-with-module`.
- `bridgeSessionId` is caller scope, not direct bridge operation payload.
  `callHostRpcMember` sends it as `x-pe-bridge-session-id` RPC metadata for the
  generic/scoped path, while generated bridge RPC payloads only contain the
  operation request.
- Current terminal proof after the final StorageRuntime purge includes
  `Pe.Shared.StorageRuntime` compile, focused shared tests, downstream `Pe.App`
  compile, host-contracts/host dispatch tests, host-contracts/apps-host TS
  checks, source codegen sync, and host pack. The remaining production gate is
  live/installed behavior, not another local cleanup pass.

## Runtime verification findings

- 2026-07-03: The dev-lane host root
  `%LocalAppData%\Positive Energy\Pe.Tools\dev\bin\host\Pe.Host.exe` can stay
  stale from the deleted C# ASP.NET host. In that state it listens but returns
  404 for `/host/status`, so `Pe.App` cannot prove or launch the TS host by
  product identity. `apps/host` `vp pack` produced the correct TS-built
  `Pe.Host.exe`, and copying that artifact into the dev host root restored
  `/host/status`, identity file, and admin-shutdown proof. Do not count a
  source-run `jiti src/index.ts` host or stale dev root as installed/dev lane
  product proof.
- 2026-07-03: APS token acquisition initially returned a token but persisted an
  empty protected payload, so immediate `aps.auth.status` reported
  `exists:false`. The bug was PowerShell DPAPI invocation: `-Command` argument
  passing did not populate `$args`, and failures could collapse to empty stdout.
  The fix uses `-EncodedCommand` with embedded safe base64 arguments, loads
  `System.Security`, and fails on empty output. Redacted runtime proof now shows
  two-legged ParameterService token acquisition, DPAPI-protected token-store
  payload, immediate `exists:true` status, and Revit-side C# shim status through
  TS RPC.

## Architectural decisions

### Delete C# `Pe.Host`; make TS `@pe/host` the host runtime

- Pro: Deletes the old ASP.NET host, duplicated registries, wrapper clients,
  local operation handlers, and product-layout DLL identity.
- Con: Moves runtime trust to Effect RPC, Node packaging, and the TS host
  ownership lane; final installed-lane proof matters more than compile proof.

### Generate Effect RPC contracts from C# operation authority

- Pro: Keeps Revit operation truth in C#, gives TS callers one typed RPC surface,
  and preserves dynamic `host.call` for Pea/tool use.
- Con: Session-scoped calls still use the generic `host.call` funnel so the
  generated direct RPCs stay operation-payload-only.

### Keep local/admin behavior TS-owned

- Pro: `host.status`, `bridge.sessions.*`, `logs.tail`, recent documents,
  settings document IO, and APS auth are not Revit capabilities, so they should
  not pollute the searchable Revit operation catalog.
- Con: `operation-types.ts` still hand-maintains TS-owned schemas. That is fine
  while they are genuinely TS-owned; it becomes bad if C# also keeps equivalent
  transport DTOs alive.

### Keep host and Mastra separate for this branch

- Pro: Stabilizes one server boundary before collapsing two unstable runtimes.
- Con: Keeps one extra local server/process until the Mastra merge happens.

## Identity/type sharing decisions

### C# remains the source for Revit bridge operation types

- Pro: Revit semantics stay near Revit packages, and generated Effect schemas
  are a projection rather than a second truth.
- Con: TS-only iteration on Revit operation shape is intentionally blocked by
  the C# authority/codegen loop.

### TS owns process/session identity

- Pro: Revit no longer invents bridge session IDs. TS host maps opaque session
  IDs to WebSocket connections and can later schedule/queue per session.
- Con: The public generic caller still exposes `HostSessionScope` so callers can
  select a bridge session intentionally.

### Settings document identity is module/root/path

- Pro: Settings files are addressed by `moduleKey`, `rootKey`, and
  `relativePath`, with safe local path resolution and no Revit session identity
  baked into file identity.
- Con: Direct C# settings reads now contain a tiny Effect NDJSON RPC shim until
  a broader .NET RPC client exists.

### Installed process identity remains `Pe.Host.exe`

- Pro: Preserves product-layout expectations while deleting the C# host project.
- Con: The name is now historical. Docs and status output must be explicit that
  the executable is TS-built.

### APS auth is TS-primary; C# auth stays as fallback

- Pro: Matches the new host boundary while preserving the proven C# auth code
  as the one exception to delete-everything.
- Con: Two auth implementations can drift. Keep C# unused and covered only as a
  fallback lane, not as parallel active behavior.

## Code deletion decisions

### Delete `source/Pe.Host`

- Pro: Removes the largest duplicate runtime and forces loose references to
  surface.

### Delete `@pe/host-client` and `@pe/host-generated`

- Pro: Removes wrapper/typegen sprawl. `@pe/host-contracts` is now the generated
  contract package, and apps/tools keep only thin local caller setup.
- Con: Call-site ergonomics now depend on the generated RPC helpers being boring
  enough. Do not rebuild a wrapper package unless repeated setup proves it is
  smaller than local helpers.

### Delete the standalone settings runtime spec

- Pro: The settings plan is no longer future-only; the TS host implements the
  important parts. Keeping a second doc would preserve stale advice.

### Delete old C# settings storage/runtime leaves

- Pro: Moves authored document IO, composition, validation, and versioning into
  the TS host where the web/editor/runtime loop lives.
- Con: Revit-side settings reads now depend on the TS host being reachable.
- Done: removed the unused C# include/preset composition pipeline and unused C#
  save/validate document DTOs. Kept C# storage roots, discovery, document
  snapshot/open DTOs, directive marker attributes, and schema metadata that
  still have live consumers.

### Do not add `aps-sdk-node` for auth-only

- Pro: Current TS auth is a small Effect-native slice with Pe-owned credential
  loading, DPAPI persistence, callback listener scoping, and request tests. The
  SDK would mostly add axios/sdkmanager for code that is already small.
- Con: We still own the small auth HTTP/token implementation for now.

## Next steps

1. Run connected-Revit acceptance: host launch from `Pe.App`, bridge session
   list/status, a no-request Revit op, a request/response Revit op, settings
   open/validate/save, scripting execute, and APS token/status.
2. Run installed-lane smoke proving installed `Pe.App` launches the TS-built
   `Pe.Host.exe` from the product descriptor, not a source dev server or stale
   artifact.
3. Before porting broader APS behavior to TS, spike `aps-sdk-node` for Data
   Management + OSS + Model Derivative. Skip it for auth unless the current
   Effect-native auth path becomes a maintenance problem.
4. After TS host stability, effectify Mastra integration and collapse host +
   Mastra into one server.
