import { placeInput } from "./admitted-place.test-fixture";
import { acceptedWork } from "./admitted-work.test-support";
import { expect, test } from "vite-plus/test";
import {
  builtinData,
  builtinModule,
  schemas,
} from "../../../../packages/agent-contracts/src/route-kernel.fixtures";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import type { KernelServices } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { InvocationBasis } from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { WorkScope } from "../../../../packages/agent-contracts/src/work-journal-door";
import { createFixtureWorkDoor } from "./fixture-work-door";
import { createRouteShell } from "./admitted-mount";

test("decoded subject opens existing host Work and never opens an encoded workspace key", async () => {
  const id = builtinModule.identities.local.encode({
    namespace: "schedules",
    subject: "schedule:fixture",
  });
  if (!id.ok) throw Error(id.reason);
  const data = {
    ...builtinData,
    workSubject: "system",
    fields: { ...builtinData.fields, system: { ...builtinData.fields.system, initial: id.value } },
  } as const;
  const module = { ...builtinModule, data };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data,
    hostVersion: "test",
    variants: [{ client: "web" as const, entry: "test.ts" }],
    modules: [{ id: "test.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    tiny: {
      module,
      closure: { envelope, fingerprint },
      catalog: Object.entries(module.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  });
  const admitted = (await inventory.prepare("tiny", fingerprint)).admit(module);
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  const store = createFixtureWorkDoor(
    { route: "tiny", title: "", description: "", schema: schemas.work },
    { amount: 0, note: "" },
  );
  const scope: WorkScope = {
    route: "tiny",
    fingerprint: admitted.route.workFingerprint,
    key: { binding: "workspace", route: "tiny", target: null, work: "schedule:fixture" },
    target: null,
    subject: id.value,
  };
  await new Promise<void>((resolve) =>
    store
      .submitWork(
        scope,
        {
          kind: "apply",
          press: "host",
          expectedRevision: 0,
          patches: [{ path: ["amount"], value: 41 }],
        },
        {} as InvocationBasis,
      )
      .subscribe(
        (outcome) => {
          if (outcome.kind === "accepted") resolve();
        },
        () => {},
      ),
  );
  const opened: WorkScope[] = [];
  const services: KernelServices = {
    work: {
      ...store,
      open: (scope) => {
        opened.push(scope);
        return store.open(scope);
      },
    },
    reads: {
      lifetime: "read",
      acquire: (request) => ({
        lifetime: "read",
        key: request.key,
        release() {},
        read: () => ({ status: "pending", current: false, reason: "Waiting" }),
      }),
    },
    readings: { lifetime: "subscription", subscribe: () => () => {} },
    clock: { lifetime: "read", now: Date.now },
    availability: {},
  };
  let search = new URLSearchParams();
  const mount = createRouteShell(services).mount(
    admitted.route,
    placeInput({
      read: () => search,
      write: (next) => {
        search = next;
      },
      subscribe: () => () => {},
    }),
  );
  try {
    await acceptedWork(mount);
    expect(mount.work()).toEqual({ revision: 1, value: { amount: 41, note: "" } });
    expect(opened.length).toBeGreaterThan(0);
    expect(
      opened.every(
        (scope) => scope.key.binding === "workspace" && scope.key.work === "schedule:fixture",
      ),
    ).toBe(true);
    expect(
      opened.some((scope) => scope.key.binding === "workspace" && scope.key.work === id.value),
    ).toBe(false);
  } finally {
    mount.close();
  }
});
