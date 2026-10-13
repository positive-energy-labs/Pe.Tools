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
