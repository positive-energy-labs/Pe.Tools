// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  DUCTS_BODY_VERSION_HEADER,
  readingKey,
  type DuctsReadingRequest,
  type DuctsReadingEnvelope,
  type ReadingFrame,
} from "@pe/agent-contracts";
import { DuctsBodies, useDuctsReading, type Readings } from "./readings";

const target = { session: "bridge-a", openId: "open-a" };
const request: DuctsReadingRequest = { kind: "ducts-snapshot", target };
const envelope = (
  revision: string,
  state: DuctsReadingEnvelope["state"] = "ready",
): DuctsReadingEnvelope => ({
  revision,
  version: state === "ready" ? revision : null,
  state,
  target,
  session: target.session,
});
function source(initial: DuctsReadingEnvelope) {
  let value = initial;
  const listeners = new Set<(frame: ReadingFrame) => void>();
  const readings: Readings = {
    subscribe: (_request, accept) => {
      listeners.add(accept);
      accept({ kind: "snapshot", key: readingKey(request), value });
      return () => {
        listeners.delete(accept);
      };
    },
    dirty: () => {},
  };
  return {
    readings,
    publish: (next: DuctsReadingEnvelope) => {
      value = next;
      for (const accept of listeners) accept({ kind: "snapshot", key: readingKey(request), value });
    },
  };
}
const pending = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const response = (version: string, data: unknown = { nodes: [version] }, openId = target.openId) =>
  new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
      "x-pe-resolved-session": target.session,
      "x-pe-resolved-open-id": openId,
      "x-pe-native-request-id": `native-${version}`,
      [DUCTS_BODY_VERSION_HEADER]: version,
      "x-pe-ducts-reused": "true",
    },
  });
afterEach(cleanup);

test("two consumers and remount share one body transfer, parse identity, and original native provenance", async () => {
  const owner = source(envelope("A"));
  const fetchBody = vi.fn(async () => response("A"));
  const a = renderHook(() =>
    useDuctsReading<{ nodes: string[] }>(request, owner.readings, fetchBody),
  );
  const b = renderHook(() =>
    useDuctsReading<{ nodes: string[] }>(request, owner.readings, fetchBody),
  );
  await waitFor(() => expect(a.result.current.data).toEqual({ nodes: ["A"] }));
  await waitFor(() => expect(b.result.current.data).toBe(a.result.current.data));
  const body = a.result.current.data;
  expect(a.result.current.nativeObservation).toMatchObject({
    requestId: "native-A",
    document: target,
    version: "A",
  });
  a.unmount();
  b.unmount();
  const c = renderHook(() => useDuctsReading(request, owner.readings, fetchBody));
  await waitFor(() => expect(c.result.current.data).toBe(body));
  expect(fetchBody).toHaveBeenCalledTimes(1);
  const init = fetchBody.mock.calls[0] as unknown[];
  expect(new Headers((init[1] as RequestInit).headers).get(DUCTS_BODY_VERSION_HEADER)).toBe("A");
});

test("a late A response cannot replace B after invalidation or strand B behind a completed attempt", async () => {
  const owner = source(envelope("A"));
  const old = pending<Response>();
  const fetchBody = vi
    .fn()
    .mockImplementationOnce(() => old.promise)
    .mockImplementation(async () => response("B"));
  const hook = renderHook(() =>
    useDuctsReading<{ nodes: string[] }>(request, owner.readings, fetchBody),
  );
  await waitFor(() => expect(fetchBody).toHaveBeenCalledTimes(1));
  act(() => owner.publish(envelope("B")));
  await waitFor(() => expect(hook.result.current.data).toEqual({ nodes: ["B"] }));
  const b = hook.result.current.data;
  await act(async () => {
    old.resolve(response("A"));
    await old.promise;
  });
  expect(hook.result.current.data).toBe(b);
  expect(hook.result.current.pending).toBe(false);
});

test("HTTP may beat the ready envelope; loading evidence stays fenced until that version is ready", async () => {
  const owner = source(envelope("A", "idle"));
  const reply = pending<Response>();
  const fetchBody = vi.fn(() => reply.promise);
  const hook = renderHook(() => useDuctsReading(request, owner.readings, fetchBody));
  await waitFor(() => expect(fetchBody).toHaveBeenCalledTimes(1));
  act(() => owner.publish(envelope("A", "loading")));
  await act(async () => {
    reply.resolve(response("A"));
    await reply.promise;
  });
  expect(hook.result.current.data).toBeUndefined();
  act(() => owner.publish(envelope("A")));
  await waitFor(() => expect(hook.result.current.data).toEqual({ nodes: ["A"] }));
  expect(fetchBody).toHaveBeenCalledTimes(1);
});

test("unconfirmed native targets and transport failures are visible and do not spin retries", async () => {
  const owner = source(envelope("A"));
  const fetchBody = vi.fn(async () => response("A", {}, "other-open"));
  const hook = renderHook(() => useDuctsReading(request, owner.readings, fetchBody));
  await waitFor(() => expect(hook.result.current.error?.message).toContain("did not confirm"));
  expect(hook.result.current.data).toBeUndefined();
  expect(hook.result.current.pending).toBe(false);
  hook.rerender();
  expect(fetchBody).toHaveBeenCalledTimes(1);
});

test("browser retention has both count and byte bounds; failed loads are retryable by a later consumer", async () => {
  const bodies = new DuctsBodies({ entries: 1, bytes: 10 });
  const decoded = (version: string, bytes = 5) => ({
    data: { version },
    bytes,
    nativeObservation: {
      session: target.session,
      document: target,
      requestId: "native",
      version,
      reused: true,
    },
  });
  const a = vi.fn(async () => decoded("A"));
  const first = await bodies.read("A", a);
  expect(await bodies.read("A", a)).toBe(first);
  await bodies.read("B", async () => decoded("B"));
  await bodies.read("A", a);
  expect(a).toHaveBeenCalledTimes(2);
  await expect(bodies.read("large", async () => decoded("large", 11))).rejects.toThrow(
    "byte budget",
  );
  expect(await bodies.read("large", async () => decoded("large"))).toMatchObject({ bytes: 5 });
});

test("returning to an earlier subject (slot A -> B -> A) shows A again instead of waiting forever", async () => {
  // The fan sheet's airflow slot switch: each slot is its own subject with its own revision.
  const slotted = (slot: string): DuctsReadingRequest => ({ ...request, slots: { terminalFlow: slot } });
  const revisionOf = (r: DuctsReadingRequest) =>
    r.kind === "ducts-snapshot" ? (r.slots?.terminalFlow ?? "") : "";
  const readings: Readings = {
    subscribe: (subject, accept) => {
      accept({
        kind: "snapshot",
        key: readingKey(subject),
        value: envelope(revisionOf(subject as DuctsReadingRequest)),
      });
      return () => {};
    },
    dirty: () => {},
  };
  const fetchBody = vi.fn(async (_url: unknown, init?: RequestInit) =>
    response(new Headers(init?.headers).get(DUCTS_BODY_VERSION_HEADER)!),
  );
  const hook = renderHook(
    ({ slot }) => useDuctsReading<{ nodes: string[] }>(slotted(slot), readings, fetchBody as never),
    { initialProps: { slot: "A" } },
  );
  await waitFor(() => expect(hook.result.current.data).toEqual({ nodes: ["A"] }));
  hook.rerender({ slot: "B" });
  await waitFor(() => expect(hook.result.current.data).toEqual({ nodes: ["B"] }));
  hook.rerender({ slot: "A" });
  await waitFor(() => expect(hook.result.current.data).toEqual({ nodes: ["A"] }));
  expect(hook.result.current.pending).toBe(false);
});
