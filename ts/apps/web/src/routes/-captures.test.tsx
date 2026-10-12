// @vitest-environment jsdom
/** The capture history over a seeded receipt list: order, facts, focus, receipt and URL. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { captureListSchema, type CaptureReceipt } from "@pe/agent-contracts";

import { CapturesList } from "#/captures/list";

afterEach(cleanup);
const scrolled: Element[] = [];
beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});

const shaA = "a".repeat(64);
const shaB = "b".repeat(64);
const receipt = (over: Partial<CaptureReceipt>): CaptureReceipt => ({
  id: "r",
  sha: shaA,
  at: "2026-10-04T17:00:00.000Z",
  origin: "human",
  document: { openId: "open-a", title: "HVAC.rvt" },
  view: { id: 7, name: "Floor Plan: L1" },
  focus: null,
  registration: { imageSha256: shaA, width: 10, height: 10 },
  byteSize: 1234,
  url: `/captures/${shaA}.png`,
  ...over,
});
/** Seeds pass through the wire contract, so a receipt the host could not serve cannot seed this. */
const { captures: seeded } = captureListSchema.parse({
  captures: [
    receipt({
      id: "newest",
      sha: shaB,
      url: `/captures/${shaB}.png`,
      origin: "agent",
      view: { name: "Sheet: A101" },
      registration: null,
    }),
    receipt({ id: "older", origin: "web:/rooms", focus: { elementIds: [1, 2, 3] } }),
  ],
});

test("one frame per receipt in the order the host gave, each with its facts and picture", () => {
  render(<CapturesList captures={seeded} />);
  const frames = screen.getAllByRole("group");
  expect(frames.map((frame) => frame.getAttribute("aria-label"))).toEqual([
    "capture bbbbbbbb",
    "capture aaaaaaaa",
  ]);
  const newest = within(frames[0]!);
  expect(newest.getByText("agent")).toBeTruthy();
  expect(newest.getByText("Sheet: A101")).toBeTruthy();
  expect(newest.getByText("whole view")).toBeTruthy();
  expect(newest.getByText("unregistered")).toBeTruthy();
  const older = within(frames[1]!);
  expect(older.getByText("web:/rooms")).toBeTruthy();
  expect(older.getByText("HVAC.rvt")).toBeTruthy();
  expect(older.getByText("3 elements")).toBeTruthy();
  expect(older.queryByText("unregistered")).toBeNull();
  expect(older.getByRole("img").getAttribute("src")).toBe(`/captures/${shaA}.png`);
  expect(older.getByText("open png").getAttribute("href")).toBe(`/captures/${shaA}.png`);
});

test("?sha focuses its row, opens its receipt and scrolls it into view; others stay collapsed", () => {
  render(<CapturesList captures={seeded} focus={shaA} />);
  const [newest, older] = screen.getAllByRole("group");
  expect(older!.parentElement!.hasAttribute("data-active")).toBe(true);
  expect(newest!.parentElement!.hasAttribute("data-active")).toBe(false);
  expect(scrolled).toEqual([older!.parentElement]);
  // The receipt is a highlighted `Code` block, so its text is split across token spans.
  expect(older!.textContent).toContain('"id": "older"');
  expect(newest!.textContent).not.toContain('"id": "newest"');
  fireEvent.click(within(newest!).getByText("receipt"));
  expect(newest!.textContent).toContain('"id": "newest"');
});

test("copy url copies the absolute capture URL", () => {
  const copied: string[] = [];
  const writeText = async (text: string) => void copied.push(text);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<CapturesList captures={seeded} />);
  fireEvent.click(within(screen.getAllByRole("group")[1]!).getByText("copy url"));
  expect(copied).toEqual([`${window.location.origin}/captures/${shaA}.png`]);
});

test("an empty store says how to fill it", () => {
  render(<CapturesList captures={[]} />);
  expect(screen.getByText("no captures kept yet")).toBeTruthy();
});
