// @vitest-environment jsdom
import * as Atom from "effect/reactivity/Atom";
import { RegistryContext } from "@effect/atom-react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { setHovered } from "@pe/kit/lang/attention";
import { Pane } from "@pe/kit/lang/pane";
import { makeAtomRegistry } from "#/shell/owner";
import { AttentionScope } from "#/attention";
import { DEMO_PLAN, DEMO_ROOMS, DEMO_VIEW } from "./demo";
import { roomsPageSchema } from "./page";
import { RoomsPlan } from "./plan";
import { roomRows } from "./table";
import { regionSubject } from "./subject";
import { bindings } from "./bindings";
import type { RoomsContext } from "./route";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// A region is published as `region:<carrierGuid>` (hover, mentions, inbox members); the plan must
// draw that same region hovered and selected, wired as TypedPane wires the Rooms pane.
test("a region hovered or picked as its regionSubject draws hovered and selected on the plan", () => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(private read: ResizeObserverCallback) {}
    observe() { this.read([{ contentRect: { width: 800, height: 600 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() {}
  });
  const [target, other] = DEMO_ROOMS.regions;
  const ctx = { value: { value: { snapshot: DEMO_ROOMS } }, page: { read: () => ({ picked: [target!.guid] }) }, cells: { doc: null }, target: null } as unknown as RoomsContext;
  const bound = bindings(ctx);
  const registry = makeAtomRegistry();
  const doc = "s/1";
  const rows = roomRows(DEMO_ROOMS.regions, ["Fixture level"]);
  const page = roomsPageSchema.parse({ view: DEMO_VIEW });
  const view = render(
    <RegistryContext value={registry}>
      <AttentionScope doc={doc} selected={Atom.make(() => new Set(bound.selected))} members={bound.members}>
        <RoomsPlan renderPane={(body, furniture) => <Pane picture {...furniture}>{body}</Pane>} rows={rows} plan={DEMO_PLAN}
          planRefusal={null} planError={null} empty={null} onSelect={() => {}} trace={{ data: null, none: "fixture" }}
          page={{ read: () => page, pose: () => {} }} />
      </AttentionScope>
    </RegistryContext>,
  );
  const path = (guid: string) => view.container.querySelector<SVGPathElement>(`path[data-subject="${regionSubject(guid)}"]`)!;
  expect(path(target!.guid).style.strokeWidth).toContain("3px");
  expect(path(other!.guid).style.strokeWidth).toContain("2px");
  const rest = path(other!.guid).getAttribute("fill");
  act(() => setHovered(registry, { doc, key: regionSubject(other!.guid) }));
  expect(path(other!.guid).getAttribute("fill")).not.toBe(rest);
  expect(path(other!.guid).getAttribute("fill")).toContain("40%");
});
