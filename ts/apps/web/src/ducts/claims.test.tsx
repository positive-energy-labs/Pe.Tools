// @vitest-environment jsdom
/**
 * /ducts scene claims, deterministic: an element id in a claim's text reads as the element's name
 * (or a dot where the prose already names it), lights the element on hover, and crosses into Revit
 * only on a click. The `?demo=scene` fixture exercises one gap and one omission.
 */
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { ductsRouteState } from "@pe/agent-contracts";

import { readiness } from "@pe/ducts-domain/readiness";
import { claimParts, elementNamer } from "./claims";
import { claimsOf, legsOf } from "./legs";
import type { DuctsPage } from "./manifest";
import { SCENE_FIXTURE } from "./scene.fixture";
import { DuctsSpatial } from "./spatial";

const { callHostRpc } = vi.hoisted(() => ({
  callHostRpc: vi.fn(async () => ({ shown: [1], missing: [], viewName: "3D" })),
}));
vi.mock("#/host/client", () => ({ callHostRpc }));

beforeAll(() => {
  // jsdom does not substitute var() in a computed custom property; the hover halo reads this one.
  document.documentElement.style.setProperty("--pe-veil", "rgb(0 0 0 / 10%)");
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
      this.callback(
        [{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  callHostRpc.mockClear();
});

const { snapshot, subject } = SCENE_FIXTURE;

it("an id resolves to its label, else a short kind; the prose's own noun makes it a dot; unknown numbers stay text", () => {
  const nameOf = elementNamer(snapshot, null);
  expect(nameOf(14577391)).toBe("MUAS-1");
  expect(nameOf(14107111)).toBe("end cap");
  expect(nameOf(14122436)).toBe("12″ duct");
  expect(nameOf(6105264)).toBeNull();
  expect(
    claimParts("duct 14122436 meets end cap 14107111 near 14577391; ERV 6105264.", nameOf),
  ).toEqual([
    "duct ",
    { id: 14122436, name: "12″ duct", dot: true },
    " meets end cap ",
    { id: 14107111, name: "end cap", dot: true },
    " near ",
    { id: 14577391, name: "MUAS-1", dot: false },
    "; ERV 6105264.",
  ]);
});

const page: DuctsPage = {
  stage: "survey",
  view: "plan",
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

const draw = (doc: { session: string; openId: string } | null) => {
  const setPage = vi.fn();
  const { container } = render(
    <DuctsSpatial
      snapshot={snapshot}
      ready={readiness(snapshot, ductsRouteState.schema.parse({}))}
      priced={null}
      page={page}
      setPage={setPage}
      empty={null}
      subject={{ ids: subject, claims: claimsOf(SCENE_FIXTURE.claims), onVerdict: () => {} }}
      doc={doc}
    />,
  );
  return { container, setPage };
};

it("the scene fixture draws one gap at the unjoined intake and one omission between FR-1 and FC-23", () => {
  const cut = legsOf(snapshot, subject);
  expect(cut.gaps).toEqual([{ after: 14107111, before: 14122436 }]);
  expect(cut.omissions).toEqual([
    { after: 13760866, before: 13760867, skipped: [13761466, 13761629, 13761574] },
  ]);
  const { container } = draw(null);
  expect(container.querySelector('[data-gap="14107111-14122436"]')).not.toBeNull();
  expect(container.querySelector('[data-omission="13760866-13760867"]')).not.toBeNull();
  expect(container.textContent).toContain("1 gap · 1 omission");
});

it("hovering a resolved id lights its element and sends nothing; a click selects it in Revit", () => {
  const { container } = draw({ session: "s", openId: "o" });
  const row = container.querySelector('[data-claim-row="c3"]') as HTMLElement;
  const duct = within(row).getByRole("button", { name: "12″ duct 14122436" });
  fireEvent.mouseEnter(duct);
  expect(container.querySelector('[data-segment="14122436"][data-hovered]')).not.toBeNull();
  expect(callHostRpc).not.toHaveBeenCalled();
  fireEvent.click(duct);
  expect(callHostRpc).toHaveBeenCalledWith(
    "revit.context.show-elements",
    { elementIds: [14122436] },
    { bridgeSessionId: "s", openDocumentId: "o" },
  );
});

it("with no document, a click on a resolved id selects it in the drawing", () => {
  const { container, setPage } = draw(null);
  const row = container.querySelector('[data-claim-row="c3"]') as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "end cap 14107111" }));
  expect(setPage).toHaveBeenCalledWith({ selected: "14107111", issue: "" });
  expect(callHostRpc).not.toHaveBeenCalled();
});
