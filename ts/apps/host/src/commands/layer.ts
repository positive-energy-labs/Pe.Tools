import { NodeCrypto } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Effect, Layer } from "effect";
import { ClusterWorkflowEngine, SingleRunner } from "effect/cluster";
import { SqlClient } from "effect/sql";
import { engineCustody } from "./custody.ts";
import { commandLimits } from "./model.ts";
import { CommandFailure } from "../../../../packages/agent-contracts/src/command-authority.ts";
import {
  commandInterpreter,
  commandServiceLayer,
  initializeCommandTables,
  type FoundationOptions,
} from "./service.ts";

/** Replacement graph: custody/header before any replay-capable layer, one SqlClient throughout. */
export const commandFoundationLayer = <R>(
  directory: string,
  options: Omit<FoundationOptions, "generation">,
  run: Parameters<typeof commandInterpreter<R>>[0],
  operation: "open" | "provision" = "open",
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const custody = yield* engineCustody(directory, operation);
      const client = SqliteClient.layer({ filename: custody.filename, busyTimeout: "100 millis" });
      const initialized = Layer.effectDiscard(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const limits = options.limits ?? commandLimits;
          if (Object.values(limits).some((limit) => !Number.isSafeInteger(limit) || limit <= 0))
            return yield* new CommandFailure({ problem: "invalid", ref: null });
          const [page] = yield* sql<{ page_size: number }>`PRAGMA page_size`;
          if (page.page_size !== 4096)
            return yield* new CommandFailure({ problem: "incompatible", ref: null });
          yield* sql`PRAGMA synchronous=FULL`;
          yield* sql.unsafe(`PRAGMA max_page_count=${Math.floor(limits.databaseBytes / 4096)}`);
          // This bounds a checkpointed suffix, not the size of a WAL held by an active transaction.
          yield* sql.unsafe(`PRAGMA journal_size_limit=${limits.walBytes}`);
          if (operation === "provision") yield* sql.withTransaction(initializeCommandTables);
          // Missing/incompatible schema refuses before constructing the engine.
          yield* sql`SELECT id,body,state,stopped,result,problem,admission_order,reserved_bytes,parent,stop_with_parent FROM command_authority LIMIT 0`;
          yield* sql`SELECT command_id,occurrence,descriptor,request_id,started FROM command_steps LIMIT 0`;
          yield* sql`SELECT claim,command_id FROM command_claims LIMIT 0`;
          yield* sql`SELECT command_id,body FROM command_plans LIMIT 0`;
        }),
      ).pipe(Layer.provideMerge(client));
      const engine = ClusterWorkflowEngine.layer.pipe(
        Layer.provideMerge(
          SingleRunner.layer({
            runnerStorage: "sql",
            shardingConfig: {
              entityMailboxCapacity: 64,
              entityTerminationTimeout: "5 seconds",
            },
          }).pipe(Layer.provide(NodeCrypto.layer)),
        ),
        Layer.provideMerge(initialized),
      );
      const service = commandServiceLayer({ ...options, generation: custody.generation }).pipe(
        Layer.provideMerge(engine),
      );
      return commandInterpreter(run).pipe(Layer.provideMerge(service));
    }),
  );
