import { describe, expect, it } from "vite-plus/test";
import { RouteGraphJson, type FieldJson } from "./route-kernel-data.ts";
import type { BodyBindings } from "./route-kernel-bodies.ts";
import type {
  AdmittedRoute,
  AdmittedRouteRegistry,
  RouteFingerprint,
} from "./route-kernel-admission.ts";
import type { FixtureEnvironment, NativeWriteCapability } from "./route-kernel-environment.ts";
import type {
  AcceptanceToken,
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
  ductsData,
  ductsBodies,
  schemas,
  entries,
} from "./route-kernel.fixtures.ts";

type Builtin = BodyBindings<typeof builtinData, typeof schemas, typeof entries, string>;
type Pod = BodyBindings<typeof podData, typeof schemas, typeof entries, string>;
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
      podPage.circuit;
      // @ts-expect-error only declared reading dependencies are visible
      readings.total;
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
      ctx.owner;
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
  const fixture: FixtureEnvironment<{}, {}, {}, {}> = {
    reads: {},
    work: {},
    clock: {},
    geometry: {},
    availability: {},
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

describe("S0 signature witnesses", () => {
  it.each([builtinData, podData, ductsData])("decodes $key with the same data schema", (data) => {
    expect(RouteGraphJson.parse(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });
  it("exercises 26 fields and separate builtin/Pod bodies", () => {
    expect(Object.keys(ductsData.fields)).toHaveLength(26);
    expect(Object.keys(builtinBodies)).toEqual(Object.keys(podBodies));
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
