import { browserActionSays } from "@pe/agent-contracts";
/**
 * The stage rung of the scope tree binds the stage's own chords (ledger 2026-09-22): push is a
 * stage verb, so `StageDecl.keys` is where `Mod+Enter` lives and the manifest carries no chord for
 * it. The route node alone must not fire it; the stage node must; a chat pane that owns neither the
 * URL nor the chords must not.
 */
// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { RouteKeys, StageKeys } from "./keys";
import { schedulesManifest } from "./schedules/manifest";
import { SCHEDULE_STAGES } from "./schedules/stage";

afterEach(cleanup);

/** Only what `RouteKeys` and `StageKeys` read off a handle: the action's words and its run. */
const handleWith = (push: () => void) =>
  ({
    manifest: { name: "schedules" },
    actions: {
      push: {
        label: "push",
        says: browserActionSays.memberOpen,
        refusal: null,
        chord: undefined,
        run: async () => {
          push();
          return null;
        },
      },
    },
  }) as never;

/** `Mod` resolves to Control off mac, and jsdom is never mac. */
const modEnter = () => fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });

test("the push chord fires from the stage node and from nowhere else", () => {
  const push = vi.fn();
  const handle = handleWith(push);

  // The route node alone: the manifest declares no chord, so nothing is bound.
  const bare = render(<RouteKeys handle={handle} />);
  modEnter();
  expect(push).not.toHaveBeenCalled();
  bare.unmount();

  // The same route with a stage drawing under it: the stage's own `keys` bind it.
  const staged = render(
    <RouteKeys handle={handle}>
      <StageKeys id="schedules:audit" handle={handle} keys={SCHEDULE_STAGES.audit.keys} />
    </RouteKeys>,
  );
  modEnter();
  expect(push).toHaveBeenCalledTimes(1);

  // The stage leaves and the chord leaves with it.
  staged.unmount();
  modEnter();
  expect(push).toHaveBeenCalledTimes(1);
});

test("a page that does not own the chords binds no stage chord either", () => {
  const push = vi.fn();
  const handle = handleWith(push);
  render(
    <RouteKeys handle={handle} chords={false}>
      <StageKeys
        id="schedules:audit"
        handle={handle}
        keys={SCHEDULE_STAGES.audit.keys}
        chords={false}
      />
    </RouteKeys>,
  );
  modEnter();
  expect(push).not.toHaveBeenCalled();
});

test("the stage declares the one chord that writes to Revit, and the manifest declares none", () => {
  for (const stage of Object.values(SCHEDULE_STAGES)) expect(stage.keys.push).toBe("Mod+Enter");
  // The route node binds every manifest action that carries a chord; push carries none, so the
  // stage node is the only thing that can fire it.
  const actions = schedulesManifest().actions as Record<string, { chord?: unknown }>;
  for (const [name, action] of Object.entries(actions))
    expect(action.chord, `${name} binds a chord on the route node`).toBeUndefined();
});
