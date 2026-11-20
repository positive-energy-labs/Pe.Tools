import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { address, bindWork, workHandle, type Caller } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import {
  findingSchema,
  findingsWork,
  type Finding,
  type FindingInput,
} from "@pe/agent-contracts/slots";
import { RouteWorkspace } from "@pe/runtime";
import {
  subjectCode,
  uniqueIdSchema,
  type SubjectRefCode,
} from "../../../packages/agent-contracts/src/subject-ref.ts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { findingsExecutors } from "../src/slots/findings.ts";
import { hostTimeline } from "../src/reads/work-timeline.ts";
import { approvedPea, human } from "./callers.ts";
import { fixtureNative } from "./fixture-native.ts";

const port = subjectCode({
  keyKind: "UniqueId",
  key: uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72"),
  sub: { port: 1 },
});
const row = subjectCode({ keyKind: "name", key: ["Price LBP15A Return", "8 X 4 D"] });
const input = (
  text: string,
  subject: SubjectRefCode,
  kind: FindingInput["kind"],
  verdict?: string,
): FindingInput => ({
  subject,
  kind,
  text,
  ...(verdict ? { verdict } : {}),
});
const memory = () => {
  // One record per Work key, as the real store keeps them: another document's findings are another record.
  const saved: Record<string, unknown> = {};
  const workspace = new RouteWorkspace({
    registrations: [{ spec: findingsWork }],
    store: {
      getState: async ({ targetKey }) => structuredClone(saved[targetKey] ?? null),
      setState: async ({ targetKey, value }) => void (saved[targetKey] = structuredClone(value)),
    },
  });
  return { saved, workspace };
};

/*
 * The production doors: `findings.say`, `findings.rule` and `findings.retract` on the action door,
 * where the host mints the id and stamps the author from the caller, and the Work history door,
 * where the host derives `own` from the route so an author's undo is their own. The generic apply
 * and start doors refuse findings.
 */
async function doors() {
  const dir = await mkdtemp(join(tmpdir(), "pe-findings-doors-"));
  const native = await fixtureNative(join(dir, "native"));
  const socket = await native.connect();
  const { saved, workspace } = memory();
  const target = address("C:/model.rvt");
  const key = bindWork("findings", target);
  const revision = async () => (await workspace.view(key, "findings"))?.revision ?? 0;
  const peaCaller = approvedPea("findings-doors");
  const post = native.actions({ workspace });
  const routes = createPeRoutes({
    workspace,
    journal: native.journal,
    registrations: [{ spec: findingsWork }],
  });
  let calls = 0;
  const document = { kind: "document", ref: socket.target } as const;
  /** One door call that must succeed; answers its receipt's result. */
  async function call<T>(door: string, body: object, caller: Caller): Promise<T> {
    const id = `${door}-${++calls}`;
    const response = await post({ id, key: door, target: document, input: body }, caller);
    expect(response.status, await response.clone().text()).toBeLessThan(400);
    const receipt = await native.journal.wait(id);
    expect(receipt, `${id}: ${JSON.stringify(receipt)}`).toMatchObject({ state: "succeeded" });
    return (receipt as unknown as { result: T }).result;
  }
  /** One door call the host must refuse, at the door or in its receipt, leaving the Work as it was. */
  async function refusedCall(door: string, body: object, caller: Caller): Promise<string> {
    const id = `${door}-${++calls}`,
      before = await revision();
    const response = await post({ id, key: door, target: document, input: body }, caller);
    const said =
      response.status >= 400
        ? await response.text()
        : JSON.stringify(await native.journal.wait(id));
    if (response.status < 400)
      expect(JSON.parse(said), id).not.toMatchObject({ state: "succeeded" });
    expect(await revision(), `${id} changed the Work`).toBe(before);
    return said;
  }
  return {
    peaCaller,
    revision,
    refusedCall,
    list: async (subject?: SubjectRefCode, caller: Caller = human) =>
      (await call<{ findings: Finding[] }>("findings.list", subject ? { subject } : {}, caller))
        .findings,
    /** Text and author of each finding, oldest first, through `findings.list`. */
    async authors(subject?: SubjectRefCode) {
      return (await this.list(subject)).map((f) => [f.text, f.said.by]);
    },
    /** A Work the door cannot address (another document's), read from the workspace itself. */
    held: async (at: typeof key) =>
      Object.keys(
        findingsWork.schema.parse((await workspace.view(at, "findings"))?.doc ?? {}).findings,
      ),
    /**
     * `on` is the route whose own Work handle the caller holds; a row verb on /fans holds Fans'.
     * `on: null` sends no handle, as Pea's first call does: the host binds the target document's.
     * `on` as a handle is sent as it is: one keyed to another document must not carry the write there.
     */
    async say(
      finding: FindingInput,
      caller: Caller,
      on: string | null | ReturnType<typeof workHandle> = "findings",
    ) {
      const work =
        on === null
          ? undefined
          : typeof on === "object"
            ? on
            : on === "findings"
              ? workHandle(key, await revision())
              : workHandle({ ...key, route: on }, 7);
      return (
        await call<{ id: string; revision: number }>(
          "findings.say",
          { ...(work ? { work } : {}), ...finding },
          caller,
        )
      ).id;
    },
    rule: (id: string, value: string | null, caller: Caller) =>
      call<{ revision: number }>("findings.rule", { id, value }, caller),
    retract: (id: string, caller: Caller) =>
      call<{ revision: number }>("findings.retract", { id }, caller),
    /** The generic start door: `work.start` on the findings Work with a caller-supplied seed. */
    start: (id: string, seed: unknown, caller: Caller) =>
      post({ id, key: "work.start", target: { kind: "host" }, input: { key, seed } }, caller),
    stored: () => Object.keys(saved),
    settled: (id: string) => native.journal.wait(id),
    door: (verb: "apply" | "history", body: unknown, caller: Caller = peaCaller) =>
      withInvocationContext({ caller }, () =>
        routes.fetch(
          new Request(
            `http://host/pe/route-state/findings/${verb}?target=${encodeURIComponent(target)}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            },
          ),
        ),
      ),
    /** As a client presses undo: it names its route's Work only, and sends back the step the read shows. */
    async undo(caller: Caller, by: "human" | "pea") {
      const works = [bindWork("fans", target)];
      const shown = await hostTimeline(workspace, native.journal).read(works, by);
      return this.door("history", { direction: "undo", works, expected: shown.undo }, caller);
    },
    close: async () => {
      await native.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/* Mutant "rule restamps the statement" (the old door: every rewrite stamped `by` again) turns this red at `said`. */
test("Pea says a claim, a person rules it, and findings.list still shows said.by pea; the ruling carries its own author", async () => {
  const d = await doors();
  try {
    const id = await d.say(input("the riser is undersized", port, "claim"), d.peaCaller);
    const [said] = await d.list();
    expect(said).toMatchObject({ id, kind: "claim", said: { by: "pea" } });
    expect(said).not.toHaveProperty("verdict");
    await d.rule(id, "no", human);
    expect(await d.list()).toEqual([
      { ...said, verdict: { by: "human", at: expect.any(String), value: "no" } },
    ]);
    // A value the kind does not admit is refused; so is any ruling on a note.
    expect(await d.refusedCall("findings.rule", { id, value: "pass" }, human)).toMatch(
      /yes, no, not-this/,
    );
    const note = await d.say(input("seen on site", row, "note"), human);
    expect(await d.refusedCall("findings.rule", { id: note, value: "yes" }, d.peaCaller)).toMatch(
      /A note takes no ruling/,
    );
    expect(await d.refusedCall("findings.rule", { id: "nope", value: "yes" }, human)).toMatch(
      /No finding nope/,
    );
    // null withdraws the ruling and leaves the statement.
    await d.rule(id, null, d.peaCaller);
    expect(await d.list(port)).toEqual([said]);
  } finally {
    await d.close();
  }
});

test("a note with a verdict fails to parse, at the door and in the record; the generic apply door refuses a forged finding", async () => {
  const d = await doors();
  try {
    expect(
      await d.refusedCall("findings.say", input("n", port, "note", "yes"), d.peaCaller),
    ).toMatch(/verdict/);
    expect(await d.refusedCall("findings.say", input("c", port, "claim", "pass"), human)).toMatch(
      /verdict/,
    );
    // A caller cannot supply the id, the author or a place: the door takes none of them.
    expect(
      await d.refusedCall("findings.say", { ...input("x", port, "note"), id: "mine" }, human),
    ).toMatch(/id/);
    expect(
      await d.refusedCall("findings.say", { ...input("x", port, "note"), place: {} }, human),
    ).toMatch(/place/);
    const said = { by: "pea", at: "2026-11-12T12:00:00.000Z" };
    const note = { id: "n", kind: "note", subject: port, text: "n", said };
    expect(findingSchema.safeParse(note).success).toBe(true);
    expect(findingSchema.safeParse({ ...note, verdict: { ...said, value: "yes" } }).success).toBe(
      false,
    );
    expect(
      findingSchema.safeParse({ ...note, kind: "check", verdict: { ...said, value: "yes" } })
        .success,
    ).toBe(false);
    expect(findingSchema.safeParse({ ...note, place: {} }).success).toBe(false);
    const before = await d.revision();
    const refused = await d.door("apply", {
      patches: [{ path: ["findings", "n"], value: { ...note, said: { ...said, by: "human" } } }],
      expectedRevision: before,
      press: "forge",
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("findings.say"),
    });
    expect(await d.revision()).toBe(before);
  } finally {
    await d.close();
  }
});

/* Mutant "every non-Pea caller is a person" (the old stamp) writes this finding as a person's. */
test("a caller that is neither a person nor Pea is refused and writes nothing", async () => {
  const d = await doors();
  try {
    // Through the door an external caller is stopped by the grant guard before any executor.
    const outsider: Caller = {
      kind: "external-mcp",
      context: "ctx-outside",
      label: "another agent",
    };
    await d.refusedCall("findings.say", input("not mine to say", port, "note"), outsider);
    const id = await d.say(input("p", port, "claim"), d.peaCaller);
    await d.refusedCall("findings.rule", { id, value: "yes" }, outsider);
    await d.refusedCall("findings.retract", { id }, outsider);
    expect(await d.authors()).toEqual([["p", "pea"]]);
  } finally {
    await d.close();
  }
  // The doors' own refusal, behind that guard: every caller kind but the two authors, at bind, before any Work is read.
  const executors = findingsExecutors(memory().workspace, null as never);
  const others: Caller[] = [
    { kind: "external-mcp", context: "c", label: "l" },
    { kind: "page", page: "p" as never },
    { kind: "service", service: "s" },
    { kind: "anonymous" },
  ];
  for (const door of ["findings.say", "findings.rule", "findings.retract"] as const)
    for (const caller of others)
      await expect(
        executors[door].bind({ caller } as never),
        `${door} as ${caller.kind}`,
      ).rejects.toThrow(/Only a person or Pea writes a finding/);
});

test("either author retracts any finding; retracting one that is gone is refused", async () => {
  const d = await doors();
  try {
    const peas = await d.say(input("p", port, "note"), d.peaCaller);
    const persons = await d.say(input("h", row, "note"), human);
    await d.retract(peas, human);
    await d.retract(persons, d.peaCaller);
    expect(await d.list()).toEqual([]);
    expect(await d.refusedCall("findings.retract", { id: peas }, human)).toMatch(/No finding/);
  } finally {
    await d.close();
  }
});

/*
 * The clock and id leaves (contract "Clock and id"): the door asks its context, never `new Date()` or
 * `randomUUID()`. Mutants "say mints with randomUUID" and "say stamps with new Date" each turn this red.
 */
test("findings.say twice mints two ids from ids.mint() and two times from clock.now(); rule and retract each take a press of their own", async () => {
  const { workspace } = memory();
  const key = bindWork("findings", address("C:/model.rvt"));
  const minted: string[] = [];
  const ctx = {
    caller: human,
    work: workspace,
    clock: { now: () => `2026-11-12T12:00:0${minted.length}.000Z` },
    ids: {
      mint: () => {
        minted.push(`minted-${minted.length + 1}`);
        return minted.at(-1)!;
      },
    },
  };
  const written = vi.spyOn(workspace, "write");
  const executors = findingsExecutors(workspace, null as never);
  const run = async (door: keyof typeof executors, prepared: object) => {
    const work = workHandle(key, (await workspace.view(key, "findings"))?.revision ?? 0);
    return Effect.runPromise(
      executors[door].run(
        ctx as never,
        {
          prepared: { ...prepared, work },
          step: (
            _kind: string,
            _key: string,
            _input: unknown,
            body: () => Effect.Effect<unknown, unknown>,
          ) => body(),
        } as never,
      ) as Effect.Effect<unknown, unknown>,
    );
  };
  // Each say mints the finding's id, then its press.
  expect(await run("findings.say", input("first", port, "claim"))).toMatchObject({
    id: "minted-1",
  });
  expect(await run("findings.say", input("second", port, "claim", "yes"))).toMatchObject({
    id: "minted-3",
  });
  await run("findings.rule", { id: "minted-1", value: "no" });
  await run("findings.rule", { id: "minted-1", value: "yes" });
  await run("findings.retract", { id: "minted-3" });
  expect(minted).toEqual([
    "minted-1",
    "minted-2",
    "minted-3",
    "minted-4",
    "minted-5",
    "minted-6",
    "minted-7",
  ]);
  expect(await run("findings.list", {})).toEqual({
    findings: [
      {
        id: "minted-1",
        kind: "claim",
        subject: port,
        text: "first",
        said: { by: "human", at: "2026-11-12T12:00:00.000Z" },
        verdict: { by: "human", at: "2026-11-12T12:00:05.000Z", value: "yes" },
      },
    ],
  });
  // K-A4 line 3: no two writes of the findings Work share a press.
  expect(written.mock.calls.map(([, , , write]) => write.press)).toEqual([
    "finding:minted-2",
    "finding:minted-4",
    "finding:minted-5",
    "finding:minted-6",
    "finding:minted-7",
  ]);
});

/* purge-2 integrity 1: the refusal sat on apply alone, so a start seed carried a forged author into the Work. */
test("a generic work.start with a findings seed is refused, for Pea and a person alike, and writes no doc", async () => {
  const d = await doors();
  try {
    const forged = {
      id: "f1",
      kind: "note",
      subject: port,
      text: "f1",
      said: { by: "human", at: new Date().toISOString() },
    };
    for (const [id, caller] of [
      ["forge-pea", d.peaCaller],
      ["forge-human", human],
    ] as const) {
      await d.start(id, { findings: { f1: forged } }, caller);
      const settled = await d.settled(id);
      expect(d.stored(), `${id} stored a findings doc`).toEqual([]);
      expect(settled).toMatchObject({
        steps: [],
        outcome: { state: "refused", reason: expect.stringContaining("findings.say") },
      });
    }
    expect(await d.revision()).toBe(0);
  } finally {
    await d.close();
  }
});

test("Pea's undo through the Work history door reverts Pea's own finding; the person's newer finding stays", async () => {
  const d = await doors();
  try {
    await d.say(input("p1", port, "claim", "no"), d.peaCaller);
    await d.say(input("h1", row, "claim", "yes"), human);
    const undone = await d.undo(d.peaCaller, "pea");
    expect(await undone.json()).toMatchObject({ ok: true });
    expect(await d.authors()).toEqual([["h1", "human"]]);
  } finally {
    await d.close();
  }
});

test("the person's undo through the Work history door reverts the person's own finding; Pea's newer finding stays", async () => {
  const d = await doors();
  try {
    await d.say(input("h1", row, "claim", "yes"), human);
    await d.say(input("p1", port, "claim", "no"), d.peaCaller);
    const undone = await d.undo(human, "human");
    expect(await undone.json()).toMatchObject({ ok: true });
    expect(await d.authors()).toEqual([["p1", "pea"]]);
  } finally {
    await d.close();
  }
});

test("a row verb's own route handle (Fans, Families) addresses the same document's findings Work", async () => {
  const d = await doors();
  try {
    await d.say(input("p1", port, "note"), d.peaCaller);
    await d.say(input("h1", port, "check", "fail"), human, "fans");
    await d.say(input("h2", row, "note"), human, "families");
    expect(await d.authors()).toEqual([
      ["p1", "pea"],
      ["h1", "human"],
      ["h2", "human"],
    ]);
    expect(await d.authors(port), "findings.list narrowed to one subject").toEqual([
      ["p1", "pea"],
      ["h1", "human"],
    ]);
  } finally {
    await d.close();
  }
});

/* purge-2 integrity 5: the caller's handle named the Work, so a handle keyed to another document wrote that document. */
test("findings.say handed another document's handle lands in the admitted document's findings Work, never the other's", async () => {
  const d = await doors();
  try {
    const other = bindWork("findings", address("C:/other.rvt"));
    await d.say(input("x1", port, "note"), human, workHandle(other, 0));
    expect(await d.held(other), "the other document's findings Work").toEqual([]);
    expect(await d.authors()).toEqual([["x1", "human"]]);
    expect(d.stored()).toHaveLength(1);
  } finally {
    await d.close();
  }
});

/* gate-ef940d36: Pea's first write and findings.list were refused for a missing handle, then retried. */
test("Pea's first findings.say and findings.list, with no handle, succeed on the target document's findings Work", async () => {
  const d = await doors();
  try {
    const id = await d.say(input("p1", port, "note"), d.peaCaller, null);
    expect(await d.list(undefined, d.peaCaller)).toEqual([
      expect.objectContaining({ id, said: expect.objectContaining({ by: "pea" }) }),
    ]);
  } finally {
    await d.close();
  }
});

test("findings reject legacy and missing stamps and caller-supplied by", async () => {
  for (const by of ["unknown", "person", undefined])
    expect(
      findingSchema.safeParse({
        id: "n",
        kind: "note",
        subject: port,
        text: "note",
        said: { by, at: new Date().toISOString() },
      }).success,
    ).toBe(false);
  const d = await doors();
  try {
    const forged = { ...input("forged", port, "note"), by: "human" };
    await expect(d.say(forged, d.peaCaller)).rejects.toThrow();
    expect(await d.list()).toEqual([]);
    for (const caller of [human, d.peaCaller]) {
      await d.say(input(caller.kind, port, "note"), caller);
      expect((await d.list()).at(-1)?.said.by).toBe(caller.kind);
    }
  } finally {
    await d.close();
  }
});
