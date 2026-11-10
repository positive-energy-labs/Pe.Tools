import { Effect, Layer, Scope, Exit } from "effect";
import { expect, test, vi } from "vite-plus/test";
import type { ActionJournal } from "../src/action-journal.ts";
import { ActionJournalService } from "../src/receipt-services.ts";
import { ReceiptExport } from "../src/receipt-export.ts";

test("a consumer takes a fake journal through a Layer, and no log is required", async () => {
  const recordFact = vi.fn(async () => undefined);
  const close = vi.fn(async () => {});
  const fake = { recordFact, close, subscribe: () => () => {} } as unknown as ActionJournal;
  const scope = await Effect.runPromise(Scope.make());
  const exporter = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* ReceiptExport;
    }).pipe(
      Effect.provide(
        ReceiptExport.layer({ host: null, web: null }).pipe(
          Layer.provide(Layer.succeed(ActionJournalService, fake)),
        ),
      ),
      Scope.provide(scope),
    ),
  );
  expect(exporter.journal).toBe(fake);
  expect(recordFact).toHaveBeenCalledWith({ kind: "diagnostic", code: "identity.unavailable" }, undefined, null, undefined);
  await Effect.runPromise(Scope.close(scope, Exit.void));
  expect(close).toHaveBeenCalled();
});
