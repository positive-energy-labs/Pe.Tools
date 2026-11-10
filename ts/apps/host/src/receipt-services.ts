import { join } from "node:path";
import { Clock, Context, Effect, Layer } from "effect";
import { receiptStampSchema, type ReceiptStamp } from "@pe/agent-contracts";
import { ActionJournal } from "./action-journal.ts";
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

/** The host's one ActionJournal (the receipt journal, not the Work journal). */
export class ActionJournalService extends Context.Service<ActionJournalService, ActionJournal>()(
  "pe/ActionJournal",
) {
  /**
   * Admit the stamp once, open the journal, and append every committed receipt revision to the
   * log in commit order. Provide it outermost: its finalizer joins admitted commands and flushes
   * after the bridge and threads close (the log, acquired first, is released after), so a
   * successor runtime never borrows this journal.
   */
  static layer(stamp: ReceiptStamp | null, dir: string = hostStateDir()) {
    return Layer.effect(
      ActionJournalService,
      Effect.gen(function* () {
        const admitted = stamp && receiptStampSchema.parse(stamp);
        if (admitted && admitted.component !== "host")
          return yield* Effect.die(Error("The host receipt owner requires a host stamp"));
        const log = yield* HostLogService;
        const clock = yield* Clock.clockWith(Effect.succeed);
        const journal = new ActionJournal(
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
    );
  }
  /** The journal with its log: both services, for a runtime that owns them. */
  static live(stamp: ReceiptStamp | null, dir: string = hostStateDir()) {
    return ActionJournalService.layer(stamp, dir).pipe(Layer.provideMerge(HostLogService.layer(dir)));
  }
}
