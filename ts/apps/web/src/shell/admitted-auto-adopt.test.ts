import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import { commands, settingsRouteState, memberWork, workKey, workHandle } from "@pe/agent-contracts";
import { commandCatalogAxes } from "../../../../packages/agent-contracts/src/command-axes.ts";
import { builtinModule } from "../../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import {
  createBuiltinRouteInventory,
  builtinClosureFingerprint,
} from "../../../../packages/agent-contracts/src/route-module.ts";
import { identityCodecs } from "./page-port.ts";
import { createRouteShell } from "./admitted-mount.ts";
import { createFixtureWorkDoor } from "./fixture-work-door.ts";
import type { KernelServices } from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import type { WorkScope } from "../../../../packages/agent-contracts/src/work-journal-door.ts";
import type { InvocationBasis } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { settleWork } from "./work-door-observation.ts";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type { RouteSeed } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";

const source = { module: "auto-adopt.test.ts", export: "bodies" };
const members = [
  { pod: "test-pod", path: "settings/a.json" },
  { pod: "test-pod", path: "settings/b.json" },
];
const id = (index: number) => {
  const result = identityCodecs.local.encode({
    namespace: "pods",
    subject: memberWork(members[index]!),
  });
  if (!result.ok) throw Error(result.reason);
  return result.value;
};
const close: (() => void)[] = [];
afterEach(() =>
  close
    .splice(0)
    .reverse()
    .forEach((stop) => stop()),
);

async function fixture(
  options: {
    auto?: boolean;
    entry?: string;
    review?: "none" | "shown";
    input?: z.ZodType;
    intent?: Record<string, unknown>;
    workRoute?: string;
    effect?: "SessionWrite" | "ModelWrite";
    local?: boolean;
    pendingWork?: boolean;
    selfAuthorize?: boolean;
    adoptId?: string;
  } = {},
) {
  let allowed = false;
  const entryKey = options.entry ?? "settings.observe";
  const axes = {
    ...commandCatalogAxes["settings.observe"],
    ...(options.effect ? { effect: options.effect } : {}),
  };
  const data = {
    ...builtinModule.data,
    key: "pods",
    address: "/pods",
    capabilities: ["work", "native-write", ...(options.local ? ["local"] : [])],
    work: {
      route: options.workRoute ?? "pods",
      schema: "work",
      version: 1,
      migrations: {},
      ...(options.auto === false ? {} : { adopt: options.adoptId ?? "open" }),
    },
    workSubject: "system",
    subject: { ...builtinModule.data.subject, detail: "roster" },
    readings: { roster: { ...builtinModule.data.readings.roster, demand: "visible" } },
    verbs: {
      open: {
        kind: options.local ? "local" : "command",
        entry: entryKey,
        intent: "observe",
        input: "empty",
        label: "Open",
        review: options.review ?? "none",
        ready: "ready",
        deps: { page: ["system"], work: ["fields"], readings: ["roster"] },
        captures: [],
      },
    },
    ...(options.local ? { local: { [entryKey]: { input: "empty", output: "empty" } } } : {}),
    panes: { main: { ...builtinModule.data.panes.main, draws: ["roster"], verbs: ["open"] } },
    stages: { inspect: { word: "Inspect", panes: ["main"], verbs: ["open"] } },
    workFields: {},
  };
  const entries = {
    roster: builtinModule.entries.roster,
    [entryKey]: {
      input: commands["settings.observe"].input,
      output: z.unknown(),
      axes,
      ...(options.selfAuthorize ? { autoAdopt: true } : {}),
    },
  };
  const module = {
    ...builtinModule,
    data,
    entries,
    schemas: {
      ...builtinModule.schemas,
      work: settingsRouteState.schema,
      empty: options.input ?? z.strictObject({}),
    },
    bodies: {
      pick: builtinModule.bodies.pick,
      rosterArgs: builtinModule.bodies.rosterArgs,
      main: { slot: "panes.main.body", kind: "pane", source, run: (ctx: unknown) => ctx },
      ready: {
        slot: "verbs.open.ready",
        kind: "ready",
        source,
        run: () => (allowed ? true : "Member not ready"),
      },
      observe: {
        slot: "verbs.open.intent",
        kind: "intent",
        source,
        run: ({ page }: { page: { system: string | null } }) => ({
          member: members[page.system === id(1) ? 1 : 0],
          replaceEdits: false,
          ...options.intent,
        }),
      },
    },
  };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: data as RouteGraphJson,
    hostVersion: "test",
    variants: [{ client: "web" as const, entry: "auto-adopt.test.ts" }],
    modules: [{ id: "auto-adopt.test.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    pods: {
      module,
      closure: { envelope, fingerprint },
      catalog: Object.entries(entries).map(([key, entry]) => ({ key, ...entry.axes, uses: [] })),
    },
  });
  const admitted = (await inventory.prepare("pods", fingerprint)).admitUnknown(module);
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  const route = admitted.route;
  const door = createFixtureWorkDoor(settingsRouteState, {
    fields: { "/pending": { edit: { value: "keep", by: "human" } } },
  });
  const sent: Parameters<NonNullable<KernelServices["submitNative"]>>[0][] = [];
  const frames: ((value: unknown) => void)[] = [];
  let search = new URLSearchParams({ system: builtinModule.codecs.subject.encode(id(0)) });
  const listeners = new Set<() => void>();
  const mount = createRouteShell({
    reads: {
      lifetime: "read",
      acquire: (request) => ({
        lifetime: "read",
        key: request.key,
        release() {},
        read: () => ({ status: "pending", current: false, reason: "waiting" }),
      }),
    },
    readings: {
      lifetime: "subscription",
      subscribe: (_request, _token, deliver) => {
        frames.push(deliver as (value: unknown) => void);
        return () => {};
      },
    },
    work: {
      ...door,
      ...(options.pendingWork ? { open: () => ({ subscribe: () => () => {} }) } : {}),
      submit: (command) => {
        sent.push(command);
        return door.submit(command);
      },
    },
    clock: { lifetime: "read", now: Date.now },
    availability: {},
  }).mount(route, {
    address: {
      read: () => search,
      write: (next) => {
        search = next;
        listeners.forEach((fn) => fn());
      },
      subscribe: (fn) => {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
    },
    fixture: null,
    target: { kind: "host" },
    work: { address: null, open: null },
    custody: { current: () => true },
    memory: () => ({}),
  });
  close.push(mount.close);
  if (!options.pendingWork) await expect.poll(() => mount.work()).not.toBeNull();
  const emit = () => frames.at(-1)!({ status: "ready", current: true, value: [], hash: "roster" });
  const invoke = () =>
    (mount.read("main") as { verbs: { open(input: unknown): unknown } }).verbs.open({});
  const scope = (): WorkScope => ({
    route: "pods",
    fingerprint: route.workFingerprint!,
    key: mount.work()!.handle.key,
    target: null,
    subject: null,
  });
  return {
    admitted,
    mount,
    door,
    sent,
    emit,
    invoke,
    scope,
    allow: () => {
      allowed = true;
    },
    refresh: () => mount.refresh("roster"),
  };
}

test("required Work command uses the trusted binder for explicit invocation", async () => {
  const f = await fixture({ auto: false });
  f.allow();
  f.emit();
  const handle = f.mount.work()!.handle;
  f.invoke();
  expect(f.sent[0]?.input).toMatchObject({ work: handle, replaceEdits: false });
});

test("auto-adopt waits for readiness, latches dispatch before notifications, and stays once per canonical Work", async () => {
  const f = await fixture();
  f.emit();
  expect(f.sent).toHaveLength(0);
  let reenter = false;
  const stop = f.mount.subscribe(() => {
    if (reenter) {
      reenter = false;
      f.refresh();
    }
  });
  reenter = true;
  f.allow();
  f.emit();
  stop();
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0]?.key).toBe("settings.observe");
  expect(f.sent[0]?.input).toMatchObject({ work: f.mount.work()!.handle, replaceEdits: false });
  f.emit();
  expect(f.sent).toHaveLength(1);
  f.mount.release();
  const resume = f.mount.subscribe(() => {});
  f.emit();
  expect(f.sent).toHaveLength(1);
  resume();
  await settleWork(
    f.door.submitWork(
      f.scope(),
      {
        kind: "apply",
        expectedRevision: 0,
        patches: [
          { path: ["fields", "/other"], value: { edit: { value: "changed", by: "human" } } },
        ],
        press: "edit",
      },
      {} as InvocationBasis,
    ),
  );
  f.emit();
  expect(f.sent).toHaveLength(1);
  expect(f.mount.work()!.value).toMatchObject({
    fields: { "/pending": { edit: { value: "keep" } } },
  });
  f.mount.controls.subject(id(1));
  await expect.poll(() => workKey(f.mount.work()!.handle.key)).toContain(memberWork(members[1]!));
  f.emit();
  expect(f.sent).toHaveLength(2);
  f.mount.controls.subject(id(0));
  await expect.poll(() => workKey(f.mount.work()!.handle.key)).toContain(memberWork(members[0]!));
  f.emit();
  expect(f.sent).toHaveLength(2);
  // The actual fixture command door rejects native execution. A terminal refusal never retries.
  await Promise.resolve();
  f.refresh();
  f.emit();
  expect(f.sent).toHaveLength(2);
  f.invoke();
  expect(f.sent).toHaveLength(3);
});

test.each([
  { entry: "settings.write" },
  { workRoute: "foreign" },
  { review: "shown" as const },
  { input: z.string() },
  { local: true },
  { effect: "ModelWrite" as const },
  { entry: "settings.write", selfAuthorize: true },
  { adoptId: "missing" },
])("auto-adopt refuses ineligible declaration %j", async (options) => {
  await expect(fixture(options)).rejects.toThrow("Automatic adoption");
});

test("auto-adopt requires a current owner Work handle before dispatch", async () => {
  const f = await fixture({ pendingWork: true });
  f.allow();
  f.emit();
  expect(f.sent).toHaveLength(0);
  expect(f.invoke).toThrow("Work unavailable");
});

// Compile the sanctioned selector format against the actual declared reading output.
export const selectedSeed: RouteSeed<
  typeof builtinModule.data,
  typeof builtinModule.schemas,
  typeof builtinModule.entries
> = {
  readings: {
    roster: { fixtureSelect: { fields: ["filter"], values: { '[""]': [] }, fallback: [] } },
  },
};
export const invalidSelectedSeed: typeof selectedSeed = {
  // @ts-expect-error A selector cannot weaken its declared reading output schema.
  readings: { roster: { fixtureSelect: { fields: ["filter"], values: {}, fallback: 42 } } },
};

test.each(["work", "readWorks"])(
  "required Work command rejects intent-supplied %s",
  async (key) => {
    const f = await fixture({
      auto: false,
      intent: {
        [key]: workHandle(
          { binding: "workspace", route: "pods", target: null, work: "foreign" },
          0,
        ),
      },
    });
    f.allow();
    f.emit();
    expect(f.invoke).toThrow("intent cannot supply Work identity");
    expect(f.sent).toHaveLength(0);
  },
);
