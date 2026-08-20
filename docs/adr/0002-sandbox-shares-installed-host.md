# ADR 0002 — A sandbox session shares the one installed host

Date: 2026-07-14. Status: superseded by [ADR 0008](0008-session-custody-and-test-rungs.md) on
2026-08-20. Pe.Revit.Sdk beta.121 deleted the `sandbox` lane, so the mapping question this ADR
answered no longer arises: lane is payload source (`dev` | `installed`) and a controlled session on
the installed lane runs the installed payload by construction. The record below is what this repo
decided in July 2026.

## Context

A `lane=sandbox` session descriptor is a proving harness for installed behavior. It must talk to
the *actual* installed host, port, and service file, not a private incarnation — otherwise a
sandbox proving "installed" would prove a different runtime than the one users get.

## Decision

A `lane=sandbox` descriptor continues to yield `ProductRuntimeLane.Installed`: the sandbox Pe.App
**shares** the one installed host/port/service-file by design. We deliberately do **not** add a
`Sandbox` value to `ProductRuntimeLane` — that enum answers "which binaries/services am I using",
and for a sandbox session the honest answer is "installed". The bridge still attributes the session
as `sandbox` where session identity matters. `BridgeSessionIdentity` emits one `Information` log
when it reads a sandbox descriptor so the intentional collapse-to-installed is observable rather
than silent (IPC-SEAM-SPEC D6).

## Consequences

- Sandbox proving is honest: what a sandbox session exercises is the installed host, port, and service
  file users actually get. There is no second runtime that could pass while the real one fails.
- A sandbox session's lifecycle is coupled to installed state. If the installed receipts are stale or
  drifted, sandbox runs fail on selection before they ever reach product behavior — repair the install
  rather than debugging the sandbox.
- Only one session can hold the installed host at a time, so sandbox supervisors and host takeover
  contend for the same claim. Eviction rules are load-bearing, not incidental.
- Lane is not identity: consumers asking "which binaries am I running" get `Installed` and must read the
  bridge's session attribution (`sandbox`) when they need to distinguish the two.

