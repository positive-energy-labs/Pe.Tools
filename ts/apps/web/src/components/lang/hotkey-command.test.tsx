// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { Popover } from "@base-ui/react/popover";
import { Save } from "lucide-react";
import { Button } from "./button";
import { HotkeyCommand, HotkeyHint } from "./hotkey-command";
import { Input } from "./input";
import { KeyScope, useScopeKeys } from "#/route/keys";

afterEach(cleanup);
test("a hotkey hint shares the chord marks without introducing a focusable or acting control", () => {
  const view = render(<HotkeyHint hotkey="Mod+Shift+K" face="compact" />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(view.container.querySelector("[tabindex]")).toBeNull();
  expect(view.container.querySelector("[data-command-chord]")?.textContent).toBe("Ctrl+Shift+K");
  expect(
    [...view.container.querySelectorAll("[data-key-symbol]")].map((key) =>
      key.getAttribute("data-key-symbol"),
    ),
  ).toEqual(["Ctrl", "Shift"]);
});
test("compact draws one chord with SVG modifier symbols and preserves fully written accessibility", () => {
  const view = render(
    <HotkeyCommand
      label="Signal command"
      word="Situation"
      icon={Save}
      hotkey="Mod+Shift+K"
      invoke={vi.fn()}
      bind={false}
      face="compact"
      data-tone="caution"
      data-situation-kind="unbound"
    />,
  );
  const button = screen.getByRole("button", { name: "Signal command" });
  expect(button.getAttribute("data-tone")).toBeNull();
  expect(button.getAttribute("data-wash")).toBeNull();
  expect(button.getAttribute("data-situation-kind")).toBe("unbound");
  expect(button.querySelector("svg")?.getAttribute("data-tone")).toBe("caution");
  expect(button.querySelector("[data-command-word]")?.getAttribute("data-tone")).toBe("caution");
  const compact = button.querySelector("[data-command-keys]")!;
  expect(compact.querySelectorAll("kbd")).toHaveLength(1);
  expect(compact.textContent).toBe("K");
  expect(
    [...compact.querySelectorAll("[data-key-symbol]")].map((key) =>
      key.getAttribute("data-key-symbol"),
    ),
  ).toEqual(["Ctrl", "Shift"]);
  for (const symbol of compact.querySelectorAll("svg")) {
    expect(symbol.getAttribute("viewBox")).toBe("0 0 12 12");
    expect(symbol.getAttribute("stroke-width")).toBe("1.5");
  }
  expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+Shift+K");
  expect(button.querySelector("[data-command-chord]")?.textContent).toBe("Ctrl+Shift+K");
  expect(view.container.querySelector("[data-command-glyphs]")).toBeNull();
});
test("Alt and Escape use drawn paths rather than font modifier words", () => {
  render(
    <HotkeyCommand
      label="Alternate cancel"
      hotkey="Alt+Escape"
      invoke={vi.fn()}
      bind={false}
      face="compact"
    />,
  );
  const compact = screen
    .getByRole("button", { name: "Alternate cancel" })
    .querySelector("[data-command-keys]")!;
  expect(compact.textContent).toBe("");
  expect(
    [...compact.querySelectorAll("[data-key-symbol]")].map((key) =>
      key.getAttribute("data-key-symbol"),
    ),
  ).toEqual(["Alt", "Escape"]);
});
test("compact period is a prominent centered circle while the written chord and accessibility retain punctuation", () => {
  render(
    <HotkeyCommand
      label="Situation punctuation"
      hotkey={{ key: ".", mod: true }}
      invoke={vi.fn()}
      bind={false}
      face="compact"
    />,
  );
  const button = screen.getByRole("button", { name: "Situation punctuation" });
  const period = button.querySelector('[data-command-keys] [data-key-symbol="Period"]')!;
  expect(period.getAttribute("viewBox")).toBe("0 0 12 12");
  const circle = period.querySelector("circle")!;
  expect([circle.getAttribute("cx"), circle.getAttribute("cy"), circle.getAttribute("r")]).toEqual([
    "6",
    "6",
    "1.4",
  ]);
  expect(button.querySelector("[data-command-chord]")?.textContent).toBe("Ctrl+.");
  expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+.");
  expect(button.getAttribute("title")).toContain("Ctrl+.");
});
test("click and real shifted punctuation share admission even with input focus", () => {
  const invoke = vi.fn();
  const tree = (busy = false, refusal: string | undefined = undefined) => (
    <>
      <HotkeyCommand
        label="Fixture command"
        icon={Save}
        hotkey={{ key: ".", mod: true, shift: true }}
        invoke={invoke}
        busy={busy}
        refusal={refusal}
        face="compact"
      />
      <Input aria-label="Editing" />
    </>
  );
  const view = render(tree());
  const input = screen.getByRole("textbox");
  input.focus();
  fireEvent.keyDown(input, { key: ">", code: "Period", ctrlKey: true, shiftKey: true });
  expect(invoke).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Fixture command" }));
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(
    screen.getByRole("button", { name: "Fixture command" }).getAttribute("aria-keyshortcuts"),
  ).toBe("Control+Shift+.");
  view.rerender(tree(true));
  fireEvent.keyDown(input, { key: ">", code: "Period", ctrlKey: true, shiftKey: true });
  fireEvent.click(screen.getByRole("button", { name: /Fixture command/ }));
  expect(invoke).toHaveBeenCalledTimes(2);
  view.rerender(tree(false, "No permission"));
  fireEvent.keyDown(input, { key: ">", code: "Period", ctrlKey: true, shiftKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Fixture command" }));
  expect(invoke).toHaveBeenCalledTimes(2);
});
test("caller-owned and hidden scope bindings do not create a second registration", () => {
  const invoke = vi.fn();
  function Caller() {
    useScopeKeys([
      {
        hotkey: "Mod+K",
        callback: invoke,
        label: "Caller palette",
        options: { ignoreInputs: false },
      },
    ]);
    return (
      <HotkeyCommand label="Page palette" icon={Save} hotkey="Mod+K" invoke={invoke} bind={false} />
    );
  }
  const view = render(
    <KeyScope id="owner">
      <Caller />
    </KeyScope>,
  );
  fireEvent.keyDown(document, { key: "k", code: "KeyK", ctrlKey: true });
  expect(invoke).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Page palette" }));
  expect(invoke).toHaveBeenCalledTimes(2);
  view.rerender(
    <KeyScope id="owner" hidden>
      <Caller />
    </KeyScope>,
  );
  fireEvent.keyDown(document, { key: "k", code: "KeyK", ctrlKey: true });
  expect(invoke).toHaveBeenCalledTimes(2);
});

// A refused verb that is also a Popover trigger (situation-verbs) still says why on focus.
test("a refused button composed as another trigger keeps its refusal tooltip", async () => {
  render(
    <Popover.Root>
      <Popover.Trigger
        render={<Button label="send" icon={Save} refusal="frozen seed is read-only" />}
      />
    </Popover.Root>,
  );
  const button = screen.getByRole("button", { name: "send" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  await act(async () => {
    button.focus();
    fireEvent.focus(button);
    await new Promise((wait) => setTimeout(wait, 50));
  });
  expect(await screen.findByText("frozen seed is read-only")).toBeTruthy();
});
