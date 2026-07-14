# ADR 0002 — A sandbox session shares the one installed host

Date: 2026-07-14. Status: accepted, implemented.

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
