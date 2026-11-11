import { join } from "node:path";
import { Clock, Context, Effect, FiberMap, Layer, Option } from "effect";
import { NodeFileSystem, NodeHttpClient, NodePath } from "@effect/platform-node";
import type { HttpClient } from "effect/http";
import { receiptStampSchema, type ReceiptStamp } from "@pe/agent-contracts";
import { ActionJournal, type AttemptHost, type FiberOwner } from "./action-journal.ts";
import { HostLog } from "./host-log.ts";
import { hostStateDir } from "./host-ownership.ts";

/** The host's one HostLog, opened under the state directory with the runtime Clock. */
export class HostLogService extends Context.Service<HostLogService, HostLog>()("pe/HostLog") {
  static layer(dir: string = hostStateDir()) {
    return Layer.effect(
      HostLogService,
      Effect.gen(function* () {
        const clock = yield* Clock.clockWith(Effect.succeed);
        return new HostLog(join(dir, "log"), () => clock.currentTimeMillisUnsafe());
      }),
    );
  }
}

/**
 * One FiberMap whose fork never replaces a running fiber: a second fork under a running key
 * returns that fiber to join, and its own effect never runs (rule 11: Stop is never an interrupt).
 * The lookup and the fork are one synchronous step, so no other fork can land between them.
 */
const fiberOwner = Effect.fnUntraced(function* () {
  const map = yield* FiberMap.make<string, unknown, unknown>();
  const run = yield* FiberMap.runtime(map)<AttemptHost>();
  const fork: FiberOwner["fork"] = (key, effect) =>
    Option.getOrElse(FiberMap.getUnsafe(map, key), () => run(key, effect));
  return { map, fork } satisfies FiberOwner;
});

/**
 * A journal whose attempts (by action id) and op.cancel sends (by step id) are fibers in two
 * FiberMaps of the caller's scope. Its finalizer joins both before the maps close, so closing the
 * scope never interrupts an attempt.
 */
export const makeActionJournal = Effect.fn("ActionJournal.make")(function* (
  path: string,
  now: () => number,
  stamp?: () => ReceiptStamp | null,
  retain?: number,
) {
  const owners = { attempts: yield* fiberOwner(), cancels: yield* fiberOwner() };
  const journal = new ActionJournal(path, now, stamp, retain, owners);
  // Registered after the maps, so it runs before their interrupting finalizers.
  yield* Effect.addFinalizer(() => Effect.promise(() => journal.close()));
  return journal;
});
/** The services every owned attempt runs with, received once (never per call). */
const attemptHost = (http: Layer.Layer<HttpClient.HttpClient>) =>
  Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, http);

/** The host's one ActionJournal (the receipt journal, not the Work journal). */
export class ActionJournalService extends Context.Service<ActionJournalService, ActionJournal>()(
  "pe/ActionJournal",
) {
  /**
   * Admit the stamp once, open the journal, and append every committed receipt revision to the
   * log in commit order. Provide it outermost: its finalizer joins every attempt fiber and flushes
   * after the bridge and threads close (the log, acquired first, is released after), so a
   * successor runtime never borrows this journal.
   */
  static layer(
    stamp: ReceiptStamp | null,
    dir: string = hostStateDir(),
    http: Layer.Layer<HttpClient.HttpClient> = NodeHttpClient.layerUndici,
  ) {
    return Layer.effect(
      ActionJournalService,
      Effect.gen(function* () {
        const admitted = stamp && receiptStampSchema.parse(stamp);
        if (admitted && admitted.component !== "host")
          return yield* Effect.die(Error("The host receipt owner requires a host stamp"));
        const log = yield* HostLogService;
        const clock = yield* Clock.clockWith(Effect.succeed);
        // Released after the journal's own close, so receipts its join commits still reach the log.
        let stop = () => {};
        yield* Effect.addFinalizer(() => Effect.sync(() => stop()));
        const journal = yield* makeActionJournal(
          join(dir, "partition-operations.json"),
          () => clock.currentTimeMillisUnsafe(),
          () => admitted,
        );
        stop = journal.subscribe({}, (receipt) => log.append({ kind: "receipt", receipt }));
        return journal;
      }),
    ).pipe(Layer.provide(attemptHost(http)));
  }
  /** The same journal over an exact file, without the log: what tests and tools own directly. */
  static at(
    path: string,
    now: () => number,
    stamp: (() => ReceiptStamp | null) | undefined,
    retain: number | undefined,
    http: Layer.Layer<HttpClient.HttpClient>,
  ) {
    return Layer.effect(ActionJournalService, makeActionJournal(path, now, stamp, retain)).pipe(
      Layer.provide(attemptHost(http)),
    );
  }
  /** The journal with its log: both services, for a runtime that owns them. */
  static live(
    stamp: ReceiptStamp | null,
    dir: string = hostStateDir(),
    http?: Layer.Layer<HttpClient.HttpClient>,
  ) {
    return ActionJournalService.layer(stamp, dir, http).pipe(
      Layer.provideMerge(HostLogService.layer(dir)),
    );
  }
}
