// @vitest-environment jsdom
/** The composer ladder: provider › model › one rung per trait, read whole in its trigger. */
import type { Reading } from "@pe/agent-contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";

const wb = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("#/workbench/provider", () => ({ useWorkbench: () => wb.current }));
vi.mock("#/navigation/state", () => ({ useDestination: () => vi.fn() }));

const { useThreadScope } = await import("./scope");

vi.mock("#/machine/use-machine", () => ({ useMachine: () => ({ reading: { state: "absent" } }) }));
vi.mock("#/shell/binding", () => ({ useChooseTarget: () => [null, vi.fn()] }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const lifetime = { session: "S1", openId: "A" };
const headReading = (): Reading<unknown> => ({
  state: "ready",
  observation: {
    targets: [{ request: { kind: "open", ref: lifetime }, admission: null }],
    revision: 3,
  },
});

test("a refused head write shows the door, the reason and the remedy, not an unknown outcome", async () => {
  const refusal = {
    code: "context.foreign-thread",
    door: "/pe/scope/t2",
    reason:
      "Refused at /pe/scope/t2: this context belongs to thread t1; it cannot write thread t2's head.",
    remedy: "Write /pe/scope/self.",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { error: { code: refusal.code, message: refusal.reason, details: { refusal } } },
        { status: 403 },
      ),
    ),
  );
  function Setter() {
    const scope = useThreadScope("t2", true, headReading());
    useEffect(() => void scope.set([]), []);
    return <output>{scope.refusal}</output>;
  }
  render(<Setter />);
  expect(await screen.findByText(`${refusal.reason} ${refusal.remedy}`)).toBeTruthy();
  vi.unstubAllGlobals();
});
