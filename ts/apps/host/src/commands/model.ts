import { Schema } from "effect";
import {
  CommandId,
  ExecutionId,
  Generation,
  CommandProblem,
} from "../../../../packages/agent-contracts/src/command-authority.ts";

/** These are immutable admission facts, never a deserialized permission. */
export const Binding = Schema.Struct({
  principal: Schema.String,
  authority: Schema.String,
  target: Schema.String,
  parent: Schema.NullOr(CommandId),
  stopWithParent: Schema.Boolean,
});
export type Binding = typeof Binding.Type;
export const CommandDescriptor = Schema.Struct({
  id: CommandId,
  generation: Generation,
  execution: ExecutionId,
  tag: Schema.String,
  manifest: Schema.String,
  key: Schema.String,
  input: Schema.String,
  digest: Schema.String,
  binding: Binding,
});
export const CommandRow = Schema.Struct({
  ...CommandDescriptor.fields,
  state: Schema.Literals(["allocated", "accepted", "stopped", "blocked", "terminal"]),
  stop: Schema.Boolean,
  result: Schema.NullOr(Schema.String),
  problem: Schema.NullOr(CommandProblem),
});
export type CommandRow = typeof CommandRow.Type;

/** Finite lifetime authority. Exhaustion refuses allocation; it never rotates generations. */
export const commandLimits = {
  tickets: 1024,
  accepted: 32,
  active: 16,
  requestBytes: 64 * 1024,
  planBytes: 256 * 1024,
  stepBytes: 128 * 1024,
  steps: 64,
  claimBytes: 1024,
  safetyRows: 8192,
  reservedCommandBytes: 16 * 1024 * 1024,
  authorityBytes: 512 * 1024 * 1024,
  databaseBytes: 1024 * 1024 * 1024,
  walBytes: 64 * 1024 * 1024,
  nativeFifo: 64,
  observers: 64,
  observerBuffer: 32,
  historySuffix: 256,
  shutdownMs: 5000,
} as const;
export type CommandLimits = { readonly [K in keyof typeof commandLimits]: number };

/** UTF-8 budget, including values that cannot be represented safely as JSON. */
export function json(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(json).join(",")}]`;
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${json(Reflect.get(value, key))}`)
      .join(",")}}`;
  throw Error("Command values must be finite JSON");
}
