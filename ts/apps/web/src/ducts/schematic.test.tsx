// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { scopeOf } from "@pe/ducts-domain/system-scope";
import { makeAtomRegistry } from "#/route/route-owner";
import { TestAttention } from "#/test-attention";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import { encodingFor } from "./encoding";
import { indexOf, sceneOf } from "./scene";
import { Schematic } from "./schematic";

afterEach(cleanup);

test("open networks draw separate schematic roots in open order, shared networks once", () => {
  const { snapshot } = NAVIGATION_FIXTURE;
  const scope = scopeOf(snapshot, ["EA Lab", "SA Office", "SA Lab"])!;
  const index = indexOf(snapshot);
  const encoding = encodingFor(
    "health",
    sceneOf(index, scope.groups, () => true),
  );
  const pick = vi.fn();
  const { container } = render(
    <TestAttention registry={makeAtomRegistry()}>
      <Schematic
        readout={null}
        index={index}
        groups={scope.groups}
        encoding={encoding}
        onSelect={pick}
        size="inset"
      />
    </TestAttention>,
  );
  expect(
    [...container.querySelectorAll("[data-schematic-group]")].map((e) =>
      e.getAttribute("data-schematic-group"),
    ),
  ).toEqual(["g4001", "g1001"]);
  expect(container.querySelectorAll('[aria-label="root"]')).toHaveLength(2);
  const exhaust = container.querySelector('[data-schematic-group="g4001"] [data-element]')!;
  fireEvent.click(exhaust);
  expect(pick).toHaveBeenCalledWith(Number(exhaust.getAttribute("data-element")));
});
