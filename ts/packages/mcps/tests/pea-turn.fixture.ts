import { onTestFinished } from "vite-plus/test";
import { bindControl, mintContext, retireContext } from "../../../apps/host/src/control.ts";
import { testConsents } from "../../../apps/host/tests/effect-test.ts";

/** Real run registry and host-minted credentials for HTTP/MCP journeys across turns. */
export function peaTurns() {
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
