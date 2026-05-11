# Pe.Shared.HostContracts

## Scope

Owns durable host-facing contracts: HTTP route constants, host operation definitions, request/response/problem DTOs, the hand-maintained .NET client plus the generated TypeScript client slice, scripting contracts, settings storage DTOs, and protocol versions.

## Purpose

`Pe.Shared.HostContracts` is the public contract package for callers that talk to `Pe.Host`. It defines the stable shape of host HTTP behavior and websocket bridge mechanics. Besides the small bridge protocol convenience helper, this package knows nothing of host implementation details.

## Critical Entry Points

- `Protocol/HttpRoutes.cs` and protocol constants - route and contract-version authority.
- `Operations/` - typed host operation definitions and the public `pea` client catalog slice.
- `Scripting/` - scripting HTTP and bridge operation DTOs.
- `SettingsStorage/` - settings storage DTO contracts.
- `PeHostClient.cs` - hand-maintained .NET host client that repo callers and scripts can consume directly.
- `HostRuntimeDefaults.cs` - fixed runtime/operator defaults for host probe/startup/bridge timing.
- `HostReachability.cs` - shared probe/session-summary reachability helpers.
- `Bridge/BridgeContracts.cs` - bridge request/response/event frame contracts.
- `Bridge/BridgeTransportSession.cs` - fragmented WebSocket text-frame reassembly, bounded frame reads, and serialized writes.
- `Bridge/HostProbeCompatibility.cs` - compatibility check tying host probe identity, Host protocol version, bridge protocol version, and bridge route together.

## Living Memory

- Do not recreate a separate host environment package. Product/process identity lives in `Pe.Shared.Product`; host HTTP + WS contract behavior lives here;.
- Product names, executable names, env var names, default local URLs, and filesystem roots come from `Pe.Shared.Product`.
- Keep contracts stable and explicit. Avoid adding host implementation services or Revit runtime dependencies here.
