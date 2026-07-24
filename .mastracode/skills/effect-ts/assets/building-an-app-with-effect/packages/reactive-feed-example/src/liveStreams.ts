import { Effect, Queue, Schema, Scope, Stream } from "effect"
import { LiveEvent } from "./feedModel"

const decodeLiveEvent = Schema.decodeUnknown(LiveEvent)

export const websocketEvents = (url: string) =>
  Stream.unwrapScoped(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<LiveEvent>()
      const socket = new WebSocket(url)

      socket.addEventListener("message", (event) => {
        Effect.runPromise(decodeLiveEvent(JSON.parse(String(event.data))).pipe(Effect.andThen(Queue.offer(queue))))
      })

      yield* Scope.addFinalizer(() => Effect.sync(() => socket.close()))
      return Stream.fromQueue(queue)
    })
  )

export const sseEvents = (url: string) =>
  Stream.unwrapScoped(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<LiveEvent>()
      const source = new EventSource(url)

      source.addEventListener("message", (event) => {
        Effect.runPromise(decodeLiveEvent(JSON.parse(event.data)).pipe(Effect.andThen(Queue.offer(queue))))
      })

      yield* Scope.addFinalizer(() => Effect.sync(() => source.close()))
      return Stream.fromQueue(queue)
    })
  )
