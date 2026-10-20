// @vitest-environment jsdom
/** THROWAWAY (protoui round 1): variant C renders on the scene fixture and its pins open popovers. */
import { mkdirSync, writeFileSync } from "node:fs";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, expect, it } from "vite-plus/test";

import { claimsOf } from "../../legs";
import type { DuctsPage } from "../../manifest";
import { SCENE_CLAIMS, SCENE_FIXTURE, SCENE_SUBJECT } from "../../scene.fixture";
import type { ProtoProps } from "../props";
import { CanvasOnly } from "./canvas";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
      this.callback(
        [{ contentRect: { width: 1600, height: 900 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const page: DuctsPage = {
  stage: "survey",
  view: "iso",
  group: "",
  level: "",
  layers: [],
  selected: "",
  issue: "",
  encoding: "health",
  scene: "subject",
  epoch: 0,
  evaluation: null,
};

it("draws the fixture full-bleed with loss labels and ruling pins; a pin opens its ruling", () => {
  const claims = claimsOf(SCENE_CLAIMS);
  const props: ProtoProps = {
    snapshot: SCENE_FIXTURE.snapshot,
    fromFixture: true,
    priced: null,
    findings: [],
    ready: {},
    subject: { ids: SCENE_SUBJECT, claims, onVerdict: () => {} },
    claims,
    claimCells: SCENE_CLAIMS,
    page,
    setPage: () => {},
    onSelect: () => {},
    onSelectClaim: () => {},
    onHover: () => {},
    hovered: null,
    work: { doc: null, revision: null, write: () => {}, preview: null },
    empty: null,
    doc: null,
    reading: { pending: false, error: null },
  };
  const { container } = render(<CanvasOnly {...props} />);
  const segs = container.querySelectorAll("[data-segment]").length;
  const pins = [...container.querySelectorAll("[data-ruling-pin]")];
  const labels = container.querySelectorAll("[data-loss-label]").length;
  expect(segs).toBeGreaterThan(0);
  expect(pins.length).toBeGreaterThan(0);
  expect(labels).toBeGreaterThan(0);
  const before = container.innerHTML;
  act(() => {
    fireEvent.click(pins[0]!);
  });
  const pop = document.body.querySelector("[data-ruling]");
  expect(pop?.textContent).toMatch(/Pea claim/);
  mkdirSync("C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/proto/ducts-r1", { recursive: true });
  writeFileSync(
    "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/proto/ducts-r1/C-dom.html",
    `<!doctype html><html data-pe><head><meta charset="utf-8"><link rel="stylesheet" href="http://127.0.0.1:5280/src/styles.css"></head><body style="margin:0;width:1600px;height:900px">${before}<div style="position:absolute;left:900px;top:120px;width:320px;background:#fff;border:1px solid #999;padding:8px">${pop?.outerHTML ?? ""}</div></body></html>`,
  );
  console.log(JSON.stringify({ segs, pins: pins.length, labels, kinds: pins.map((p) => p.getAttribute("data-ruling-kind")) }));
});
