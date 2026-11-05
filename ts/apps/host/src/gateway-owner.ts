import { join } from "node:path";
import { Clock, Context, Effect, Layer } from "effect";
import { ActionJournal } from "./action-journal.ts";
import { HostLog } from "./host-log.ts";
import { hostOwnership } from "./host-ownership.ts";
import { receiptStampSchema, type ReceiptStamp } from "@pe/agent-contracts";

const stateDir = () => join(hostOwnership.rootPath, "state", "host", hostOwnership.serviceName);

/** The host's one ActionJournal and the HostLog that mirrors it, owned by one host runtime's scope. */
export class HostReceipts extends Context.Service<
  HostReceipts,
  { readonly journal: ActionJournal; readonly log: HostLog }
>()("pe/HostReceipts") {
  /**
   * Admit the stamp once, open the journal and log, and append every committed receipt revision
   * to the log in commit order. Provide it outermost: its finalizer joins admitted commands and
   * flushes after the bridge and threads close, so a successor runtime never borrows this journal.
   */
  static layer(stamp: ReceiptStamp | null, dir: string = stateDir()) {
    return Layer.effect(
      HostReceipts,
      Effect.gen(function* () {
        const admitted = stamp && receiptStampSchema.parse(stamp);
        if (admitted && admitted.component !== "host")
          return yield* Effect.die(Error("The host receipt owner requires a host stamp"));
        const clock = yield* Clock.clockWith(Effect.succeed);
        const now = () => clock.currentTimeMillisUnsafe();
        const log = new HostLog(join(dir, "log"), now);
        const journal = new ActionJournal(join(dir, "partition-operations.json"), now, () => admitted);
        const stop = journal.subscribe({}, (receipt) => log.append({ kind: "receipt", receipt }));
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            await journal.close();
            stop();
          }),
        );
        return { journal, log };
      }),
    );
  }
}
