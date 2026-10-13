import type { Caller } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/mcps/context";
import type { Crossing } from "../src/action-journal.ts";

/** Host-minted callers for fixtures that mount routes without the identity middleware. */
export const human: Caller = { kind: "human", via: "local" };
export const pea = (thread = "thread-1"): Caller => ({
  kind: "pea",
  context: `ctx-${thread}`,
  thread,
});

/** The crossing a direct admit call carries; `agent` is a Pea context outside any grant check. */
export const crossingOf = (actor: "human" | "agent" = "human"): Crossing =>
  actor === "human" ? { caller: human, basis: { kind: "human" } } : { caller: pea(), basis: null };

/** Run a web handler as `caller`, as the identity middleware would. */
export const asCaller =
  <A extends unknown[], R>(caller: Caller, handler: (...args: A) => R) =>
  (...args: A): R =>
    withInvocationContext({ caller }, () => handler(...args));
