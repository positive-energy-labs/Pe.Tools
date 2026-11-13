import { expect, test, vi } from "vite-plus/test";
import { hostResourceObserver } from "../src/resource-adapters.ts";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/contracts";
import type { ReadingFrame } from "@pe/agent-contracts";

const target = { session: "explicit-session", openId: "explicit-document" };
const request = { kind: "field-options" as const, target, key: "parameters", context: {} };

test("field options uses the recorded operation door with its own target, without a bridge", async () => {
  const frame = Promise.withResolvers<ReadingFrame>();
  const value = { descriptor: { requiredRuntimeMode: "LiveDocument" }, items: [] };
  const transport = vi.fn(async (url: URL, init?: RequestInit) => {
    expect(url.pathname).toBe(peRouteUrl("operation.call", {}));
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBe(target.session);
    expect(new Headers(init?.headers).get(HOST_RPC_DOCUMENT_HEADER)).toBe(target.openId);
    expect(JSON.parse(init?.body as string)).toEqual({
      key: "revit.catalog.field-options",
      request: { key: request.key, context: {} },
    });
    return Response.json(value);
  });
  const observe = hostResourceObserver(
    undefined,
    undefined,
    undefined,
    "http://localhost",
    transport,
  );
  const stop = observe(request, frame.resolve);
  try {
    expect(await frame.promise).toMatchObject({ kind: "snapshot", value: { ...value, target } });
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

test("a recorded miss stays a failure and never falls back to a live bridge", async () => {
  const frame = Promise.withResolvers<ReadingFrame>();
  const transport = vi.fn(async () => Response.json({ error: "recorded miss" }, { status: 409 }));
  const observe = hostResourceObserver(
    undefined,
    undefined,
    undefined,
    "http://localhost",
    transport,
  );
  const stop = observe(request, frame.resolve);
  try {
    expect(await frame.promise).toMatchObject({
      kind: "failure",
      error: expect.stringContaining("recorded miss"),
    });
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

test("leaving aborts the read and fences an already queued answer", async () => {
  const answer = Promise.withResolvers<Response>();
  let signal: AbortSignal | null | undefined;
  const observe = hostResourceObserver(
    undefined,
    undefined,
    undefined,
    "http://localhost",
    async (_url, init) => {
      signal = init?.signal;
      return answer.promise;
    },
  );
  const publish = vi.fn();
  const stop = observe(request, publish);
  stop();
  expect(signal?.aborted).toBe(true);
  answer.resolve(Response.json({ descriptor: { requiredRuntimeMode: "LiveDocument" }, items: [] }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(publish).not.toHaveBeenCalled();
});
