// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { SheetCell } from "./sheet-cell";

afterEach(cleanup);

it("Enter then blur commits once while the write is in flight (2026-10-30: the second POST was refused)", async () => {
  let land!: () => void;
  const onValue = vi.fn(() => new Promise<void>((resolve) => (land = resolve)));
  const { container } = render(
    <SheetCell label="Terminal drop in-wg" value={0.03} unit={{ label: "in-wg" }} digits={4} source="firm seed" refusal={null} onValue={onValue} />,
  );
  const input = container.querySelector("input")!;
  await act(async () => input.focus());
  fireEvent.change(input, { target: { value: "0.08" } });
  await act(async () => fireEvent.keyDown(input, { key: "Enter", code: "Enter" }));
  await act(async () => fireEvent.blur(input));
  expect(onValue).toHaveBeenCalledTimes(1);
  expect(onValue).toHaveBeenCalledWith(0.08);
  await act(async () => land());
});
