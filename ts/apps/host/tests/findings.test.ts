import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { address, bindWork, workHandle, type Caller } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import { findingsWork, type FindingInput } from "@pe/agent-contracts/slots";
import { RouteWorkspace } from "@pe/runtime";
import { subjectCode, uniqueIdSchema, type SubjectRefCode } from "../../../packages/agent-contracts/src/subject-ref.ts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { approvedPea, human } from "./callers.ts";
import { fixtureNative } from "./fixture-native.ts";

const port = subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72"), sub: { port: 1 } });
const row = subjectCode({ keyKind: "name", key: ["Price LBP15A Return", "8 X 4 D"] });
const input = (id: string, subject: SubjectRefCode, kind: FindingInput["kind"], verdict?: string): FindingInput => ({
  id, subject, kind, text: id, place: { subject }, ...(verdict ? { verdict } : {}),
});

/*
 * The production doors (wave 1 review catches 1 and 2): `findings.write` on the action door, where
 * the host stamps `by` from the caller (S9-M6), and the Work history door, where the host derives
 * `own` from the route so an author's undo is their own. The generic apply door refuses findings.
 */
async function doors() {
  const dir = await mkdtemp(join(tmpdir(), "pe-findings-doors-"));
  const native = await fixtureNative(join(dir, "native"));
  const socket = await native.connect();
  // One record per Work key, as the real store keeps them: another document's findings are another record.
  const saved: Record<string, unknown> = {};
  const workspace = new RouteWorkspace({
    registrations: [{ spec: findingsWork }],
    store: { getState: async ({ targetKey }) => structuredClone(saved[targetKey] ?? null), setState: async ({ targetKey, value }) => void (saved[targetKey] = structuredClone(value)) },
  });
  const target = address("C:/model.rvt");
  const key = bindWork("findings", target);
  const revision = async () => (await workspace.view(key, "findings"))?.revision ?? 0;
  const peaCaller = approvedPea("findings-doors");
  const post = native.actions({ workspace });
  const routes = createPeRoutes({ workspace, registrations: [{ spec: findingsWork }] });
  let lists = 0;
  return {
    peaCaller,
    revision,
    /** Through `findings.list`, as the person; `subject` narrows it to one SubjectRef code. */
    async authors(subject?: SubjectRefCode) {
      const id = `list-${++lists}`;
      const response = await post({ id, key: "findings.list", target: { kind: "document", ref: socket.target }, input: subject ? { subject } : {} }, human);
      expect(response.status, await response.clone().text()).toBeLessThan(400);
      const receipt = await native.journal.wait(id);
      expect(receipt, id).toMatchObject({ state: "succeeded" });
      return (receipt as unknown as { result: { findings: { id: string; by: string }[] } }).result.findings.map((f) => [f.id, f.by]);
    },
    /** A Work the door cannot address (another document's), read from the workspace itself. */
    held: async (at: typeof key) => Object.keys(((await workspace.view(at, "findings"))?.doc as { findings?: object } | undefined)?.findings ?? {}),
    /** The raw post, for a write the host must refuse. */
    post,
    target: socket.target,
    /** `on` is the route whose own Work handle the caller holds; a row verb on /fans holds Fans'. */
    /** `on: null` sends no handle, as Pea's first call does: the host binds the target document's. */
    /** `on` as a handle is sent as it is: one keyed to another document must not carry the write there. */
    async write(id: string, finding: FindingInput, caller: Caller, on: string | null | ReturnType<typeof workHandle> = "findings") {
      const work = on === null ? undefined : typeof on === "object" ? on : on === "findings" ? workHandle(key, await revision()) : workHandle({ ...key, route: on }, 7);
      const response = await post({ id, key: "findings.write", target: { kind: "document", ref: socket.target },
        input: { ...(work ? { work } : {}), finding } }, caller);
      expect(response.status, await response.clone().text()).toBeLessThan(400);
      expect(await native.journal.wait(id), id).toMatchObject({ state: "succeeded" });
    },
    async list(id: string, caller: Caller) {
      const response = await post({ id, key: "findings.list", target: { kind: "document", ref: socket.target }, input: {} }, caller);
      expect(response.status, await response.clone().text()).toBeLessThan(400);
      return native.journal.wait(id);
    },
    /** The generic start door: `work.start` on the findings Work with a caller-supplied seed. */
    start: (id: string, seed: unknown, caller: Caller) =>
      post({ id, key: "work.start", target: { kind: "host" }, input: { key, seed } }, caller),
    stored: () => Object.keys(saved),
    settled: (id: string) => native.journal.wait(id),
    door: (verb: "apply" | "history", body: unknown, caller: Caller = peaCaller) =>
      withInvocationContext({ caller }, () => routes.fetch(new Request(
        `http://host/pe/route-state/findings/${verb}?target=${encodeURIComponent(target)}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      ))),
    close: async () => { await native.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

test("findings.write through the action door: the host stamps each caller's author; the generic apply door refuses a Pea finding marked by a person", async () => {
  const d = await doors();
  try {
    await d.write("by-person", input("h1", row, "claim", "yes"), human);
    await d.write("by-pea", input("p1", port, "claim", "no"), d.peaCaller);
    expect(await d.authors()).toEqual([["h1", "person"], ["p1", "pea"]]);
    expect(await d.authors(port), "findings.list narrowed to one subject").toEqual([["p1", "pea"]]);
    // The contract refuses a verdict the kind does not declare, before any Work changes.
    const unwritten = await d.revision();
    const bad = await d.post({ id: "note-verdict", key: "findings.write", target: { kind: "document", ref: d.target },
      input: { finding: input("n", port, "note", "yes") } }, d.peaCaller);
    expect(bad.status).toBe(409);
    expect(await bad.text()).toMatch(/verdict/);
    expect(await d.revision()).toBe(unwritten);
    expect(await d.authors()).toEqual([["h1", "person"], ["p1", "pea"]]);
    const forged = { ...input("p2", port, "note"), by: "person", at: new Date().toISOString() };
    const before = await d.revision();
    const refused = await d.door("apply", { patches: [{ path: ["findings", "p2"], value: forged }], expectedRevision: before, press: "forge" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ ok: false, error: expect.stringContaining("findings.write") });
    expect(await d.revision()).toBe(before);
  } finally { await d.close(); }
});

/* purge-2 integrity 1: the refusal sat on apply alone, so a start seed carried a forged `by` into the Work. */
test("a generic work.start with a findings seed is refused, for Pea and a person alike, and writes no doc", async () => {
  const d = await doors();
  try {
    const forged = { ...input("f1", port, "note"), by: "person", at: new Date().toISOString() };
    for (const [id, caller] of [["forge-pea", d.peaCaller], ["forge-human", human]] as const) {
      await d.start(id, { findings: { f1: forged } }, caller);
      const settled = await d.settled(id);
      expect(d.stored(), `${id} stored a findings doc`).toEqual([]);
      expect(settled).toMatchObject({ steps: [], outcome: { state: "refused", reason: expect.stringContaining("findings.write") } });
    }
    expect(await d.revision()).toBe(0);
  } finally { await d.close(); }
});

test("Pea's undo through the Work history door reverts Pea's own finding; the person's newer finding stays", async () => {
  const d = await doors();
  try {
    await d.write("by-pea", input("p1", port, "claim", "no"), d.peaCaller);
    await d.write("by-person", input("h1", row, "claim", "yes"), human);
    const undone = await d.door("history", { direction: "undo", expectedRevision: await d.revision() });
    expect(await undone.json()).toMatchObject({ ok: true });
    expect(await d.authors()).toEqual([["h1", "person"]]);
  } finally { await d.close(); }
});

test("the person's undo through the Work history door reverts the person's own finding; Pea's newer finding stays", async () => {
  const d = await doors();
  try {
    await d.write("by-person", input("h1", row, "claim", "yes"), human);
    await d.write("by-pea", input("p1", port, "claim", "no"), d.peaCaller);
    const undone = await d.door("history", { direction: "undo", expectedRevision: await d.revision() }, human);
    expect(await undone.json()).toMatchObject({ ok: true });
    expect(await d.authors()).toEqual([["p1", "pea"]]);
  } finally { await d.close(); }
});

test("a row verb's own route handle (Fans, Families) addresses the same document's findings Work", async () => {
  const d = await doors();
  try {
    await d.write("by-pea", input("p1", port, "note"), d.peaCaller);
    await d.write("fans-row", input("h1", port, "check", "fail"), human, "fans");
    await d.write("families-row", input("h2", row, "note"), human, "families");
    expect(await d.authors()).toEqual([["p1", "pea"], ["h1", "person"], ["h2", "person"]]);
  } finally { await d.close(); }
});

/* purge-2 integrity 5: the caller's handle named the Work, so a handle keyed to another document wrote that document. */
test("findings.write handed another document's handle lands in the admitted document's findings Work, never the other's", async () => {
  const d = await doors();
  try {
    const other = bindWork("findings", address("C:/other.rvt"));
    await d.write("wrongdoc", input("x1", port, "note"), human, workHandle(other, 0));
    expect(await d.held(other), "the other document's findings Work").toEqual([]);
    expect(await d.authors()).toEqual([["x1", "person"]]);
    expect(d.stored()).toHaveLength(1);
  } finally { await d.close(); }
});

/* gate-ef940d36: Pea's first findings.write and findings.list were refused for a missing handle, then retried. */
test("Pea's first findings.write and findings.list, with no handle, succeed on the target document's findings Work", async () => {
  const d = await doors();
  try {
    await d.write("first-write", input("p1", port, "note"), d.peaCaller, null);
    expect(await d.authors()).toEqual([["p1", "pea"]]);
    expect(await d.list("first-list", d.peaCaller)).toMatchObject({ state: "succeeded", result: { findings: [expect.objectContaining({ id: "p1", by: "pea" })] } });
  } finally { await d.close(); }
});
