import { expect, test, vi } from "vite-plus/test";
import {
  builtinData,
  schemas,
} from "../../../../packages/agent-contracts/src/route-kernel.fixtures";
import { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate";
import { createRouteTokenIssuer } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { createPagePolicy, identityCodecs } from "./page-port";
import { createAdmittedPlace } from "./admitted-place";
import type { RouteActivityScope } from "../route/activity";

function fixture() {
  let active = "a";
  let search = new URLSearchParams("fan=a");
  const listeners = new Set<() => void>();
  const write = vi.fn((next: URLSearchParams) => {
    search = new URLSearchParams(next);
    listeners.forEach((listener) => listener());
  });
  const address = {
    read: () => search,
    write,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const makeState = () => {
    const policy = createPagePolicy(builtinData, schemas, () => "unresolved");
    const initial = policy.initial();
    if (!initial.ok) throw Error(initial.reason);
    const owner = createRouteScopeGate<typeof builtinData, typeof schemas>({
      issuer: createRouteTokenIssuer(),
      preparePage: policy.prepare,
      workSchema: schemas.work,
      hashWork: JSON.stringify,
      dependencies: () => ({}),
      journal: () => {
        throw Error("No Work writes in Place witness");
      },
    });
    owner.enter({ target: null, work: null }, initial.value);
    return {
      owner,
      readings: Object.freeze({ fan: "accepted fan reading" }),
      dispose: vi.fn(() => owner.close()),
    };
  };
  function place(id: string) {
    const owners = new Set<{ dispose(): void }>();
    const scope: RouteActivityScope = {
      pathname: "/tiny",
      search: {},
      current: () => active === id,
      retain: (owner) => {
        owners.add(owner);
      },
      retire: (owner) => {
        owners.delete(owner);
        owner.dispose();
      },
    };
    const place = createAdmittedPlace<ReturnType<typeof makeState>>({
      scope,
      address,
      search: new URLSearchParams({ fan: id, fixture: id }),
      visible: true,
    });
    return { place, remove: () => owners.forEach((owner) => owner.dispose()) };
  }
  return {
    place,
    makeState,
    address,
    write,
    activate: (id: string) => {
      active = id;
    },
  };
}

test("two Places retain independent Page selection/pose and accepted values across hide", () => {
  const f = fixture();
  const a = f.place("a");
  const stateA = a.place.state(f.makeState);
  const first = '["system","fan-a"]';
  const second = '["system","fan-b"]';
  const restore = (state: typeof stateA, system: string, x: number) => {
    // Role and selection validation still belong to the real Page owner.
    const id = identityCodecs.local.encode({ namespace: "system", subject: JSON.parse(system)[1] });
    if (!id.ok) throw Error(id.reason);
    const result = state.owner.movePage(
      { system: id.value },
      { kind: "human", source: "subject", history: "push" },
    );
    expect(result.kind).toBe("accepted");
    const selected = state.owner.movePage(
      { selected: [{ kind: "system", id: id.value }] },
      { kind: "human", source: "selection", history: "push" },
    );
    expect(selected.kind).toBe("accepted");
    expect(
      state.owner.movePage(
        { viewport: { x, y: 1 } },
        { kind: "human", source: "pose", history: "replace" },
      ).kind,
    ).toBe("accepted");
  };
  restore(stateA, first, 10);
  a.place.remember(stateA.owner.read()!.page);
  a.place.setVisible(false);
  f.activate("b");
  const b = f.place("b");
  const stateB = b.place.state(f.makeState);
  restore(stateB, second, 20);
  const beforeA = stateA.owner.read();
  const beforeB = stateB.owner.read();
  a.place.setVisible(true);
  expect(
    a.place.state(() => {
      throw Error("must not recreate on reveal");
    }),
  ).toBe(stateA);
  expect(stateA.owner.read()).toBe(beforeA);
  expect(stateB.owner.read()).toBe(beforeB);
  expect(stateA.owner.read()!.page.system).toBe(first);
  expect(stateB.owner.read()!.page.system).toBe(second);
  expect(stateA.owner.read()!.page.viewport).toEqual({ x: 10, y: 1 });
  expect(stateB.owner.read()!.page.viewport).toEqual({ x: 20, y: 1 });
  expect(stateA.owner.read()!.page.selected).not.toEqual(stateB.owner.read()!.page.selected);
  expect(a.place.memory()).toEqual(stateA.owner.read()!.page);
  expect(stateA.readings.fan).toBe("accepted fan reading");
  expect(stateA.dispose).not.toHaveBeenCalled();
  a.remove();
  b.remove();
  expect(stateA.dispose).toHaveBeenCalledTimes(1);
});

test("inactive callbacks cannot read another Place's URL or write it, including target", () => {
  const f = fixture();
  const a = f.place("a");
  a.place.address.write(new URLSearchParams("fan=a&target=one&fixture=changed"), "push");
  f.activate("b");
  f.address.write(new URLSearchParams("fan=b&target=two"));
  const b = f.place("b");
  f.write.mockClear();
  a.place.address.write(new URLSearchParams("target=wrong"), "replace");
  expect(a.place.fixture).toBe("a");
  expect(f.write).not.toHaveBeenCalled();
  expect(a.place.address.read().get("fan")).toBe("a");
  expect(b.place.address.read().get("target")).toBe("two");
  a.remove();
  b.remove();
});
