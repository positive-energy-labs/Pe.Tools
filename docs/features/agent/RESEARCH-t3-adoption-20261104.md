# T3 as Pea's agent bedrock

Assessment date: 2026-11-04. Pe.Tools source at `be0e94dcb8ea73e13e3684e911a0fb30772a652d`; T3 source at `e68e19d605485db6ef31b2033f67a9d07634fc2b`. Research only. No product code, installed configuration, provider login, or Revit session changed.

## Judgment

T3 is a credible owner for the generic agent workbench that Pe.Tools should stop building. Its direction supports that architectural choice. The inspected source does not support the stronger claim that a supported T3 orchestration SDK is available or imminent.

The best next experiment is a T3 environment running beside Pe.Host, with Pea's Revit tools exposed through MCP. Keep T3's backend whole and use its own thread contracts. A custom Pe UI can then become another client of that environment. This is a proposed integration, not a demonstrated one. Extracting only provider-core would leave Pe.Tools maintaining the orchestration, delegation, persistence, and UI features that motivated this investigation.

Two independent source reports support this account: [core and history](RESEARCH-t3-adoption-core-history-20261104.md) and [Pea dependency census](RESEARCH-t3-adoption-pea-census-20261104.md). Their recommendations are testimony. The main session directly re-read package manifests, runtime composition, delegation admission, Pea MCP admission, guest sharing, client commands, and authentication documentation. It independently repeated the three manifest counts.

## What changed over the requested month

These are UTC date cutoffs on fetched main ancestry, not release comparisons or evidence that installed builds contain every change.

| Snapshot | Source observation | Meaning for Pe.Tools |
| --- | --- | --- |
| October 4, [efecd3cf](https://github.com/pingdotgg/t3code/commit/efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448) | 7 immediate packages; all private and all have exports | Shared workspace modules already existed. An exports map alone did not establish an external SDK. |
| October 21, [b5a226e4](https://github.com/pingdotgg/t3code/commit/b5a226e49c52ecab4ddc2d678a7012d97e651a6a) | 24 packages; all private. Provider-core/testing and separate provider packages landed October 8 | The strongest library-oriented movement happened before the last two weeks: explicit reusable provider boundaries. |
| November 4 fetched head, [e68e19d6](https://github.com/pingdotgg/t3code/commit/e68e19d605485db6ef31b2033f67a9d07634fc2b) | 30 packages; all private. Production orchestration and delegation remain in apps/server | Modularity continued, but application extraction has not become a supported orchestration package. |

Method and exact timestamps are in the [core report](RESEARCH-t3-adoption-core-history-20261104.md#revisions-and-census). These counts measure package boundaries, not quality, velocity, or reusable percentage.

Specific later developments matter more than the counts. [Guest sharing landed October 24](https://github.com/pingdotgg/t3code/commit/fb76594d7b). [Agent-assisted environment linking landed October 27](https://github.com/pingdotgg/t3code/commit/8b14660b27). [Organization-wide managed policy landed November 1](https://github.com/pingdotgg/t3code/commit/d897d3f3f0). Delegation also received [option inheritance fixes](https://github.com/pingdotgg/t3code/commit/4c9189275a) and [project provider filtering](https://github.com/pingdotgg/t3code/commit/aeaf3633b5). These are observed changes toward a multi-client, multi-environment agent control product. They are not evidence of a promised SDK.

## What we can stop owning

| Responsibility | Proposed disposition | Evidence and boundary |
| --- | --- | --- |
| Provider launch, account/model configuration, protocol normalization | Replace with T3 | Pea currently owns these in [providers.ts](../../../ts/apps/host/src/harness/providers.ts) and [threads.ts](../../../ts/apps/host/src/harness/threads.ts). T3 has [ProviderDriver](../../../.explore/t3code/packages/provider-core/src/server/driver.ts) and [ProviderAdapter](../../../.explore/t3code/packages/provider-core/src/server/ProviderAdapter.ts). T3 still uses ACP for some providers. We can remove our ACP responsibility without requiring ACP to disappear upstream. |
| Generic thread/run lifecycle, queueing, provider requests, transcript projection, delegation, scheduling | Replace with the T3 environment | These need the [production runtime](../../../.explore/t3code/apps/server/src/orchestration-v2/runtimeLayer.ts:357), not only a provider adapter. [OrchestratorMcpService](../../../.explore/t3code/apps/server/src/mcp/OrchestratorMcpService.ts:2339) checks active parent ownership, resolves provider policy, and records delegation. |
| Chat controls and transport contracts | Adopt T3 types and client runtime | [Client commands](../../../.explore/t3code/packages/client-runtime/src/operations/commands.ts) and [connection exports](../../../.explore/t3code/packages/client-runtime/src/connection/index.ts) are real seams. Pea's [harness client](../../../ts/apps/web/src/workbench/provider/harness-client.ts) and ACP-shaped [harness-thread contract](../../../ts/packages/agent-contracts/src/harness-thread.ts) would be rewritten or removed. Do not normalize T3 back into the old ACP event model. |
| Revit tools, operation catalog, scripting, document identity and freshness | Retain | [Pea MCP exports](../../../ts/packages/mcps/src/index.ts) already isolate much of this product surface. T3 can call it; T3 cannot supply its domain meaning. |
| Work, shared human/agent edits, semantic admission, action recovery and receipts | Retain the semantics; adapt the thread link | [RouteWorkspace](../../../ts/packages/runtime/src/route-workspace.ts), [semantic-actions.ts](../../../ts/packages/agent-contracts/src/semantic-actions.ts), and [thread history joins](../../../ts/apps/host/src/thread-history.ts) are product obligations. Their current placement under agent-contracts does not make them generic chat contracts. |
| Pod packaging, dependency versions, import/export and installation | Retain | [pod-transfer.ts](../../../ts/apps/host/src/pod-transfer.ts) performs product-specific freezing and consent. Conversation sharing does not replace executable distribution. |

The Pea report's scope counts are neighborhoods, not deletion estimates. A source file can mix replaceable transport and necessary authority. No honest percentage or schedule follows from these counts without an integration spike.

## Comparable UI wiring

There are three different adoption shapes.

1. **T3 product plus Pea MCP.** Lowest integration burden and most upstream feature reuse. T3 owns the chat UI; Pe.Tools retains its domain surfaces. [MCP Apps support](../../../.explore/t3code/docs/user/html-renders.md:11) gives a possible in-thread home for interactive Revit tools, but current documentation limits support to Codex and imposes lifecycle/approval constraints. It is not proven equivalent to the full Pe workbench.
2. **T3 environment plus custom Pe UI.** Best fit for comparable existing UI integration. Consume T3 commands, snapshots and streams through one narrow adapter. Keep Pe Work and Revit receipts as separate authorities keyed to T3 thread/run identities. Reuse client-runtime where practical. It is private source today, so pinning and update compatibility are our responsibility.
3. **Embedded or extracted T3 library.** Technically plausible from source boundaries, but highest ownership risk today. [runtimeLayer.ts](../../../.explore/t3code/apps/server/src/orchestration-v2/runtimeLayer.ts) imports persistence, Git, projects, provider services, scheduling, secrets and guest sharing from the application. Removing that context is an extraction project. A pinned application fork would be more honest than calling it a library dependency.

The important reduction is one owner for agent state. Do not retain a writable Pea transcript alongside a writable T3 transcript. Pea can keep product receipt joins without owning agent execution state.

## Authentication and sharing

T3 offers several separate things. [Outside-agent OAuth](../../../.explore/t3code/docs/user/outside-agents.md) controls access to an environment. Provider accounts remain provider-specific. [T3 Connect](../../../.explore/t3code/docs/internals/t3-connect.md) uses Clerk, relay authorization, and managed tunnels. [Connect setup](../../../.explore/t3code/docs/operations/connect-setup.md) says a fresh clone has Connect disabled and documents production versus separate-deployment configuration. No source observation grants Pe.Tools an upstream hosted-service support commitment. Reusing hosted T3 and self-hosting its relay have different costs.

[Guest links](../../../.explore/t3code/docs/user/guest-links.md) are a concrete sharing candidate: beta, Connect required, host online, one browser, 24-hour expiry, owner-approved guest messages. The [GuestShareService](../../../.explore/t3code/apps/server/src/guest/GuestShareService.ts) implements guest commands and thread projections. This covers supervised conversation sharing. It does not establish shared editable Work, Pod community distribution, organization entitlement, or APS authorization parity. [Autodesk auth](../../../ts/apps/host/src/aps-auth.ts:19) remains a separate integration.

## The hard integration edge

Pea's [stdio MCP](../../../ts/packages/mcps/src/stdio.ts:10) binds an internal child using PE_CONTEXT; its [HTTP MCP admission](../../../ts/apps/host/src/mcp-route.ts:77) explicitly refuses to treat a thread-id header as authority. An ordinary external T3 caller gets an external identity, not automatically Pea's thread-bound native consent.

Therefore the central adapter must establish authenticated T3 thread/run/child identity, map it to Pe host-issued authority, and revoke it on stop or completion. T3 permission ceilings and Pea Revit consent are different controls. A delegated child must not inherit an unrestricted reusable bearer merely because its parent has access. Restart, delayed completion, wrong-document refusal, and remote-environment routing must preserve this distinction.

Another migration trap is retention. T3's [architecture note](../../../.explore/t3code/docs/internals/overview.md:47) says persisted projections become authoritative and the event log is pruned to roughly a day of reconnect history. It is not an indefinitely replayable audit archive. Keep Pe's domain receipts independently; do not reconstruct Revit evidence from an assumed permanent T3 event log.

## Forecast and next proof

Inference: continued investment in shared clients, provider packages, remote environments, delegation and managed policy makes T3 increasingly suitable as a generic agent platform. The internal interfaces make future extraction cheaper. Confidence is higher in continued platform capability than in any external SDK release. More platform capability can also increase extraction cost if orchestration remains application-owned.

Do not wait for an imagined SDK and do not start a full replacement now. First prove shape 2 with one provider, one thread and one existing Revit capability. The proof must include streaming and reconnect, permission/question response, restart/resume, cancellation, one child delegation, a linked Work edit, a host-owned receipt, and refusal of stale or foreign document authority. An initial no-Revit client spike can validate transport and contracts; the authority claims require a named controlled Revit lane later. Existing history needs an explicit choice between migration and read-only archive rather than assumed lossless import.

The go criterion is whether this slice allows deleting Pea's generic orchestration ownership while preserving product authority, without accumulating a parallel event model or a large fork. A supported upstream server/client contract would strengthen the case; the absence of a published library need not block a successful whole-server integration.

PROVEN[source inspection, linked Git revisions and independent manifest census, e68e19d605485db6ef31b2033f67a9d07634fc2b / be0e94dcb8ea73e13e3684e911a0fb30772a652d, 2026-11-04]. UNPROVEN[external consumption, integration behavior, deletion amount, deployment cost, hosted-service commitment and SDK roadmap]. Source evidence establishes code structure only. No build or Revit behavior proof was attempted.
