import { Effect, Exit } from "effect";
import { expect, test } from "vite-plus/test";
import type { ActionAdmission, Caller } from "@pe/agent-contracts";
import { admittedCommandReadIdentity } from "../src/command-read-identity.ts";

const pea: Caller = { kind: "pea", context: "ctx", thread: "t", run: { thread: "t", turn: "1" }, root: { thread: "t", turn: "1" } };
const plan = (target: ActionAdmission["target"]): ActionAdmission => ({
  id: "plan-7",
  key: "sheet.plan",
  target,
  input: {},
});

test("a command read keeps its Pea caller, exact document and command parent in a fresh child request", async () => {
  const context = { caller: pea, admission: plan({ kind: "document", ref: { session: "s1", openId: "doc-a" } }) };
  const [first, second] = await Effect.runPromise(
    Effect.all([admittedCommandReadIdentity(context), admittedCommandReadIdentity(context)]),
  );
  expect(first).toMatchObject({
    caller: pea,
    scope: { bridgeSessionId: "s1", openDocumentId: "doc-a" },
    ownership: { causalParent: "plan-7", owner: first!.requestId },
  });
  expect(first!.requestId).not.toBe(second!.requestId);
  expect(Object.isFrozen(first!.ownership) && Object.isFrozen(first!.caller)).toBe(true);
});

test.each([
  ["a host target", plan({ kind: "host" }), "read.target"],
  ["a session-wide target", plan({ kind: "session", session: "s1" }), "read.target"],
  ["an admission outside its schema", { ...plan({ kind: "document", ref: { session: "s1", openId: "doc-a" } }), id: "" }, "read.admission"],
])("%s is refused before any identity is minted", async (_, admission, problem) => {
  const exit = await Effect.runPromiseExit(admittedCommandReadIdentity({ caller: pea, admission }));
  expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain(problem);
});
