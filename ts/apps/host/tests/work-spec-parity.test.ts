import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { RouteWorkspace } from "@pe/runtime";
import { bindWork, applyPatches, type RouteStateSpec } from "@pe/agent-contracts";
import { builtinData } from "../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../packages/agent-contracts/src/route-module.ts";
import type { HostRouteModule } from "../../../packages/agent-contracts/src/host-route-admission.ts";
import { createRouteRegistrations } from "../../../packages/mcps/src/pea/routes.ts";
import type { HostWorkRegistration } from "../../../packages/agent-contracts/src/host-route-admission.ts";
import { composeHostRouteRegistration } from "../src/host-route-registration.ts";
import { builtinEnrollments } from "../src/builtin-enrollment.ts";

const schema = z.object({ value: z.number().default(0), reviewed: z.boolean().default(false) });
const fixture = {
  route: "parity",
  title: "Parity",
  description: "All fields",
  finds: ["probe"],
  schema,
  schemaVersion: 2,
  migrations: { 1: () => ({ value: 1, reviewed: false }) },
  editable: [["value"]],
  reconcileEdit: (next: unknown, patches: readonly unknown[]) => ({
    ...(next as object),
    reviewed: patches.length > 0,
  }),
  salvage: (raw: unknown) => raw,
} satisfies Required<RouteStateSpec<typeof schema>>;
const loadedFamilies = vi.fn(async () => [
  { familyName: "Loaded family", types: [{ typeName: "Loaded type" }] },
]);
const legacy = createRouteRegistrations({ admittedKeys: [], loadedFamilies });
async function parity(source: HostRouteModule, registration: HostWorkRegistration) {
  const { spec } = registration;
  const module = composeHostRouteRegistration(source, [registration]);
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data,
    hostVersion: "parity",
    modules: [{ id: "neutral.ts", sha256: "a".repeat(64) }],
    variants: [{ client: "web" as const, entry: "neutral.ts" }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const port = await createBuiltinRouteInventory({
    [module.data.key]: {
      host: true,
      module,
      catalog: [],
      closure: { envelope, fingerprint },
    },
  }).prepare(module.data.key, fingerprint);
  const admitted = port.admitHost(module);
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  function store() {
    let saved: unknown = {
      version: 1,
      schemaVersion: spec.schemaVersion ?? 1,
      revision: 0,
      doc: spec.schema.parse({}),
      history: [],
    };
    return {
      getState: async () => structuredClone(saved),
      setState: async ({ value }: { value: unknown }) => {
        saved = structuredClone(value);
      },
      listState: async () => ({ records: [], unreadable: 0, unindexed: 0, truncated: false }),
    };
  }
  const ws = new RouteWorkspace({ registrations: [], store: store() });
  const register = vi.spyOn(ws, "register");
  const receipt = ws.registerAdmitted(admitted.route);
  try {
    expect(await receipt.ready).toBeNull();
    const installedRegistration = register.mock.calls[0]![0];
    // 743ad0e4: admission adds the route's ruled, presentation-only history meta schema.
    expect(Object.keys(installedRegistration).sort()).toEqual(
      [
        ...new Set([
          ...Object.keys(registration),
          ...(module.data.historyDetail ? ["historyDetail"] : []),
        ]),
      ].sort(),
    );
    expect(installedRegistration.admit).toBe(registration.admit);
    const installed = installedRegistration.spec;
    expect(Object.keys(installed).sort()).toEqual(Object.keys(spec).sort());
    for (const key of Object.keys(spec) as (keyof typeof spec)[])
      if (key !== "schema") expect(installed[key]).toEqual(spec[key]);
    const direct = new RouteWorkspace({ registrations: [registration], store: store() });
    const scope = bindWork(spec.route, null);
    expect(await ws.view(scope, spec.route)).toEqual(await direct.view(scope, spec.route));
    for (const raw of [{}, null, { invalid: true }])
      expect(installed.schema.safeParse(raw)).toEqual(spec.schema.safeParse(raw));
    const doc = spec.schema.parse({});
    for (const patches of [[], [{ path: ["value"], value: 4 }]])
      expect(
        applyPatches(installed, { version: 1, revision: 0, doc }, "human", patches, 0),
      ).toEqual(applyPatches(spec, { version: 1, revision: 0, doc }, "human", patches, 0));
    // Both writers exercise the actual workspace boundary, including async admission.
    for (const by of ["human", "pea"] as const) {
      for (const patches of [
        [],
        [{ path: ["value"], value: 4 }],
        [{ path: ["value"], value: -1 }],
      ]) {
        const before = await ws.read(scope, spec.route);
        const write = {
          kind: "apply" as const,
          expectedRevision: before!.revision,
          press: "parity",
          patches,
        };
        const actual = await ws.write(scope, spec.route, by, write);
        const expected = await direct.write(scope, spec.route, by, write);
        expect(actual.ok).toBe(expected.ok);
        if (!actual.ok && !expected.ok) expect(actual).toEqual(expected);
        expect((await ws.read(scope, spec.route))?.revision).toBe(
          (await direct.read(scope, spec.route))?.revision,
        );
      }
    }
    if (spec.salvage) expect(installed.salvage!({ old: 1 })).toEqual(spec.salvage({ old: 1 }));
    for (const [age, run] of Object.entries(spec.migrations ?? {}))
      expect(installed.migrations![Number(age)]!({ old: 1 })).toEqual(run({ old: 1 }));
  } finally {
    receipt.close();
  }
}
// Every legacy builtin becomes a host fixture; future fields are checked without a field allowlist.
for (const registration of [
  ...legacy,
  {
    spec: fixture,
    admit: async (doc: unknown) =>
      (doc as { value: number }).value < 0
        ? {
            ok: false as const,
            kind: "refused" as const,
            code: "scope-unresolved" as const,
            agentHint: "Negative value refused",
          }
        : null,
  } satisfies HostWorkRegistration,
])
  test(`complete registration parity: ${registration.spec.route}`, async () => {
    const { spec } = registration;
    const migrations = Object.fromEntries(
      Object.keys(spec.migrations ?? {}).map((age) => [age, `migrate-${age}`]),
    );
    await parity(
      {
        data: {
          ...builtinData,
          key: spec.route,
          address: `/${spec.route}`,
          work: { route: spec.route, schema: "work", version: spec.schemaVersion ?? 1, migrations },
          ...(spec.salvage ? { salvage: "recover" } : {}),
        },
        schemas: { work: spec.schema },
        workState: spec,
        bodies: Object.fromEntries([
          ...Object.entries(spec.migrations ?? {}).map(([age, run]) => [
            `migrate-${age}`,
            {
              kind: "migration",
              slot: `work.migrations.${age}`,
              source: { module: "neutral.ts", export: `migrate${age}` },
              run,
            },
          ]),
          ...(spec.salvage
            ? [
                [
                  "recover",
                  {
                    kind: "recovery",
                    slot: "salvage",
                    source: { module: "neutral.ts", export: "recover" },
                    run: spec.salvage,
                  },
                ],
              ]
            : []),
        ]),
      },
      registration,
    );
  });
test("actual builtin enrollment overlap preserves the full legacy registration", async () => {
  for (const entry of builtinEnrollments) {
    const module = await entry.load();
    const registration = legacy.find((r) => r.spec.route === module.data.key);
    if (registration && module.data.work?.schema) await parity(module, registration);
  }
});
