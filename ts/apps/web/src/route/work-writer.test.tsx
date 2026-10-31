// @vitest-environment jsdom
/** Consecutive graph edits bind the authoritative Work revision delivered after each ACK. */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { address, ductsRouteState, readingKey, workWriteSchema } from "@pe/agent-contracts";
import { z } from "zod";
import { peReadings } from "#/readings";
import { useGraphRoute } from "#/shell/mount";
import { workVerb } from "#/shell/verbs";
import * as routeHost from "./host";

const DOC = address("C:/Review/Writer.rvt");
const graph = {
  key: "ducts",
  address: "ducts",
  name: "Ducts",
  fields: {},
  readings: {},
  needs: "document" as const,
  work: ductsRouteState.schema,
  verbs: {
    edit: workVerb(
      { label: "Edit", input: z.string() },
      { patches: (_scope, value) => [{ path: ["assumptions", "note"], value }] },
    ),
  },
  layout: { kind: "pane" as const, id: "probe" },
  panes: { probe: { label: "Probe", purpose: "Acknowledged writer", draws: [], verbs: [] } },
  stages: { probe: { word: "Probe", panes: ["probe"], verbs: [] } },
};
const adapters = {
  sources: {},
  bodies: {},
  binding: (_id: string, value: unknown) => ({ subject: null, args: value }),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("consecutive graph edits bind each authoritative Work revision", async () => {
  const workReaders = new Set<Parameters<typeof peReadings.subscribe>[1]>();
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
    // This integration fixture publishes the host's new Work with each acknowledgement.
    if (request.kind === "work") {
      workReaders.add(accept);
      accept({
        kind: "snapshot",
        key: readingKey(request),
        value: { revision: 3, doc: ductsRouteState.schema.parse({ assumptions: {} }) },
      } as never);
    }
    return () => {
      workReaders.delete(accept);
    };
  });
  // The host's revision check, as the real host keeps it.
  let revision = 3;
  const sent: number[] = [];
  const presses: (string | null)[] = [];
  vi.spyOn(routeHost, "writeRouteWork").mockImplementation(async (key, body) => {
    const { expectedRevision, press, patches, kind } = workWriteSchema.parse(body);
    sent.push(expectedRevision);
    presses.push(press);
    if (expectedRevision !== revision)
      return { ok: false, kind: "error", error: "stale", hint: "", code: "stale_revision" };
    revision++;
    for (const accept of workReaders)
      accept({
        kind: "snapshot",
        key: "work",
        value: { revision, doc: ductsRouteState.schema.parse({ assumptions: {} }) },
      } as never);
    return {
      ok: true,
      revision,
      write: {
        key,
        kind,
        by: "human",
        press,
        base: expectedRevision,
        revision,
        patches,
        inverse: [],
        undoable: true,
      },
    };
  });
  const { result } = renderHook(() => useGraphRoute(graph, adapters, { target: DOC, url: false }));
  expect(result.current.owner.snapshot().work?.handle.revision).toBe(3);
  const edit = (value: string) => act(() => result.current.owner.control("edit", value).run());
  const first = await edit("first");
  expect(first, JSON.stringify(first)).toMatchObject({ state: "done" });
  // The next verb follows the newly published Work rather than a private revision cursor.
  expect(result.current.owner.snapshot().work?.handle.revision).toBe(4);
  expect(await edit("second")).toMatchObject({ state: "done" });
  expect(sent).toEqual([3, 4]);
  expect(await edit("third")).toMatchObject({ state: "done" });
  expect(await edit("fourth")).toMatchObject({ state: "done" });
  expect(sent).toEqual([3, 4, 5, 6]);
  expect(presses.every((press) => typeof press === "string")).toBe(true);
  expect(new Set(presses).size).toBe(4);
});
