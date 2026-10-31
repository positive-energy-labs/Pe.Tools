// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { pane, type RouteGraph } from "@pe/agent-contracts";
import {
  actionControlRpc,
  automaticUpdatesRpc,
  hostShellOpenRpc,
} from "../../../../packages/mcps/src/shared/rpc-client";
import { createGraphMount } from "#/shell/mount";
import { rpcVerb } from "#/shell/verbs";

const transport = vi.hoisted(() => ({ control: vi.fn(), submit: vi.fn() }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async (original) => ({
  ...(await original<
    typeof import("../../../../packages/mcps/src/shared/takeoff-action-client")
  >()),
  controlAction: transport.control,
  submitAction: transport.submit,
}));

const owners: ReturnType<typeof createGraphMount>[] = [];
afterEach(() => {
  owners.splice(0).forEach((owner) => owner.dispose());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function mounted() {
  const graph: RouteGraph<Record<string, never>> = {
    key: "host-door-proof",
    address: "ops",
    name: "Host doors",
    fields: {},
    readings: {},
    verbs: {
      automatic: rpcVerb(
        automaticUpdatesRpc,
        {
          label: "Automatic updates",
          input: automaticUpdatesRpc.input,
          caller: "human",
          review: "none",
        },
        { intent: (_, input) => input },
      ),
      control: rpcVerb(
        actionControlRpc,
        {
          label: "Receipt control",
          input: actionControlRpc.input,
          caller: "human",
          review: "none",
        },
        { intent: (_, input) => input },
      ),
      open: rpcVerb(
        hostShellOpenRpc,
        { label: "Open path", input: hostShellOpenRpc.input, caller: "human", review: "none" },
        { intent: (_, input) => input },
      ),
    },
    panes: {
      body: { label: "Doors", purpose: "Exercise declared RPC doors", draws: [], verbs: [] },
    },
    layout: pane("body"),
    stages: { act: { word: "Acting", panes: ["body"], verbs: ["automatic", "control", "open"] } },
  };
  const owner = createGraphMount(graph, {
    sources: {},
    getSnapshot: () => ({ target: { kind: "host" }, work: null }),
    subscribe: () => () => {},
    subscribeAcceptedDeltas: () => () => {},
    write: async () => {
      throw Error("Host doors do not write Work");
    },
    binding: (_, row) => ({ subject: null, args: row ?? {} }),
  });
  owners.push(owner as ReturnType<typeof createGraphMount>);
  return owner;
}

test("mounted automatic-update verb sends the switch and reports a host refusal", async () => {
  const fetch = vi.fn(async () => Response.json({ error: "Updates are locked" }, { status: 409 }));
  vi.stubGlobal("fetch", fetch);
  const owner = mounted();
  const refused = await owner.control("automatic", { enabled: false }).run();
  expect(refused).toMatchObject({ state: "failed", refusal: { message: "Updates are locked" } });
  expect(fetch).toHaveBeenCalledWith(
    "/host/update/automatic",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ enabled: false }),
    }),
  );
  fetch.mockImplementation(async () => Response.json({}));
  expect(await owner.control("automatic", { enabled: true }).run()).toMatchObject({
    state: "done",
    kind: "rpc",
  });
});

test("mounted receipt control retains the original id and endpoint", async () => {
  transport.control.mockResolvedValue({ id: "original-action", state: "running" });
  expect(
    await mounted()
      .control("control", {
        key: "action.resume",
        id: "original-action",
        base: "http://original-host",
      })
      .run(),
  ).toMatchObject({ state: "done", kind: "rpc" });
  expect(transport.control).toHaveBeenCalledWith(
    "action.resume",
    { id: "original-action" },
    "http://original-host",
  );
});

test("mounted shell-open verb keeps human admission and refuses a failed receipt", async () => {
  const owner = mounted();
  transport.submit.mockResolvedValue({ id: "open", state: "succeeded", result: {} });
  expect(await owner.control("open", { path: "C:/model.rvt" }).run()).toMatchObject({
    state: "done",
    kind: "rpc",
  });
  expect(transport.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      key: "host.shell.open",
      target: { kind: "host" },
      input: { path: "C:/model.rvt" },
    }),
    "",
    30_000,
  );
  transport.submit.mockResolvedValue({ id: "open", state: "failed", error: "File missing" });
  expect(await owner.control("open", { path: "C:/missing.rvt" }).run()).toMatchObject({
    state: "failed",
  });
});
