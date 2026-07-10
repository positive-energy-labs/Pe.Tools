---
name: pe-live-loop
description: Run and verify Pe.Tools Revit development through the SDK-owned pe-revit live loop. Use for RRD, Rider Hot Reload, AttachedRrd, Revit runtime freshness, active-document prerequisites, exact session stop/restart, approval blockage, or behavior that builds successfully but is stale or failing inside Revit.
---

# Pe live loop

Treat `pe-revit` as the control plane. It owns dev signing, the Rider plugin, isolated compile checks,
deploy, Hot Reload, restart routing, process identity, worktree identity, and session diagnostics.

## Default loop

1. Run from the repository root:

   ```powershell
   dotnet tool run pe-revit live --project source/Pe.App/Pe.App.csproj --year 2025 --json
   ```

2. Follow its verdict. Do not separately build, deploy, open Rider, restart Revit, or manipulate
   manifests unless the command gives a specific recovery step.
3. Verify the changed behavior in the same process. Prefer a callable host/Revit operation; open a
   fixture document first when the operation requires one. Ask for one manual action only when the
   remaining prerequisite is genuinely visual, modal, authentication-bound, or unavailable by shell.
4. Report the strongest evidence actually obtained: compile, `Applied`, fresh loaded path, or changed
   behavior. `Applied` alone proves delta acceptance, not product behavior.

## Read-only diagnosis

Use status first when mutation is not authorized or session ownership is uncertain:

```powershell
dotnet tool run pe-revit live status --project source/Pe.App/Pe.App.csproj --year 2025 --json
```

Use `live doctor --json` only when `live` or status identifies wiring/environment trouble. Read the
session journal path from command output; do not hunt through log directories.

## Branches

- Use `live --restart` for member-shape, WPF/BAML/resource, startup, or other restart-required edits.
- A restart normally returns Revit to Home. Reopen the required fixture through the host's document-open
  operation; this is agent-owned and is not a reason to ask the user to rerun Rider.
- Use `pe-revit test fresh` when a fresh owned process is sufficient; do not disturb RRD.
- Use `pe-revit test attached` only when the existing RRD session itself is under test.
- Use `live approve --pid PID` only when status reports an approval dialog; dev signing is primary.
- Use `live stop --project ... --year ...` for exact owned-session teardown.
- Keep installed-lane verification separate from RRD; use install/verify flows, not `live`.
- For host/web-only edits, use that package's dev loop. Restart Revit only when the in-process add-in
  boundary or SDK verdict requires it.

## Guardrails

- Never infer freshness from an isolated terminal build, an old log line, or a matching filename.
- Never kill Revit/Rider by name or choose a same-year process heuristically.
- Never treat an open document as implicit; check status or use the host's document-open operation.
- Preserve unrelated worktrees and installed sessions. Let exact descriptors and PIDs route actions.
