import { Effect } from "effect";
import type { OpRequestOf } from "@pe/host-contracts/operation-types";
import { CommandFailure } from "../../../../packages/agent-contracts/src/command-authority.ts";
import type { CommandProgram, KeyedOperation } from "./program.ts";

/** Input is the frozen reviewed request; freshness remains an owner's gate, never a rewritten request. */
export const drawRoomsProgram = (program: CommandProgram, input: OpRequestOf<"rooms.draw">) =>
  Effect.gen(function* () {
    let remaining = Infinity;
    while (remaining > 0) {
      const result = yield* program.native("takeoffs.initialize-carrier", { stage: "Rooms" });
      if (result.remaining.length >= remaining)
        return yield* new CommandFailure({ problem: "invalid", ref: null });
      remaining = result.remaining.length;
    }
    return yield* program.native("rooms.draw", input);
  });

/** Canonical file Work must supply this keyed capability before this program can be connected. */
export const applyFamiliesProgram = <A>(
  program: CommandProgram,
  leaves: readonly { request: OpRequestOf<"families.apply">; consumed: string }[],
  retire: KeyedOperation<
    {
      readonly consumed: string;
      readonly successful: readonly string[];
      readonly converged: readonly string[];
    },
    A
  >,
) =>
  program.forEach(leaves, (leaf) =>
    Effect.gen(function* () {
      const result = yield* program.native("families.apply", leaf.request);
      const successful = result.receipts.filter((receipt) => receipt.success);
      yield* program.store(retire, {
        consumed: leaf.consumed,
        successful: successful.map((receipt) => receipt.familyName),
        converged: successful
          .filter((receipt) => receipt.converged)
          .map((receipt) => receipt.familyName),
      });
      return result;
    }),
  );
