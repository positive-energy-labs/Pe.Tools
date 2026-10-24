// @vitest-environment jsdom
import { Profiler, act } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { TurnPeek } from "./peek";
import type { Turn } from "./moments";

/**
 * The peek is a core feature with a perf budget: one commit to open, at most one more while the
 * pointer rests on the same tick, one per step to a neighbour. This pins those counts so a change to the rail's
 * geometry (the slot rule, drag-to-scrub) cannot quietly make the peek render more.
 */
afterEach(cleanup);
/** Observed at 298b4b07, peek.tsx untouched by wave 10: open 1; the first still move on the same tick
 *  re-renders once with no DOM change (React's same-state bailout commits the Profiler once), later
 *  still moves none; a step 1; off every tick 0. */
const PINNED = [1, 2, 3, 3];

const turns: Turn[] = [1, 2, 3].map((turn) => ({
  turn,
  first: `u${turn}`,
  last: `a${turn}`,
  ask: `ask ${turn}`,
  answer: `answer ${turn}`,
}));

function rail() {
  const lane = document.createElement("div");
  const dial = document.createElement("div");
  dial.dataset.annotation = "dial";
  lane.append(dial);
  document.body.append(lane);
  const rect = (top: number, height: number) => () =>
    ({ top, bottom: top + height, left: 0, right: 10, width: 10, height, x: 0, y: top }) as DOMRect;
  lane.getBoundingClientRect = rect(0, 600);
  dial.getBoundingClientRect = rect(0, 600);
  turns.forEach((turn, index) => {
    const band = document.createElement("div");
    band.dataset.annotation = "dial-band";
    band.dataset.key = turn.first;
    band.dataset.index = String(index);
    band.getBoundingClientRect = rect(100 + index * 50, 48);
    const tick = document.createElement("div");
    tick.dataset.annotation = "dial-tick";
    tick.dataset.index = String(index);
    tick.getBoundingClientRect = rect(148 + index * 50, 1);
    dial.append(band, tick);
  });
  return { lane, dial };
}

const move = (el: HTMLElement, clientY: number) =>
  act(() => {
    el.dispatchEvent(
      new (globalThis.PointerEvent ?? MouseEvent)("pointermove", {
        bubbles: true,
        clientY,
        buttons: 0,
      }),
    );
  });

test("the peek commits once to open, never on a still pointer, once per step", () => {
  // jsdom has no CSS.escape; the peek only uses it to find its band.
  (globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s };
  const { lane, dial } = rail();
  let commits = 0;
  render(
    <Profiler id="peek" onRender={() => commits++}>
      <TurnPeek
        turns={turns}
        laneRef={{ current: lane }}
        dialRef={{ current: dial }}
        goTo={() => {}}
      />
    </Profiler>,
  );
  const mounted = commits;
  const trail: number[] = [];
  const card = () =>
    document.querySelector('[data-annotation="peek-card"]:not([data-ghost])')?.textContent;

  move(dial, 148); // on tick #1
  expect(card()).toContain("#1");
  trail.push(commits - mounted);

  move(dial, 150); // still within the same tick's hit
  move(dial, 146);
  trail.push(commits - mounted);

  move(dial, 198); // step to tick #2
  expect(card()).toContain("#2");
  expect(dial.querySelector('[data-key="u2"]')?.hasAttribute("data-peeked")).toBe(true);
  trail.push(commits - mounted);

  move(dial, 20); // off every tick and band: nothing changes
  trail.push(commits - mounted);

  expect(trail).toEqual(PINNED);
});
