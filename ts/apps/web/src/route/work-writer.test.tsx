// @vitest-environment jsdom
/**
 * The route writer serializes its own intents over ACKNOWLEDGED revisions. A person's second edit,
 * sent after the first edit's acknowledgement but before the Work Reading re-reads, binds to the
 * revision the first edit landed, not to the observation still on screen. The host refuses a stale
 * revision; the writer must never hand it one of its own making. Its own file: the app registry
 * keeps the Work Reading, so a second mount elsewhere never re-subscribes.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { address, ductsRouteState, readingKey, routeAddress } from "@pe/agent-contracts";
import { peReadings } from "#/readings";
import { defineRoute } from "./manifest";
import * as routeHost from "./host";
import { useRoute } from "./use-route";

const DOC = address("C:/Review/Writer.rvt");
const manifest = defineRoute({
  key: "ducts",
  name: "Ducts",
  address: "ducts",
  page: routeAddress("ducts").schema,
  work: ductsRouteState,
  needs: "document",
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("a second edit after the first's acknowledgement binds to the acknowledged revision", async () => {
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "inventory")
      accept({
        kind: "snapshot",
        key: readingKey(request),
        value: {
          sessions: [
            {
              sessionId: "s1",
              connected: true,
              openDocumentCount: 1,
              openDocuments: [
                { openId: "o1", title: "Writer", address: DOC, isFamilyDocument: false },
              ],
            },
          ],
        },
      } as never);
    // The Work Reading delivers revision 3 once and never re-reads: the observation lags.
    if (request.kind === "work")
      accept({
        kind: "snapshot",
        key: readingKey(request),
        value: { revision: 3, doc: ductsRouteState.schema.parse({ assumptions: {} }) },
      } as never);
    return () => {};
  });
  // The host's revision check, as the real host keeps it.
  let revision = 3;
  const sent: number[] = [];
  vi.spyOn(routeHost, "postRouteWrite").mockImplementation(async (_operation, _input, body) => {
    const { expectedRevision } = body as { expectedRevision: number };
    sent.push(expectedRevision);
    if (expectedRevision !== revision)
      return {
        status: 409,
        result: { ok: false, kind: "error", error: "stale", hint: "", code: "stale_revision" },
      };
    return { status: 200, result: { ok: true, revision: ++revision } };
  });
  const { result } = renderHook(() => useRoute(manifest, { target: DOC, url: false }));
  expect(result.current.work.revision).toBe(3);

  const edit = (value: string) =>
    act(() => result.current.work.write([{ path: ["assumptions", "note"], value }]));
  expect(await edit("first")).toBeNull();
  // Acknowledged at 4; the Reading still says 3.
  expect(result.current.work.revision).toBe(3);
  expect(await edit("second")).toBeNull();
  expect(sent).toEqual([3, 4]);
});
