import { expect, test, vi } from "vite-plus/test";
import { handle } from "@pe/agent-contracts/handle";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { hostActions } from "@pe/agent-contracts/semantic-actions";
import { isMutation } from "../ops/manifest";
import { HOST_RPC_BRIDGE_SESSION_HEADER, HOST_RPC_DOCUMENT_HEADER } from "@pe/host-contracts/operation-types";
import { sendCommand, createWorkFeedClient, browserWorkPorts } from "./work-feed-client";
import type { AcceptedResult } from "../../../../packages/agent-contracts/src/work-journal-door";

const target = { kind: "document", ref: { session: "session-a", openId: "open-a" } } as const;
const ports = (value: unknown = {}) => ({
  submit: vi.fn(async () => ({ state: "detached" as const, id: "request-a", key: "work.start", acceptance: "unknown" as const })),
  fetch: vi.fn(async (_path: string, _init?: RequestInit) => Response.json(value)),
  decode: vi.fn(async (_key: string, value: unknown) => value),
});

test.each(["action.cancel", "action.read"] as const)(
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
    input: { op: { key: "revit.detail.elements", effect: "Read" }, request: { ids: ["one"] } },
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
    input: { op: { key: "ducts.assign-fan", effect: "ModelWrite" }, request: {} },
  }, transport)).rejects.toThrow("requires a native Read");
  expect(transport.submit).not.toHaveBeenCalled();
  expect(transport.fetch).not.toHaveBeenCalled();
});

test("Ops fallback catalog classifies every native effect and admits only reads to Run read", async () => {
  const seen = new Set<string>();
  for (const op of hostOpCatalog) {
    const read = op.effect === "Read" || op.effect === "TransactRead";
    seen.add(op.effect);
    expect(isMutation(op), op.key).toBe(!read);
    const input = { op, request: {} };
    expect(hostActions["ops.read"].input.safeParse(input).success, op.key).toBe(read);
    const transport = ports();
    const sent = sendCommand(handle("ops.read"), { id: "fallback", key: "ops.read", target, input }, transport);
    if (read) {
      await expect(sent).resolves.toMatchObject({ state: "answered" });
      expect(transport.fetch).toHaveBeenCalledOnce();
    } else {
      await expect(sent).rejects.toThrow("requires a native Read");
      expect(transport.fetch).not.toHaveBeenCalled();
    }
  }
  expect([...seen]).toEqual(expect.arrayContaining(["Read", "TransactRead", "ModelWrite", "SessionWrite"]));
});

test("family reads project the owning Work into scope outside the strict read input", async () => {
  const transport = ports({ reading: true });
  const work = { key: { binding: "host", route: "family", target: null }, revision: 7 };
  await sendCommand(handle("family.read"), { id: "request-a", key: "family.read", target,
    input: { readId: "read-a", expectedRevision: 7, work } }, transport);
  expect(transport.fetch.mock.calls[0]![0]).toBe("/family/readings");
  expect(JSON.parse(String(transport.fetch.mock.calls[0]![1]!.body))).toEqual({
    key: "family.read", input: { readId: "read-a", expectedRevision: 7 }, target: target.ref, scope: work.key,
  });
  expect(transport.submit).not.toHaveBeenCalled();
});

test("direct answers resolve and replay without inventing a host receipt", async () => {
  const result = { id: "original", state: "running" };
  const door = createWorkFeedClient(undefined, {
    write: browserWorkPorts.write,
    submit: async () => ({ state: "answered" as const, result }),
  });
  const submission = door.submit({ id: "control-request", key: "action.cancel", target, input: { id: "original" } });
  const accepted = await new Promise<AcceptedResult>((resolve) => submission.accepted.subscribe(
    (value) => { if (value.kind !== "pending") resolve(value); },
    () => {},
  ));
  expect(accepted).toEqual({ kind: "accepted-native", outcome: "committed", result });
  expect(door.accepted(submission.handle.id)).toEqual(accepted);
  expect(accepted).not.toHaveProperty("receiptId");
});

/*
 * The witness `runOp` held before k2/verbs deleted it: what this client's contract does not name is
 * refused. A command key mints no handle; a native read key has no decoder, so its answer is never
 * handed on as a value.
 */
test("a command or a native read absent from this client's contract is refused", async () => {
  expect(() => handle("nope.command" as never)).toThrow("No command or route: nope.command");
  const { submit, fetch } = ports({ anything: 1 });
  const { opResponseSchema } = await import("../host/catalog-client");
  await expect(sendCommand(handle("ops.read"), {
    id: "request-a", key: "ops.read", target,
    input: { op: { key: "revit.detail.not-in-this-contract", effect: "Read" }, request: {} },
  }, { submit, fetch, decode: async (key, value) => (await opResponseSchema(key)).parse(value) }))
    .rejects.toThrow("revit.detail.not-in-this-contract is not in the op catalog");
  expect(submit).not.toHaveBeenCalled();
});
