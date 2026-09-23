// @vitest-environment jsdom
/** Obligation 12 on `/family`: old-shape saved Work surfaces the host's sentence on the handle. */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { UNREADABLE_WORK } from "@pe/agent-contracts";
import { peReadings } from "#/readings";
import { familyManifest } from "../family/manifest";
import { useRoute } from "./use-route";

const UNREADABLE = UNREADABLE_WORK;
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

test("/family: a refused Work Reading is the handle's refusal sentence and never current", () => {
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
  expect(accept.has("work")).toBe(true);
  act(() => accept.get("work")?.({ kind: "failure", key: "work", error: UNREADABLE } as never));
  expect(result.current.work.current).toBe(false);
  expect(result.current.work.refusal).toBe(UNREADABLE);
  expect(result.current.work.startFresh).not.toBeNull();
});
