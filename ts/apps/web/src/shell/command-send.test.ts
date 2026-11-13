import { expect, test, vi } from "vite-plus/test";
import { handle } from "@pe/agent-contracts/handle";
import { HOST_RPC_BRIDGE_SESSION_HEADER, HOST_RPC_DOCUMENT_HEADER } from "@pe/host-contracts/operation-types";
import { sendCommand } from "./work-feed-client";

const target = { kind: "document", ref: { session: "session-a", openId: "open-a" } } as const;
const ports = (value: unknown = {}) => ({
  submit: vi.fn(async () => ({ state: "detached" as const, id: "request-a", key: "work.start", acceptance: "unknown" as const })),
  fetch: vi.fn(async (_path: string, _init?: RequestInit) => Response.json(value)),
  decode: vi.fn(async (_key: string, value: unknown) => value),
});

test.each(["action.recover", "action.resume", "action.cancel", "action.read"] as const)(
  "%s controls the original receipt without admitting another action",
  async (key) => {
    const receipt = { state: "running", id: "original", key: "sheet.apply", caller: { kind: "human", via: "local" },
      basis: null, target, input: {}, steps: [], prepared: { state: "unprepared" }, recovery: [],
      startedAt: "2026-11-12T00:00:00Z" };
    const transport = ports(key === "action.read" ? [receipt] : receipt);
    const result = await sendCommand(handle(key), { id: "control-request", key, target, input: { id: "original" } }, transport);
    expect(result).toMatchObject({ state: "answered", result: { id: "original", key: "sheet.apply", state: "running" } });
    expect(transport.submit).not.toHaveBeenCalled();
    expect(transport.fetch).toHaveBeenCalledWith(
      key === "action.read" ? "/actions?id=original" : "/actions/" + key.slice("action.".length),
      expect.objectContaining(key === "action.read" ? { method: "GET" } : { method: "POST", body: JSON.stringify({ id: "original" }) }),
    );
  },
);

test("command via submits the original admission and never calls a route", async () => {
  const transport = ports();
  const admission = { id: "request-a", key: "work.start", target, input: {} };
  await sendCommand(handle("work.start"), admission, transport);
  expect(transport.submit).toHaveBeenCalledWith(admission);
  expect(transport.fetch).not.toHaveBeenCalled();
});

test("Page binding uses its route and answers without inventing an action receipt", async () => {
  const transport = ports({ bound: true });
  const result = await sendCommand(handle("page.bind"), {
    id: "request-a", key: "page.bind", target,
    input: { slug: "page a", binding: { target: target.ref } },
  }, transport);
  expect(transport.submit).not.toHaveBeenCalled();
  expect(transport.fetch).toHaveBeenCalledWith("/pe/pages/page%20a/binding", expect.objectContaining({
    method: "PUT", body: JSON.stringify({ target: target.ref }),
  }));
  expect(result).toEqual({ state: "answered", result: { bound: true } });
});

test("native read route retains the exact session and open document", async () => {
  const transport = ports({ rows: [] });
  await sendCommand(handle("ops.read"), {
    id: "request-a", key: "ops.read", target,
    input: { op: { key: "revit.detail.elements", intent: "Read" }, request: { ids: ["one"] } },
  }, transport);
  expect(transport.fetch).toHaveBeenCalledWith("/call", expect.objectContaining({
    headers: expect.objectContaining({
      [HOST_RPC_BRIDGE_SESSION_HEADER]: "session-a", [HOST_RPC_DOCUMENT_HEADER]: "open-a",
    }),
    body: JSON.stringify({ key: "revit.detail.elements", request: { ids: ["one"] } }),
  }));
  expect(transport.submit).not.toHaveBeenCalled();
});

test("a different handle or a native mutation never reaches the read route", async () => {
  const transport = ports();
  await expect(sendCommand(handle("ops.read"), {
    id: "request-a", key: "page.bind", target, input: {},
  }, transport)).rejects.toThrow("Handle and admission command differ");
  await expect(sendCommand(handle("ops.read"), {
    id: "request-a", key: "ops.read", target,
    input: { op: { key: "ducts.assign-fan", intent: "Mutation" }, request: {} },
  }, transport)).rejects.toThrow("requires a native Read");
  expect(transport.submit).not.toHaveBeenCalled();
  expect(transport.fetch).not.toHaveBeenCalled();
});

test("family reads project the owning Work into scope outside the strict read input", async () => {
  const transport = ports({ reading: true });
  const work = { key: { binding: "host", route: "family", target: null }, revision: 7 };
  await sendCommand(handle("family.read"), { id: "request-a", key: "family.read", target,
    input: { readId: "read-a", expectedRevision: 7, work } }, transport);
  expect(transport.fetch).toHaveBeenCalledWith("/family/readings", expect.objectContaining({
    body: JSON.stringify({ key: "family.read", input: { readId: "read-a", expectedRevision: 7 }, target: target.ref, scope: work.key }),
  }));
  expect(transport.submit).not.toHaveBeenCalled();
});
