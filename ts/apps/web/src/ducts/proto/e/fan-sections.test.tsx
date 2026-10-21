// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { FanResult } from "@pe/ducts-domain/losses";

import { FanSections } from "./fan-sections";

afterEach(cleanup);

const fan = (over: Partial<FanResult>): FanResult => ({
  unit: 1,
  cfm: 600,
  port: 10,
  junction: null,
  owned: [10, 11],
  esp: 0.382,
  critical: 30,
  tel: 591.8,
  stretch: [],
  viaJunction: false,
  path: [],
  rows: [],
  ...over,
});

test("one row per fan with its TEL, ESP and where its section ends; hover lights what it owns", () => {
  const light = vi.fn();
  const select = vi.fn();
  const names: Record<number, string> = { 1: "FC-30", 2: "DH-16", 51: "duct 51" };
  render(
    <FanSections
      fans={[fan({}), fan({ unit: 2, cfm: 200, port: 15, junction: 51, owned: [15], esp: 0.372, tel: 560.6, viaJunction: true })]}
      nameOf={(id) => names[id] ?? String(id)}
      light={light}
      select={select}
    />,
  );
  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]!.textContent).toContain("ESP 0.382 in-wg · owns the trunk");
  expect(rows[1]!.textContent).toContain("200 cfm");
  expect(rows[1]!.textContent).toContain("to duct 51, then the trunk");
  fireEvent.mouseEnter(rows[1]!);
  expect(light).toHaveBeenLastCalledWith([15]);
  fireEvent.click(rows[1]!);
  expect(select).toHaveBeenCalledWith(30);
});

test("draws nothing for a one-fan system", () => {
  const { container } = render(
    <FanSections fans={[]} nameOf={String} light={() => {}} select={() => {}} />,
  );
  expect(container.innerHTML).toBe("");
});
