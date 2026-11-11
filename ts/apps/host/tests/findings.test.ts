import { expect, test } from "vite-plus/test";
import { bindWork, keepPointer, workHandle } from "@pe/agent-contracts";
import { findingsWork, type FindingInput } from "@pe/agent-contracts/slots";
import { RouteWorkspace } from "@pe/runtime";
import { subjectCode, uniqueIdSchema, type SubjectRefCode } from "../../../packages/agent-contracts/src/subject-ref.ts";
import { findingsList, findingsWrite } from "../src/slots/findings.ts";

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
  await findingsWrite(workspace, await handle(), input("p1", port, "claim", "no"), "pea");
  await findingsWrite(workspace, await handle(), input("h1", row, "claim", "yes"), "person");
  await expect(findingsWrite(workspace, await handle(), input("n", port, "note", "yes"), "pea")).rejects.toThrow(/verdict/);
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
