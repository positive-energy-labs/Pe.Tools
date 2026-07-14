# SDK migration runtime acceptance — 2026-07-13/14

## Verdict

The local Pe.Tools `0.6.10` publish candidate passes the SDK-migration acceptance gates on Revit
2025. Remote creation, GitHub publication, and NuGet publication were intentionally not performed.
All acceptance assertions and product operations were shell-driven; the user opened the test artifact.
No approval-dialog automation was required.

## Candidate authority

| Authority | Candidate |
| --- | --- |
| SDK repository | `C:\Users\kaitp\source\repos\Pe.Revit.Sdk` |
| SDK candidate | `6417f4ace7d691bfa64a033c2b2f5e54fc060b41` (source-root fix `a305032b37a4f85bf9dcb104c439edb361a6ae13`) |
| SDK package family | `0.1.0-beta.87` (11 packages) |
| Consumer repository | `C:\Users\kaitp\source\repos\Pe.Tools` |
| Product version | `0.6.10` |
| Revit/configuration | Revit 2025 / `Debug.R25` and `Release.R25` |
| Development signing certificate | `DBE820C856CAE3A9A06B8F2E95D37071973A470B` |

`pe-revit release --plan --json` passed for the full beta.87 family at the SDK commit above. The
consumer pins the same version in `global.json` and `.config/dotnet-tools.json`; the canonical SDK
TypeScript service client is copied from that package. Because remote NuGet publication is deferred,
the complete 11-package beta.87 family is committed under `eng/sdk-feed`; a fresh checkout therefore
does not depend on this machine's NuGet cache. Final `pe-revit doctor --json` reported every check
green, including lockstep pins and TypeScript client drift.

## Ownership migration

Pe.Tools now constructs one SDK `RevitTaskQueue` from the payload's real
`UIControlledApplication`, passes it through its host/runtime services, and disposes it at payload
shutdown after every producer is stopped and the shared accessor is cleared. Bridge cancellation is
passed through every settings/data operation into the SDK queue; ordinary bridge runs have a
two-minute execution bound, a result-type label, and cancellation checkpoints around product work.
The old `ricaun.Revit.UI.Tasks` queue and its manual exception/result wrappers are gone.

The palette's fake asynchronous Revit lane was also removed. `PaletteAction` and the local task
registry expose synchronous delegates, so an `await` cannot resume after the SDK queue callback has
left valid Revit API context. Background and UI work remain explicit palette threading lanes.

The product-local `DocumentSandbox`, failure-mechanics implementation, and redundant sandbox tests
were deleted. Callers use `Pe.Revit.Tasks.DocumentSandbox`. Pe.Tools retains only product policy in
`PeToolsFailureHandling` (which warnings to delete or resolve) and delegates failure-processing
mechanics to the SDK.

## Unsigned-dialog and lifecycle fixes

The original blocker was reproducible: local Release packaging installed an unsigned
content-addressed selector, so Revit displayed **Security — Unsigned Add-In**. Three fixes were
required:

1. Pe.Tools packaging calls the pinned SDK's idempotent `dev-sign init`, forwards its thumbprint and
   SignTool path to the SDK MSBuild targets with timestamping disabled, and rejects output unless
   `signtool verify /pa /q` validates the digest and trust chain for both `Pe.App.dll` and the selector,
   after which the embedded signer must match the expected Authenticode identity. Explicit production
   `PeCodeSignThumbprint` or `PeCodeSignPfx` inputs remain authoritative. The `publish` command
   refuses to run without one of those explicit production inputs, so acceptance's SDK development
   identity cannot become a remote release by accident.
2. SDK beta.84 makes same-version `VersionedApp` and `VersionedAddin` refreshes exact mirrors, so an
   obsolete unsigned content-addressed selector cannot survive a forced reinstall.
3. SDK beta.85 deletes `sandbox stop`'s duplicate legacy `GET /arm-nosave` path and uses the shared
   tokenized POST client introduced by bridge hardening.

After the final forced install, the installed Revit payload contained exactly one selector:

```text
Pe.Revit.Loader.2C9F8893ED3DB5BB0589F23E558257F9D1334D5C2CF59E89F3747D679926DDED.dll
SHA-256: 2C9F8893ED3DB5BB0589F23E558257F9D1334D5C2CF59E89F3747D679926DDED
Authenticode: Valid
Signer: DBE820C856CAE3A9A06B8F2E95D37071973A470B
```

## Executed gates

| Gate | Result |
| --- | --- |
| SDK loader/CLI/queue harness | Pass: 30 envelope verbs, bridge HTTP security, install mirror regression, and Revit-free queue suite. |
| SDK pack/release preflight | Pass: all 11 beta.87 packages and source revision `6417f4a...`. |
| Fresh consumer restore | Pass: the beta.87 package cache was evicted; tool restore and the complete installer build then resolved the pinned CLI, SDK, and companion packages from the committed feed. Earlier detached-worktree/empty-`NUGET_PACKAGES` proof also passed. |
| Pe.Tools isolated build | Pass: solution compiled with zero errors (existing warnings only); focused post-review `Pe.App` and build-orchestrator builds also passed. |
| Pe.Tools installer pack | Pass: complete 2023-2026 matrix, host, web SPA, Pea, portable install zip, and MSI under beta.87. The final ZIP contains four selectors, no nested build/obj/publish debris, and all ten key payload binaries have valid Authenticode signatures. |
| Install integrity | Pass: final forced apply followed by `install verify`, `ok-5797`. |
| Approval-free startup | Pass: installed sandbox reached SDK-ready without an unsigned-add-in dialog or UI automation. |
| Migrated queue E2E | Pass after review fixes: PID `69836`, session `session-6c8b90c033bf999d`; targeted `settings.module-catalog` returned four modules. Pe.Tools logged queue entry, execution on the Revit thread after 2 ms, and completion after 6 ms. |
| Journal | Pass: descriptor accepted, document tracker started, Pe.App payload started, bridge started; no startup-failure event. |
| Deterministic close | Pass: `sandbox stop` returned `sandbox.no-save-armed` and stopped the exact owned PID cleanly. |
| SDK doctor | Pass: every final check green. |

## Source-mode gap closed in beta.86

The SDK runtime descriptor already authored the original workspace before copying the managed payload
into an immutable generation. Beta.86 validates that absolute source workspace, carries it through
`PePayloadContext.SourceRoot`, and rejects it on installed descriptors. Pe.Tools now consumes that
SDK-owned value and deletes its assembly-path walk; it only accepts `<sourceRoot>\source\pe-tools`
when the host package marker exists.

Fresh source acceptance used sandbox `pe-tools-beta86-source`, generation
`20260714012410659`, Revit PID `63928`, and a newly launched Node PID `83264`. Without approval-dialog
automation, `/host/status` reported `lane=dev`, `bridgeIsConnected=true`, and
`sourceRoot=C:\Users\kaitp\source\repos\Pe.Tools\source\pe-tools`. The public
`revit.context.document-session` operation then returned the open
`source-sandbox-artifact.rfa`. SDK journal startup had no failure event.

## Packaging blocker resolved; remaining release gates

The `0x800700C1` failure was caused by Node 25 injecting the SEA blob into its already-signed Windows
executable. Installer packaging now copies Node to a temporary path, removes that copy's Authenticode
signature, builds the host and Pea SEAs from the unsigned base, then signs and verifies the final
executables. The exact `pack installer` command passes; the portable ZIP is 324,587,470 bytes, the MSI
is validly development-signed, and the key binaries extracted from the ZIP all verify as signed by the
expected development identity.

Installer packaging also clears only the exact isolated `Pe.App` release output used by each year.
This prevents stale `bin`, `obj`, or `publish` trees from leaking into a package without disrupting
unrelated live dev processes.

No public release is authorized by this evidence. A clean-machine/VM install, launch, operation,
upgrade/wipe, and uninstall remains the pre-release gate. Production certificate plus RFC 3161
timestamp proof, remote creation, NuGet publication, and GitHub publication also remain deferred.
