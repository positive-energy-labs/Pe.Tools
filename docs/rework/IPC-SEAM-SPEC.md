# IPC / identity seam rework — agreed spec

Status: **agreed 2026-07-14** (grilled decision-by-decision with kaitpw). This document is the
shared understanding for the pre-release identity-seam rework across **Pe.Tools** and
**Pe.Revit.Sdk**. It supersedes the deferred-items list in Pe.Tools issue #7 for the items named
here. Background evidence: the 2026-07-13 IPC/lane audit (lane heuristics, `/host/status`
duplication, env-var port republication) — first tranche already landed as Pe.Tools `b4cc639`.

## D1 — Release ordering

**The release waits for this rework.** These items are release blockers, not post-release cleanup.
Rationale: shipping on the old seam makes user install issues harder to debug, and a later seam
swap would make "is it a migration bug or a seam bug" undecidable. The release ships on the new
seam, verified by the exit gate (D10).

## D2 — Service-file schema: additive on v2

`state/service/<name>.json` gains **optional** fields `executablePath` and (dev lane)
`sourceRoot`. `schemaVersion` stays **2**. No reader rejects a file lacking them.

Defined behavior when `executablePath` is absent: **no match — spawn/replace fresh** (today's
conservative behavior). The file is rewritten on every host bind, so thin-shape files self-heal in
one launch.

Touches: SDK `Pe.Revit.Loader/InstalledService.cs` (`ServiceFile` record + JSON fields), SDK
`clients/ts/pe-service.ts`, the `scripts/service-parity.mjs` harness, and re-vendoring into
Pe.Tools `apps/host/src/pe-service.ts` (byte-identical — never reformat vendored files).

## D3 — PeServiceHost: SDK-owned primitives, SDK-owned eviction

New serve-side helper in the SDK TS client (sibling of `pe-service.ts`, dependency-free,
vendored verbatim like its siblings). **Primitives-only** — it does NOT own an HTTP server or
routes. It owns:

- Claim-on-startup: lease → verify prior owner (pid + start-time via existing `takeOver`
  machinery) → evict if policy allows → write service file on bind → delete on graceful exit.
- **Eviction end-to-end**: the SDK itself reads the prior owner's file, POSTs the shutdown to the
  file's port with the file's token, waits for port release, then claims. This mirrors what C#
  `InstalledService.EnsureRunning` already does (lane-mismatch shutdown/respawn) — the two
  languages become symmetric.
- Token validation for the shutdown route (product mounts its own Effect route and calls the SDK
  validator).

Replacement **policy is data passed to the claim call**, not product probe logic. Current policy to
preserve: a dev host replaces an installed host automatically; a dev host replaces another dev host
only with explicit `--take-over-host`.

Deleted from Pe.Tools as a consequence: `takeoverCurrentHost` and the probe/reconcile flow in
`apps/host/src/host-ownership.ts`, the bespoke `x-pe-host-dev-shutdown` header, and the dual
identity model (SDK-LEDGER `S-DEF-1` / `S-DEF-12` close).

## D4 — C# launcher stops reading `/host/status` entirely

With D2, `Pe.App/Host/TsHostLauncher.cs` does identity from the service file + liveness from SDK
`ProbeHealth`, on **both lanes**. `/host/status` remains as a diagnostics endpoint only — nothing
load-bearing reads it. The dev-lane reuse rule ("never evict a healthy dev host from a Revit
payload") is expressed as: read file → lane `dev` → `executablePath`/`sourceRoot` matches checkout
→ probe alive → reuse.

`StartAndWait`'s status-polling loop becomes a file-polling loop (file appears → probe → done).
Note for log readers: a startup timeout now means "service file never appeared / never probed
healthy", not "HTTP status never answered".

## D5 — Dev launch: manifest-declared, executed in-process

The dev-host launch command moves to a `dev` field on the `host` payload in
`product.payloads.json`, using the same `{root}`-substitution grammar `DevCommand`/`install apply`
consume. Canonical spelling: **`vp run @pe/host#start`**.

`TsHostLauncher` reads the manifest field via the SDK loader API and spawns **in-process** (no
shelling out to the `pe-revit` CLI from inside Revit). The CLI and Pe.App become two consumers of
one manifest-declared spelling. `.claude/launch.json` is aligned to the same spelling (or its host
entry deleted).

## D6 — Sandbox lane: sharing is the intent, made explicit

A `lane=sandbox` descriptor continues to yield `ProductRuntimeLane.Installed`: a sandbox Pe.App
**shares** the one installed host, port, and service file. This is by design — a sandbox proving
installed behavior should talk to the actual installed host; the bridge already attributes
sessions (`sandbox` vs `installed`) where it matters.

Required changes: a log line (or debug assert) in `PeRuntimeContext.Capture` when the descriptor
says sandbox, so the collapse is observable; one ADR/CONTEXT.md sentence recording the intent.
**Do NOT add a `Sandbox` value to `ProductRuntimeLane`** — the enum answers "which
binaries/services am I using", and for a sandbox session the answer is genuinely "installed".

## D7 — Lane: one signal, no guessing (rides along)

- Retire `PE_TOOLS_HOST_LANE`: `PE_LANE` (SDK) is the only lane env var. Stop setting the product
  var in `TsHostLauncher`; delete the path/argv lane heuristic in `host-ownership.ts` entirely
  (`resolveHostLane` reads `PE_LANE` or fails over to... nothing — see fail-fast below).
- `BridgeSessionIdentity` consumes `PeRuntimeContext.Lane` as its base and only enriches
  sandboxId/buildStamp from the descriptor — no second lane derivation with its own default.
- `PeRuntimeContext` pre-`Capture` lane reads **fail fast** (throw or loud log) instead of
  silently returning `Installed`.

## D8 — Strings, names, identity: wholesale cleanup

Ownership boundaries:

- **SDK-owned strings**: `x-pe-service-token` (delete Pe.Tools' duplicate `SERVICE_TOKEN_HEADER`
  in `host-ownership.ts`; import the vendored `pe-service.ts` export), the
  `state/service/<name>.json` path grammar, `PE_LANE`.
- **Product contract pair** (`Pe.Shared.Product/HostProcessIdentity.cs` ↔
  `packages/host-contracts/src/contracts/product.ts`, guarded by
  `packages/host-contracts/tests/product-mirror.test.ts`): add `serviceName: "host"`,
  `healthPath: "/host/status"`, `shutdownPath: "/admin/shutdown"`. Replace every bare literal
  (`TsHostLauncher.cs`, `host-lifecycle.ts`, `host-ownership.ts` inline, `PeaCliCommands.ts`,
  route registrations).
- **Manifest as third mirror leg**: extend `product-mirror.test.ts` (~10 lines) to load
  `product.payloads.json` and assert the `host` payload's `name`/`health`/`shutdown` equal the
  contract constants. After this, every identity string is SDK-owned, mirror-tested, or generated.
- **Proper service-file reader in C#**: give `Pe.Shared.Product` a `Pe.Revit.Loader`
  `PackageReference` and replace the hand-rolled `JObject` port projection in
  `HostProcessIdentity.TryReadServiceFileBaseUrl` with `ServiceFile.Read`. No hand-rolled readers
  of SDK-owned formats anywhere.
- **Dead code**: delete `Pe.Dev.RevitAutomation/RevitProcessIdentityResolver.cs` (no callers) and
  the stale `RevitDeploymentIdentity` / dead TS constants (SDK-LEDGER `T-DEF-1`).

## D9 — Sequencing: one SDK release, one product rework branch

1. **Entry gate: `codex/rider-shell-open-spike` merges to SDK master first.** As of 2026-07-14 it
   holds four unmerged commits (`c1d0caf`…`9973133`), at least one touching
   `InstalledService`-adjacent lifecycle code, and a subagent may still be committing. Do not edit
   SDK lifecycle files until it lands; rebase the seam branch onto the merged master.
2. **SDK branch** (one release, new pinned family — e.g. beta.90): D2 schema fields, D3
   `PeServiceHost`, anything DevCommand-grammar related. Gated by `service-parity`,
   `ts-client-drift` doctor, SDK acceptance suite.
3. **Product rework branch** (one branch, reviewable commits — constants/dead-code first, then
   seam adoption, then deletions): pin the new family, re-vendor `pe-service.ts` +
   `pe-revit-cli.ts` byte-identical, then D4–D8.
4. **Parallelizable now** (no SDK dependency): D6 log + ADR, D8 constants/mirror/manifest-leg/dead
   code, D5 manifest field authoring.

**Update (2026-07-14, phase 2):** the D9-step-1 entry gate was **voided** — the
`codex/rider-shell-open-spike` touched no IPC-seam files (it is parked as a quarry per the SDK
repo's DECISIONS "Rider open" note), so the seam branch did not need to rebase onto it. The SDK side
(D2/D3/D5 primitives) landed on Pe.Revit.Sdk master (`35602c5`, repacked as beta.90 after the
`3349f2a` dead-code purge — same-version-different-bytes forbidden, so the repack is the only valid
beta.90). Pe.Tools phase-2 (this branch) pinned + re-vendored beta.90 and adopted D3/D4/D5-wiring.

## D10 — Exit gate ("safe to ship on the new seam")

1. SDK repo: `service-parity` green, doctor `ts-client-drift` green, SDK acceptance green.
2. Pe.Tools unit lanes: all TS tests (incl. grown mirror test), C# build, `dotnet test`.
3. FreshRevitProcess (`test_fresh`): installed lane cold-start — host spawned via `PeServiceHost`,
   lane asserted via `PE_LANE`, URL resolved via service file only.
4. Installed behavior: `pack` → `install_verify` on the real artifact; one manual smoke in a fresh
   sandbox session confirming shared-host behavior and that the D6 log line fires.
5. Dev lane, **manual**: clean-checkout launch through the manifest `dev` command, plus one
   deliberate dev-takes-over-installed exercise proving SDK-owned eviction. Automating the
   takeover exercise is an accepted gap — note it in the ledger.

## Known hazards for implementing agents

- Vendored SDK files (`apps/host/src/pe-service.ts`, `apps/host/src/pe-revit-cli.ts`) must stay
  **byte-identical** to the SDK sources. `vp check --fix` will try to reformat them — revert if it
  does. Product-specific glue goes in adapters (`pe-revit-launch.ts` pattern).
- `vp` binary: run from the package dir via `../../node_modules/.bin/vp`; tsgolint currently can't
  start on this machine (node not on the Windows PATH it uses) — pre-existing, not a signal.
- The lane/URL first tranche (PE_LANE-first read, env-republication deletion, mirror test,
  re-vendored CLI client) is already on Pe.Tools main as `b4cc639`; build on it, don't redo it.
