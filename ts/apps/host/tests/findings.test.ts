import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { address, bindWork, keepPointer, workHandle, type Caller } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import { findingsWork, type FindingInput } from "@pe/agent-contracts/slots";
import { RouteWorkspace } from "@pe/runtime";
import { subjectCode, uniqueIdSchema, type SubjectRefCode } from "../../../packages/agent-contracts/src/subject-ref.ts";
import { findingsList, findingsWrite } from "../src/slots/findings.ts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { approvedPea, human } from "./callers.ts";
import { fixtureNative } from "./fixture-native.ts";

const port = subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72"), sub: { port: 1 } });
const row = subjectCode({ keyKind: "name", key: ["Price LBP15A Return", "8 X 4 D"] });
const input = (id: string, subject: SubjectRefCode, kind: FindingInput["kind"], verdict?: string): FindingInput => ({
  id, subject, kind, text: id, place: { subject }, ...(verdict ? { verdict } : {}),
});

test("findings.write lands in the document's findings Work with the host's author; findings.list reads it; each author's undo leaves the other's", async () => {
  let saved: unknown = null;
  const workspace = new RouteWorkspace({
    registrations: [{ spec: findingsWork }],
    store: { getState: async () => structuredClone(saved), setState: async ({ value }) => void (saved = structuredClone(value)) },
  });
  const key = bindWork("findings", null, "doc-a");
  const handle = async () => workHandle(key, (await workspace.view(key, "findings"))!.revision);
  await findingsWrite(workspace, workspace, await handle(), input("p1", port, "claim", "no"), "pea");
  await findingsWrite(workspace, workspace, await handle(), input("h1", row, "claim", "yes"), "person");
  await expect(findingsWrite(workspace, workspace, await handle(), input("n", port, "note", "yes"), "pea")).rejects.toThrow(/verdict/);
  expect((await findingsList(workspace, key)).map((f) => [f.id, f.by])).toEqual([["p1", "pea"], ["h1", "person"]]);
  expect((await findingsList(workspace, key, port)).map((f) => f.id)).toEqual(["p1"]);
  const undone = await workspace.step(key, "findings", "pea", "undo", (await handle()).revision, true);
  expect(undone.ok).toBe(true);
  expect((await findingsList(workspace, key)).map((f) => f.id)).toEqual(["h1"]);
});

test("the keep verb turns a pointer on a subject into a finding; a pointer on a place has no subject to keep", () => {
  const pointer = { id: "pt-1", route: "fans", target: port, label: "FC-1 port 1 looks undersized", at: "2026-11-10T12:00:00.000Z" };
  expect(keepPointer(pointer, { kind: "claim", verdict: "yes" })).toEqual({
    id: "pt-1", subject: port, kind: "claim", verdict: "yes", text: "FC-1 port 1 looks undersized", place: {},
  });
  expect(() => keepPointer(pointer, { kind: "note", verdict: "yes" })).toThrow(/verdict/);
  expect(() => keepPointer({ ...pointer, target: { selected: "[]" } }, { kind: "note" })).toThrow(/subject/);
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
  let saved: unknown = null;
  const workspace = new RouteWorkspace({
    registrations: [{ spec: findingsWork }],
    store: { getState: async () => structuredClone(saved), setState: async ({ value }) => void (saved = structuredClone(value)) },
  });
  const target = address("C:/model.rvt");
  const key = bindWork("findings", target);
  const revision = async () => (await workspace.view(key, "findings"))?.revision ?? 0;
  const peaCaller = approvedPea("findings-doors");
  const post = native.actions({ workspace });
  const routes = createPeRoutes({ workspace, registrations: [{ spec: findingsWork }] });
  return {
    peaCaller,
    revision,
    authors: async () => (await findingsList(workspace, key)).map((f) => [f.id, f.by]),
    /** `on` is the route whose own Work handle the caller holds; a row verb on /fans holds Fans'. */
    /** `on: null` sends no handle, as Pea's first call does: the host binds the target document's. */
    async write(id: string, finding: FindingInput, caller: Caller, on: string | null = "findings") {
      const work = on === null ? undefined : on === "findings" ? workHandle(key, await revision()) : workHandle({ ...key, route: on }, 7);
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
    const forged = { ...input("p2", port, "note"), by: "person", at: new Date().toISOString() };
    const before = await d.revision();
    const refused = await d.door("apply", { patches: [{ path: ["findings", "p2"], value: forged }], expectedRevision: before, press: "forge" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ ok: false, error: expect.stringContaining("findings.write") });
    expect(await d.revision()).toBe(before);
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

/* gate-ef940d36: Pea's first findings.write and findings.list were refused for a missing handle, then retried. */
test("Pea's first findings.write and findings.list, with no handle, succeed on the target document's findings Work", async () => {
  const d = await doors();
  try {
    await d.write("first-write", input("p1", port, "note"), d.peaCaller, null);
    expect(await d.authors()).toEqual([["p1", "pea"]]);
    expect(await d.list("first-list", d.peaCaller)).toMatchObject({ state: "succeeded", result: { findings: [expect.objectContaining({ id: "p1", by: "pea" })] } });
  } finally { await d.close(); }
});
