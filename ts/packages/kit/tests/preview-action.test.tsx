// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { PreviewAction, type PreviewHeld } from "../src/components/lang/preview-action";
import { TooltipProvider } from "../src/components/lang/tooltip";

afterEach(() => {
  cleanup();
  spy.mockClear();
});

const HELD: PreviewHeld = { word: "heal · previewed 3", summary: "3 pass · 1 refused" };

const spy = vi.fn();

/** A route in miniature: it keeps the preview result and the input it rested on, as the page does. */
function Route({ commit }: { commit?: () => Promise<{ message: string } | null> }) {
  const [input, setInput] = useState(1);
  const [rest, setRest] = useState<number | null>(null);
  const previewed = async () => {
    spy();
    setRest(input);
    return null;
  };
  const held = rest !== null && rest === input;
  return (
    <TooltipProvider delay={0}>
      <button onClick={() => setInput((n) => n + 1)}>change input</button>
      <PreviewAction
        label="preview heal"
        says="Preview healing"
        held={held ? HELD : null}
        stale={rest !== null && !held ? "changed since preview" : null}
        preview={previewed}
        commit={{
          label: "apply heal",
          says: "Heal what passed",
          run: commit ?? (async () => null),
          done: "healed 3",
        }}
      />
    </TooltipProvider>
  );
}

const previewed = () => spy;
const mark = () =>
  document.querySelector("[data-preview-action]")!.getAttribute("data-preview-action");

test("idle, previewing, armed; Escape keeps it armed; reopening does not re-preview; an input change disarms", async () => {
  render(<Route />);
  expect(mark()).toBe("idle");
  expect(screen.getByRole("button", { name: "preview heal" })).toBeTruthy();

  // idle -> previewing -> armed, popover open with the counts and the commit
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "preview heal" })));
  expect(previewed()).toHaveBeenCalledTimes(1);
  expect(mark()).toBe("armed");
  expect(screen.getByText("3 pass · 1 refused")).toBeTruthy();
  expect(screen.getByRole("button", { name: "apply heal" })).toBeTruthy();

  // Escape closes the popover and the button stays armed
  await act(async () =>
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape", keyCode: 27 }),
  );
  await waitFor(() => expect(screen.queryByText("3 pass · 1 refused")).toBeNull());
  expect(mark()).toBe("armed");
  const armed = screen.getByRole("button", { name: "heal · previewed 3" });
  expect(armed.getAttribute("aria-pressed")).toBe("true");

  // pressing it again reopens, with no second preview
  await act(async () => fireEvent.click(armed));
  expect(screen.getByText("3 pass · 1 refused")).toBeTruthy();
  expect(previewed()).toHaveBeenCalledTimes(1);

  // the input the preview rested on changes: back to idle, with the reason, and no popover
  await act(async () => fireEvent.click(screen.getByText("change input")));
  await waitFor(() => expect(screen.queryByText("3 pass · 1 refused")).toBeNull());
  expect(mark()).toBe("stale");
  expect(screen.getByText("· changed since preview")).toBeTruthy();
  expect(screen.getByRole("button", { name: "preview heal" })).toBeTruthy();
});

test("committing ends in done or refused, in the popover", async () => {
  const commit = vi.fn<() => Promise<{ message: string } | null>>().mockResolvedValue(null);
  render(<Route commit={commit} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "preview heal" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "apply heal" })));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-preview-outcome="done"]')?.textContent).toBe("healed 3");
  cleanup();

  const refuse = vi.fn().mockResolvedValue({ message: "Revit refused the transaction" });
  render(<Route commit={refuse} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "preview heal" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "apply heal" })));
  expect(document.querySelector('[data-preview-outcome="refused"]')?.textContent).toBe(
    "Revit refused the transaction",
  );
  // a refused commit leaves the preview armed to try again
  expect(screen.getByRole("button", { name: "apply heal" })).toBeTruthy();
});

test("a held preview reopens even while a fresh preview is refused", async () => {
  render(
    <TooltipProvider delay={0}>
      <PreviewAction
        label="preview heal"
        says="Preview healing"
        refusal="An open document is required"
        held={HELD}
        preview={async () => null}
        commit={{ label: "apply heal", says: "Heal", run: async () => null, done: "healed" }}
      />
    </TooltipProvider>,
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "heal · previewed 3" })),
  );
  expect(screen.getByText("3 pass · 1 refused")).toBeTruthy();
});
