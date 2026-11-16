import { Context, Effect, Option, Schema } from "effect";
import { ClusterSchema } from "effect/cluster";
import { Activity } from "effect/workflow";
import type { WorkflowInstance } from "effect/workflow/WorkflowEngine";
import type { Statement } from "effect/sql/Statement";
import {
  CommandFailure,
  OwnerOutcome,
  StepRequestId,
} from "../../../../packages/agent-contracts/src/command-authority.ts";
import { fromStandardSchema } from "@pe/host-contracts/contracts";
import { nativeRequestSchema, nativeResponseSchema } from "@pe/host-contracts/decoders";
import type { HostOperationKey, OpRequestOf } from "@pe/host-contracts/operation-types";
import { CommandService } from "./service.ts";
import { json, type CommandRow } from "./model.ts";

/** Registered owner operations, not feature callbacks. Owners enforce key/input/result replay. */
export type StoreOperation =
  | "work.retire"
  | "work.publish"
  | "member.write"
  | "archive.install"
  | "archive.export"
  | "scratch.retire"
  | "acquisition.copy"
  | "acquisition.reserve"
  | "acquisition.remove"
  | "capture.retain"
  | "page.publish"
  | "evidence.export";
export type OutsideOperation =
  | "outward.send"
  | "shell.open"
  | "rhvac.launch"
  | "aps.login"
  | "aps.logout";
export interface KeyedOperation<I, A> {
  readonly key: StoreOperation;
  readonly input: Schema.Codec<I>;
  readonly result: Schema.Codec<A>;
  readonly apply: (key: StepRequestId, input: I) => Effect.Effect<A, CommandFailure>;
}
/** Only a store built over CommandService.sql can create this capability. */
export class SameDatabaseOperation<I, A> {
  readonly #sql;
  private constructor(
    sql: CommandService["Service"]["sql"],
    readonly operation: {
      readonly key: string;
      readonly input: Schema.Codec<I>;
      readonly result: Schema.Codec<A>;
      readonly statement: (
        sql: CommandService["Service"]["sql"],
        key: StepRequestId,
        input: I,
      ) => Statement<object>;
    },
  ) {
    this.#sql = sql;
  }
  static make<I, A>(
    store: CommandService["Service"],
    operation: SameDatabaseOperation<I, A>["operation"],
  ) {
    return new SameDatabaseOperation(store.sql, operation);
  }
  belongsTo(store: CommandService["Service"]) {
    return this.#sql === store.sql;
  }
}
export class NativeCommandOwner extends Context.Service<
  NativeCommandOwner,
  {
    /** Private SDK departure checks Stop, authority, incarnation and connection again at queue departure. */
    depart(
      row: CommandRow,
      key: StepRequestId,
      operation: HostOperationKey,
      request: string,
    ): Effect.Effect<OwnerOutcome, CommandFailure>;
  }
>()("Pe/NativeCommandOwner") {}
export class OutsideCommandOwner extends Context.Service<
  OutsideCommandOwner,
  {
    /** Registration admits OD8 operations only; upload/auth/process launch cannot register as keyed files. */
    invoke(
      row: CommandRow,
      operation: OutsideOperation,
      input: string,
    ): Effect.Effect<OwnerOutcome, CommandFailure>;
  }
>()("Pe/OutsideCommandOwner") {}

/** One cursor per root activation. Feature code traverses sequentially and never authors step IDs. */
export const commandProgram = (row: CommandRow) =>
  Effect.gen(function* () {
    const store = yield* CommandService;
    const ref = { id: row.id };
    let occurrence = 0;
    const fail = (problem: CommandFailure["problem"]) => new CommandFailure({ problem, ref });
    const db = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.mapError((error) => (error instanceof CommandFailure ? error : fail("storage"))),
      );
    const gate = db(store.gate(ref));
    const step = Effect.fn("CommandProgram.step")(function* (
      kind: string,
      key: string,
      input: string,
    ) {
      const index = occurrence++;
      if (index >= store.limits.steps || Buffer.byteLength(input) > store.limits.stepBytes)
        return yield* fail("overload");
      // Input is deliberately absent from the name: divergence refuses, never forks an Activity.
      const name = `step-${index}`;
      const requestId = StepRequestId.make(yield* Activity.idempotencyKey(name));
      const descriptor = json({ kind, key, input, target: row.binding.target });
      const fresh = yield* gate;
      yield* db(
        store.sql.withTransaction(
          Effect.gen(function* () {
            const prior = yield* store.sql<{ descriptor: string; request_id: string }>`
        SELECT descriptor,request_id FROM command_steps WHERE command_id=${row.id} AND occurrence=${index}`;
            if (prior.length) {
              if (prior[0].descriptor !== descriptor || prior[0].request_id !== requestId)
                return yield* fail("incompatible");
            } else {
              yield* db(store.decision(ref, fresh.authorityVersion));
              yield* store.sql`INSERT INTO command_steps(command_id,occurrence,descriptor,request_id)
          VALUES(${row.id},${index},${descriptor},${requestId})`;
            }
          }),
        ),
      );
      return { name, requestId, index };
    });
    const bounded = <A>(schema: Schema.Codec<A>, effect: Effect.Effect<A, CommandFailure>) =>
      Effect.gen(function* () {
        const result = yield* effect;
        const encoded = yield* Schema.encodeEffect(schema)(result).pipe(
          Effect.mapError(() => fail("invalid")),
        );
        if (Buffer.byteLength(json(encoded)) > store.limits.stepBytes)
          return yield* fail("overload");
        return result;
      });
    return {
      native: Effect.fn("CommandProgram.native")(function* <K extends HostOperationKey>(
        operation: K,
        request: OpRequestOf<K>,
      ) {
        // ADR 0048 temporary boundary: generated C# zod authority only; S3 replaces this one projection.
        const inputSchema = fromStandardSchema(
          nativeRequestSchema(operation),
          `${operation}/request`,
        );
        const responseSchema = fromStandardSchema(
          nativeResponseSchema(operation),
          `${operation}/response`,
        );
        const input = yield* Schema.decodeUnknownEffect(inputSchema)(request).pipe(
          Effect.mapError(() => fail("invalid")),
        );
        const { name, requestId } = yield* step("native", operation, json(input));
        const outcome = yield* Activity.make({
          name,
          success: OwnerOutcome,
          error: CommandFailure,
          execute: Effect.gen(function* () {
            yield* gate;
            const owner = yield* NativeCommandOwner;
            return yield* bounded(
              OwnerOutcome,
              owner.depart(row, requestId, operation, json(input)),
            );
          }),
        });
        if (outcome.outcome !== "completed" || outcome.value === null)
          return yield* fail("unavailable");
        const raw = yield* Effect.try({
          try: () => JSON.parse(outcome.value!),
          catch: () => fail("invalid"),
        });
        return yield* Schema.decodeUnknownEffect(responseSchema)(raw).pipe(
          Effect.mapError(() => fail("invalid")),
        );
      }),
      store: <I, A>(operation: KeyedOperation<I, A>, input: I) =>
        Effect.gen(function* () {
          const checked = yield* Schema.encodeEffect(operation.input)(input).pipe(
            Effect.mapError(() => fail("invalid")),
          );
          const { name, requestId } = yield* step("store", operation.key, json(checked));
          return yield* Activity.make({
            name,
            success: operation.result,
            error: CommandFailure,
            execute: Effect.andThen(
              gate,
              bounded(operation.result, operation.apply(requestId, input)),
            ),
          });
        }),
      database: <I, A>(operation: SameDatabaseOperation<I, A>, input: I) =>
        Effect.gen(function* () {
          if (!operation.belongsTo(store)) return yield* fail("invalid");
          const op = operation.operation;
          const encoded = yield* Schema.encodeEffect(op.input)(input).pipe(
            Effect.mapError(() => fail("invalid")),
          );
          const { name, requestId } = yield* step("database", op.key, json(encoded));
          const fresh = yield* gate;
          return yield* Activity.make({
            name,
            success: op.result,
            error: CommandFailure,
            // A typed domain failure must roll back the domain body even though Activity records its failure reply.
            execute: db(
              store.sql.withTransaction(
                Effect.gen(function* () {
                  yield* store.decision(ref, fresh.authorityVersion);
                  const rows = yield* op.statement(store.sql, requestId, input);
                  return yield* bounded(
                    op.result,
                    Schema.decodeUnknownEffect(op.result)(rows).pipe(
                      Effect.mapError(() => fail("invalid")),
                    ),
                  );
                }),
              ),
            ),
          }).annotate(ClusterSchema.WithTransaction, true);
        }),
      outside: Effect.fn("CommandProgram.outside")(function* (
        operation: OutsideOperation,
        input: string,
      ) {
        const { name, index } = yield* step("outside", operation, input);
        const outcome = yield* Activity.make({
          name,
          success: OwnerOutcome,
          error: CommandFailure,
          execute: Effect.gen(function* () {
            // OD8 is never an encompassing engine transaction or nested marker savepoint.
            const tx = yield* Effect.serviceOption(store.sql.transactionService);
            if (Option.isSome(tx)) return yield* fail("invalid");
            yield* gate;
            const changed = yield* db(
              store.sql.withTransaction(store.sql`
            UPDATE command_steps SET started=1 WHERE command_id=${row.id} AND occurrence=${index} AND started=0
            RETURNING request_id`),
            );
            if (!changed.length)
              return {
                outcome: "unknown" as const,
                dispatch: "unknown" as const,
                value: null,
                evidence: "outside-started",
              };
            yield* gate;
            const owner = yield* OutsideCommandOwner;
            return yield* bounded(OwnerOutcome, owner.invoke(row, operation, input));
          }),
        });
        if (outcome.outcome !== "completed") return yield* fail("unavailable");
        return outcome;
      }),
      /** Ordered leaves and repeated operations share the same cursor. No parallel racing counters. */
      forEach: <I, A, E, R>(items: readonly I[], f: (item: I) => Effect.Effect<A, E, R>) =>
        Effect.forEach(items, f, { concurrency: 1 }),
    };
  });
export type CommandProgram = Effect.Success<ReturnType<typeof commandProgram>>;
export type CommandProgramEnvironment =
  | CommandService
  | NativeCommandOwner
  | OutsideCommandOwner
  | WorkflowInstance;
