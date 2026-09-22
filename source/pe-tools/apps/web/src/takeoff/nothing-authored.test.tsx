// @vitest-environment jsdom
/** F-X-2 (c): with no Work at the document yet, /takeoffs says so; "not hydrated" is not a state. */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { peReadings } from "#/readings";
import { useRoute } from "#/route";
import { manifest } from "#/takeoff/manifest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("absent Work at a bound document reads 'nothing authored here yet', never 'not hydrated'", () => {
  const accept = new Map<string, Parameters<typeof peReadings.subscribe>[1]>();
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, next) => {
    accept.set(request.kind, next);
    return () => {};
  });
  const answer = (kind: string, value: unknown) =>
    act(() => accept.get(kind)?.({ kind: "snapshot", key: kind, value } as never));
  const { result } = renderHook(() =>
    useRoute(manifest, {
      target: JSON.stringify({ kind: "open", ref: { session: "A", openId: "doc-1" } }),
    }),
  );
  answer("inventory", {
    sessions: [
      {
        connected: true,
        sessionId: "A",
        openDocumentCount: 1,
        openDocuments: [
          {
            openId: "doc-1",
            title: "project-a",
            address: "C:/m/projectA.rvt",
            isFamilyDocument: false,
          },
        ],
      },
    ],
  });
  expect(result.current.resolution.kind).toBe("resolved");
  // The Work Reading answers: nothing is authored at this document yet.
  answer("work", null);
  expect(result.current.work.current).toBe(true);
  expect(result.current.actions.adopt.refusal).toBe("nothing authored here yet");
});
