// @vitest-environment jsdom
import { act } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { TurnPeek } from "./peek";
import { scrubRail } from "./model";
import { railLayout } from "./scale";
import type { Turn } from "./moments";

afterEach(cleanup);

const turns: Turn[] = [1, 2, 3].map((turn) => ({
  turn,
  first: `u${turn}`,
  last: `a${turn}`,
  ask: `ask ${turn}`,
  answer: `answer ${turn}`,
}));

/** A lane holding the rail (three 48px bands from y 100, ticks at their bottoms) and the peek, as
 *  view.tsx draws them; the rail's scrub and the peek's press both live on it. */
function mount() {
  (globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s };
  const lane = document.createElement("div");
  const dial = document.createElement("div");
  dial.dataset.annotation = "dial";
  dial.setPointerCapture = () => {};
  lane.append(dial);
  document.body.append(lane);
  const rect = (top: number, height: number) => () =>
    ({ top, bottom: top + height, left: 0, right: 10, width: 10, height, x: 0, y: top }) as DOMRect;
  lane.getBoundingClientRect = rect(0, 600);
  dial.getBoundingClientRect = rect(100, 150);
  turns.forEach((turn, index) => {
    const band = document.createElement("div");
    band.dataset.annotation = "dial-band";
    band.dataset.key = turn.first;
    band.dataset.index = String(index);
    band.getBoundingClientRect = rect(100 + index * 50, 50);
    const tick = document.createElement("div");
    tick.dataset.annotation = "dial-tick";
    tick.dataset.index = String(index);
    tick.getBoundingClientRect = rect(150 + index * 50, 1);
    dial.append(band, tick);
  });
  const goTo = vi.fn();
  const host = document.createElement("div");
  lane.append(host);
  render(
    <TurnPeek turns={turns} laneRef={{ current: lane }} dialRef={{ current: dial }} goTo={goTo} />,
    { container: host },
  );
  const scroller = { scrollTop: 0 } as HTMLElement;
  const geom = [0, 1, 2].map((i) => ({
    key: `u${i + 1}`,
    turn: i + 1,
    top: i * 1000,
    height: 1000,
    blocks: [i * 1000],
  }));
  const map = railLayout(geom, 3000, 150);
  scrubRail(
    dial,
    scroller,
    { current: null },
    () => map,
    () => {},
  );
  return { lane, dial, goTo, scroller };
}

const fire = (el: Element, type: string, clientY: number, buttons = 0) =>
  act(() => {
    el.dispatchEvent(
      new (globalThis.PointerEvent ?? MouseEvent)(type, {
        bubbles: true,
        clientY,
        button: 0,
        buttons,
      }),
    );
  });

/** A press as Chrome delivers it: down where it began, then up and click on the dial, which holds
 *  the pointer capture. */
const press = (start: Element, dial: Element, clientY: number) => {
  fire(start, "pointerdown", clientY, 1);
  fire(dial, "pointerup", clientY);
  act(() => {
    dial.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY }));
  });
};

test("a press on a slot, away from its tick, goes to that turn", () => {
  const { dial, goTo } = mount();
  press(dial, dial, 175); // mid band #2, 25px from either tick
  expect(goTo).toHaveBeenCalledExactlyOnceWith("u2");
});

test("a press in the funnel gap acts on the slot at its height; a drag from it scrubs", () => {
  const { lane, dial, goTo, scroller } = mount();
  fire(dial, "pointermove", 150); // open the peek on tick #1
  const funnel = lane.querySelector('[data-annotation="peek-funnel"] polygon')!;
  expect(funnel).not.toBeNull();
  press(funnel, dial, 225); // mid band #3
  expect(goTo).toHaveBeenCalledExactlyOnceWith("u3");

  fire(funnel, "pointerdown", 125, 1);
  fire(dial, "pointermove", 200, 1);
  expect(scroller.scrollTop).toBeGreaterThan(0);
  fire(dial, "pointerup", 200);
  act(() => {
    dial.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: 200 }));
  });
  // The click that ends a scrub is swallowed: no jump.
  expect(goTo).toHaveBeenCalledTimes(1);
});
