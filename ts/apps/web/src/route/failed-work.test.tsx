// @vitest-environment jsdom
/**
 * G1: start fresh answers only the host's UNREADABLE_WORK. Any other failed Work read (host down,
 * network, timeout, 5xx) says its own failure and offers no start fresh. Its own file: the app
 * registry keeps a Work Reading, so a second mount in `old-work.test.tsx` never re-subscribes.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { peReadings } from "#/readings";
import { familyManifest } from "../family/manifest";
import { useRoute } from "./use-route";

const inventory = {
  sessions: [
    {
      connected: true,
      sessionId: "A",
      openDocumentCount: 1,
      openDocuments: [{ openId: "doc-A", title: "Tower", address: null, isFamilyDocument: true }],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("/family: a host-down Work read says its own failure and offers no start fresh", () => {
  const accept = new Map<string, Parameters<typeof peReadings.subscribe>[1]>();
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, next) => {
    accept.set(request.kind, next);
    return () => {};
  });
  const { result } = renderHook(() =>
    useRoute(familyManifest(), {
      target: JSON.stringify({ kind: "open", ref: { session: "A", openId: "doc-A" } }),
    }),
  );
  act(() =>
    accept.get("inventory")?.({ kind: "snapshot", key: "inventory", value: inventory } as never),
  );
  const failure = "fetch failed: host unavailable (503)";
  act(() => accept.get("work")?.({ kind: "failure", key: "work", error: failure } as never));
  expect(result.current.work.refusal).toBe(failure);
  expect(result.current.work.startFresh).toBeNull();
});
