// @vitest-environment jsdom
/**
 * The closer verb is live while the person types its number, not only after Enter commits it
 * (UAT 2026-10-29, Chadds MUAS-1: "set flow" stayed refused until Enter). Leaving the box still
 * commits, so the press runs the typed value.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { AttentionScope, useHoveredIssue } from "#/attention";
import * as Atom from "effect/reactivity/Atom";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { BlockerRow } from "./blocker-row";
import { describeCloser, type Closer } from "./closer";
import type { SheetBlocker } from "./tiers";
import { eKey } from "#/test-attention";

afterEach(cleanup);

const blocker: SheetBlocker = {
  id: "no-flow:9:1",
  kind: "no-flow",
  elementId: 9,
  connector: 1,
  effectInWg: null,
  detail: "terminal 9 has no design flow",
  closer: { kind: "default", note: "" },
};

it("a typed cfm makes the verb live before Enter, and the press runs that value", () => {
  const onClose = vi.fn<(closer: Closer) => void>();
  render(
    <BlockerRow
      blocker={blocker}
      focused={false}
      closerOf={(b, typed) =>
        describeCloser(b, typed, { terminalDrop: null, nameOf: () => "duct", wait: null })
      }
      onClose={onClose}
      onFocus={() => {}}
    />,
  );
  const input = screen.getByRole("row").querySelector("input")!;
  input.focus();
  fireEvent.input(input, { target: { value: "100" } });
  const verb = screen.getByText("set flow 100 cfm");
  fireEvent.click(verb);
  expect(onClose).toHaveBeenCalledWith(
    expect.objectContaining({ action: { kind: "cfm", elementId: 9, value: 100 } }),
  );
});

it("Enter commits the ask like an Inputs cell, and the verb press after a blur does not run it twice", () => {
  const onClose = vi.fn<(closer: Closer) => void>();
  render(
    <BlockerRow
      blocker={blocker}
      focused={false}
      closerOf={(b, typed) =>
        describeCloser(b, typed, { terminalDrop: null, nameOf: () => "duct", wait: null })
      }
      onClose={onClose}
      onFocus={() => {}}
    />,
  );
  const input = screen.getByRole("row").querySelector("input")!;
  input.focus();
  fireEvent.change(input, { target: { value: "100" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledWith(
    expect.objectContaining({ action: { kind: "cfm", elementId: 9, value: 100 } }),
  );
  fireEvent.click(screen.getByText("set flow 100 cfm"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("Escape cancels the typed ask without running it", () => {
  const onClose = vi.fn<(closer: Closer) => void>();
  render(
    <BlockerRow
      blocker={blocker}
      focused={false}
      closerOf={(b, typed) =>
        describeCloser(b, typed, { terminalDrop: null, nameOf: () => "duct", wait: null })
      }
      onClose={onClose}
      onFocus={() => {}}
    />,
  );
  const input = screen.getByRole("row").querySelector("input")!;
  input.focus();
  fireEvent.change(input, { target: { value: "100" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
});

it("delegates row hover to the document subject scope and withdraws the issue on leave", () => {
  function Probe() {
    return <output data-testid="hovered-issue">{useHoveredIssue() ?? "none"}</output>;
  }
  const selected = Atom.make<ReadonlySet<SubjectKey>>(new Set<SubjectKey>());
  const view = render(
    <AttentionScope
      doc="blocker-model"
      selected={selected}
      members={new Map<SubjectKey, readonly SubjectKey[]>([[`issue:${blocker.id}`, [eKey(9)]]])}
    >
      <Probe />
      <BlockerRow
        blocker={blocker}
        focused={false}
        closerOf={(b, typed) =>
          describeCloser(b, typed, { terminalDrop: null, nameOf: () => "duct", wait: null })
        }
        onClose={() => {}}
        onFocus={() => {}}
      />
    </AttentionScope>,
  );
  fireEvent.pointerOver(view.getByRole("row"));
  expect(view.getByTestId("hovered-issue").textContent).toBe(blocker.id);
  fireEvent.pointerLeave(view.getByRole("row").parentElement!);
  expect(view.getByTestId("hovered-issue").textContent).toBe("none");
});
