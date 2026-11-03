// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { module, scheduleIdentity } from "./kernel";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { createRouteShell } from "../shell/admitted-mount";
import { sourceRouteServices } from "../shell/source-route-services";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door";

const close: (() => void)[] = [];
afterEach(() => {
  cleanup();
  close.splice(0).forEach((fn) => fn());
});
async function admit() {
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data,
    hostVersion: "fixture",
    variants: [{ client: "web" as const, entry: "schedules/kernel.tsx" }],
    modules: [{ id: "schedules/kernel.tsx", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    schedules: {
      module,
      closure: { envelope, fingerprint },
      catalog: Object.entries(module.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  });
  const result = (await inventory.prepare("schedules", fingerprint)).admit(module);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.route;
}
async function fixture(name = "read") {
  const open = vi.fn(() => {
    throw Error("Fixture reached transport");
  });
  const route = await admit();
  const shell = createRouteShell(
    sourceRouteServices(
      Object.fromEntries(
        Object.keys(module.entries).map((key) => [key, { kind: "use" as const, open }]),
      ),
    ),
  );
  let search = new URLSearchParams({
    fixture: name,
    workspaceId: scheduleIdentity("schedule:fixture"),
  });
  const mount = shell.mount(route, {
    read: () => search,
    write: (next) => {
      search = next;
    },
    subscribe: () => () => {},
  });
  close.push(mount.close);
  return { mount, open, shell, route };
}
test("real admitted mount draws retained schedule cells and resolves the schedule picker without transport", async () => {
  const { mount, open } = await fixture();
  expect(mount.page.read().workspaceId).toBe(scheduleIdentity("schedule:fixture"));
  expect(mount.picker("workspaceId")).toEqual([
    { id: scheduleIdentity("schedule:fixture"), label: "Mechanical equipment" },
  ]);
  render(mount.read("grid") as ReactNode);
  expect(screen.getByText("IU-1")).toBeTruthy();
  expect(screen.getByText("FXMQ15")).toBeTruthy();
  mount.refresh();
  expect(open).not.toHaveBeenCalled();
});
test("rendered Work basis survives a delayed edit and refuses reuse after publication", async () => {
  const { mount } = await fixture();
  mount.read("grid");
  const basis = mount.workBasis()!;
  const edit = mount.invoke(
    "edit",
    { patches: [{ path: ["cells", "1::1"], value: { edit: { value: "replacement" } } }] },
    basis,
  ) as Observation<WorkWriteOutcome>;
  const outcome = await new Promise<WorkWriteOutcome>((resolve) =>
    edit.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve(value);
      },
      () => {},
    ),
  );
  expect(outcome.kind).toBe("accepted");
  expect(mount.work()?.value).toMatchObject({
    cells: { "1::1": { edit: { value: "replacement" } } },
  });
  const stale = mount.invoke("edit", { patches: [] }, basis) as Observation<WorkWriteOutcome>;
  const refused = await new Promise<WorkWriteOutcome>((resolve) =>
    stale.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve(value);
      },
      () => {},
    ),
  );
  expect(refused.kind).toBe("refused");
  expect(mount.work()?.value).toMatchObject({
    cells: { "1::1": { edit: { value: "replacement" } } },
  });
});
test.each(["", "unknown"])(
  "missing fixture %s refuses instead of reading the model",
  async (name) => {
    const { mount, open } = await fixture(name);
    expect(renderToStaticMarkup(mount.read("grid") as ReactNode)).not.toContain("FXMQ15");
    expect(open).not.toHaveBeenCalled();
  },
);

test("decoded admitted subject opens the existing schedule workspace key", async () => {
  const { mount } = await fixture();
  const key = mount.workBasis()!.token.scope.identity.work!;
  expect(key.binding).toBe("workspace");
  if (key.binding !== "workspace") throw Error("Expected schedule workspace");
  expect(key.work).toBe("schedule:fixture");
});

import { applyPatches, scheduleGridRouteState } from "@pe/agent-contracts";

test("G3: top-level cells replacement loses untouched stale marks at the authoritative schedule reducer", () => {
  const doc = scheduleGridRouteState.schema.parse({
    basis: {
      captureId: "a".repeat(64),
      stale: [
        { key: "1::1", was: "a" },
        { key: "1::2", was: "b" },
      ],
    },
    cells: { "1::1": { edit: { value: "a" } }, "1::2": { edit: { value: "b" } } },
  });
  const envelope = { version: 1 as const, revision: 0, doc };
  const patches = [{ path: ["cells", "1::1", "edit"], value: { value: "reviewed" } }];
  const direct = applyPatches(scheduleGridRouteState, envelope, "human", patches, 0);
  expect(direct.ok).toBe(true);
  if (!direct.ok) throw Error("Domain edit refused");
  expect(direct.envelope.doc.basis?.stale).toEqual([{ key: "1::2", was: "b" }]);
  // This is the strongest patch the current typed WorkPatches contract permits.
  const root = applyPatches(
    scheduleGridRouteState,
    envelope,
    "human",
    [{ path: ["cells"], value: direct.envelope.doc.cells }],
    0,
  );
  expect(root.ok).toBe(true);
  if (!root.ok) throw Error("Root replacement refused");
  expect(root.envelope.doc.basis?.stale).toBeUndefined();
});

test("accepted edits undo and redo through the mount's Work history", async () => {
  const { mount } = await fixture();
  const before = mount.work()?.value;
  const observation = mount.invoke(
    "edit",
    { patches: [{ path: ["cells", "1::1"], value: { edit: { value: "edited" } } }] },
    mount.workBasis()!,
  ) as Observation<WorkWriteOutcome>;
  await new Promise<void>((resolve) =>
    observation.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve();
      },
      () => {},
    ),
  );
  const edited = mount.work()?.value;
  expect(edited).not.toEqual(before);
  expect((await mount.history!.undo()).ok).toBe(true);
  expect(mount.work()?.value).toEqual(before);
  expect((await mount.history!.redo()).ok).toBe(true);
  expect(mount.work()?.value).toEqual(edited);
});

import { createFixtureWorkDoor } from "../shell/fixture-work-door";

test("G3 mount witness: the typed root adapter clears an untouched stale cell on the real domain Work door", async () => {
  const store = createFixtureWorkDoor(scheduleGridRouteState, {
    basis: {
      captureId: "a".repeat(64),
      stale: [
        { key: "1::1", was: "a" },
        { key: "1::2", was: "b" },
      ],
    },
    cells: { "1::1": { edit: { value: "a" } }, "1::2": { edit: { value: "b" } } },
  });
  const mount = createRouteShell({ ...sourceRouteServices({}), work: store }).mount(await admit(), {
    read: () => new URLSearchParams({ workspaceId: scheduleIdentity("schedule:fixture") }),
    write: () => {},
    subscribe: () => () => {},
  });
  close.push(mount.close);
  const result = mount.invoke(
    "edit",
    { patches: [{ path: ["cells", "1::1", "edit"], value: { value: "reviewed" } }] },
    mount.workBasis()!,
  ) as Observation<WorkWriteOutcome>;
  const outcome = await new Promise<WorkWriteOutcome>((resolve) =>
    result.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve(value);
      },
      () => {},
    ),
  );
  expect(outcome.kind).toBe("accepted");
  expect(scheduleGridRouteState.schema.parse(mount.work()?.value).basis?.stale).toBeUndefined();
});
