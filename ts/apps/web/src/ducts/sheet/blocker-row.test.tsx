// @vitest-environment jsdom
/**
 * The closer verb is live while the person types its number, not only after Enter commits it
 * (UAT 2026-10-29, Chadds MUAS-1: "set flow" stayed refused until Enter). Leaving the box still
 * commits, so the press runs the typed value.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { BlockerRow } from "./blocker-row";
import { describeCloser, type Closer } from "./closer";
import type { SheetBlocker } from "./tiers";

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
        describeCloser(b, typed, { terminalDrop: null, nameOf: () => null, wait: null })
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
