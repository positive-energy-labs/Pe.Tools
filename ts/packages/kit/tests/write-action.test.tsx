// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { WriteAction, writeWord, type WriteHeld } from "../src/components/lang/write-action";
import { TooltipProvider } from "../src/components/lang/tooltip";

afterEach(() => {
  cleanup();
  spy.mockClear();
});

const HELD: WriteHeld = { word: "heal · planned 3", summary: "3 pass · 1 refused" };

const spy = vi.fn();

/** A route in miniature: it keeps the plan and the input it rested on, as the page does. */
function Route({ commit }: { commit?: () => Promise<{ message: string } | null> }) {
  const [input, setInput] = useState(1);
  const [rest, setRest] = useState<number | null>(null);
  const planned = async () => {
    spy();
    setRest(input);
    return null;
  };
  const held = rest !== null && rest === input;
  return (
    <TooltipProvider delay={0}>
      <button onClick={() => setInput((n) => n + 1)}>change input</button>
      <WriteAction
        label="plan heal"
        says="Plan healing"
        held={held ? HELD : null}
        stale={rest !== null && !held ? "changed since plan" : null}
        plan={planned}
        apply={{
          label: "apply heal",
          says: "Heal what passed",
          run: commit ?? (async () => null),
          done: "healed 3",
        }}
      />
    </TooltipProvider>
  );
}

const planned = () => spy;
const mark = () => document.querySelector("[data-write-action]")!.getAttribute("data-write-action");

test("idle, planning, armed; Escape keeps it armed; reopening does not re-plan; an input change disarms", async () => {
  render(<Route />);
  expect(mark()).toBe("idle");
  expect(screen.getByRole("button", { name: "plan heal" })).toBeTruthy();

  // idle -> planning -> armed, popover open with the counts and the commit
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "plan heal" })));
  expect(planned()).toHaveBeenCalledTimes(1);
  expect(mark()).toBe("armed");
  expect(screen.getByText("3 pass · 1 refused")).toBeTruthy();
  expect(screen.getByRole("button", { name: "apply heal" })).toBeTruthy();

  // Escape closes the popover and the button stays armed
  await act(async () =>
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape", keyCode: 27 }),
  );
  await waitFor(() => expect(screen.queryByText("3 pass · 1 refused")).toBeNull());
  expect(mark()).toBe("armed");
  const armed = screen.getByRole("button", { name: "heal · planned 3" });
  expect(armed.getAttribute("aria-pressed")).toBe("true");

  // pressing it again reopens, with no second plan
  await act(async () => fireEvent.click(armed));
  expect(screen.getByText("3 pass · 1 refused")).toBeTruthy();
  expect(planned()).toHaveBeenCalledTimes(1);

  // the input the plan rested on changes: back to idle, with the reason, and no popover
  await act(async () => fireEvent.click(screen.getByText("change input")));
  await waitFor(() => expect(screen.queryByText("3 pass · 1 refused")).toBeNull());
  expect(mark()).toBe("stale");
  expect(screen.getByText("· changed since plan")).toBeTruthy();
  expect(screen.getByRole("button", { name: "plan heal" })).toBeTruthy();
});

test("committing ends in done or refused, in the popover", async () => {
  const commit = vi.fn<() => Promise<{ message: string } | null>>().mockResolvedValue(null);
  render(<Route commit={commit} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "plan heal" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "apply heal" })));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-write-outcome="done"]')?.textContent).toBe("healed 3");
  cleanup();

  const refuse = vi.fn().mockResolvedValue({ message: "Revit refused the transaction" });
  render(<Route commit={refuse} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "plan heal" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "apply heal" })));
  expect(document.querySelector('[data-write-outcome="refused"]')?.textContent).toBe(
    "Revit refused the transaction",
  );
  // a refused commit leaves the plan armed to try again
  expect(screen.getByRole("button", { name: "apply heal" })).toBeTruthy();
});

test("a held plan reopens even while a fresh plan is refused", async () => {
  render(
    <TooltipProvider delay={0}>
      <WriteAction
        label="plan heal"
        says="Plan healing"
        refusal="An open document is required"
        held={HELD}
        plan={async () => null}
        apply={{ label: "apply heal", says: "Heal", run: async () => null, done: "healed" }}
      />
    </TooltipProvider>,
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "heal · planned 3" })),
  );
  expect(screen.getByText("3 pass · 1 refused")).toBeTruthy();
});

test("a plan is never checked in Revit; only a successful declared rehearsal is", () => {
  expect(writeWord("heal", 3, false)).toBe("heal · planned 3");
  expect(writeWord("heal", 3, true)).toBe("heal · checked in Revit 3");
});

test("before, after and each author are drawn; the open window offers Reject? instead of apply", async () => {
  const reject = vi.fn();
  render(
    <TooltipProvider delay={0}>
      <WriteAction
        label="plan heal"
        says="Plan healing"
        held={{
          ...HELD,
          cells: [
            { key: "a", label: "duct-A size", before: "10", after: "12", author: "pea" },
            { key: "b", label: "duct-B size", before: null, after: "14", author: "human" },
          ],
        }}
        plan={async () => null}
        apply={{ label: "apply heal", says: "Heal", run: async () => null, done: "healed" }}
        reject={{ until: "17s", run: reject }}
      />
    </TooltipProvider>,
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "heal · planned 3" })));
  const cell = document.querySelector('[data-write-cell="a"]')!;
  expect(cell.textContent).toContain("12");
  expect(cell.textContent).toContain("10");
  expect(cell.querySelector("[data-write-author]")!.textContent).toBe("Pea");
  expect(document.querySelector('[data-write-cell="b"] [data-write-author]')!.textContent).toBe("you");
  expect(screen.queryByRole("button", { name: "apply heal" })).toBeNull();
  await act(async () => fireEvent.click(document.querySelector("[data-write-reject]")!));
  expect(reject).toHaveBeenCalledTimes(1);
});

test("apply without a seal is refused at the button and never runs", async () => {
  const run = vi.fn(async () => null);
  render(
    <TooltipProvider delay={0}>
      <WriteAction
        label="plan heal"
        says="Plan healing"
        held={HELD}
        plan={async () => null}
        apply={{ label: "apply heal", says: "Heal", refusal: "Plan the current Work first", run, done: "healed" }}
      />
    </TooltipProvider>,
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "heal · planned 3" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "apply heal" })));
  expect(run).not.toHaveBeenCalled();
});
