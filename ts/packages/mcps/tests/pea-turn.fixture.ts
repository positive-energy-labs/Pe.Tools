import { onTestFinished } from "vite-plus/test";
import { bindControl, mintContext, retireContext } from "../../../apps/host/src/control.ts";
import { testConsents } from "../../../apps/host/tests/effect-test.ts";

/** Real run registry and host-minted credentials for HTTP/MCP journeys across turns. */
type Turn = { thread: string; turn: string };
// Named through `testConsents`: inferred, the host's consent type is reachable only by a path a
// route directory's `@pe/host` import exposes, which declaration emit refuses as unportable.
export function peaTurns(): {
  runs: ReturnType<typeof testConsents>;
  newTurn: (thread: string, root?: Turn) => { run: Turn; token: ReturnType<typeof mintContext> };
} {
  const tokens: string[] = [];
  const runs = testConsents(() => {}, { autoApprove: () => false });
  bindControl({ runs });
  onTestFinished(() => {
    runs.closeAll();
    for (const token of tokens) retireContext(token);
  });
  const active = new Map<string, { thread: string; turn: string }>();
  const newTurn = (thread: string, root?: { thread: string; turn: string }) => {
    const old = active.get(thread);
    if (old) runs.close(old, "completed");
    const run = { thread, turn: crypto.randomUUID() };
    runs.open(run, root);
    active.set(thread, run);
    const token = mintContext({ kind: "pea", thread, run, root: root ?? run });
    tokens.push(token);
    return { run, token };
  };
  return { runs, newTurn };
}
