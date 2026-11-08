import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  builtinData,
  ductsData,
  podData,
  schemas,
} from "../../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import {
  createRouteTokenIssuer,
  type DecodeResult,
  type PageOf,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate.ts";
import { createViewOwner, applyPageIntent } from "../route/view-owner";
import { createRouteOwner, makeAtomRegistry } from "./owner";
import { createPagePolicy, createPagePorts, identityCodecs, selectionCodec } from "./page-port";

const graph = {
  ...builtinData,
  fields: {
    ...builtinData.fields,
    stage: { ...builtinData.fields.search, role: "stage", initial: "pick" },
    draft: { ...builtinData.fields.search, role: "draft" },
    editor: {
      ...builtinData.fields.search,
      role: "device",
      url: false,
      share: false,
      agent: "none",
    },
    hover: {
      ...builtinData.fields.search,
      role: "transient",
      url: false,
      share: false,
      agent: "none",
    },
  },
} as const;
type Page = PageOf<typeof graph, typeof schemas>;
function value<T>(result: DecodeResult<T>): T {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
const local = (subject: string) =>
  value(identityCodecs.local.encode({ namespace: "system", subject }));
const item = (subject: string) => ({ kind: "system", id: local(subject) }) as const;
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

function fixture() {
  let evidence: "verified" | "unresolved" | { reason: string } = "verified";
  const policy = createPagePolicy(graph, schemas, () => evidence);
  const issuer = createRouteTokenIssuer();
  const published: Page[] = [];
  const owner = createRouteScopeGate<typeof graph, typeof schemas>({
    workSchema: schemas.work,
    hashWork: JSON.stringify,
    dependencies: () => ({}),
    journal: () => {
      throw new Error("Page test must not access a Work journal");
    },
    preparePage: policy.prepare,
    issuer,
  });
  cleanup.push(() => owner.close());
  owner.enter({ target: null, work: null }, value(policy.initial()));
  owner.subscribe((s) => published.push(s.page));
  const ports = createPagePorts(graph, { ...owner, readPage: () => owner.read()!.page });
  const restore = issuer.restore("url");
  const token = owner.capture("pea");
  const lease = value(
    issuer.lease({
      token,
      pageEpoch: owner.read()!.pageEpoch,
      pageRevision: 0,
      workRevision: null,
      dependencies: {},
    }),
  );
  return {
    policy,
    owner,
    ...ports,
    published,
    restore,
    lease,
    read: () => owner.read()!,
    evidence: (next: typeof evidence) => {
      evidence = next;
    },
    retire: () => {
      owner.retire(token);
    },
  };
}

test("device and transient use exact human role ports and reject schema, agent and restore writes", () => {
  const f = fixture();
  for (const [role, key] of [
    ["device", "editor"],
    ["transient", "hover"],
  ] as const) {
    const move = Reflect.get(f.page, role);
    expect(move).toBeTypeOf("function");
    expect(Reflect.apply(move, f.page, [key, "active"])).toMatchObject({ kind: "accepted" });
    expect(f.read().page[key]).toBe("active");
    expect(Reflect.apply(move, f.page, [key, 42])).toMatchObject({ kind: "refused" });
    expect(Reflect.apply(move, f.page, ["search", "wrong role"])).toMatchObject({
      kind: "refused",
    });
    expect(f.owner.acceptPage(f.lease, { [key]: "agent" })).toMatchObject({ kind: "refused" });
    expect(
      Reflect.apply(f.owner.restorePage, f.owner, [
        { [key]: "restore" },
        { kind: "restore", source: "url", token: f.restore },
      ]),
    ).toMatchObject({ kind: "refused" });
    expect(f.policy.restoreState({ [key]: "url" }, {})).toMatchObject({ ok: false });
  }
  if (false) {
    f.page.device("editor", "typed");
    f.controls.transient("hover", "typed");
    // @ts-expect-error A query key is not a device key.
    f.page.device("search", "wrong");
    // @ts-expect-error Device values come from the declared schema.
    f.page.device("editor", 42);
    // @ts-expect-error A device key is not a transient key.
    f.controls.transient("editor", "wrong");
  }
});

test("fixture defaults cannot initialize settings, device or transient fields through the restore lane", () => {
  for (const patch of [{ density: 2 }, { editor: "active" }, { hover: "active" }]) {
    const policy = createPagePolicy(graph, schemas, () => "verified", undefined, patch);
    expect(policy.initial()).toMatchObject({ ok: false });
    expect(policy.restoreState({}, {})).toMatchObject({ ok: false });
  }
});

test("subject, selection and frame restore once; a subject move clears selection and frame atomically", () => {
  const f = fixture();
  const seen = f.published;
  expect(
    f.owner.restorePage(
      { system: local("A"), selected: [item("A")], viewport: { x: 9, y: 8 } },
      { kind: "restore", source: "url", token: f.restore },
    ),
  ).toMatchObject({ kind: "accepted", changed: true });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({
    system: local("A"),
    selected: [item("A")],
    viewport: { x: 9, y: 8 },
  });
  f.controls.subject(local("B"));
  expect(seen).toHaveLength(2);
  expect(seen[1]).toMatchObject({ system: local("B"), selected: [], viewport: { x: 0, y: 0 } });
});

test("selection and stage leave pose unchanged, and logical no-ops publish nothing", () => {
  const f = fixture();
  f.controls.subject(local("A"));
  f.page.pose({ viewport: { x: 3, y: 4 } }, "gesture");
  const codec = selectionCodec(graph, graph.fields.selected.kinds);
  f.page.select(value(codec.decode(value(codec.encode([item("A")])))));
  f.controls.stage("detail");
  expect(f.read().page.viewport).toEqual({ x: 3, y: 4 });
  const basis = f.read();
  f.page.select([item("A"), item("A")]);
  f.controls.subject(local("A"));
  f.page.pose({ viewport: { x: 3, y: 4 } }, "named");
  f.owner.movePage({}, { kind: "human", source: "query", history: "replace" });
  expect(f.owner.movePage(basis.page, { kind: "scope", token: basis.scope })).toMatchObject({
    kind: "accepted",
    changed: false,
  });
  expect(
    f.owner.movePage(
      { selected: [], viewport: { x: 9, y: 9 } },
      { kind: "scope", token: basis.scope },
    ),
  ).toMatchObject({ kind: "refused" });
  expect(f.read()).toBe(basis);
  expect(f.published).toHaveLength(4);
});

test("explicit empty/default URL values beat tab memory, while absent keys inherit", () => {
  const f = fixture();
  const restored = value(
    f.policy.restoreState(
      { system: null, selected: [], search: "", viewport: { x: 0, y: 0 } },
      {
        system: local("B"),
        selected: [item("B")],
        search: "old",
        viewport: { x: 8, y: 9 },
        stage: "detail",
      },
    ),
  );
  expect(restored).toMatchObject({
    system: null,
    selected: [],
    search: "",
    viewport: { x: 0, y: 0 },
    stage: "detail",
  });
  f.page.set("density", 5);
  expect(
    f.owner.restorePage(restored, { kind: "restore", source: "url", token: f.restore }),
  ).toMatchObject({ kind: "accepted" });
  expect(f.read().page.density).toBe(5);
  expect(f.policy.restoreState({ density: 99 }, {}).ok).toBe(false);
  expect(f.policy.restoreState({}, { density: 99 }).ok).toBe(false);
});

test("unresolved restore retains selection; contrary evidence refuses without dropping input", () => {
  const f = fixture();
  f.evidence("unresolved");
  expect(
    f.owner.restorePage(
      { system: local("A"), selected: [item("A")] },
      { kind: "restore", source: "url", token: f.restore },
    ),
  ).toMatchObject({ membership: "unresolved" });
  f.evidence({ reason: "Selection is outside the subject" });
  const before = f.read();
  expect(f.page.select([item("B")])).toMatchObject({ kind: "refused" });
  expect(f.read()).toBe(before);
  f.evidence("verified");
  expect(f.page.select([item("A")])).toMatchObject({
    kind: "accepted",
    changed: false,
    membership: "verified",
  });
});

test("the pane port has no raw writer and JS cannot write through the wrong role", () => {
  const f = fixture();
  expect(Object.keys(f.page).sort()).toEqual([
    "device",
    "pose",
    "read",
    "select",
    "set",
    "transient",
  ]);
  expect(Object.isFrozen(f.page)).toBe(true);
  for (const key of ["system", "selected", "stage", "search", "draft", "__proto__"]) {
    expect(Reflect.apply(f.page.set.bind(f.page), null, [key, "bad"])).toMatchObject({
      kind: "refused",
    });
  }
  expect(Reflect.apply(f.page.pose.bind(f.page), null, [{ search: "bad" }, "named"])).toMatchObject(
    { kind: "refused" },
  );
  expect(
    Reflect.apply(f.page.pose.bind(f.page), null, [{ viewport: { x: 1, y: 2 } }, "invalid"]),
  ).toMatchObject({ kind: "refused" });
  expect(f.page.set("density", 2)).toMatchObject({ kind: "accepted" });
  expect(f.controls.query("search", "query")).toMatchObject({ kind: "accepted" });
  expect(f.controls.draft("draft", "text")).toMatchObject({ kind: "accepted" });
});

test("hostile raw transactions, omitted origins and partial restores refuse before publication", () => {
  const f = fixture();
  const origin = { kind: "human", source: "pose", history: "push" } as const;
  for (const patch of [
    null,
    [],
    { missing: true },
    { viewport: { x: "bad", y: 1 } },
    JSON.parse('{"__proto__":{"x":1}}'),
    Object.create({ viewport: { x: 1, y: 2 } }),
    {
      get viewport() {
        throw new Error("Never read getters");
      },
    },
    { [Symbol("hidden")]: 1 },
  ]) {
    expect(Reflect.apply(f.owner.movePage.bind(f.owner), null, [patch, origin])).toMatchObject({
      kind: "refused",
    });
  }
  expect(Reflect.apply(f.owner.movePage.bind(f.owner), null, [{ search: "x" }])).toMatchObject({
    kind: "refused",
  });
  expect(
    Reflect.apply(f.owner.movePage.bind(f.owner), null, [
      { system: null, selected: [] },
      { kind: "restore", source: "url", token: f.restore },
    ]),
  ).toMatchObject({ kind: "refused" });
  expect(
    Reflect.apply(f.owner.restorePage.bind(f.owner), null, [
      { system: null },
      { kind: "restore", source: "url", token: f.restore },
    ]),
  ).toMatchObject({ kind: "refused" });
  for (const origin of [
    { kind: "pea" },
    { kind: "pea", lease: null },
    { kind: "invocation", token: null, purpose: "result" },
  ]) {
    expect(
      Reflect.apply(f.owner.movePage.bind(f.owner), null, [{ search: "escape" }, origin]),
    ).toMatchObject({ kind: "refused" });
  }
  expect(f.published).toHaveLength(0);
});

test("authority is rechecked after validation; stale or copied Pea leases refuse even no-ops", () => {
  const f = fixture();
  expect(f.owner.movePage({ search: "a" }, { kind: "pea", lease: f.lease })).toMatchObject({
    kind: "accepted",
  });
  expect(
    Reflect.apply(f.owner.movePage.bind(f.owner), null, [
      { search: "b" },
      { kind: "pea", lease: Object.assign({}, f.lease) },
    ]),
  ).toMatchObject({ kind: "refused" });
  f.retire();
  const before = f.read();
  expect(f.owner.movePage({ search: "a" }, { kind: "pea", lease: f.lease })).toMatchObject({
    kind: "refused",
  });
  expect(f.read()).toBe(before);
});

test("read snapshots and submitted containers cannot mutate owner state", () => {
  const f = fixture();
  const pose = { x: 3, y: 4 };
  f.page.pose({ viewport: pose }, "gesture");
  pose.x = 99;
  const read = f.page.read();
  expect(Reflect.set(read.viewport, "x", 88)).toBe(false);
  expect(Reflect.set(read.selected, "0", item("intruder"))).toBe(false);
  expect(f.read().page.viewport).toEqual({ x: 3, y: 4 });
});

test("mixed native/local subjects and many subjects retain their identity contracts", () => {
  const policy = createPagePolicy(podData, schemas, () => "verified");
  const initial = value(policy.initial());
  const manual = { kind: "manual", id: local("manual") } as const;
  const circuit = {
    kind: "circuit",
    id: value(
      identityCodecs.element.encode({ document: "d", link: null, uniqueId: "circuit-uid" }),
    ),
  } as const;
  const origin = { kind: "human", source: "subject", history: "push" } as const;
  expect(policy.prepare(initial, { system: manual }, origin).ok).toBe(true);
  expect(policy.prepare(initial, { system: circuit }, origin).ok).toBe(true);
  expect(policy.prepare(initial, { system: { kind: "circuit", id: manual.id } }, origin).ok).toBe(
    false,
  );
  const many = createPagePolicy(ductsData, schemas, () => "verified");
  const empty = value(many.initial());
  expect(many.prepare(empty, { system: { kind: "all" } }, origin).ok).toBe(true);
  expect(many.prepare(empty, { system: { kind: "ids", ids: [local("A")] } }, origin).ok).toBe(true);
  expect(many.prepare(empty, { system: [local("A")] }, origin).ok).toBe(false);
  expect(many.prepare(empty, { selected: "all" }, { ...origin, source: "selection" }).ok).toBe(
    false,
  );
});

test("invocation landing keeps its epoch, but human navigation invalidates its continuation", () => {
  const f = fixture();
  const token = f.owner.capture("action");
  const invocation = value(f.owner.invocation(token, {}));
  const epoch = f.read().pageEpoch;
  expect(f.owner.acceptPage(invocation, { search: "review" })).toMatchObject({ kind: "accepted" });
  expect(f.owner.acceptPage(invocation, { search: "result" })).toMatchObject({ kind: "accepted" });
  expect(f.read().pageEpoch).toBe(epoch);
  f.controls.query("search", "human");
  expect(f.owner.acceptPage(invocation, { search: "late result" })).toMatchObject({
    kind: "refused",
  });
  expect(f.read().page.search).toBe("human");
});

test("action landing and Pea receipts remain tied to the accepted rendered Page", () => {
  const base = createRouteOwner("unit-c", makeAtomRegistry());
  const owner = createViewOwner(base, z.object({ value: z.string().default("") }), {});
  try {
    const actionBasis = owner.read();
    owner.move({ value: "action" }, {}, "action", actionBasis);
    expect(owner.read().epoch).toBe(actionBasis.epoch);
    const leased = owner.read().page;
    const result = applyPageIntent(leased, () => owner.setPage({ value: "pea" }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected receipt");
    expect(result.receipt.current()).toBe(true);
    expect(result.receipt.rendered(leased)).toBe(false);
    expect(result.receipt.rendered(owner.read().page)).toBe(true);
    owner.setPage({ value: "human" });
    expect(result.receipt.current()).toBe(false);
    expect(applyPageIntent(leased, () => owner.setPage({ value: "late" })).ok).toBe(false);
    owner.move({ value: "late action" }, {}, "action", actionBasis);
    expect(owner.read().page.value).toBe("human");
  } finally {
    owner.dispose();
    base.dispose();
  }
});

// Declaration-checked prohibitions are never executed.
function prohibited(f: ReturnType<typeof fixture>) {
  // @ts-expect-error origin is mandatory
  f.owner.movePage({ search: "x" });
  // @ts-expect-error restore is a separate coupled door
  f.owner.movePage({}, { kind: "restore", source: "url", token: f.restore });
  // @ts-expect-error selection must accompany a restored subject
  f.owner.restorePage({ system: null }, { kind: "restore", source: "url", token: f.restore });
  // @ts-expect-error query is not setting
  f.page.set("search", "x");
  // @ts-expect-error subject is not setting
  f.page.set("system", null);
  const wider = { viewport: { x: 1, y: 2 }, search: "escape" };
  // @ts-expect-error pose rejects extra fields in wider variables too
  f.page.pose(wider, "named");
  // @ts-expect-error snapshots are readonly
  f.page.read().viewport.x = 2;
  // @ts-expect-error query control cannot write draft
  f.controls.query("draft", "x");
}
void prohibited;
