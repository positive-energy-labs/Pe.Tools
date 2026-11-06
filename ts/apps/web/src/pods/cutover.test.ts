import { afterEach, expect, test, vi } from "vite-plus/test";
import { memberWork, settingsRouteState } from "@pe/agent-contracts";
import { builtinRouteStamp, loadBuiltinRoute } from "../route/builtin-inventory";
import { createRouteShell } from "../shell/admitted-mount";
import { sourceRouteServices } from "../shell/source-route-services";
import { placeInput } from "../shell/admitted-place.test-fixture";
async function createPodsFixture() {
  const result = await loadBuiltinRoute("pods", builtinRouteStamp("pods"));
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return createRouteShell(sourceRouteServices({})).mount(
    result.route,
    placeInput({
      read: () => new URLSearchParams({ fixture: "browse" }),
      write() {},
      subscribe: () => () => {},
    }),
  );
}
import { acceptedWork } from "../shell/admitted-work.test-support";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { module } from "./kernel";
import { isValidElement } from "react";
import type { Body } from "./panes";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
const closes: (() => void)[] = [];
afterEach(() => {
  closes.splice(0).forEach((close) => close());
  vi.unstubAllGlobals();
});
const settle = (observation: unknown) =>
  new Promise<WorkWriteOutcome>((resolve) => {
    (observation as Observation<WorkWriteOutcome>).subscribe(
      (outcome) => {
        if (outcome.kind !== "pending") resolve(outcome);
      },
      () => {},
    );
  });

test("Pods admits its real caller declaration with host-fenced member writes", async () => {
  const result = await loadBuiltinRoute("pods", builtinRouteStamp("pods"));
  expect(result.ok ? [] : result.diagnostics).toEqual([]);
  if (!result.ok) throw Error("Pods refused admission");
  expect(result.route.data).toEqual(module.data);
  expect(module.data.verbs.save).toMatchObject({ kind: "command", entry: "settings.write" });
  expect(module.data.fields.pod.agent).toBe("read");
  expect(module.data.fields.path.agent).toBe("read");
  expect(module.data.fields.runs.agent).toBe("set");
});

test("Pods switches actual seeded members, preserves their Work and undoes edits without host access", async () => {
  const fetch = vi.fn(() => {
    throw Error("Real host called");
  });
  vi.stubGlobal("fetch", fetch);
  const mount = await createPodsFixture();
  closes.push(() => mount.close());
  await acceptedWork(mount);
  const first = { pod: String(mount.page.read().pod), path: String(mount.page.read().path) };
  expect(mount.readingStatus("member").snapshot).toMatchObject({
    current: true,
    value: { member: first },
  });
  expect(mount.workBasis()?.token.scope.identity.work).toMatchObject({ work: memberWork(first) });
  expect(mount.subjectDisplay()).toBe(first.path);
  const basis = mount.workBasis()!;
  expect(await settle(mount.invoke("edit", { content: '{"fixture":true}' }, basis))).toMatchObject({
    kind: "accepted",
  });
  expect(settingsRouteState.schema.parse(mount.work()?.value).fields[""]?.edit?.value).toBe(
    '{"fixture":true}',
  );
  expect(mount.invoke("select", { pod: "demo", path: "settings/family/box.json" })).toMatchObject({
    kind: "accepted",
  });
  await acceptedWork(mount);
  expect(mount.readingStatus("member").snapshot).toMatchObject({
    current: true,
    value: { member: { pod: "demo", path: "settings/family/box.json" } },
  });
  expect(settingsRouteState.schema.parse(mount.work()?.value).fields[""]).toBeUndefined();
  expect(() => mount.invoke("edit", { content: '{"stale":true}' }, basis)).toThrow();
  mount.invoke("select", first);
  await acceptedWork(mount);
  expect(settingsRouteState.schema.parse(mount.work()?.value).fields[""]?.edit?.value).toBe(
    '{"fixture":true}',
  );
  expect(await mount.restoreWork("undo")).toMatchObject({ ok: true });
  expect(settingsRouteState.schema.parse(mount.work()?.value).fields[""]).toBeUndefined();
  expect(await mount.restoreWork("redo")).toMatchObject({ ok: true });
  expect(settingsRouteState.schema.parse(mount.work()?.value).fields[""]?.edit?.value).toBe(
    '{"fixture":true}',
  );
  expect(fetch).not.toHaveBeenCalled();
});

test("Pods keeps editor state local, rejects Pea member movement and names every Work field", async () => {
  const mount = await createPodsFixture();
  closes.push(() => mount.close());
  await acceptedWork(mount);
  const pane = mount.read("spec");
  if (!isValidElement<Body>(pane)) throw Error("Pods spec did not produce its declared body");
  expect(pane.props.fixture).toBe("browse");
  expect(pane.props.page.device("mode", "raw")).toMatchObject({ kind: "accepted" });
  expect(pane.props.page.transient("pendingDraft", true)).toMatchObject({ kind: "accepted" });
  expect(mount.page.read()).toMatchObject({ mode: "raw", pendingDraft: true });
  expect(mount.peaMove({ pod: "demo" })).toMatchObject({ kind: "refused" });
  expect(
    Object.keys(settingsRouteState.schema.shape).filter(
      (key) =>
        !Object.hasOwn(module.data.cells, key) && !Object.hasOwn(module.data.workFields, key),
    ),
  ).toEqual([]);
});

test("a nonfixture Place projects null provenance through the same admitted pane constructor", async () => {
  const route = await loadBuiltinRoute("pods", builtinRouteStamp("pods"));
  if (!route.ok) throw Error(JSON.stringify(route.diagnostics));
  const services = {
    ...sourceRouteServices({}),
    work: createFixtureWorkDoor(settingsRouteState, settingsRouteState.schema.parse({})),
  };
  const mount = createRouteShell(services).mount(
    route.route,
    placeInput({ read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} }),
  );
  closes.push(() => mount.close());
  await acceptedWork(mount);
  const pane = mount.read("spec");
  if (!isValidElement<Body>(pane)) throw Error("Pods spec did not produce its declared body");
  expect(pane.props.fixture).toBeNull();
});
