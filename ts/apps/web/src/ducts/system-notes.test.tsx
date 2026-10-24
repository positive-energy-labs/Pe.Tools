// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { SystemMark, systemNoteCount } from "./proto/e/bar";

afterEach(cleanup);

const system = {
  total: 0.9,
  rating: 0.5,
  fanless: false,
  blocked: false,
  provisional: { count: 2, worst: 1.5 } as never,
};
const calmSystem = { ...system, rating: 1.5, provisional: null as never };

test("the chip's +n counts the same notes the scrollbar shades: issues + Fix rows + Set rows", () => {
  const notes = systemNoteCount(system, { fix: 2, set: 3 });
  // fix (from fix > 0), over (alarm) and ~2 joins (caution) are the issue words.
  expect(notes.issues.map((i) => i.word)).toEqual(["fix", "over", "~2 joins"]);
  expect(notes.total).toBe(3 + 2 + 3);
  render(<SystemMark issues={notes.issues} total={notes.total} open={() => {}} />);
  expect(screen.getByRole("button").textContent).toBe(`fix +${notes.total - 1}`);
});

test("Set rows alone are a note the chip names rather than a shade with no number", () => {
  const calm = systemNoteCount(calmSystem, { fix: 0, set: 1 });
  expect(calm.issues).toEqual([]);
  expect(calm.total).toBe(1);
  render(<SystemMark issues={calm.issues} total={calm.total} open={() => {}} />);
  expect(screen.getByRole("button").textContent).toBe("set");
  expect(systemNoteCount(calmSystem, undefined).total).toBe(0);
});
