/* eslint-disable typescript/no-misused-spread -- Deliberate hostile copies test nominal authority refusals. */
import { createRouteAdmission, resolveRouteBindings } from "./route-module.ts";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import { RouteGraphJson, type FieldJson } from "./route-kernel-data.ts";
import type { Observation, WorkWriteOutcome } from "./work-journal-door.ts";
import type { BodyBindings, PaneContext } from "./route-kernel-bodies.ts";
import type {
  AdmittedRoute,
  AdmittedRouteRegistry,
  RouteFingerprint,
  RouteModule,
} from "./route-kernel-admission.ts";
import type {
  FixtureEnvironment,
  NativeWriteCapability,
  GeometryRequest,
  GeometryOutcome,
  PreparedDetailReach,
  ReadCapability,
  ResolvedRead,
  ResolvedGeometryRead,
  GeometryReadCapability,
  JournalCommandHandle,
} from "./route-kernel-environment.ts";
import type {
  AcceptanceToken,
  ScopeToken,
  InvocationToken,
  AcceptanceOwner,
  WorkDelivery,
  PageOf,
  CausalParentId,
  FieldControls,
  IdentityCodecs,
  IdentityId,
  PageOwner,
  PagePort,
  RestoreToken,
  ScopeEpoch,
} from "./route-kernel-page.ts";
import {
  builtinData,
  builtinBodies,
  podData,
  podBodies,
  podEntries,
  builtinModule,
  podModule,
  ductsData,
  ductsBodies,
  schemas,
  entries,
} from "./route-kernel.fixtures.ts";

type Builtin = BodyBindings<typeof builtinData, typeof schemas, typeof entries, string>;
type Pod = BodyBindings<typeof podData, typeof schemas, typeof podEntries, string>;
type Ducts = BodyBindings<typeof ductsData, typeof schemas, typeof entries, string>;

/** Never executed. tsc checks every refusal with declarations ON; Vitest checks the data. */
export function typeRefusals(
  page: PagePort<typeof builtinData, typeof schemas>,
  owner: PageOwner<typeof builtinData, typeof schemas>,
  controls: FieldControls<typeof builtinData, typeof schemas>,
  restore: RestoreToken,
  epoch: ScopeEpoch,
  fingerprint: RouteFingerprint,
  registry: AdmittedRouteRegistry,
  native: NativeWriteCapability,
  codecs: IdentityCodecs,
  local: IdentityId<"local">,
  element: IdentityId<"element">,
  fixtureBase: FixtureEnvironment,
): void {
  // @ts-expect-error roles are required, never inferred as pose
  const field: FieldJson = {
    schema: "text",
    codec: "text",
    initial: "",
    url: false,
    share: false,
    agent: "read",
  };
  // @ts-expect-error missing named body is a compile error
  const missing: Builtin = { ...builtinBodies, calculate: undefined };
  const wrong: Builtin = {
    ...builtinBodies,
    // @ts-expect-error declaration path localizes a wrong-kind binding
    calculate: builtinBodies.pick,
  };
  const extra: Builtin = {
    ...builtinBodies,
    // @ts-expect-error unreferenced bodies are not available
    forgotten: builtinBodies.pick,
  };
  const args: Builtin["rosterArgs"] = {
    ...builtinBodies.rosterArgs,
    // @ts-expect-error entry input requires a string filter
    run: () => ({ filter: 123 }),
  };
  const picker: Builtin["pick"] = {
    ...builtinBodies.pick,
    // @ts-expect-error picker cannot substitute native elements for local system identity
    run: () => [{ id: element, label: "Wrong kind" }],
  };
  const pod: Pod["calculate"] = {
    ...podBodies.calculate,
    run: ({ page: podPage, readings }) => {
      // @ts-expect-error renaming/removing a field invalidates body access
      void podPage.circuit;
      // @ts-expect-error only declared reading dependencies are visible
      void readings.total;
      return { total: 1 };
    },
  };
  const wrongDerive: Pod["calculate"] = {
    ...podBodies.calculate,
    // @ts-expect-error derive must return its referenced schema, not an arbitrary value
    run: () => ({ total: "bad" }),
  };
  const ducts: Ducts["calculate"] = {
    ...ductsBodies.calculate,
    run: ({ page: ductsPage }) => {
      // @ts-expect-error changing the subject cardinality invalidates scalar body code
      ductsPage.system.toUpperCase();
      return { total: 1 };
    },
  };
  const edit: Builtin["edit"] = {
    ...builtinBodies.edit,
    // @ts-expect-error Work patch value must match its path
    run: () => [{ path: ["amount"], value: "bad" }],
  };
  const command: Builtin["apply"] = {
    ...builtinBodies.apply,
    // @ts-expect-error command intent follows the declared entry input
    run: () => ({ otherCommand: "unsafe" }),
  };
  const pane: Builtin["main"] = {
    ...builtinBodies.main,
    run: (ctx) => {
      // @ts-expect-error no owner/raw writer reaches the pane
      void ctx.owner;
      // @ts-expect-error no arbitrary verb string dispatch
      ctx.verbs.unknown({});
      return "ok";
    },
  };
  page.set("density", 2);
  page.select([
    { kind: "system", id: local },
    { kind: "element", id: element },
  ]);
  controls.query("search", "fan");
  // @ts-expect-error query is not a setting
  page.set("search", "fan");
  // @ts-expect-error subject is not a setting
  page.set("system", local);
  // @ts-expect-error subject cannot hide in a camera patch
  page.pose({ system: local }, "gesture");
  const widerPose = { viewport: { x: 1, y: 2 }, system: local };
  // @ts-expect-error role validation also rejects wider variables, not only object literals
  page.pose(widerPose, "gesture");
  // @ts-expect-error snapshots are immutable
  page.read().viewport.x = 3;
  // @ts-expect-error no raw Page writer on the public port
  page.movePage({ search: "x" }, { kind: "human" });
  // @ts-expect-error selection identity is kind-specific
  page.select([{ kind: "element", id: local }]);
  // @ts-expect-error selection is never all
  page.select("all");
  // @ts-expect-error numeric ElementId is not a stable identity
  codecs.element.encode({ document: "doc", link: null, uniqueId: 42 });
  // @ts-expect-error linked identity needs the source and linked document
  codecs.link.encode({ linkUniqueId: "unique" });
  // @ts-expect-error origin is mandatory
  owner.movePage({ search: "x" });
  // @ts-expect-error no universal action exemption from freshness
  owner.movePage({ search: "x" }, { kind: "action" });
  owner.restorePage(
    { system: local, selected: [], viewport: { x: 0, y: 0 } },
    { kind: "restore", source: "url", token: restore },
  );
  // @ts-expect-error atomic restore requires selection alongside subject
  owner.restorePage({ system: local }, { kind: "restore", source: "url", token: restore });
  // @ts-expect-error epochs can only be minted by the acceptance owner
  const forged: ScopeEpoch = {};
  // @ts-expect-error a token requires exact scope identity and epoch
  const attempt: AcceptanceToken = { channel: "read", attempt: 1, epoch };
  // @ts-expect-error decoded data is not admission
  const admitted: AdmittedRoute = { data: builtinData, fingerprint };
  // @ts-expect-error no unchecked registry door
  registry.register(builtinData);
  const fixture: FixtureEnvironment = {
    ...fixtureBase,
    // @ts-expect-error fixture capability excludes native writes structurally
    nativeWrite: native,
  };
  void [
    field,
    missing,
    wrong,
    extra,
    args,
    picker,
    pod,
    wrongDerive,
    ducts,
    edit,
    command,
    pane,
    forged,
    attempt,
    admitted,
    fixture,
  ];
}

/** Exact critic programs plus isolated field accesses: each must remain a compiler error. */
export function criticRefusals(
  owner: AcceptanceOwner<typeof builtinData, typeof schemas>,
  original: AdmittedRoute,
  registry: AdmittedRouteRegistry,
  scope: ScopeToken,
  attempt: AcceptanceToken,
  invocation: InvocationToken,
  restore: RestoreToken,
  system: IdentityId<"local">,
  native: () => void,
  reads: ReadCapability,
  resolved: ResolvedRead<string>,
  geometry: GeometryReadCapability,
  resolvedGeometry: ResolvedGeometryRead<string>,
  reach: PreparedDetailReach,
  handle: JournalCommandHandle,
): void {
  const hiddenArgs: Builtin["rosterArgs"] = {
    ...builtinBodies.rosterArgs,
    // @ts-expect-error critic R2: neither density nor note is a declared dependency
    run: ({ page, work }) => ({ filter: String(page.density) + work?.note }),
  };
  const hiddenDerive: Builtin["calculate"] = {
    ...builtinBodies.calculate,
    // @ts-expect-error critic R2: work.amount does not grant note or page.density
    run: ({ page, work }) => ({ total: work.amount + work.note.length + page.density }),
  };
  const separate: Builtin["apply"] = {
    ...builtinBodies.apply,
    run: ({ page, work, readings, captures }) => {
      // @ts-expect-error no Page dependency declared
      void page.search;
      // @ts-expect-error work.amount does not grant all Work
      void work.note;
      // @ts-expect-error captures do not become invalidating dependencies
      void readings.total;
      // @ts-expect-error only named captures are visible
      void captures.roster;
      return { amount: captures.total.value?.total ?? work.amount };
    },
  };
  // @ts-expect-error critic R5: no partial restore through the move door
  owner.movePage({ system }, { kind: "restore", source: "url", token: restore });
  // @ts-expect-error critic R1: reconstructed scope does not inherit authority from an epoch
  const rebound: ScopeToken = { identity: { target: null, work: null }, epoch: scope.epoch };
  // @ts-expect-error copies lose the nominal private owner membership
  const copiedScope: ScopeToken = { ...scope, identity: { target: null, work: null } };
  // @ts-expect-error arbitrary channel/attempt cannot be minted around an authentic scope
  const forgedAttempt: AcceptanceToken = { scope, channel: "read", attempt: 99 };
  const copiedDelivery = {
    kind: "snapshot" as const,
    key: { binding: "host" as const, route: "tiny", target: null },
    revision: 1,
    value: { amount: 1, note: "" },
    hash: "x",
  };
  // @ts-expect-error a copied attempt is not an owner-issued attempt
  owner.acceptWork({ ...attempt, attempt: 99 }, copiedDelivery);
  // @ts-expect-error copied invocation cannot revive a stale Page revision
  owner.acceptPage({ ...invocation, pageRevision: 999 }, { search: "x" });
  // @ts-expect-error critic R6: spread does not carry the admission authority
  registry.register({
    ...original,
    data: { ...original.data, key: "pod.rebound", address: "/rebound" },
  });
  // @ts-expect-error even unchanged copies require the exact kernel-owned handle
  registry.register({ ...original });
  const fixture: FixtureEnvironment = {
    // @ts-expect-error critic R4: read transport is not a read capability
    reads: { callNative: native },
    // @ts-expect-error concrete Work operations required
    work: {},
    // @ts-expect-error concrete clock operation required
    clock: {},
    // @ts-expect-error concrete admitted geometry acquisition required
    geometry: {},
    availability: {},
  };
  // @ts-expect-error cannot erase the services through unconstrained generic arguments
  type EmptyServices = FixtureEnvironment<{}, {}, {}, {}>;
  const emptyServices: EmptyServices = {};
  void emptyServices;
  // @ts-expect-error read lifetime cannot be command
  const wrongLifetime: ReadCapability = { ...reads, lifetime: "command" };
  // @ts-expect-error acquisition requires an owner-issued attempt
  reads.acquire(resolved);
  geometry.acquire(resolvedGeometry, attempt);
  // @ts-expect-error geometry cannot dispatch a raw logical operation
  geometry.acquire({ op: "scene" }, attempt);
  // @ts-expect-error default GeometryRequest is overview only
  const automaticDetail: GeometryRequest = { representation: "meshes", reach };
  const shortReach: GeometryRequest<"meshes"> = {
    representation: "meshes",
    // @ts-expect-error detail requires prepared/validated reach, not a numeric assertion
    reach: { ...reach, reachFt: 1 },
  };
  const budget: GeometryOutcome<string> = {
    // @ts-expect-error cost-based refusal is no longer an outcome
    kind: "over-budget",
    estimatedCost: 100,
    budget: 1,
    overviewEntry: "x",
  };
  // @ts-expect-error every successful result has generated GeometryCost metadata
  const uncosted: GeometryOutcome<string> = {
    kind: "ready",
    value: "x",
    representation: "overview",
  };
  // @ts-expect-error a submitted command is a journal handle, not an invocation function
  handle.invoke();
  // @ts-expect-error causal parents are opaque, not free-form correlation strings
  const parent: CausalParentId = "made-up";
  // @ts-expect-error snapshot cannot impersonate an ack with no inverse/provenance
  const lostReceipt: WorkDelivery<unknown> = { kind: "ack", revision: 1, value: {} };
  // @ts-expect-error typed cells reject undeclared keys
  podBodies.cellGroup.run("anything");
  const nativeId = podModule.identities.element.encode({
    document: "doc",
    link: null,
    uniqueId: "unique",
  });
  if (nativeId.ok) {
    const wrongSubject: PageOf<typeof podData, typeof schemas>["system"] = {
      kind: "manual",
      // @ts-expect-error manual subjects cannot carry native ids
      id: nativeId.value,
    };
    void wrongSubject;
  }
  const omittedGeometry = {
    ...podData,
    readings: {
      ...podData.readings,
      overview: { ...builtinData.readings.roster, entry: "scene" as const },
    },
  };
  const unguardedModule: RouteModule<
    typeof omittedGeometry,
    typeof schemas,
    typeof podEntries,
    string
  > = {
    ...podModule,
    // @ts-expect-error Geometry catalog footprint cannot opt out by omitting geometry
    data: omittedGeometry,
  };
  // @ts-expect-error explicit detail cannot be scheduled from subject demand
  const automaticGeometry: RouteGraphJson["readings"][string] = {
    ...podData.readings.detail,
    demand: "subject",
  };
  // @ts-expect-error explicit detail cannot refresh on dependency changes
  const refreshingGeometry: RouteGraphJson["readings"][string] = {
    ...podData.readings.detail,
    refresh: "dependencies",
  };
  void [unguardedModule, automaticGeometry, refreshingGeometry];
  void [
    hiddenArgs,
    hiddenDerive,
    separate,
    rebound,
    copiedScope,
    forgedAttempt,
    fixture,
    wrongLifetime,
    automaticDetail,
    shortReach,
    budget,
    uncosted,
    parent,
    lostReceipt,
  ];
}

describe("S0 signature witnesses", () => {
  it.each([builtinData, podData, ductsData])("decodes $key with the same data schema", (data) => {
    expect(RouteGraphJson.parse(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });
  it("exercises 26 fields and separate builtin/Pod bodies", () => {
    expect(Object.keys(ductsData.fields)).toHaveLength(26);
    expect(podModule.bodies.upgradeV1.run({ amount: 3 })).toEqual({ amount: 3, note: "" });
    expect(builtinModule.data).toBe(builtinData);
    expect(podModule.artifact.data).toBe(podData);
  });
  it("keeps detail explicit and validates its minimum reach without a cost cap", () => {
    const parse = (detail: unknown) =>
      RouteGraphJson.safeParse({ ...podData, readings: { ...podData.readings, detail } }).success;
    expect(parse(podData.readings.detail)).toBe(true);
    expect(parse({ ...podData.readings.detail, demand: "subject" })).toBe(false);
    expect(parse({ ...podData.readings.detail, refresh: "dependencies" })).toBe(false);
    expect(
      parse({
        ...podData.readings.detail,
        geometry: { ...podData.readings.detail.geometry, reachFt: 4.99 },
      }),
    ).toBe(false);
    expect(
      parse({
        ...podData.readings.detail,
        geometry: { ...podData.readings.detail.geometry, reachFt: 50000 },
      }),
    ).toBe(true);
    expect(
      parse({
        ...podData.readings.detail,
        geometry: { ...podData.readings.detail.geometry, budget: "host-weighted" },
      }),
    ).toBe(false);
  });
  it("round trips both Pod subject kinds through its bound field codec", () => {
    const manual = podModule.identities.local.encode({
      namespace: "pod.circuits",
      subject: "manual",
    });
    const native = podModule.identities.element.encode({
      document: "doc",
      link: null,
      uniqueId: "circuit-uid",
    });
    if (!manual.ok || !native.ok) throw new Error("Witness identity codec refused valid parts");
    const values = [
      { kind: "manual", id: manual.value },
      { kind: "circuit", id: native.value },
    ] as const;
    for (const value of values)
      expect(podModule.codecs.subject.decode(podModule.codecs.subject.encode(value))).toEqual({
        ok: true,
        value,
      });
    expect(
      podModule.codecs.subject.decode(JSON.stringify({ kind: "manual", id: native.value })).ok,
    ).toBe(false);
    expect(podModule.bodies.cellGroup.run("voltage")).toEqual(["electrical"]);
  });
  it("refuses missing roles, executable data, unknown policy, and required review", () => {
    const { role: _role, ...unroled } = builtinData.fields.search;
    expect(
      RouteGraphJson.safeParse({
        ...builtinData,
        fields: { ...builtinData.fields, search: unroled },
      }).success,
    ).toBe(false);
    expect(RouteGraphJson.safeParse({ ...builtinData, transition: () => ({}) }).success).toBe(
      false,
    );
    expect(
      RouteGraphJson.safeParse({
        ...builtinData,
        fields: { ...builtinData.fields, density: { ...builtinData.fields.density, url: "push" } },
      }).success,
    ).toBe(false);
    expect(
      RouteGraphJson.safeParse({
        ...builtinData,
        verbs: { ...builtinData.verbs, apply: { ...builtinData.verbs.apply, review: "required" } },
      }).success,
    ).toBe(false);
  });
});

/** Replays s0-recheck's cast-free descriptor rebinding counterexample. Never executed. */
export function geometryRebind(
  read: ResolvedRead<GeometryOutcome<string>>,
  reach: PreparedDetailReach,
  geometry: GeometryReadCapability,
  token: AcceptanceToken,
) {
  const request: { readonly representation: "meshes"; readonly reach: PreparedDetailReach } = {
    representation: "meshes",
    reach,
  };
  // @ts-expect-error a generic read plus a request lacks resolver-issued geometry authority
  return geometry.acquire(Object.assign({}, read, { request }), token);
}

/** Geometry descriptors have one acquisition door, with geometry authority checks. */
export function geometryDoors(
  read: ResolvedGeometryRead<string>,
  environment: FixtureEnvironment,
  token: AcceptanceToken,
) {
  // @ts-expect-error generic reads cannot bypass geometry acquisition validation
  environment.reads.acquire(read, token);
  // @ts-expect-error subscriptions cannot bypass geometry acquisition validation
  environment.readings.subscribe(read, token, () => {});
}

/** The source admission and both resolution doors retain the same authoring contract. */
export function sourceRetention(
  port: Awaited<ReturnType<typeof createRouteAdmission>>,
  registry: AdmittedRouteRegistry,
) {
  const admitted = port.admit(builtinModule);
  if (!admitted.ok) return;
  const resolved = registry.resolve(admitted.route);
  if (!resolved) return;
  const bindings = resolveRouteBindings(registry, resolved);
  if (!bindings) return;
  const bodies: Builtin = bindings.bodies;
  const schema: typeof schemas.number = bindings.schemas.number;
  const entry: typeof entries.roster = bindings.entries.roster;
  const address: "/tiny" = resolved.data.address;
  const pane: Builtin["main"] = {
    ...bodies.main,
    run: (ctx) => {
      const density: number = ctx.page.read().density;
      // @ts-expect-error renamed field is unavailable after admission
      void ctx.page.read().oldDensity;
      // @ts-expect-error query field is not a setting
      ctx.page.set("search", "bad");
      return String(density);
    },
  };
  const derive: Builtin["calculate"] = {
    ...bodies.calculate,
    run: (ctx) => {
      // @ts-expect-error undeclared dependency stays hidden after admission
      void ctx.page.density;
      return { total: ctx.work.amount };
    },
  };
  // @ts-expect-error copied handles never acquire nominal membership
  const copied: typeof admitted.route = { ...admitted.route };
  // @ts-expect-error resolved slot retains its literal kind
  const wrong: Builtin["calculate"] = bodies.pick;
  const unknown = port.admitUnknown(builtinModule);
  if (unknown.ok) {
    const broad = resolveRouteBindings(registry, unknown.route);
    // @ts-expect-error unknown JSON never gets source schema inference
    const narrow: typeof schemas.number = broad!.schemas.number;
    void narrow;
  }
  void [schema, entry, address, pane, derive, copied, wrong];
}

// A variable with extra services is also refused, not only fresh object literals.
import type {
  EnvironmentFor,
  KernelServices,
  RouteEnvironment,
} from "./route-kernel-environment.ts";
function capabilityTypes(baseline: KernelServices, all: RouteEnvironment) {
  const empty = { capabilities: [] } as const;
  const work = { capabilities: ["work"] } as const;
  const geometry = { capabilities: ["geometry"] } as const;
  const native = { capabilities: ["native-write"] } as const;
  const { reads, readings, clock, availability } = baseline;
  const readOnly: EnvironmentFor<typeof empty> = { reads, readings, clock, availability };
  // @ts-expect-error unused Work/geometry services cannot be supplied via a variable
  const unused: EnvironmentFor<typeof empty> = all;
  // @ts-expect-error Work requires its services
  const missingWork: EnvironmentFor<typeof work> = baseline;
  // @ts-expect-error geometry requires its services
  const missingGeometry: EnvironmentFor<typeof geometry> = baseline;
  // @ts-expect-error native-write requires nominal authority
  const missingNative: EnvironmentFor<typeof native> = baseline;
  return [readOnly, unused, missingWork, missingGeometry, missingNative];
}
void capabilityTypes;

export function paneOutcomeWitness(
  pane: PaneContext<typeof builtinData, typeof schemas, typeof entries, "main">,
  basis: InvocationToken,
) {
  const outcome = pane.verbs.edit({ amount: 2 }, basis);
  expectTypeOf(outcome).toEqualTypeOf<Observation<WorkWriteOutcome>>();
  // @ts-expect-error a Work edit cannot erase its authoritative outcome
  const erased: void = outcome;
  void [erased];
  expectTypeOf(pane.verbs.apply({})).toEqualTypeOf<
    { readonly kind: "review"; readonly preview: unknown } | { readonly kind: "preview" }
  >();
}
