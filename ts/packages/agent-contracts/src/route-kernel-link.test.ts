/* oxlint-disable typescript/no-misused-spread -- These adversaries deliberately copy nominal class instances. */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import {
  builtinModule,
  podModule,
  builtinData,
  builtinBodies,
  schemas,
  entries,
} from "./route-kernel.fixtures.ts";
import { projectKernelDirectory } from "./route-directory.ts";
import { INVALID } from "./page-keys.ts";
import { canonicalRouteJson } from "./route-graph.ts";
import { decodeRouteGraph, linkRouteBodies, routeBindingSchema } from "./route-bodies.ts";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
  type BuiltinClosure,
  AdmittedRoute,
  createAdmittedRouteRegistry,
  createRouteAdmission,
  resolveRouteBindings,
  routeFingerprint,
  type RouteAdmissionEvidence,
} from "./route-module.ts";
import type { RouteGraphJson } from "./route-kernel-data.ts";
import type { RouteModule, RouteFingerprintInput } from "./route-kernel-admission.ts";
import type { BodyBindings } from "./route-kernel-bodies.ts";
import type { CatalogLink } from "./catalog.ts";
import { manyField, manyCodec, sortField, keyedSetField, orderedListField } from "./route-field.ts";
const bytes = new TextEncoder().encode("export const bodies = {};\n");
const contracts = new TextEncoder().encode("kernel, schemas and codecs v1\n");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const baseCatalog: readonly CatalogLink[] = Object.entries(entries).map(([key, entry]) => ({
  key,
  ...entry.axes,
  uses: [],
}));
async function prepare(
  data: RouteGraphJson = builtinData,
  catalog = baseCatalog,
  loadedBindings: unknown = builtinModule,
) {
  const artifact: RouteFingerprintInput = {
    version: 1,
    data,
    contracts: [{ id: "contracts.js", sha256: digest(contracts) }],
    executables: [
      {
        client: "shared",
        entry: "bodies.js",
        members: [{ path: "bodies.js", sha256: digest(bytes) }],
      },
    ],
  };
  const evidence: RouteAdmissionEvidence = {
    loadedBindings,
    artifact,
    expectedFingerprint: await routeFingerprint(artifact),
    contracts: [{ id: "contracts.js", bytes: contracts }],
    executables: [
      {
        client: "shared",
        entry: "bodies.js",
        resolved: true,
        members: [{ path: "bodies.js", bytes }],
      },
    ],
    catalog,
  };
  return { artifact, evidence, port: await createRouteAdmission(evidence) };
}
async function refuse(data: RouteGraphJson, overrides: object = {}, catalog = baseCatalog) {
  const { artifact, port } = await prepare(data, catalog);
  const result = port.admitUnknown({ ...builtinModule, data, artifact, ...overrides });
  if (result.ok) throw Error("Expected refusal");
  return result.diagnostics;
}
describe("one decoded admission", () => {
  it("admits builtin and complete mixed-identity Pod through the same door", async () => {
    const builtin = await prepare();
    expect(builtin.port.admit({ ...builtinModule, artifact: builtin.artifact })).toMatchObject({
      ok: true,
    });
    const pod = {
      ...podModule,
      entries: {
        ...podModule.entries,
        scene: {
          ...podModule.entries.scene,
          axes: { ...podModule.entries.scene.axes, cap: 50000 },
        },
      },
    };
    const catalog: CatalogLink[] = Object.entries(pod.entries).map(([key, entry]) => ({
      key,
      ...entry.axes,
      uses: [],
    }));
    const prepared = await prepare(pod.data, catalog, pod);
    expect(
      prepared.port.admitUnknown({
        ...pod,
        data: JSON.parse(JSON.stringify(pod.data)),
        artifact: prepared.artifact,
      }),
    ).toMatchObject({ ok: true });
  });
  it("diagnoses wrong, missing, extra and conflicting bodies at the slot", async () => {
    const errors = await refuse(builtinData, {
      bodies: { ...builtinBodies, calculate: { ...builtinBodies.calculate, kind: "picker" } },
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        path: "readings.total.derive",
        reference: "calculate",
        expected: "derive",
        namespace: "tiny",
        version: 1,
        source: { module: "bodies.js", export: "bodies" },
      }),
    );
    const { calculate: _calculate, ...missing } = builtinBodies;
    expect(await refuse(builtinData, { bodies: missing })).toContainEqual(
      expect.objectContaining({ path: "readings.total.derive", code: "missing" }),
    );
    expect(
      await refuse(builtinData, { bodies: { ...builtinBodies, unused: builtinBodies.main } }),
    ).toContainEqual(expect.objectContaining({ path: "bodies.unused", code: "extra" }));
    expect(await refuse({ ...builtinData, subjectText: "calculate" })).toContainEqual(
      expect.objectContaining({ path: "readings.total.derive", code: "kind" }),
    );
  });
  it("refuses unknown pane and Page/Work/reading dependencies", async () => {
    expect(
      await refuse({ ...builtinData, subject: { ...builtinData.subject, pane: "absent" } }),
    ).toContainEqual(expect.objectContaining({ path: "subject.pane" }));
    expect(
      await refuse({
        ...builtinData,
        readings: {
          ...builtinData.readings,
          total: {
            ...builtinData.readings.total,
            deps: { page: ["absent"], work: ["absent"], readings: ["absent"] },
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining(
        ["page", "work", "readings"].map((key) =>
          expect.objectContaining({ path: `readings.total.deps.${key}.0`, code: "missing" }),
        ),
      ),
    );
  });
  it("refuses reading cycles, stage mismatch and multiple subjects/selections", async () => {
    expect(
      await refuse({
        ...builtinData,
        readings: {
          ...builtinData.readings,
          total: {
            ...builtinData.readings.total,
            deps: { page: [], work: [], readings: ["total"] },
          },
        },
      }),
    ).toContainEqual(expect.objectContaining({ code: "cycle" }));
    expect(await refuse({ ...builtinData, stageOrder: ["missing"] })).toContainEqual(
      expect.objectContaining({ path: "stageOrder" }),
    );
    expect(
      await refuse({
        ...builtinData,
        fields: { ...builtinData.fields, second: builtinData.fields.system },
      }),
    ).toContainEqual(expect.objectContaining({ path: "subject.field" }));
    expect(
      await refuse({
        ...builtinData,
        fields: { ...builtinData.fields, second: builtinData.fields.selected },
      }),
    ).toContainEqual(expect.objectContaining({ path: "fields" }));
  });
  it("checks field codecs, refinements, stage enums and migration coverage", async () => {
    const data = {
      ...builtinData,
      fields: {
        ...builtinData.fields,
        stage: {
          ...builtinData.fields.search,
          role: "stage" as const,
          schema: "stage",
          codec: "stage",
          initial: "other",
        },
      },
    };
    expect(
      await refuse(data, {
        schemas: { ...schemas, stage: z.enum(["other"]) },
        codecs: {
          ...builtinModule.codecs,
          stage: { encode: String, decode: (value: string) => ({ ok: true, value }) },
        },
      }),
    ).toContainEqual(expect.objectContaining({ path: "fields.stage.schema" }));
    expect(
      await refuse(builtinData, {
        codecs: {
          ...builtinModule.codecs,
          number: { encode: String, decode: () => ({ ok: true, value: 999 }) },
        },
      }),
    ).toContainEqual(expect.objectContaining({ path: "fields.density.codec" }));
    expect(
      await refuse({ ...builtinData, work: { ...builtinData.work, version: 2 } }),
    ).toContainEqual(expect.objectContaining({ path: "work.migrations.1" }));
    expect(
      await refuse(builtinData, { schemas: { ...schemas, subjectOne: z.string().nullable() } }),
    ).toContainEqual(expect.objectContaining({ path: "fields.system.schema", code: "identity" }));
  });
  it("refuses invalid axes and transitive geometry without policy", async () => {
    expect(
      await refuse(builtinData, {
        entries: {
          ...entries,
          roster: { ...entries.roster, axes: { ...entries.roster.axes, effect: "Unset" } },
        },
      }),
    ).toContainEqual(expect.objectContaining({ path: "readings.roster.entry", code: "policy" }));
    expect(
      await refuse(builtinData, {}, [{ ...baseCatalog[0]!, subject: "Unset" }, baseCatalog[1]!]),
    ).toContainEqual(expect.objectContaining({ path: "entries", code: "policy" }));
    const catalog: CatalogLink[] = [
      { ...baseCatalog[0]!, cost: "Expensive", uses: ["geometry"] },
      baseCatalog[1]!,
      {
        key: "geometry",
        subject: "Elements",
        touches: ["Geometry"],
        effect: "Read",
        cost: "Expensive",
        cardinality: "One",
        uses: [],
      },
    ];
    expect(
      await refuse(
        builtinData,
        {
          entries: {
            ...entries,
            roster: { ...entries.roster, axes: { ...entries.roster.axes, cost: "Expensive" } },
          },
        },
        catalog,
      ),
    ).toContainEqual(expect.objectContaining({ path: "readings.roster.geometry" }));
  });
  it("refuses automatic dependency closures that reach detailed geometry", async () => {
    const data = {
      ...podModule.data,
      readings: {
        ...podModule.data.readings,
        total: {
          ...podModule.data.readings.total,
          deps: { page: [], work: [], readings: ["detail"] },
        },
      },
    };
    const prepared = await prepare(
      data,
      Object.entries(podModule.entries).map(([key, entry]) => ({ key, ...entry.axes, uses: [] })),
    );
    const result = prepared.port.admitUnknown({ ...podModule, data, artifact: prepared.artifact });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ path: "readings.total.deps.readings", reference: "detail" }),
      ]),
    });
  });
});
describe("canonical bytes", () => {
  it.each([() => 1, undefined, Infinity, NaN, 1n, new Date(), "\ud800", Symbol("x")])(
    "refuses invalid JSON: %s",
    (value) => {
      expect(() => canonicalRouteJson({ value })).toThrow();
      expect(
        decodeRouteGraph({
          ...builtinData,
          fields: {
            ...builtinData.fields,
            density: { ...builtinData.fields.density, initial: value },
          },
        }).ok,
      ).toBe(false);
    },
  );
  it("rejects accessors, sparse arrays and cycles without evaluating them", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const sparse: unknown[] = [];
    sparse.length = 2;
    for (const value of [
      { nested: { a: undefined } },
      {
        get a() {
          throw Error("do not run");
        },
      },
      sparse,
      cycle,
    ])
      expect(() => canonicalRouteJson(value)).toThrow();
    expect(canonicalRouteJson({ z: -0, a: [1e30, "€"] })).toBe('{"a":[1e+30,"€"],"z":0}');
  });
  it("requires roles and refuses required review", () => {
    const { role: _role, ...field } = builtinData.fields.search;
    expect(
      decodeRouteGraph({ ...builtinData, fields: { ...builtinData.fields, search: field } }).ok,
    ).toBe(false);
    expect(
      decodeRouteGraph({
        ...builtinData,
        verbs: { ...builtinData.verbs, apply: { ...builtinData.verbs.apply, review: "required" } },
      }).ok,
    ).toBe(false);
  });
  it("matches independent SHA256, binds body bytes and refuses a wrong fingerprint", async () => {
    const { artifact, evidence } = await prepare();
    const expected = createHash("sha256")
      .update(`pe.route.v1\n${canonicalRouteJson(artifact)}`)
      .digest("hex");
    expect(await routeFingerprint(artifact)).toBe(expected);
    const changed = {
      ...artifact,
      executables: [
        {
          ...artifact.executables[0]!,
          members: [{ path: "bodies.js", sha256: digest(new Uint8Array([1])) }],
        },
      ],
    };
    expect(await routeFingerprint(changed)).not.toBe(expected);
    const bad = await createRouteAdmission({
      ...evidence,
      executables: [
        {
          ...evidence.executables[0]!,
          members: [{ path: "bodies.js", bytes: new Uint8Array([9]) }],
        },
      ],
    });
    expect(bad.admitUnknown({ ...builtinModule, artifact }).ok).toBe(false);
    const wrong = await createRouteAdmission({ ...evidence, expectedFingerprint: "0".repeat(64) });
    expect(wrong.admitUnknown({ ...builtinModule, artifact }).ok).toBe(false);
  });
  it("rejects unsafe paths, duplicate members, missing entries and unresolved closures", async () => {
    const { artifact, evidence } = await prepare();
    for (const path of ["../bodies.js", "/bodies.js", "a\\b", "a//b", "C:body.js", "missing.js"])
      await expect(
        routeFingerprint({
          ...artifact,
          executables: [{ ...artifact.executables[0]!, entry: path }],
        }),
      ).rejects.toThrow();
    await expect(
      routeFingerprint({ ...artifact, contracts: [...artifact.contracts, ...artifact.contracts] }),
    ).rejects.toThrow();
    const port = await createRouteAdmission({
      ...evidence,
      executables: [{ ...evidence.executables[0]!, resolved: false }],
    });
    expect(port.admitUnknown({ ...builtinModule, artifact }).ok).toBe(false);
  });
});
it("authenticates the exact immutable handle and captures bindings once", async () => {
  const { artifact, port } = await prepare();
  const bodies = { ...builtinBodies };
  const result = port.admit({ ...builtinModule, bodies, artifact });
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  const route = result.route;
  const registry = createAdmittedRouteRegistry();
  expect(registry.resolve(route)).toBeNull();
  const registration = registry.register(route);
  expect(registry.resolve(route)).toBe(route);
  const revoked = Proxy.revocable(route, {});
  revoked.revoke();
  expect(registry.resolve(revoked.proxy)).toBeNull();
  const bindings = resolveRouteBindings(registry, route)!;
  bodies.main = { ...bodies.main, run: () => "changed" };
  expect(bindings.bodies.main!.run).toBe(builtinBodies.main.run);
  expect(Object.isFrozen(route.data.fields.system)).toBe(true);
  for (const copy of [
    { ...route },
    { ...route, data: { ...route.data, key: "pod.forged" } },
    Object.assign({}, route, { data: { ...route.data, key: "pod.forged" } }),
    new Proxy(route, {}),
    Object.create(Object.getPrototypeOf(route)),
  ]) {
    expect(registry.resolve(copy)).toBeNull();
    expect(() => registry.register(copy)).toThrow();
    expect(resolveRouteBindings(registry, copy)).toBeNull();
  }
  expect(() =>
    Reflect.construct(AdmittedRoute, [Symbol(), route.data, route.fingerprint, bindings]),
  ).toThrow();
  registration.deactivate();
  expect(registry.resolve(route)).toBeNull();
  expect(() => registry.register(route)).toThrow();
});
it("preserves manyField and table codec repairs", () => {
  const field = manyField("UniqueId", { url: "replace" });
  const value = ["a,b", "all", 'quote"', "space value"];
  expect(field.schema.safeParse(value).success).toBe(true);
  expect(manyCodec.decode(manyCodec.encode(value))).toEqual(value);
  expect(manyCodec.decode("all")).toBe("all");
  const sort = sortField({});
  const sorted = sort.schema.parse(undefined);
  expect(sort.codec.decode(sort.codec.encode(sorted))).toEqual(sorted);
  const set = keyedSetField({});
  const hidden = { column: true as const };
  expect(set.codec.decode(set.codec.encode(hidden))).toEqual(hidden);
});
function typeRefusals(route: AdmittedRoute<typeof builtinData>) {
  const registry = createAdmittedRouteRegistry();
  // @ts-expect-error spread drops private nominal identity
  registry.register({ ...route });
  // @ts-expect-error changed data does not retain admission
  registry.register({ ...route, data: { ...route.data, key: "forged" } });
  // @ts-expect-error constructor is private
  new AdmittedRoute();
  const wrong: BodyBindings<typeof builtinData, typeof schemas, typeof entries> = {
    ...builtinBodies,
    // @ts-expect-error derive output follows the named result schema
    calculate: { ...builtinBodies.calculate, run: () => ({ total: "wrong" }) },
    // @ts-expect-error catalog args follow the linked entry input
    rosterArgs: { ...builtinBodies.rosterArgs, run: () => ({ filter: 1 }) },
  };
  // @ts-expect-error role is compulsory
  const missingRole: RouteGraphJson["fields"][string] = {
    schema: "text",
    codec: "text",
    initial: "",
  };
  return { wrong, missingRole };
}
void typeRefusals;

it("refuses replacement executable exports even under unchanged source labels and bytes", async () => {
  const { artifact, port } = await prepare();
  const result = port.admit({
    ...builtinModule,
    artifact,
    bodies: {
      ...builtinBodies,
      calculate: { ...builtinBodies.calculate, run: () => ({ total: 999 }) },
    },
  });
  expect(result).toMatchObject({
    ok: false,
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "identity", path: "bodies" }),
    ]),
  });
});
it("canonicalizes manifest ordering and fingerprints every client and dependency", async () => {
  const { artifact } = await prepare();
  const expanded: RouteFingerprintInput = {
    ...artifact,
    contracts: [...artifact.contracts, { id: "a", sha256: digest(contracts) }],
    executables: [
      {
        client: "web",
        entry: "web.js",
        members: [
          { path: "web.js", sha256: digest(bytes) },
          { path: "dep.js", sha256: digest(contracts) },
        ],
      },
      ...artifact.executables,
    ],
  };
  const hash = await routeFingerprint(expanded);
  expect(
    await routeFingerprint({
      ...expanded,
      contracts: [...expanded.contracts].reverse(),
      executables: [...expanded.executables]
        .reverse()
        .map((item) => ({ ...item, members: [...item.members].reverse() })),
    }),
  ).toBe(hash);
  expect(
    await routeFingerprint({
      ...expanded,
      executables: expanded.executables.map((item) => ({
        ...item,
        members: item.members.map((member) =>
          member.path === "dep.js" ? { ...member, sha256: digest(bytes) } : member,
        ),
      })),
    }),
  ).not.toBe(hash);
});

it("links capture to Page fields and validates catalog entries even when unused", async () => {
  const data = { ...builtinData, capture: "search", workSubject: "system" };
  const prepared = await prepare(data);
  expect(
    prepared.port.admitUnknown({ ...builtinModule, data, artifact: prepared.artifact }),
  ).toMatchObject({ ok: true });
  expect(await refuse({ ...builtinData, capture: "edit" })).toContainEqual(
    expect.objectContaining({ path: "capture", expected: "field" }),
  );
  expect(
    await refuse(builtinData, {
      entries: {
        ...entries,
        unused: { ...entries.roster, axes: { ...entries.roster.axes, effect: "Unset" } },
      },
    }),
  ).toContainEqual(expect.objectContaining({ path: "entries.unused" }));
});

// Capabilities select services, never relax the catalog's actual footprint.
it("requires closed capabilities and Work agreement", async () => {
  expect(decodeRouteGraph({ ...builtinData, capabilities: undefined }).ok).toBe(false);
  expect(decodeRouteGraph({ ...builtinData, capabilities: ["other"] }).ok).toBe(false);
  expect(decodeRouteGraph({ ...builtinData, capabilities: ["work", "work"] }).ok).toBe(false);
  expect(await refuse({ ...builtinData, capabilities: [] })).toContainEqual(
    expect.objectContaining({ path: "work", reference: "work", code: "policy" }),
  );
  expect(
    linkRouteBodies(
      { ...builtinData, work: undefined },
      routeBindingSchema.parse(builtinModule),
      baseCatalog,
    ),
  ).toContainEqual(expect.objectContaining({ path: "capabilities", reference: "work" }));
});
it("requires geometry and native-write for transitive catalog dependencies", () => {
  for (const effect of ["Read", "ModelWrite"] as const) {
    const leaf: CatalogLink = {
      key: "hidden",
      subject: "None",
      touches: ["Geometry"],
      effect,
      cost: "Cheap",
      cardinality: "One",
      uses: [],
    };
    const catalog = baseCatalog.map((entry) =>
      entry.key === "roster" ? { ...entry, uses: [leaf.key] } : entry,
    );
    const errors = linkRouteBodies(
      { ...builtinData, capabilities: ["work"] },
      routeBindingSchema.parse(builtinModule),
      [...catalog, leaf],
    );
    expect(errors).toContainEqual(
      expect.objectContaining({ path: "readings.roster.entry", reference: "geometry" }),
    );
    if (effect === "ModelWrite") {
      expect(errors).toContainEqual(
        expect.objectContaining({ reference: "native-write", code: "policy" }),
      );
      expect(errors).toContainEqual(
        expect.objectContaining({ expected: "read closure", code: "policy" }),
      );
    }
  }
});

it("round trips complete directory metadata without duplicate addresses or titles", () => {
  const decoded = decodeRouteGraph(JSON.parse(canonicalRouteJson(builtinData)));
  if (!decoded.ok) throw Error(JSON.stringify(decoded.diagnostics));
  expect(decoded.data).toEqual(builtinData);
  const { group, summary, ...metadata } = builtinData.directory;
  expect(projectKernelDirectory(decoded.data)).toEqual({
    ...metadata,
    path: builtinData.address,
    title: builtinData.name,
    category: group,
    blurb: summary,
  });
  for (const key of ["title", "path", "category", "blurb"])
    expect(
      decodeRouteGraph({
        ...builtinData,
        directory: { ...builtinData.directory, [key]: "duplicate" },
      }).ok,
    ).toBe(false);
  expect(
    projectKernelDirectory({ ...decoded.data, address: "/renamed", name: "Renamed" }),
  ).toMatchObject({ path: "/renamed", title: "Renamed" });
});

it("admits ordered pose data while refusing bare arrays, list subjects and selection schemas", () => {
  const list = orderedListField(z.string(), { cap: 3 });
  const data = {
    ...builtinData,
    fields: {
      ...builtinData.fields,
      open: {
        role: "pose",
        schema: "open",
        codec: "open",
        initial: { items: [] },
        url: "replace",
        share: true,
        agent: "set",
      },
    },
  } as const;
  const codec = {
    encode: list.codec.encode,
    decode: (text: string) => {
      const value = list.codec.decode(text);
      return value === INVALID
        ? { ok: false as const, reason: "Invalid ordered list" }
        : { ok: true as const, value };
    },
  };
  const bindings = routeBindingSchema.parse({
    ...builtinModule,
    schemas: { ...builtinModule.schemas, open: list.schema },
    codecs: { ...builtinModule.codecs, open: codec },
  });
  expect(linkRouteBodies(data, bindings, baseCatalog)).toEqual([]);
  expect(
    linkRouteBodies(
      { ...data, fields: { ...data.fields, open: { ...data.fields.open, initial: [] } } },
      { ...bindings, schemas: { ...bindings.schemas, open: z.array(z.string()).default([]) } },
      baseCatalog,
    ),
  ).toContainEqual(
    expect.objectContaining({
      path: "fields.open.schema",
      message: "Bare arrays are not Page fields",
    }),
  );
  expect(
    linkRouteBodies(
      {
        ...data,
        fields: {
          ...data.fields,
          system: {
            ...data.fields.system,
            schema: "open",
            codec: "open",
            initial: { items: [] },
            cardinality: "many",
          },
        },
      },
      bindings,
      baseCatalog,
    ),
  ).toContainEqual(
    expect.objectContaining({ path: "fields.system.schema", expected: "kernel Many" }),
  );
  expect(
    decodeRouteGraph({
      ...data,
      fields: {
        ...data.fields,
        selected: { role: "selection", kinds: ["system"], schema: "open" },
      },
    }).ok,
  ).toBe(false);
});

it("refuses workSubject fields without a codec that decodes a local Work key", async () => {
  for (const workSubject of ["search", "selected"]) {
    expect(await refuse({ ...builtinData, workSubject })).toContainEqual(
      expect.objectContaining({ path: "workSubject", expected: "decoded Work key" }),
    );
  }
  expect(
    await refuse({
      ...builtinData,
      workSubject: "system",
      identities: {
        ...builtinData.identities,
        system: { kind: "element", codec: "element" },
      },
    }),
  ).toContainEqual(expect.objectContaining({ path: "workSubject", expected: "decoded Work key" }));
});

it("admits journal previews with truthful Geometry/rollback axes but still refuses native geometry", async () => {
  const { commands } = await import("./semantic-actions.ts");
  const { commandCatalogAxes } = await import("./command-axes.ts");
  const key = "families.apply.preview";
  const preview = {
    input: commands[key].input,
    output: commands[key].result,
    axes: commandCatalogAxes[key],
  };
  const data = {
    ...builtinData,
    capabilities: [...builtinData.capabilities, "geometry"] as const,
    readings: {
      ...builtinData.readings,
      roster: {
        ...builtinData.readings.roster,
        entry: key as typeof key,
        demand: "explicit" as const,
      },
    },
  };
  const module = { ...builtinModule, data, entries: { ...entries, [key]: preview } };
  const catalog = [...baseCatalog, { key, ...preview.axes, uses: [] }];
  const { port, artifact } = await prepare(data, catalog, module);
  const checked: RouteModule<typeof data, typeof schemas, typeof module.entries>["data"] = data;
  const result = port.admitUnknown({ ...module, data: checked, artifact });
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  expect(result.ok).toBe(true);
  const registry = createAdmittedRouteRegistry();
  registry.register(result.route);
  expect(resolveRouteBindings(registry, result.route)?.entries[key]?.axes).toEqual(preview.axes);
  expect(preview.axes).toMatchObject({
    touches: ["Geometry"],
    effect: "TransactRead",
    rollsBack: true,
  });

  for (const axes of [{ ...preview.axes, effect: "Read" as const }, preview.axes]) {
    const native = {
      ...module,
      data: {
        ...data,
        readings: {
          ...data.readings,
          roster: { ...data.readings.roster, entry: "native.geometry" },
        },
      },
      entries: { ...entries, "native.geometry": { ...preview, axes } },
    };
    const prepared = await prepare(
      native.data,
      [...baseCatalog, { key: "native.geometry", ...axes, uses: [] }],
      native,
    );
    const refused = prepared.port.admitUnknown({ ...native, artifact: prepared.artifact });
    expect(refused.ok).toBe(false);
    if (!refused.ok)
      expect(refused.diagnostics).toContainEqual(
        expect.objectContaining({ path: "readings.roster.geometry" }),
      );
  }
});

it("links recovery display slots and validates their declared evidence", () => {
  const data = {
    ...builtinData,
    salvage: "recover",
    salvagePresent: "presentRecovery",
    salvageDeps: { page: ["density"], work: ["amount"], readings: ["total"] },
  } as const;
  const bindings = routeBindingSchema.parse({
    ...builtinModule,
    sources: {},
    bodies: {
      ...builtinBodies,
      recover: {
        slot: "salvage",
        kind: "salvage",
        source: { module: "test", export: "recover" },
        run: () => ({ ok: true, value: [] }),
      },
      presentRecovery: {
        slot: "salvagePresent",
        kind: "present",
        source: { module: "test", export: "present" },
        run: () => "Recovered inputs",
      },
    },
  });
  expect(linkRouteBodies(data, bindings, baseCatalog)).toEqual([]);
  expect(
    linkRouteBodies(
      { ...data, salvageDeps: { ...data.salvageDeps, readings: ["missing"] } },
      bindings,
      baseCatalog,
    ),
  ).toContainEqual(expect.objectContaining({ path: "salvageDeps.readings.0" }));
  expect(
    linkRouteBodies({ ...data, salvagePresent: "missing" }, bindings, baseCatalog),
  ).toContainEqual(expect.objectContaining({ path: "salvagePresent" }));
  expect(linkRouteBodies({ ...data, salvage: undefined }, bindings, baseCatalog)).toContainEqual(
    expect.objectContaining({ path: "salvagePresent" }),
  );
});

it.each(["missing", "malformed"])(
  "history detail schema %s fails at admission before any describe or write",
  async (kind) => {
    const data = {
      ...builtinData,
      historyDetail: "detail",
      verbs: {
        ...builtinData.verbs,
        edit: { ...builtinData.verbs.edit, describe: "describeEdit" },
      },
    };
    const describeEdit = vi.fn(() => ({ label: "Row", meta: { row: "one" } }));
    const module = {
      ...builtinModule,
      data,
      bodies: {
        ...builtinModule.bodies,
        describeEdit: {
          slot: "verbs.edit.describe",
          kind: "describe",
          source: { module: "bodies.js", export: "describeEdit" },
          run: describeEdit,
        },
      },
      schemas: { ...schemas, ...(kind === "malformed" ? { detail: { parse() {} } } : {}) },
    };
    const { port, artifact } = await prepare(data, baseCatalog, module);
    const result = port.admitUnknown({ ...module, artifact });
    expect(result).toMatchObject({ ok: false });
    expect(describeEdit).not.toHaveBeenCalled();
    if (!result.ok)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          path: kind === "missing" ? "historyDetail" : "artifact",
        }),
      );
  },
);

it("the closure pin alone admits builtin identity and refuses a stale pin or replaced body", async () => {
  const envelope: BuiltinClosure = {
    source: "builtin-closure", version: 1, data: builtinData, hostVersion: "test",
    variants: [{ client: "web", entry: "builtin.ts" }],
    modules: [{ id: "builtin.ts", sha256: digest(bytes) }], inputs: [], externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    builtin: { module: builtinModule, closure: { envelope, fingerprint }, catalog: baseCatalog },
  });
  await expect(inventory.prepare("builtin", "0".repeat(64))).rejects.toThrow("Stale or unknown builtin stamp");
  const port = await inventory.prepare("builtin", fingerprint);
  expect(port.admit(builtinModule).ok).toBe(true);
  expect(port.admit({ ...builtinModule, bodies: { ...builtinBodies, calculate: {
    ...builtinBodies.calculate, run: () => ({ total: 999 }),
  } } }).ok).toBe(false);
});
