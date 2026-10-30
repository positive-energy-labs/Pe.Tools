// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  bindWork,
  draftCellSchema,
  pane,
  readingKey,
  workWriteSchema,
  type RouteGraph,
} from "@pe/agent-contracts";
import { peClient } from "#/host/pe-client";
import { peReadings, previousOf } from "#/readings";
import { ProposalHead } from "#/chat/proposal-head";
import { presentInputHistory } from "#/ducts/sheet/input-history";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import { createGraphMount } from "./mount-owner";
import { appAtomRegistry } from "./owner";
import { docAtom } from "./work-document";
import { useWorkHandles } from "./use-work-handles";
import { workVerb } from "./verbs";
import { writeRouteWork } from "../route/host";

const RULE = "round-elbow-1d";
const LABEL = "Round Elbow 1 D table";

async function scenario() {
  const route = `composer-${crypto.randomUUID()}`;
  const schema = z.object({
    rules: z.record(z.string(), draftCellSchema(z.object({ table: z.string() }))).default({}),
  });
  type Work = z.output<typeof schema>;
  const graph: RouteGraph<Record<string, never>, Work> = {
    key: route,
    address: route,
    name: "Ducts",
    work: schema,
    fields: {},
    readings: {},
    cells: [{ segment: "rules", groupOf: (key) => [key], label: () => LABEL, noun: "loss rules" }],
    verbs: {
      edit: workVerb(
        { label: "Input edit", input: z.string() },
        {
          patches: (_scope, table) => [
            { path: ["rules", RULE, "edit"], value: { value: { table } } },
          ],
          history: { describe: () => ({ label: `Edit ${LABEL}` }) },
        },
      ),
    },
    panes: { main: { label: "Main", purpose: "D8 composer proof", draws: [], verbs: [] } },
    stages: { main: { word: "Main", panes: ["main"], verbs: ["edit"] } },
    layout: pane("main"),
  };
  const key = bindWork(route, null, crypto.randomUUID());
  const spec = { route, title: route, description: route, schema };
  let stored: unknown = { version: 1, revision: 52, doc: schema.parse({}) };
  let failed = false;
  const deliveries = new Set<(frame: never) => void>();
  const workspace = new RouteWorkspace({
    registrations: [{ spec }],
    store: {
      getState: async () => structuredClone(stored),
      setState: async ({ value }) => {
        stored = structuredClone(value);
      },
    },
  });
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "work") {
      deliveries.add(accept as never);
      const release = workspace.observe(request, route, (result) => {
        if ("error" in result) throw Error(result.error);
        if (!failed) accept({ kind: "snapshot", key: readingKey(request), value: result.value });
      });
      return () => {
        deliveries.delete(accept as never);
        release();
      };
    }
    if (request.kind === "work-acks")
      return workspace.observeAccepted(request.work, (ack) => {
        accept({ kind: "event", key: readingKey(request), value: ack } as never);
      });
    return () => {};
  });
  const posted = vi.spyOn(peClient, "response").mockImplementation(async (operation, input) => {
    expect(operation).toBe("work.apply");
    const request = workWriteSchema.parse((input as { body: unknown }).body);
    const result = await workspace.write(key, route, "human", request);
    return new Response(JSON.stringify(result), { status: result.ok ? 200 : 409 });
  });
  const entries = [{ graph, key }];
  function Head() {
    const work = useWorkHandles(entries)[0]!;
    return (
      <ProposalHead
        asks={[]}
        works={[
          {
            id: "loss-rules",
            route: "Ducts",
            subject: "loss rules",
            cells: work.doc?.rules ?? {},
            wire: {
              segment: "rules",
              revision: work.revision,
              write: work.write,
              pending: (press) => work.pending.some((request) => request.press === press),
              discard: work.discard,
            },
            groupOf: (cell) => [cell],
            label: () => LABEL,
            stale: failed || work.stale,
            commit: { word: "open", run: () => {} },
            open: () => {},
          },
        ]}
      />
    );
  }
  const view = render(<Head />);
  const atom = docAtom(spec, key);
  const owner = createGraphMount(graph, {
    getSnapshot: () => {
      const seen = previousOf(appAtomRegistry.get(atom));
      return {
        target: { kind: "host" },
        workKey: key,
        work: seen
          ? {
              handle: { key, revision: seen.revision ?? 0 },
              doc: seen.doc ?? schema.parse({}),
            }
          : null,
      };
    },
    subscribe: (notify) => appAtomRegistry.subscribe(atom, notify),
    sources: {},
    write: writeRouteWork,
    binding: (_id, args) => ({ subject: null, args }),
    subscribeAcceptedDeltas: (key, accept) => workspace.observeAccepted(key, accept),
  });
  const disconnect = owner.connect();
  await waitFor(() => expect(owner.snapshot().work?.handle.revision).toBe(52));
  const edit = async (table: string) => {
    await act(async () => {
      expect((await owner.control("edit", table).run()).state).toBe("done");
    });
  };
  return {
    view,
    owner,
    posted,
    edit,
    doc: () => (stored as { doc: Work }).doc,
    stale() {
      act(() => {
        for (const deliver of deliveries)
          deliver({ kind: "stale", key: readingKey({ ...key, kind: "work" }) } as never);
      });
    },
    fail() {
      act(() => {
        failed = true;
        for (const deliver of deliveries)
          deliver({
            kind: "failure",
            key: readingKey({ ...key, kind: "work" }),
            error: "stream.failed readings",
          } as never);
      });
    },
    recover() {
      act(() => {
        failed = false;
        const envelope = stored as { revision: number; doc: Work };
        for (const deliver of deliveries)
          deliver({
            kind: "snapshot",
            key: readingKey({ ...key, kind: "work" }),
            value: envelope,
          } as never);
      });
    },
    close() {
      vi.useRealTimers();
      disconnect();
      owner.dispose();
      cleanup();
      vi.restoreAllMocks();
    },
  };
}

test("D8.7: edit → composer revert → edit → undo → undo names the restored revert and preserves its timestamp", async () => {
  const one = await scenario();
  try {
    await one.edit("CD3-1");
    const original = structuredClone(one.doc().rules[RULE]!.edit);
    expect(original?.at).toBeTruthy();
    fireEvent.click(one.view.getByRole("button", { name: /^review/ }));
    const revert = one.view.getByRole("button", { name: "Revert 1 edit" });
    fireEvent.click(revert);
    fireEvent.click(revert);
    await waitFor(() => expect(one.doc().rules).toEqual({}));
    const reverted = one.owner.journal(one.owner.snapshot().work!.handle.key).read().undo.at(-1);
    await one.edit("CD3-3");
    await act(async () => {
      expect((await one.owner.restore("undo"))?.ok).toBe(true);
    });
    expect(one.doc().rules).toEqual({});
    await act(async () => {
      expect((await one.owner.restore("undo"))?.ok).toBe(true);
    });
    expect(one.doc().rules[RULE]!.edit).toEqual(original);
    const history = one.owner.journal(one.owner.snapshot().work!.handle.key).read();
    expect(reverted?.label).toBe(`Revert ${LABEL}`);
    expect(history.redo.at(-1)?.label).toBe(`Revert ${LABEL}`);
    expect(presentInputHistory(history, null)).toMatchObject({
      redoLabel: `Revert ${LABEL}`,
      last: { label: `undid Revert ${LABEL}` },
    });
  } finally {
    one.close();
  }
});

test("D8.8: a stale row with a failed reading stream says why confirm cannot post and retains the confirmed revert for retry", async () => {
  const one = await scenario();
  try {
    await one.edit("CD3-1");
    fireEvent.click(one.view.getByRole("button", { name: /^review/ }));
    const revert = one.view.getByRole("button", { name: "Revert 1 edit" });
    one.stale();
    expect(one.view.getByText("r53").parentElement?.textContent).toContain("stale");
    fireEvent.click(revert);
    one.fail();
    fireEvent.click(revert);
    await waitFor(() =>
      expect(one.view.getByRole("alert").textContent).toContain("stream.failed readings"),
    );
    expect(one.posted).toHaveBeenCalledTimes(1);
    expect(one.doc().rules[RULE]!.edit?.value.table).toBe("CD3-1");
    expect(revert.textContent).toContain("again");
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(revert.textContent).toContain("again");
    vi.useRealTimers();
    one.recover();
    fireEvent.click(revert);
    await waitFor(() => expect(one.doc().rules).toEqual({}));
    expect(one.posted).toHaveBeenCalledTimes(2);
  } finally {
    one.close();
  }
});
