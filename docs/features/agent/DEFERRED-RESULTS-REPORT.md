# Deferred transcript results: proposed server contract

## Settled boundary

The root `UNIFICATION.md` decision is: full large tool results load on expansion and original content is preserved. The authoritative copy remains the Mastra thread transcript read by `AgentController.queryThreadMessages`; this design adds no result store and does not use `ActionJournal` receipts. The normal SSE stream is unchanged.

## Caller census

`GET /pe/thread/:threadId` has one production caller: `useThreadStream` fetches it into `ChatState` (`apps/web/src/workbench/provider/thread-stream.ts:38-47`). The body then has these result consumers:

| Consumer | Exact dependency and deferred-result cost |
|---|---|
| `selectToolCalls` | Reads each stored `tool-invocation`'s `toolCallId`, `toolName`, `rawInput ?? args`, `state`, `isError`, `errorText`, and `result`; result also supplies validation-error text and images (`apps/web/src/workbench/chat-state.ts:94-137`). The projection must not replace `result` with a fake JSON value because that would be mistaken for a real result. |
| Transcript `ToolCallPart` | Reads successful result for diagram success, target/revision facts, JSON `out`, images, and the route plug-in payload (`apps/web/src/workbench/moments.tsx:281-386`). Its collapsed large-result row will consume the typed deferred metadata; expansion will call the exact-result endpoint. |
| Trace `ToolCellBody` | Reads completed output or failure text and chooses images instead of JSON (`apps/web/src/workbench/lens/context-strip.tsx:86-115`). It needs the same expand-time fetch, not another state owner. |
| Route chat plug-ins | Read the result wrapper for receipt IDs, returned route documents, schedule workspace IDs, and Family capture IDs (`apps/web/src/workbench/route-chat-plugins/receipt-id.ts:7-17`; `route-chat-plugins/tool-names.tsx:72-97`; `plugins/schedule-grid-chat-plugin.tsx:14-31`; `plugins/family-chat-plugin.tsx:12-20`). UI integration must either expand/fetch before rendering result-derived detail or keep its current fallback; the server must not invent a partial domain result. |
| Tool images | Extracts image metadata and bytes/URLs from the result (`apps/web/src/workbench/chat-state.ts:166-208`). A deferred image result can show only its typed structural summary until expansion fetches the original bytes. |
| Status and errors | Invocation `state`, `isError`, and `errorText` are fields beside `result`; live status, partial output, and shell output come from SSE `activeTools` (`apps/web/src/workbench/chat-state.ts:103-160`). Failed, denied, interrupted, or validation-rejected calls must remain inline so result-carried error meaning is unchanged. |
| Approvals | Permission approvals and `ask_user` suspension payloads come from live display state, not stored result (`apps/web/src/workbench/chat-state.ts:388-410`). This contract does not touch them. |
| Proposal review | Route proposals live in route Work and are read by connected route owners; the transcript result is only a route-call rendering input (`apps/web/src/workbench/trichotomy-reviewer.tsx:47-66`; `route-chat-plugins/tool-names.tsx:72-97`). No proposal or approval state moves into deferred metadata. |

Tests also fetch the thread body directly in `apps/host/tests/chat-flow.scenario.test.ts:201` and `chat-stale-hydration.scenario.test.ts:109-134`; runtime-focused tests should cover the new projection and endpoint without changing those browser scenarios in this lane.

## Implemented wire contract

Add these exported contracts to `packages/agent-contracts/src/thread.ts`:

```ts
export type ToolResultSummary =
  | { kind: "array"; items: number }
  | { kind: "object"; keys: string[]; keyCount: number }
  | { kind: "string"; characters: number }
  | { kind: "scalar" };

export interface DeferredToolResultRef {
  messageId: string;
  toolCallId: string;
  byteSize: number;
  summary: ToolResultSummary;
}

export interface ToolResultResponse {
  messageId: string;
  toolCallId: string;
  result: unknown;
}
```

`ThreadViewState` now has optional top-level `deferredResults: DeferredToolResultRef[]`. For every terminal successful invocation whose serialized `result` exceeds 64 KiB, the HTTP projection omits `toolInvocation.result` and appends one ref. The containing response supplies thread identity; each ref supplies exact `messageId` plus `toolCallId`. No sentinel or extension is added to Mastra's third-party invocation type. `keys` contains at most the first eight own keys; counts and UTF-8 `byteSize` come from `JSON.stringify(result)`. Inline results retain their existing shape and gain no wrapper.

Calls whose invocation state is not `result`, whose `isError` is true, or whose result is the Mastra validation rejection `{ error: true, ... }` remain inline. This preserves stored failure/error meaning. Approval state remains in live display state. Per root's simplification, successful large results are projected uniformly: there is no tool-name, route, artifact, proposal, or image whitelist. The web will fetch the original before rendering expanded result-dependent content. No stored message is rewritten: the projection reuses every unchanged message and part, and copies only the message/content/parts/invocation chain whose result it removes.

`GET /pe/thread/:threadId/tool-result/:messageId/:toolCallId` sits beside the existing thread route. It calls `queryThreadMessages({ threadId })`, matches the exact message and call, and returns `ToolResultResponse` with the untouched original result. It returns 404 when no result exists and 409 when the same call ID occurs more than once in that message. The route opens the same scoped session as `GET /pe/thread/:threadId`; it creates no receipt and reads no second persistence source.

## Owned implementation

- `packages/agent-contracts/src/thread.ts`: typed top-level metadata and endpoint response.
- `packages/runtime/src/thread-state.ts`: copy-on-elision transcript projection, UTF-8 sizing through `Buffer.byteLength`, and exact-result lookup over `queryThreadMessages`.
- `packages/runtime/src/agent-controller-web.ts`: one GET route using the lookup.
- `packages/runtime/tests/thread-state.test.ts`: threshold and UTF-8 size, object/array summaries, unchanged failures, original storage immutability, structural sharing for unchanged messages, exact cross-message identity, missing result, duplicate refusal, and HTTP projection/original-result round trip.

No web edit, stream change, new dependency, result persistence, receipt coupling, or generic message-storage abstraction was added.

## Proof

- `vp test packages/runtime/tests/thread-state.test.ts` - **PASS**, 5 tests.
- Focused formatting, lint, and type checks - **PASS** for the owned contract, runtime, endpoint, and test files.

## Matching web consumer

`apps/web/src/workbench/deferred-result.ts` matches top-level metadata by the existing `ToolCall.parentMessageId` and `ToolCall.id`. Its request includes the current thread plus both identities, aborts through the existing `useHostCall` lifecycle, and rejects any response whose message or call identity differs. It does not request while a transcript call is closed; no cache or second authority was added.

`moments.tsx` loads only while the call is expanded. `lens/context-strip.tsx` loads when the selected trace body mounts. Both show explicit loading/error/retry states and retain the structural summary and byte size. The fetched original drives output JSON, copy behavior, route artifact rendering, and image extraction. Deferred content is never represented as an empty success.

No `chat-state`, provider, chat-shell, stream, or server contract file changed in the web phase. `toolImages` was already exported, so no cross-owner seam is required.

Web proof: from `apps/web`, the focused helper, image, diagram, message-copy, and lens tests pass. Focused `vp check` passes for the helper, transcript, trace, and helper test.
