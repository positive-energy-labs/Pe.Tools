# Host RPC Refactor Runtime Verification Goal

## Overview

Autonomously verify the staged Host RPC refactor end-to-end across the TS-built `Pe.Host.exe`, Effect NDJSON RPC, Revit bridge/session routing, settings document runtime, APS auth, web/tool callers, scripting, and one Pea black-box workflow. Prefer live RRD probing and upper product-surface/e2e proof over new tests. Fix defects as they are found, re-run the relevant proof before moving on, and reserve installed-lane visual/product confirmation for the final collaborative pass with the user.

## Complexity Estimate

- **Size**: Large (6+ files may be touched if defects are found; verification spans C#, TS host, contracts, settings, web/tools, and live Revit).
- **Risk**: High (runtime host ownership, protocol transport, bridge session routing, settings persistence, APS auth, and installed process identity are all affected).
- **Dependencies**:
  - Existing staged refactor must remain the baseline; unrelated unstaged changes should be ignored unless web runtime behavior requires targeted fixes.
  - Live RRD is available with a document open and may be used for AttachedRrd proof.
  - Avoid adding unit tests. Only add tests at absolutely critical protocol/product boundaries or upper product/e2e surfaces.
  - Installed-lane/MSI proof is deferred until the end for collaboration with the user.
  - APS verification may touch auth/token state, but preserve global settings data management/ACC IDs.
  - Use `Documents/Pe.Tools/settings/CmdFFmigrator` as a real settings corpus; at least one valid file is expected.
  - Include at least one Pea black-box workflow that calls multiple tools/ops; defer only if current Pea churn blocks reliable execution.

## Steps

1. **File**: `source/pe-tools/apps/host/HOST_RPC_REFACTOR.md`
   - **Change**: Treat this as the controlling refactor brief. Read it first in the goal loop and append only grave mistakes or durable runtime findings discovered during verification.
   - **Why**: Keeps the branch’s temporary truth synchronized with serious findings without turning normal verification notes into noisy docs.

2. **File**: staged tree / working tree status
   - **Change**: Start by recording staged files and confirming unrelated unstaged work. Do not revert route experiments or unrelated web churn. If web runtime verification requires touching files with unstaged changes, inspect them carefully and make minimal targeted edits only.
   - **Why**: The refactor is staged, but web runtime behavior is in scope and may overlap with user churn.

3. **File**: `docs/BUILD.md`, `AGENTS.md`, live-loop tools/commands
   - **Change**: Choose proof lanes explicitly before each verification: source compile, package/artifact, AttachedRrd, Pea black-box, web dev proxy, and installed lane. Use RRD-safe live-loop workflow; prefer live RRD/AttachedRrd for Revit behavior now that the user has RRD open with a document.
   - **Why**: Prevents conflating compile/package proof with live runtime behavior and protects the user’s RRD session.

4. **File**: `source/pe-tools/apps/host/src/index.ts`, `source/pe-tools/apps/host/src/host-ownership.ts`, `source/Pe.App/Host/TsHostLauncher.cs`
   - **Change**: Verify TS host process identity and ownership behavior: host starts as `Pe.Host.exe`, `/host/status` returns lane/executable/source/process details, matching host is reused, wrong host is rejected, dev takeover of installed host works where safe, identity file lifecycle is sane, and `/admin/shutdown` enforces takeover token.
   - **Why**: Deleting C# `Pe.Host` makes process identity and lane safety a production gate.

5. **File**: `source/pe-tools/apps/host/src/index.ts`, `source/pe-tools/apps/host/src/rpc-server.ts`, `source/pe-tools/packages/host-contracts/src/rpc.ts`
   - **Change**: Verify the Effect NDJSON RPC surface: `/rpc` accepts valid calls, `/host/status` remains plain HTTP, `/api/settings/document/open` is gone, malformed/unknown calls fail with shaped `HostRpcError`, and TS-owned local/admin RPCs route correctly.
   - **Why**: The old HTTP/wrapper stack was removed; the new RPC surface is the central compatibility boundary.

6. **File**: `source/Pe.Dev.Cli/Commands/Codegen/HostContractsProjection.cs`, `source/pe-tools/packages/host-contracts/src/effect/bridge-operation-rpcs.generated.ts`, `source/pe-tools/packages/host-contracts/src/operation-types.ts`, `source/pe-tools/packages/host-contracts/src/rpc.ts`
   - **Change**: Verify generated contract alignment and session scoping: every public bridge op has a direct RPC member, direct bridge payloads contain only operation request data, `host.call` accepts public operation keys, and `callHostRpcMember` sends scoped calls through `x-pe-bridge-session-id` metadata rather than payload fields.
   - **Why**: `bridgeSessionId` moved from operation payload to caller scope; this is a critical protocol boundary.

7. **File**: `source/pe-tools/apps/host/src/bridge.ts`, `source/pe-tools/apps/host/src/dispatch.ts`, live RRD bridge
   - **Change**: In AttachedRrd, verify bridge registration/session behavior: TS-owned session IDs, current-session default routing, selected-session routing where observable, missing-session failures, contract-version health, busy/423 behavior if practical, and at least these live calls: `revit.context.summary`, `revit.catalog.loaded-families.filter-schema`, one catalog/detail op with a request, and `scripting.execute`.
   - **Why**: Connected-Revit acceptance is the main missing proof called out by the refactor brief.

8. **File**: `source/pe-tools/apps/host/src/settings.ts`, `source/pe-tools/apps/host/src/local-ops.ts`, `source/Pe.Revit.SettingsRuntime/Modules/TsSettingsDocumentClient.cs`, `Documents/Pe.Tools/settings/CmdFFmigrator`
   - **Change**: Verify settings runtime behavior through product-like paths: `settings.workspaces`, `settings.tree`, `settings.document.open`, `settings.document.open-with-module`, composition/includes/presets, safe path rejection, missing file not-found behavior, validation with Revit-provided schema JSON, save/version token behavior if safe on temp copies, and C# typed settings reads over TS RPC. Use real `CmdFFmigrator` files for open/validate proof and temp/sandbox files for write/save proof.
   - **Why**: Settings document IO moved from C# route/client/runtime into TS host RPC and is a high-risk data path.

9. **File**: APS auth surfaces in `source/pe-tools/apps/host/src/aps-auth.ts`, C# fallback/auth settings consumers, global settings storage
   - **Change**: Verify APS auth as critical behavior: `aps.auth.status`, `aps.auth.token`, and safe login/logout/status failure paths where possible. Confirm token-store key/scope shape remains compatible. Preserve global settings data management/ACC IDs and avoid destructive edits to those settings.
   - **Why**: The refactor makes TS auth primary while preserving C# fallback; auth drift would break ACC/data-management workflows.

10. **File**: `source/pe-tools/packages/tools/src/shared/host-rpc-caller.ts`, Pea/Peco tool surfaces
    - **Change**: Verify tools call `/rpc` successfully for unscoped local ops, unscoped bridge ops, scoped bridge/session ops, and error cases. Confirm operation search still exposes generated Revit ops and call failures include useful next steps/problem details.
    - **Why**: Pea/tool callers are a primary product surface for the new generated RPC contracts.

11. **File**: `source/pe-tools/apps/web/src/host/client.ts`, `source/pe-tools/apps/web/vite.config.ts`, relevant web runtime files
    - **Change**: Verify web runtime behavior through `/pe-host/rpc`: `host.status`, `bridge.sessions.summary`, settings calls, and one live Revit op. If user route experiments interfere, do not revert them; make only targeted compatibility fixes needed for host RPC behavior.
    - **Why**: Web runtime is explicitly in scope and is a likely consumer of the new RPC surface.

12. **File**: Pea runtime/tooling surfaces
    - **Change**: Run one Pea black-box workflow against the live document that requires multiple tools/ops, such as asking Pea to inspect active Revit context and then query a related catalog/detail/settings fact. Treat Pea’s tool choices, errors, and answer quality as product evidence. If current Pea churn blocks the test, document the blocker and defer without blocking Host RPC acceptance.
    - **Why**: The refactor must support the real agent/operator path, not just low-level probes.

13. **File**: `source/pe-tools`, affected `.csproj`/solution areas, package/build scripts
    - **Change**: Run verification commands after runtime smoke: focused TS checks/tests for `host-contracts`, `apps/host`, tools, and web; C# source compile for affected C# packages; codegen sync check; host pack/package artifact proof. Avoid adding tests unless an uncovered critical protocol/product boundary needs durable e2e coverage.
    - **Why**: Runtime proof catches behavior; source/package proof catches stale generated output and artifact shape regressions.

14. **File**: installed product layout / installer lane
    - **Change**: Defer installed-lane smoke until the end. Prepare a concise handoff for the user to observe installed `Pe.Host.exe` launch, `/host/status` identity, Revit bridge connection, settings read, APS status/token behavior, scripting call, and one web/Pea workflow.
    - **Why**: The user wants to see installed behavior directly before calling the refactor done.

15. **File**: any defect file touched during the goal
    - **Change**: When a defect is found, fix it immediately if the cause is clear, then re-run the smallest meaningful failing proof plus any adjacent upper-surface smoke. For grave mistakes or architectural surprises, update `HOST_RPC_REFACTOR.md` before moving on.
    - **Why**: The goal loop should converge, not only audit; every fix must earn fresh proof.

## Verification

- **AttachedRrd proof**: Live RRD host/bridge connected with current staged/runtime bits; successful real bridge calls for context, schema/catalog, scripting, settings module catalog, and scoped/session-aware calls where observable.
- **Settings proof**: Real `CmdFFmigrator` settings file opens/validates through TS RPC; C# `TsSettingsDocumentClient` successfully reads through `settings.document.open-with-module`; missing/unsafe paths fail correctly; save/version behavior is proved only on temp/sandbox data.
- **APS proof**: Status/token/login-safe paths are exercised without destroying global ACC/data-management settings; token-store compatibility is confirmed.
- **Tools/web proof**: Tools caller and web `/pe-host/rpc` call host/local/session/Revit operations successfully and surface useful errors.
- **Pea proof**: At least one multi-tool Pea black-box workflow runs against the live document, or a clear Pea-churn blocker is documented and deferred.
- **Source/package proof**: Focused TS checks/tests, C# builds/tests for affected packages, codegen sync, and host pack succeed after fixes.
- **Installed-lane proof**: Deferred to final collaboration; user observes installed TS-built `Pe.Host.exe` in action with host identity, Revit bridge, settings, APS, scripting, and web/Pea smoke.

## What Could Go Wrong

- RRD is stale or hot reload cannot prove the changed host/runtime bits; switch to FreshRevitProcess or request one user action to restart/sync RRD.
- Pea internals are temporarily broken by unrelated churn; defer Pea black-box proof while continuing host/tool/web verification.
- APS login/token proof risks modifying user auth state; prefer status/token-safe checks first and preserve global ACC/data-management IDs.
- Real `CmdFFmigrator` settings may include invalid files; identify and use a valid file for positive proof, and treat invalid files as validation behavior only.
- Web route experiments may overlap with host verification; avoid reverting them and make narrow fixes only when needed.
- Installed-lane artifacts may be stale even when source builds pass; final collaborative installed proof remains mandatory before production-ready claims.