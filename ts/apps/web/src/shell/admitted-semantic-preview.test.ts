import { placeInput } from "./admitted-place.test-fixture";
import { acceptedWork } from "./admitted-work.test-support";
import { expect, test, vi } from "vite-plus/test";
import { familiesModule } from "../families/kernel";
import { familiesScopeId } from "../families/neutral";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
  createAdmittedRouteRegistry,
  resolveRouteBindings,
} from "../../../../packages/agent-contracts/src/route-module";
import { commands, familiesRouteState, actionReceiptSchema } from "@pe/agent-contracts";
import { createRouteShell } from "./admitted-mount";
import { createFixtureWorkDoor } from "./fixture-work-door";
import { sourceRouteServices } from "./source-route-services";
import * as actions from "../../../../packages/mcps/src/shared/takeoff-action-client";
import * as host from "../host/runtime";

test("Families admission preserves axes and the mount journals preview with captured Work and target", async () => {
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: familiesModule.data,
    hostVersion: "test",
    variants: [{ client: "web" as const, entry: "families/kernel.ts" }],
    modules: [{ id: "families/kernel.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    families: {
      module: familiesModule,
      closure: { envelope, fingerprint },
      catalog: Object.entries(familiesModule.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  });
  const admitted = (await inventory.prepare("families", fingerprint)).admitUnknown(familiesModule);
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  const registry = createAdmittedRouteRegistry();
  const registration = registry.register(admitted.route);
  expect(
    resolveRouteBindings(registry, admitted.route)!.entries["families.apply.preview"]!.axes,
  ).toMatchObject({
    touches: ["Geometry"],
    effect: "TransactRead",
    rollsBack: true,
  });
  const target = {
    kind: "document" as const,
    ref: { session: "families-preview", openId: "original" },
  };
  const takenAt = "2026-11-03T00:00:00Z";
  const filter = {
    categoryNames: ["Mechanical Equipment"],
    familyNames: ["Pump"],
    placementScope: "AllLoaded" as const,
  };
  const store = createFixtureWorkDoor(
    familiesRouteState,
    familiesRouteState.schema.parse({ scope: { edit: { value: filter } }, takenAt }),
  );
  const source = sourceRouteServices({});
  const native = vi.spyOn(host, "hostFetch");
  const submit = vi.spyOn(actions, "submitAction").mockImplementation(
    async (admission) =>
      actionReceiptSchema.parse({
        ...admission,
        state: "succeeded",
        caller: { kind: "human", via: "local" },
        basis: null,
        steps: [],
        prepared: { state: "unprepared" },
        recovery: [],
        startedAt: takenAt,
        result: {
          previewOnly: true,
          derivedRequest: { familyNames: ["Pump"] },
          seal: {
            requestHash: "sealed",
            work: { handle: admission.input.work },
            incarnation: {},
            dependencies: "deps",
          },
          takenAt,
        },
      }) as any,
  );
  const matrix = {
    status: "ready" as const,
    current: true as const,
    hash: "matrix",
    value: {
      id: "matrix",
      work: { binding: "open", route: "families", target: null, open: target.ref },
      document: target.ref,
      filter,
      capturedAt: takenAt,
      completedAt: takenAt,
      result: { families: [], issues: [], page: null },
    },
  };
  const mount = createRouteShell({
    ...source,
    work: store,
    reads: {
      lifetime: "read",
      acquire(request, token) {
        if (request.key.op !== "families.read") return source.reads.acquire(request, token);
        return { lifetime: "read", key: request.key, read: () => matrix, release() {} } as any;
      },
    },
    readings: {
      lifetime: "subscription",
      subscribe(request, token, deliver) {
        if (request.key.op !== "families.read")
          return source.readings.subscribe(request, token, deliver);
        deliver(matrix as any);
        return () => {};
      },
    },
  }).mount(
    admitted.route,
    placeInput(
      {
        read: () => new URLSearchParams(),
        write() {},
        subscribe: () => () => {},
      },
      { target: target },
    ),
  );
  try {
    await acceptedWork(mount);
    mount.invoke("read", { filter, readId: "00000000-0000-4000-8000-000000000001" });
    const basis = mount.workBasis()!;
    expect(mount.invoke("apply", {}, basis)).toEqual({ kind: "preview" });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]![0]).toMatchObject({
      key: "families.apply.preview",
      target,
      input: { work: { key: basis.token.scope.identity.work, revision: basis.workRevision } },
    });
    expect(
      commands["families.apply.preview"].input.safeParse(submit.mock.calls[0]![0].input).success,
    ).toBe(true);
    await vi.waitFor(() =>
      expect(mount.review("apply")?.preview).toMatchObject({ previewOnly: true }),
    );
    expect(native).not.toHaveBeenCalled();
    const advanced = store.submitWork(
      {
        route: "families",
        fingerprint: admitted.route.workFingerprint,
        key: basis.token.scope.identity.work!,
        target,
        subject: familiesScopeId,
      },
      {
        kind: "apply",
        press: "external",
        expectedRevision: basis.workRevision!,
        patches: [
          { path: ["scope"], value: { edit: { value: { ...filter, familyNames: ["Changed"] } } } },
        ],
      },
      basis,
    );
    await new Promise<void>((resolve) =>
      advanced.subscribe(
        (outcome) => {
          if (outcome.kind !== "pending") {
            expect(outcome.kind).toBe("accepted");
            resolve();
          }
        },
        () => {},
      ),
    );
    expect(mount.review("apply")?.stale).toBe(true);
    expect(() => mount.confirm("apply")).toThrow(/stale/);
    expect(submit).toHaveBeenCalledOnce();
  } finally {
    mount.close();
    registration.deactivate();
    submit.mockRestore();
    native.mockRestore();
  }
});
