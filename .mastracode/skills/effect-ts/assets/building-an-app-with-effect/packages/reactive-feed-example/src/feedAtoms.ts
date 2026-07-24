import { Atom } from "@effect-atom/atom-react"
import { Effect, Schema, Stream } from "effect"
import { FeedId, FeedItem, FeedMeta, LiveEvent } from "./feedModel"
import { sseEvents, websocketEvents } from "./liveStreams"

const getJson = <A>(url: string, schema: Schema.Schema<A>) =>
  Effect.tryPromise(() => fetch(url).then((r) => r.json())).pipe(Effect.flatMap(Schema.decodeUnknown(schema)))

export const selectedFeedIdAtom = Atom.make<FeedId>("general" as FeedId)

export const feedMetaAtom = Atom.make(
  Effect.fnUntraced(function* (get: Atom.Context) {
    const feedId = get(selectedFeedIdAtom)
    return yield* getJson(`/api/feeds/${feedId}/meta`, FeedMeta)
  })
)

export const feedItemsAtom = Atom.make(
  Effect.fnUntraced(function* (get: Atom.Context) {
    const meta = yield* get.result(feedMetaAtom)
    return yield* getJson(`/api/feeds/${meta.id}/items?cursor=${meta.cursor}`, Schema.Array(FeedItem))
  })
)

export const liveFeedEventsAtom = Atom.make(
  Effect.fnUntraced(function* (get: Atom.Context) {
    const meta = yield* get.result(feedMetaAtom)
    return Stream.merge(
      websocketEvents(`/ws/feeds/${meta.id}`),
      sseEvents(`/api/feeds/${meta.id}/events`)
    )
  }).pipe(Stream.unwrap)
)

export const optimisticDraftsAtom = Atom.make<Array<FeedItem>>([])

export const timelineAtom = Atom.make((get) => {
  const initial = get.result(feedItemsAtom).pipe(Effect.runSync) ?? []
  const drafts = get(optimisticDraftsAtom)
  const latest = get.result(liveFeedEventsAtom).pipe(Effect.option, Effect.runSync)
  const events = latest._tag === "Some" ? [latest.value] : []

  return events.reduce<Array<FeedItem>>((items, event: LiveEvent) => {
    switch (event._tag) {
      case "ws-item": return [event.item, ...items]
      case "ws-ack": return items.map((item) => item.id === event.optimisticId ? { ...item, id: event.serverId, optimistic: false } : item)
      case "sse-progress": return items
    }
  }, [...drafts, ...initial])
})
