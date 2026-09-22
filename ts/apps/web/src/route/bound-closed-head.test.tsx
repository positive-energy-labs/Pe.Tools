// @vitest-environment jsdom
/**
 * F-X-1 (4k-2): a Chat head whose `open` document closed. The verbs and a Work write refuse with
 * the Chat's sentence (never "not hydrated"), a page that MOUNTS unbound logs it once, and the
 * same title reopened is offered, never taken.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { peReadings } from "#/readings";
import { schedulesManifest } from "./schedules/manifest";
import { useRoute } from "./use-route";

const session = (docs: { openId: string; title: string }[]) => ({
  sessions: [
    {
      connected: true,
      sessionId: "A",
      openDocumentCount: docs.length,
      openDocuments: docs.map((doc) => ({ ...doc, address: null, isFamilyDocument: false })),
    },
  ],
});

function stream() {
  const accept = new Map<string, Parameters<typeof peReadings.subscribe>[1]>();
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, next) => {
    accept.set(request.kind, next);
    return () => {};
  });
  return (kind: string, value: unknown) =>
    act(() => accept.get(kind)?.({ kind: "snapshot", key: kind, value } as never));
}

beforeEach(() => {
  // A lost binding salvages Work over the host door. Unstubbed it reaches a real port and its
  // rejection escapes the file, so every later file runs beside an unhandled error.
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const HEAD = {
  defaultTarget: { kind: "open", ref: { session: "A", openId: "doc-tower-1" } },
  revision: 1,
};
const CHAT = /^the Chat's document is no longer open — pick it again \(Tower · doc-towe…\)$/;

test("a Chat head whose document closed refuses verbs and Work writes with the Chat's sentence", async () => {
  const answer = stream();
  const { result } = renderHook(() => useRoute(schedulesManifest(), { thread: "T" }));
  answer("inventory", session([{ openId: "doc-tower-1", title: "Tower" }]));
  answer("thread-head", HEAD);
  expect(result.current.resolution.kind).toBe("resolved");

  // Closed and reopened: the same title under a new openId.
  answer("inventory", session([{ openId: "doc-tower-2", title: "Tower" }]));
  expect(result.current.bindingLost?.sentence).toMatch(CHAT);
  expect(result.current.actions.push.refusal).toMatch(CHAT);
  let refusal: unknown;
  await act(async () => {
    refusal = await result.current.work.write([{ path: ["cells"], value: {} }]);
  });
  expect(refusal).toMatchObject({ code: "no-target" });
  expect((refusal as { message: string }).message).toMatch(CHAT);
  expect(result.current.bindingLost?.reopened).toEqual({ openId: "doc-tower-2", title: "Tower" });
  expect(result.current.resolution.kind).toBe("choose");
});

test("a page that mounts with its Chat document already closed logs it once, on load", () => {
  const answer = stream();
  const { result, rerender } = renderHook(() => useRoute(schedulesManifest(), { thread: "T" }));
  answer("inventory", session([{ openId: "doc-annex", title: "Annex" }]));
  answer("thread-head", HEAD);
  rerender();
  const lines = result.current.log.filter((entry) => entry.kind === "target");
  expect(lines.map((entry) => entry.says)).toEqual(["unbound (document closed)"]);
});
