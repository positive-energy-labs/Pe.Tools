import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { address, bindWork, workKey } from "@pe/agent-contracts";
import { RouteWorkspace, type RouteDocumentStore } from "../src/route-workspace.ts";

test("instance discovery validates actual persisted Work and never reads, creates, or migrates a scope", async () => {
  const scope = bindWork("family", address("C:\\Models\\Saved.rvt"), undefined, {
    session: "s",
    openId: "before-save",
  });
  const getState = vi.fn(async () => null);
  const setState = vi.fn(async () => {});
  const store: RouteDocumentStore = {
    getState,
    setState,
    listState: async () => ({
      records: [
        {
          targetKey: workKey(scope),
          route: "family",
          value: { version: 1, revision: 5, doc: { authored: "kept-private" } },
        },
        { targetKey: workKey(scope), route: "family:aside:1", value: { raw: "unreadable" } },
        { targetKey: "open-work", route: "register", value: [] },
        { targetKey: "family/target:relative.rvt", route: "family", value: {} },
      ],
      unindexed: 2,
      unreadable: 1,
      truncated: false,
    }),
  };
  const workspace = new RouteWorkspace({
    store,
    registrations: [
      {
        spec: {
          route: "family",
          title: "Family",
          description: "Test",
          schema: z.object({ authored: z.string().default("") }),
          agentWriteMask: [],
          commands: {},
        },
        handlers: {},
      },
    ],
  });
  const result = await workspace.instances();
  expect(result).toMatchObject({ available: true, unindexed: 2, unreadable: 2, truncated: false });
  expect(result.works).toEqual([
    {
      id: workKey(scope),
      scope: bindWork("family", address("c:\\models\\saved.rvt")),
      route: "family",
      title: "Family",
      revision: 5,
      state: "ready",
      proposals: 0,
    },
  ]);
  expect(JSON.stringify(result)).not.toContain("kept-private");
  expect(getState).not.toHaveBeenCalled();
  expect(setState).not.toHaveBeenCalled();
});

test("registration discovery cannot manufacture a persisted instance", async () => {
  const workspace = new RouteWorkspace({
    store: {
      getState: async () => null,
      setState: async () => {},
      listState: async () => ({ records: [], unindexed: 0, unreadable: 0, truncated: false }),
    },
    registrations: [
      {
        spec: {
          route: "family",
          title: "Family",
          description: "Registered only",
          schema: z.object({}),
          agentWriteMask: [],
          commands: {},
        },
        handlers: {},
      },
    ],
  });
  expect(workspace.list()).toHaveLength(1);
  expect((await workspace.instances()).works).toEqual([]);
});

test("instance discovery counts each ready Work's pending Pea proposals and none for unreadable Work", async () => {
  const ready = bindWork("takeoffs", address("C:\\Models\\A.rvt"));
  const broken = bindWork("takeoffs", address("C:\\Models\\B.rvt"));
  const cell = z.object({ proposal: z.unknown().nullish(), staged: z.unknown().nullish() });
  const workspace = new RouteWorkspace({
    store: {
      getState: async () => null,
      setState: async () => {},
      listState: async () => ({
        records: [
          {
            targetKey: workKey(ready),
            route: "takeoffs",
            value: {
              version: 1,
              revision: 2,
              doc: { flags: { a: { proposal: { value: true } }, b: { staged: { value: true } } } },
            },
          },
          { targetKey: workKey(broken), route: "takeoffs", value: { doc: { flags: 3 } } },
        ],
        unindexed: 0,
        unreadable: 0,
        truncated: false,
      }),
    },
    registrations: [
      {
        spec: {
          route: "takeoffs",
          title: "Takeoffs",
          description: "Test",
          schema: z.object({ flags: z.record(z.string(), cell).default({}) }),
          agentWriteMask: [],
          commands: {},
        },
        handlers: {},
      },
    ],
  });
  const works = (await workspace.instances()).works;
  expect(works.map((work) => [work.state, work.proposals])).toEqual([
    ["ready", 1],
    ["unreadable", 0],
  ]);
});
