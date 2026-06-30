import { Schema } from "effect"

export const FeedId = Schema.String.pipe(Schema.brand("FeedId"))
export type FeedId = Schema.Schema.Type<typeof FeedId>

export const FeedMeta = Schema.Struct({
  id: FeedId,
  title: Schema.String,
  cursor: Schema.String
})
export type FeedMeta = Schema.Schema.Type<typeof FeedMeta>

export const FeedItem = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  optimistic: Schema.optional(Schema.Boolean)
})
export type FeedItem = Schema.Schema.Type<typeof FeedItem>

export const LiveEvent = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("sse-progress"), message: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("ws-item"), item: FeedItem }),
  Schema.Struct({ _tag: Schema.Literal("ws-ack"), optimisticId: Schema.String, serverId: Schema.String })
)
export type LiveEvent = Schema.Schema.Type<typeof LiveEvent>
