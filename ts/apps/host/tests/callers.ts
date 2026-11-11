import { testConsents } from "./effect-test.ts";
import { randomUUID } from "node:crypto";
import { bindControl, mintContext } from "../src/control.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { HOST_CONTEXT_HEADER, HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import type { Caller } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import type { Crossing } from "../src/action-journal.ts";

/** Host-minted callers for fixtures that mount routes without the identity middleware. */
export const human: Caller = { kind: "human", via: "local" };
export const pea = (thread = "thread-1"): Caller => ({
  kind: "pea",
  context: `ctx-${thread}`,
  thread,
});

/** Explicit approved harness fixture. Boundary tests keep using unscoped pea(). */
const fixtureRuns = testConsents((run, event) => {
  if (event.kind === "permission_request")
    queueMicrotask(() => fixtureRuns.decide(run.thread, event.requestId, "allow_now"));
});
const fixtures = new Map<string, Caller>();
export const approvedPea = (thread = "thread-1"): Caller => {
  bindControl({ runs: fixtureRuns });
  let caller = fixtures.get(thread);
  if (!caller) {
    const run = { thread, turn: `fixture-${randomUUID()}` };
    fixtureRuns.open(run);
    caller = { ...pea(thread), run, root: run } as Caller;
    fixtures.set(thread, caller);
  }
  return caller;
};

/** The crossing a direct admit call carries; `agent` is a Pea context outside any grant check. */
export const crossingOf = (actor: "human" | "agent" = "human"): Crossing =>
  actor === "human"
    ? { caller: human, basis: { kind: "human" } }
    : { caller: approvedPea(), basis: null };

/** Run as `caller`, as the identity middleware would after admission. */
export const actAs = <T>(caller: Caller, run: () => T): T => withInvocationContext({ caller }, run);

/** Run a web handler as `caller`, as the identity middleware would. */
export const asCaller =
  <A extends unknown[], R>(caller: Caller, handler: (...args: A) => R) =>
  (...args: A): R =>
    actAs(caller, () => handler(...args));

/** The marker a same-runtime request carries. */
export const serviceHeaders = () => ({ [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName });

/** A minted bearer context as request headers; the terminal human by default. */
export const contextHeaders = (
  spec: Parameters<typeof mintContext>[0] = { kind: "human", via: "cli" },
) => ({ [HOST_CONTEXT_HEADER]: mintContext(spec) });

/** What a Revit registration or session row must carry to be this host's own. */
export const ownedSession = {
  lane: hostOwnership.lane,
  sourceRoot: hostOwnership.sourceRoot,
  serviceName: hostOwnership.serviceName,
};
