import { expect, test } from "vite-plus/test";
import { bindWork, canonicalRouteInput, type WorkWriteAck } from "@pe/agent-contracts";
import { builtinData, schemas } from "../../agent-contracts/src/route-kernel.fixtures.ts";
import {
  createRouteTokenIssuer,
  ScopeToken,
  AcceptanceToken,
  InvocationToken,
  type AcceptanceOwner,
  type PageOf,
  type ScopeEpoch,
  type PageEpoch,
} from "../../agent-contracts/src/route-kernel-page.ts";
import { createRouteScopeGate, type ScopeGateOptions } from "./route-scope-gate.ts";
import { createWorkJournal } from "./work-journal.ts";
const key = bindWork("tiny", null, "A");
const other = bindWork("tiny", null, "B");
const page: PageOf<typeof builtinData, typeof schemas> = {
  system: null,
  selected: [],
  density: 1,
  viewport: { x: 0, y: 0 },
  search: "",
};
const ack = (
  revision = 1,
  amount = revision,
  overrides: Partial<WorkWriteAck> = {},
): WorkWriteAck => ({
  key,
  revision,
  base: revision - 1,
  kind: "apply",
  by: "human",
  press: `press-${revision}`,
  patches: [{ path: ["amount"], value: amount }],
  inverse: [{ path: ["amount"], value: amount - 1 }],
  undoable: true,
  at: revision,
  ...overrides,
});
const snapshot = (revision = 0, amount = revision) => ({
  kind: "snapshot" as const,
  handle: { key, revision },
  value: { amount, note: "" },
  hash: canonicalRouteInput({ amount, note: "" }),
});

test("a subject move preserves the same Work but retires prior scope authority", () => {
  const owner = createRouteScopeGate<typeof builtinData, typeof schemas>({
    workSchema: schemas.work,
    hashWork: canonicalRouteInput,
    journal: createWorkJournal,
    dependencies: () => ({}),
    scopeFields: ["search"],
    identityForPage: (next) => ({ target: null, work: next.search === "other Work" ? other : key }),
    preparePage: (current, patch) => ({
      ok: true,
      value: {
        page: { ...current, ...patch },
        changed: true,
        membership: "verified",
      },
    }),
  });
  owner.enter({ target: null, work: key }, page);
  const feed = owner.capture("work");
  expect(owner.acceptWork(feed, snapshot(1, 9)).kind).toBe("published");
  const before = owner.read()?.work;
  expect(
    owner.movePage(
      { search: "next subject" },
      {
        kind: "human",
        source: "subject",
        history: "push",
      },
    ).kind,
  ).toBe("accepted");
  expect(owner.read()?.work).toBe(before);
  expect(owner.current(feed)).toBe(false);
  expect(owner.acceptWork(feed, snapshot(2)).kind).toBe("refused");
  owner.movePage({ search: "other Work" }, { kind: "human", source: "subject", history: "push" });
  expect(owner.read()?.work).toBeNull();
  owner.close();
});

test("current is read-only and follows accepted Page and Work continuations", () => {
  let preparations = 0;
  const f = fixture((current, patch) => {
    preparations++;
    return {
      ok: true,
      value: { page: { ...current, ...patch }, changed: true, membership: "verified" },
    };
  });
  const token = f.invocation();
  const state = f.owner.read()!;
  let publications = 0;
  f.owner.subscribe(() => publications++);
  for (const candidate of [state.scope, f.read, token])
    expect(f.owner.current(candidate)).toBe(true);
  expect(f.owner.read()).toBe(state);
  expect(preparations).toBe(0);
  expect(publications).toBe(0);
  expect(f.owner.acceptPage(token, { search: "review" }).kind).toBe("accepted");
  expect(f.owner.current(token)).toBe(true);
  expect(f.owner.acceptWork(token, { kind: "ack", write: ack() }).kind).toBe("published");
  expect(f.owner.current(token)).toBe(true);
  expect(token.pageRevision).toBe(0);
  expect(token.workRevision).toBe(0);
  f.dependencies.total = "changed";
  expect(f.owner.current(token)).toBe(false);
});

test("current rejects copied, foreign, retired, replaced and closed authority", () => {
  const f = fixture();
  const scope = f.owner.read()!.scope;
  const token = f.invocation();
  for (const candidate of [scope, f.read, token]) {
    expect(f.owner.current(Object.assign({}, candidate))).toBe(false);
    expect(f.owner.current(new Proxy(candidate, {}))).toBe(false);
    expect(fixture().owner.current(candidate)).toBe(false);
  }
  f.owner.retire(token.token);
  expect(f.owner.current(token)).toBe(false);
  expect(f.owner.current(token.token)).toBe(false);
  const replaced = f.invocation();
  f.owner.capture("write");
  expect(f.owner.current(replaced)).toBe(false);
  f.enter(other);
  f.enter();
  expect(f.owner.current(scope)).toBe(false);
  expect(f.owner.current(f.read)).toBe(false);
  const fresh = f.invocation();
  const freshScope = f.owner.read()!.scope;
  f.owner.close();
  expect(f.owner.current(fresh)).toBe(false);
  expect(f.owner.current(freshScope)).toBe(false);
});

test("current checks lease continuations and independently moved Page", () => {
  const f = fixture();
  const state = f.owner.read()!;
  const issued = f.issuer.lease({
    token: f.read,
    pageEpoch: state.pageEpoch,
    pageRevision: state.pageRevision,
    workRevision: state.work!.revision,
    dependencies: {},
  });
  if (!issued.ok) throw new Error(issued.reason);
  expect(f.owner.current(issued.value)).toBe(true);
  expect(f.owner.acceptPage(issued.value, { search: "lease move" }).kind).toBe("accepted");
  expect(f.owner.current(issued.value)).toBe(true);
  f.owner.movePage(
    { search: "human move" },
    { kind: "human", source: "query", history: "replace" },
  );
  expect(f.owner.current(issued.value)).toBe(false);
});
type Options = ScopeGateOptions<typeof builtinData, typeof schemas>;
function fixture(prepare?: Options["preparePage"]) {
  const journals = new Map<string, ReturnType<typeof createWorkJournal>>();
  const dependencies = { total: "hash-1" };
  const issuer = createRouteTokenIssuer();
  const journal = (k = key) => {
    const id = canonicalRouteInput(k);
    let value = journals.get(id);
    if (!value) {
      value = createWorkJournal(k);
      journals.set(id, value);
    }
    return value;
  };
  const owner = createRouteScopeGate<typeof builtinData, typeof schemas>({
    workSchema: schemas.work,
    hashWork: canonicalRouteInput,
    journal,
    issuer,
    dependencies: () => dependencies,
    preparePage:
      prepare ??
      ((current, patch) => ({
        ok: true,
        value: {
          page: { ...current, ...patch },
          changed: canonicalRouteInput({ ...current, ...patch }) !== canonicalRouteInput(current),
          membership: "verified",
        },
      })),
  });
  const enter = (work = key) => owner.enter({ target: null, work }, page);
  enter();
  const read = owner.capture("work");
  owner.acceptWork(read, snapshot());
  const invocation = (channel = "write") => {
    const result = owner.invocation(owner.capture(channel), { total: dependencies.total });
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  };
  return { owner, read, invocation, journal, enter, dependencies, issuer };
}
test.each(["ack-first", "stream-first"])("%s publishes once and retains full receipt", (order) => {
  const f = fixture();
  const invocation = f.invocation();
  const publications: number[] = [];
  f.owner.subscribe((s) => publications.push(s.work?.revision ?? -1));
  const first = () => f.owner.acceptWork(invocation, { kind: "ack", write: ack() });
  const second = () =>
    f.owner.acceptWork(f.read, { kind: "stream", write: { ...ack(), replay: true } });
  expect((order === "ack-first" ? first() : second()).kind).toBe("published");
  expect((order === "ack-first" ? second() : first()).kind).toBe("duplicate");
  expect(publications).toEqual([1]);
  expect(f.owner.read()?.work?.value.amount).toBe(1);
  expect(f.journal().read().receipts).toHaveLength(1);
  expect(f.journal().read().undo[0]?.transitions[0]?.inverse).toEqual(ack().inverse);
  expect(f.owner.acceptPage(invocation, { search: "review" }).kind).toBe("accepted");
});
test("A?B?A never revives an attempt; original receipt survives", () => {
  const f = fixture();
  const invocation = f.invocation();
  const first = f.owner.read()!;
  f.enter(other);
  f.enter();
  expect(f.owner.read()?.scope.epoch).not.toBe(first.scope.epoch);
  expect(f.owner.read()?.pageEpoch).not.toBe(first.pageEpoch);
  expect(f.owner.acceptWork(f.read, snapshot(4))).toEqual({ kind: "refused", reason: "retired" });
  expect(f.owner.acceptWork(invocation, { kind: "ack", write: ack() }).kind).toBe("receipt-only");
  expect(f.owner.read()?.work).toBeNull();
  expect(f.journal().read().receipts).toEqual([ack()]);
  expect(f.owner.acceptPage(invocation, { search: "late" }).kind).toBe("refused");
});
test("same-key refresh retires only its channel; attempt is not revision", () => {
  const f = fixture();
  const invocation = f.invocation();
  const latest = f.owner.capture("work");
  expect(latest.attempt).toBe(2);
  expect(f.owner.acceptWork(f.read, snapshot(100)).kind).toBe("refused");
  expect(f.owner.acceptWork(latest, snapshot(10)).kind).toBe("published");
  expect(f.owner.acceptWork(invocation, { kind: "ack", write: ack() }).kind).toBe("duplicate");
  expect(f.owner.read()?.work?.revision).toBe(10);
  f.owner.retire(latest);
  expect(f.owner.acceptWork(latest, snapshot(11)).kind).toBe("refused");
});
test("same identity enter publishes Page and unloaded Work atomically", () => {
  const f = fixture();
  const previous = f.owner.read()!;
  f.owner.subscribe((s) => {
    expect(f.owner.read()).toBe(s);
    expect(s.work).toBeNull();
    expect(s.page.search).toBe("new");
  });
  f.owner.enter(previous.scope.identity, { ...page, search: "new" });
  expect(f.owner.read()?.scope).not.toBe(previous.scope);
  expect(f.owner.acceptWork(f.read, snapshot()).kind).toBe("refused");
});
test("disposal releases observers; late success retains original inverse and provenance", () => {
  const f = fixture();
  const invocation = f.invocation();
  let published = 0;
  f.owner.subscribe(() => published++);
  f.owner.close();
  expect(
    f.owner.acceptWork(invocation, { kind: "ack", write: ack(1, 1, { receiptId: "native" }) }).kind,
  ).toBe("receipt-only");
  expect(f.owner.acceptWork(f.read, snapshot(2))).toEqual({ kind: "refused", reason: "closed" });
  expect(f.journal().read().receipts[0]).toMatchObject({
    receiptId: "native",
    inverse: ack().inverse,
    by: "human",
  });
  expect(published).toBe(0);
  expect(f.owner.read()).toBeNull();
  expect(fixture().owner.acceptWork(invocation, { kind: "ack", write: ack() }).kind).toBe(
    "refused",
  );
});
test("partial then failed late delivery retains only confirmed writes", () => {
  const f = fixture();
  const invocation = f.invocation();
  f.enter(other);
  expect(
    f.owner.acceptWork(invocation, { kind: "ack", write: ack(1, 1, { press: "partial" }) }).kind,
  ).toBe("receipt-only");
  // Second write failed: no ack exists; its late Page result cannot publish either.
  expect(f.owner.acceptPage(invocation, { search: "failed" }).kind).toBe("refused");
  expect(
    f
      .journal()
      .read()
      .receipts.map((r) => r.revision),
  ).toEqual([1]);
  expect(f.owner.read()?.scope.identity.work).toEqual(other);
  expect(f.owner.read()?.page).toEqual(page);
});
test("stale snapshots and old acknowledgements cannot regress Work", () => {
  const f = fixture();
  const invocation = f.invocation();
  f.owner.acceptWork(f.read, snapshot(5));
  expect(f.owner.acceptWork(f.read, snapshot(1)).kind).toBe("duplicate");
  expect(f.owner.acceptWork(invocation, { kind: "ack", write: ack(2) }).kind).toBe("duplicate");
  expect(f.owner.read()?.work?.revision).toBe(5);
  expect(f.journal().read().receipts[0]).toEqual(ack(2));
});
test("accepted Work carries the host's handle, and a contiguous ack advances that one handle", () => {
  const f = fixture();
  f.owner.acceptWork(f.read, snapshot(1));
  expect(f.owner.read()?.work?.handle).toEqual({ key, revision: 1 });
  expect(f.owner.acceptWork(f.invocation(), { kind: "ack", write: ack(2) }).kind).toBe("published");
  expect(f.owner.read()?.work?.handle).toEqual({ key, revision: 2 });
  expect(f.owner.read()?.work?.revision).toBe(2);
});
test("snapshot before ack preserves history without republishing", () => {
  const f = fixture();
  const invocation = f.invocation();
  let publications = 0;
  f.owner.subscribe(() => publications++);
  f.owner.acceptWork(f.read, snapshot(1));
  expect(f.owner.acceptWork(invocation, { kind: "ack", write: ack() })).toEqual({
    kind: "duplicate",
    revision: 1,
    receipt: "recorded",
  });
  expect(publications).toBe(1);
  expect(f.journal().read().receipts).toEqual([ack()]);
});
test("equal revision conflicts recover without overwriting Work or history", () => {
  const f = fixture();
  f.owner.acceptWork(f.invocation(), { kind: "ack", write: ack() });
  expect(f.owner.acceptWork(f.read, snapshot(1, 99))).toMatchObject({
    kind: "recover",
    reason: "contradiction",
  });
  expect(f.owner.acceptWork(f.read, { kind: "stream", write: ack(1, 9) })).toMatchObject({
    kind: "recover",
    reason: "contradiction",
  });
  expect(f.owner.read()?.work?.value.amount).toBe(1);
  expect(f.journal().read().receipts).toEqual([ack()]);
});
test("snapshot then contradictory delta recovers", () => {
  const f = fixture();
  f.owner.acceptWork(f.read, snapshot(1));
  expect(f.owner.acceptWork(f.read, { kind: "stream", write: ack(1, 9) })).toMatchObject({
    kind: "recover",
    reason: "contradiction",
  });
  expect(f.owner.read()?.work?.value.amount).toBe(1);
});
test("gap retains receipts, snapshot recovers, replay reconciles older deltas", () => {
  const f = fixture();
  expect(f.owner.acceptWork(f.invocation(), { kind: "ack", write: ack(3) })).toMatchObject({
    kind: "recover",
    after: 0,
    reason: "gap",
  });
  expect(f.owner.read()?.work?.revision).toBe(0);
  expect(f.journal().read().receipts).toEqual([ack(3)]);
  expect(f.owner.acceptWork(f.read, snapshot(3)).kind).toBe("published");
  expect(f.owner.acceptWork(f.read, { kind: "stream", write: ack(3) }).kind).toBe("duplicate");
  expect(f.owner.acceptWork(f.read, { kind: "stream", write: ack(2) }).kind).toBe("duplicate");
  expect(
    f
      .journal()
      .read()
      .receipts.map((r) => r.revision),
  ).toEqual([2, 3]);
});
test("contiguous deltas fill a gap without losing buffered receipt", () => {
  const f = fixture();
  f.owner.acceptWork(f.read, { kind: "stream", write: ack(2) });
  f.owner.acceptWork(f.read, { kind: "stream", write: ack() });
  expect(f.owner.acceptWork(f.read, { kind: "stream", write: ack(2) }).kind).toBe("published");
  expect(f.owner.read()?.work?.value.amount).toBe(2);
});
test("invocation-local Page continuation checks Page, Work and readings", () => {
  const f = fixture();
  const a = f.invocation("a");
  const b = f.invocation("b");
  expect(f.owner.acceptPage(a, { search: "review" }).kind).toBe("accepted");
  expect(f.owner.acceptPage(b, { search: "wrong" }).kind).toBe("refused");
  expect(f.owner.acceptPage(a, { search: "result" }).kind).toBe("accepted");
  f.dependencies.total = "hash-2";
  expect(f.owner.acceptPage(a, { search: "stale" }).kind).toBe("refused");
  const c = f.invocation("c");
  f.owner.acceptWork(f.read, snapshot(4));
  expect(f.owner.acceptPage(c, { search: "stale" }).kind).toBe("refused");
  const d = f.invocation("d");
  f.owner.movePage({ search: "human" }, { kind: "human", source: "query", history: "push" });
  expect(f.owner.acceptPage(d, { search: "stale" }).kind).toBe("refused");
});
test("foreign, copied, proxied and wrong-Work tokens refuse", () => {
  const f = fixture();
  const invocation = f.invocation();
  for (const token of [
    fixture().invocation(),
    Object.assign({}, invocation),
    new Proxy(invocation, {}),
  ])
    expect(f.owner.acceptWork(token, { kind: "ack", write: ack() })).toEqual({
      kind: "refused",
      reason: "foreign-token",
    });
  expect(f.owner.acceptWork(invocation, { kind: "ack", write: ack(1, 1, { key: other }) })).toEqual(
    { kind: "refused", reason: "wrong-work" },
  );
  expect(f.journal().read().receipts).toEqual([]);
});
test("published snapshots and token identity are frozen", () => {
  const f = fixture();
  expect(() => Object.assign(f.owner.read()!.page.viewport, { x: 999 })).toThrow();
  expect(() => Object.assign(f.owner.read()!.work!.value, { amount: 999 })).toThrow();
  expect(() => Object.assign(f.owner.read()!.scope.identity.work!, { route: "other" })).toThrow();
});
test("journal reconciles missing older receipts while retaining newer undo and provenance", () => {
  const journal = createWorkJournal(key);
  journal.accept(ack(4));
  journal.observe({ revision: 4, doc: { amount: 4, note: "" } });
  const before = journal.read();
  expect(journal.reconcile(ack(2, 2, { receiptId: "older", by: "pea" }))).toBe("recorded");
  expect(journal.read()).toMatchObject({ revision: 4, undo: before.undo, moves: before.moves });
  expect(journal.read().receipts[0]).toMatchObject({
    receiptId: "older",
    by: "pea",
    inverse: ack(2).inverse,
  });
  expect(journal.reconcile({ ...ack(4), replay: true })).toBe("duplicate");
  expect(journal.reconcile(ack(4, 90))).toBe("contradiction");
  expect(journal.read().receipts.at(-1)).toEqual(ack(4));
});
test("issuer refuses another owner's scope or Page epoch and copied tokens", () => {
  const a = createRouteTokenIssuer();
  const b = createRouteTokenIssuer();
  const scope = a.scope({ target: null, work: key });
  expect(b.attempt(scope, "read", 1).ok).toBe(false);
  expect(a.attempt(Object.assign({}, scope), "read", 1).ok).toBe(false);
  const attempt = a.attempt(scope, "read", 1);
  if (!attempt.ok) throw new Error(attempt.reason);
  expect(
    a.invocation("id", {
      token: attempt.value,
      pageEpoch: b.pageEpoch(),
      pageRevision: 0,
      workRevision: null,
      dependencies: {},
    }).ok,
  ).toBe(false);
});
test("raw Page origins and policy failures refuse without publication", () => {
  const f = fixture(() => {
    throw new Error("bad policy");
  });
  expect(Reflect.apply(f.owner.movePage.bind(f.owner), null, [{}, null]).kind).toBe("refused");
  expect(Reflect.apply(f.owner.movePage.bind(f.owner), null, [{}]).kind).toBe("refused");
  expect(Reflect.apply(f.owner.restorePage.bind(f.owner), null, [{}, { kind: "human" }]).kind).toBe(
    "refused",
  );
  expect(f.owner.acceptPage(f.invocation(), { search: "bad" }).kind).toBe("refused");
  expect(f.owner.read()?.page).toEqual(page);
});
test("preparation cannot retire an invocation then publish its Page", () => {
  let retire = () => {};
  const f = fixture((current, patch) => {
    retire();
    return {
      ok: true,
      value: { page: { ...current, ...patch }, changed: true, membership: "verified" },
    };
  });
  const token = f.invocation();
  retire = () => f.owner.retire(token.token);
  expect(f.owner.acceptPage(token, { search: "bad" }).kind).toBe("refused");
  expect(f.owner.read()?.page).toEqual(page);
});
export function typeRefusals(
  owner: AcceptanceOwner<typeof builtinData, typeof schemas>,
  token: AcceptanceToken,
) {
  // @ts-expect-error nominal scope cannot be forged
  const forged: ScopeToken = { identity: { target: null, work: key }, epoch: token.scope.epoch };
  // @ts-expect-error epoch brands are private
  const epoch: ScopeEpoch = {};
  // @ts-expect-error Page epoch brands are private
  const pageEpoch: PageEpoch = {};
  // @ts-expect-error only issuer constructs scopes
  new ScopeToken();
  // @ts-expect-error only issuer constructs attempts
  new AcceptanceToken();
  // @ts-expect-error only issuer constructs invocations
  new InvocationToken();
  // @ts-expect-error commands require invocation authority
  owner.acceptWork(token, { kind: "ack", write: ack() });
  // @ts-expect-error no acceptance without token
  owner.acceptWork(snapshot());
  /* eslint-disable typescript/no-misused-spread -- compile witness for copied tokens */
  // @ts-expect-error copy loses nominal authority
  owner.acceptWork({ ...token }, snapshot());
  /* eslint-enable typescript/no-misused-spread */
  return { forged, epoch, pageEpoch };
}

test("raw invocation and Pea origins cannot omit or substitute authority", () => {
  const f = fixture();
  for (const origin of [
    { kind: "invocation" },
    { kind: "invocation", token: null },
    { kind: "pea" },
    { kind: "pea", lease: null },
    { kind: "pea", lease: f.invocation() },
    { kind: "invocation", token: f.owner.read()!.scope },
  ])
    expect(
      Reflect.apply(f.owner.movePage.bind(f.owner), null, [{ search: "bad" }, origin]).kind,
    ).toBe("refused");
  expect(f.owner.read()?.page).toEqual(page);
});

test("issuer access alone cannot fabricate a command captured by the acceptance owner", () => {
  const f = fixture();
  const state = f.owner.read()!;
  const result = f.issuer.invocation("outside", {
    token: f.read,
    pageEpoch: state.pageEpoch,
    pageRevision: state.pageRevision,
    workRevision: 0,
    dependencies: {},
  });
  if (!result.ok) throw new Error(result.reason);
  expect(f.owner.acceptWork(result.value, { kind: "ack", write: ack() })).toEqual({
    kind: "refused",
    reason: "foreign-token",
  });
  expect(f.owner.acceptPage(result.value, { search: "bad" }).kind).toBe("refused");
});
test("superseding a write attempt retires its Page but preserves its successful receipt", () => {
  const f = fixture();
  const invocation = f.invocation();
  f.owner.capture("write");
  expect(f.owner.acceptWork(invocation, { kind: "ack", write: ack() }).kind).toBe("receipt-only");
  expect(f.owner.read()?.work?.revision).toBe(0);
  expect(f.journal().read().receipts).toEqual([ack()]);
});

test("a route without Work constructs without schema, hash or journal", () => {
  const { work: _work, ...withoutWork } = builtinData;
  const declaration = { ...withoutWork, capabilities: [] } as const;
  const options: ScopeGateOptions<typeof declaration, typeof schemas> = {
    dependencies: () => ({}),
    preparePage: (value) => ({
      ok: true,
      value: { page: value, changed: false, membership: "verified" },
    }),
  };
  const owner = createRouteScopeGate<typeof declaration, typeof schemas>(options);
  owner.enter({ target: null, work: null }, page);
  expect(owner.read()?.work).toBeNull();
  const token = owner.capture("roster");
  expect(owner.current(token)).toBe(true);
  const unused: ScopeGateOptions<typeof declaration, typeof schemas> = {
    ...options,
    // @ts-expect-error no Work declaration means no Work schema argument
    workSchema: schemas.work,
  };
  void unused;
  owner.close();
  expect(owner.current(token)).toBe(false);
});
