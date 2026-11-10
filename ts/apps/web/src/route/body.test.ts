/**
 * Slice 6 falsifier, layout as data (ADR 0035 rule 5): /pea measures 2 scroll tracks and the dock
 * 1, counted over the declaration before any render. The driver's browser twin counts elements
 * whose computed `overflow-y` is `auto` or `scroll` on the real /pea and the real dock
 * (CHROME-SHAPE.md, seam a); this is the unit that must agree with it.
 */
import { expect, test } from "vite-plus/test";
import { module as chat } from "../chat/route";
import { DOCK_PANES } from "../workbench/dock-layout";
import { fillBody, isBody, scrollBody, scrollTracks } from "./body";

test("the brand is the only way to make a Body", () => {
  expect(isBody(scrollBody("a"))).toBe(true);
  expect(isBody(fillBody("a"))).toBe(true);
  expect(isBody({ kind: "scroll" })).toBe(false);
  expect(isBody("a")).toBe(false);
});

test("red (slice 6 seam a): /pea declares two scroll bodies, threads and chat", () => {
  const panes = chat.spec.panes as Readonly<Record<string, { body?: "scroll" | "fill" }>>;
  expect(
    scrollTracks(panes),
    `slice 6 gap: /pea's panes declare no body kind (${Object.keys(panes).join(", ")}); the chat route is still one pane whose drawing nests its own GraphLayoutView`,
  ).toBe(2);
});

test("red (slice 6 seam a): the dock declares one scroll body, the tools pane", () => {
  expect(
    scrollTracks(DOCK_PANES),
    "slice 6 gap: the dock's panes declare no body kind; RouteDock still hands GraphLayoutView its bodies by hand",
  ).toBe(1);
});
