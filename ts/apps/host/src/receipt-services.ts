import { join } from "node:path";
import { Clock, Context, Effect, FiberMap, Layer } from "effect";
import { NodeFileSystem, NodeHttpClient, NodePath } from "@effect/platform-node";
import type { HttpClient } from "effect/http";
import { receiptStampSchema, type ReceiptStamp } from "@pe/agent-contracts";
import { ActionJournal, type AttemptHost } from "./action-journal.ts";
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
 * A journal whose admitted attempts are fibers in a FiberMap of the caller's scope. Closing that
 * scope without `close()` interrupts them; the service Layer joins them first.
 */
export const makeActionJournal = Effect.fn("ActionJournal.make")(function* (
  path: string,
  now: () => number,
  stamp?: () => ReceiptStamp | null,
  retain?: number,
) {
  const map = yield* FiberMap.make<string, unknown, unknown>();
  const fork = yield* FiberMap.runtime(map)<AttemptHost>();
  return new ActionJournal(path, now, stamp, retain, { map, fork });
});

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
        const journal = yield* makeActionJournal(
          join(dir, "partition-operations.json"),
          () => clock.currentTimeMillisUnsafe(),
          () => admitted,
        );
        const stop = journal.subscribe({}, (receipt) => log.append({ kind: "receipt", receipt }));
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            await journal.close();
            stop();
          }),
        );
        return journal;
      }),
      // The services every owned attempt runs with, received once here (never per call).
    ).pipe(Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, http)));
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
