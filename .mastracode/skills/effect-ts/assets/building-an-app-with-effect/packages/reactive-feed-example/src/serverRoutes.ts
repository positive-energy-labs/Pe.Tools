import { Effect, Queue, Stream } from "effect"

export const sseResponse = (events: Stream.Stream<unknown>) =>
  events.pipe(
    Stream.map((event) => `data: ${JSON.stringify(event)}\n\n`),
    Stream.encodeText
  )

export const websocketSession = Effect.gen(function* () {
  const outbound = yield* Queue.unbounded<unknown>()
  return { outbound }
})
