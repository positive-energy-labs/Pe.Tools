/**
 * Slice 6 falsifier, layout as data (ADR 0035 rule 5): every /pea and dock pane declares its body,
 * counted over the declaration before any render. A fill body owns its track: the thread roster's
 * Scroll, the transcript's scroller, a docked Place's own panes. The driver's browser twin counts
 * elements whose computed `overflow-y` is `auto` or `scroll` and can scroll (CHROME-SHAPE.md, seam
 * a): /pea is 2 (the roster and the transcript) and the dock's tools pane is the Place's own.
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

test("/pea declares two fill bodies, threads and chat, each owning its track", () => {
  const panes = chat.spec.panes;
  expect(Object.fromEntries(Object.entries(panes).map(([id, pane]) => [id, pane.body]))).toEqual({
    threads: "fill",
    chat: "fill",
  });
  expect(scrollTracks(panes), "the kernel draws no scroll track around a body that owns one").toBe(0);
});

test("the dock hosts two route surfaces, so neither dock pane adds a track", () => {
  expect(DOCK_PANES).toEqual({ pea: { body: "fill" }, tools: { body: "fill" } });
  expect(scrollTracks(DOCK_PANES)).toBe(0);
});
