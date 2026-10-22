// @vitest-environment jsdom
import { KeyScope, useScopeKeys } from "@pe/kit/keys";
import { Input } from "@pe/kit/lang/input";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Save } from "lucide-react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { HotkeyCommand } from "./hotkey-command";

afterEach(cleanup);
test("click and real shifted punctuation share admission even with input focus", () => {
  const invoke = vi.fn();
  const tree = (busy = false, refusal?: string) => (
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
