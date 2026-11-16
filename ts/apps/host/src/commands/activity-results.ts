import { Context, Effect, Exit, Option, Schema } from "effect";
import {
  ClusterSchema,
  EntityAddress,
  EntityId,
  EntityType,
  MessageStorage,
  Sharding,
} from "effect/cluster";
import { SqlClient } from "effect/sql";
import { Workflow } from "effect/workflow";
import {
  CommandFailure,
  StepRequestId,
} from "../../../../packages/agent-contracts/src/command-authority.ts";
import type { CommandRow } from "./model.ts";

/** Read through the pinned engine's storage API, never a second writable outcome journal. */
export const makeActivityResults = (workflow: Workflow.AnyWithProps) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const storage = yield* MessageStorage.MessageStorage;
    const sharding = yield* Sharding.Sharding;
    return Effect.fn("CommandService.activityResult")(function* <A>(
      row: CommandRow,
      occurrence: number,
      success: Schema.Codec<A>,
    ) {
      const ref = { id: row.id };
      const failed = () => new CommandFailure({ problem: "storage", ref });
      const rows =
        yield* sql`SELECT occurrence,request_id FROM command_steps WHERE command_id=${row.id} AND occurrence=${occurrence}`;
      if (rows.length !== 1) return yield* failed();
      const step = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ occurrence: Schema.Int, request_id: StepRequestId }),
      )(rows[0]).pipe(Effect.mapError(failed));
      const entityId = EntityId.make(row.execution);
      const shardGroup = Context.get(workflow.annotations, ClusterSchema.ShardGroup)(entityId);
      const address = EntityAddress.make({
        entityId,
        entityType: EntityType.make(`Workflow/${row.tag}`),
        shardId: sharding.getShardId(entityId, shardGroup),
      });
      // Constructors do not expose Activity.retry or override CurrentAttempt. Its default is 1 at 4.0.2.
      const attempt = 1;
      const request = yield* storage
        .requestIdForPrimaryKey({ address, tag: "activity", id: `step-${occurrence}/${attempt}` })
        .pipe(Effect.mapError(failed));
      const identity = { occurrence: step.occurrence, requestId: step.request_id, attempt };
      if (Option.isNone(request))
        return { identity, result: Option.none<Exit.Exit<A, CommandFailure>>() };
      const replies = yield* storage
        .repliesForUnfiltered([request.value])
        .pipe(Effect.mapError(failed));
      const last = replies.at(-1);
      if (!last) return { identity, result: Option.none<Exit.Exit<A, CommandFailure>>() };
      if (last._tag !== "WithExit") return yield* failed();
      const codec = Schema.toCodecJson(
        Schema.Exit(
          Workflow.Result({ success, error: CommandFailure }),
          Schema.Never,
          Schema.Defect(),
        ),
      );
      const outer = yield* Schema.decodeUnknownEffect(codec)(last.exit).pipe(
        Effect.mapError(failed),
      );
      if (Exit.isFailure(outer)) return yield* failed();
      return {
        identity,
        result:
          outer.value._tag === "Complete"
            ? Option.some(outer.value.exit)
            : Option.none<Exit.Exit<A, CommandFailure>>(),
      };
    });
  });
