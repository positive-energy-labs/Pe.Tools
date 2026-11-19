/**
 * Command handles (ADR 0042): the one minted name for a command, read from the generated table.
 * Apart from `handle.ts` because a Pod bundle reaches this module through `route()`: it imports the
 * generated table and types only, never the native catalog or a schema. `handle.ts` re-exports it.
 */
import type { z } from "zod";
import type { OpKey, OpRequestOf, OpResponseOf } from "@pe/host-contracts/operation-types";
import type { PeRouteInput, PeRouteOutput } from "@pe/host-contracts/pe-api";
import { commandTable, type CommandKey } from "./command-axes.ts";
import type { httpRoutes } from "./pe-api.ts";
import type { hostActions } from "./semantic-actions.ts";

export type Effect = "Read" | "TransactRead" | "SessionWrite" | "WorkWrite" | "ModelWrite";
export const minted: unique symbol = Symbol("handle");
export interface CommandHandle<
  K extends string = string,
  I = unknown,
  O = unknown,
  E extends Effect = Effect,
> {
  readonly [minted]: true;
  readonly key: K;
  readonly effect: E;
  readonly plan?: CommandHandle<string, I, unknown, "Read" | "TransactRead">;
  /** K6: the door picks the transport from this. */
  readonly via: "command" | { route: string };
  /** Type only: no schema reaches the browser through a command handle. */
  readonly _input?: I;
  readonly _output?: O;
}
export type InputOf<H> = H extends CommandHandle<string, infer I> ? I : never;

/** Product contracts contribute their command types through their own registration modules. */
export interface ProductCommands {}
type Commands = typeof hostActions & ProductCommands;
type Routes = typeof httpRoutes;
type Row<K extends CommandKey> = (typeof commandTable)[K];
/** The generated table (K1) names every key: semantic commands, raw native commands, pe-api routes. */
export type { CommandKey };
/** A semantic command's own schema first, then the native DTO, then the pe-api route. */
export type CommandInput<K extends CommandKey> = K extends keyof Commands
  ? z.input<Commands[K]["input"]>
  : K extends OpKey
    ? OpRequestOf<K>
    : K extends keyof Routes
      ? PeRouteInput<Routes, K>
      : unknown;
export type CommandOutput<K extends CommandKey> = K extends keyof Commands
  ? Commands[K] extends { result: z.ZodType }
    ? z.output<Commands[K]["result"]>
    : unknown
  : K extends OpKey
    ? OpResponseOf<K>
    : K extends keyof Routes
      ? PeRouteOutput<Routes, K>
      : unknown;
export type CommandEffect<K extends CommandKey> = Extract<Row<K>["effect"], Effect>;
/** A sealed write's plan is required on its handle, so a verb declaration can demand `present`. */
type Planned<K extends CommandKey, I> = Row<K> extends { plan: string }
  ? { readonly plan: CommandHandle<string, I, unknown, "Read" | "TransactRead"> }
  : unknown;

export const effects = ["Read", "TransactRead", "SessionWrite", "WorkWrite", "ModelWrite"] as const;
export function mint<S extends object>(shape: S) {
  const branded: S & { readonly [minted]: true } = { ...shape, [minted]: true };
  return Object.freeze(branded);
}
const commandHandles = new Map<string, CommandHandle>();
const isPlan = (command: CommandHandle): command is CommandHandle<string, unknown, unknown, "Read" | "TransactRead"> =>
  command.effect === "Read" || command.effect === "TransactRead";
export function handle<K extends CommandKey>(
  key: K,
): CommandHandle<K, CommandInput<K>, CommandOutput<K>, CommandEffect<K>> &
  Planned<K, CommandInput<K>>;
export function handle(key: CommandKey): CommandHandle {
  const made = commandHandles.get(key);
  if (made) return made;
  if (!Object.hasOwn(commandTable, key)) throw Error(`No command or route: ${key}`);
  const row = commandTable[key];
  const plan = "plan" in row ? handle(row.plan) : undefined;
  if (plan && !isPlan(plan)) throw Error(`${key} declares a plan that writes`);
  const result: CommandHandle = mint({
    key,
    effect: row.effect,
    via: row.via,
    ...(plan ? { plan } : {}),
  });
  commandHandles.set(key, result);
  return result;
}
