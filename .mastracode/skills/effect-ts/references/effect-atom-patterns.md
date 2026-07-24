# effect-atom frontend patterns

Use `@effect-atom/atom-react` when React state should be backed by Effect computations and composed as atoms.

## Patterns to prefer

- **Input atoms**: small writable atoms for selected entity IDs, filters, auth/session, and user intent.
- **Dependent async atoms**: derive async state from input atoms; invalidate or refresh when upstream input changes.
- **Resource atoms**: wrap websocket, EventSource, BroadcastChannel, timers, and subscriptions with acquire/release cleanup.
- **Event atoms**: normalize push messages into append-only event atoms, then derive view models from those events.
- **Optimistic action atoms**: represent submit actions as effects, immediately update local projection, then reconcile with server events.

## Chained async state shape

1. `selectedFeedIdAtom` controls which feed is active.
2. `feedMetaAtom` fetches metadata for the selected feed.
3. `feedItemsAtom` depends on metadata and fetches a cursor/page.
4. `liveEventsAtom` subscribes to websocket/SSE only after metadata is loaded.
5. `timelineAtom` merges initial items, SSE progress, websocket patches, and optimistic draft state.

## Websocket + SSE guidance

- Websocket is best for bidirectional commands and low-latency patches.
- SSE is best for server-owned progress streams, notifications, and replayable event logs.
- Keep both scoped; close them when the atom scope is released or feed selection changes.
- Decode all inbound messages with `Schema` before changing state.
