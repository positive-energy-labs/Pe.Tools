// @vitest-environment jsdom
import { expect, test, vi, afterEach } from "vite-plus/test";
import { HOST_RPC_BRIDGE_SESSION_HEADER } from "@pe/host-contracts/operation-types";
import { requestJson, callOp } from "#/shell/readings-api";
import { takeoffSources } from "./sources";
import { roomsSnapshotSource } from "../rooms/sources";
import type { ReadingContext } from "#/shell/readings";

vi.mock("#/shell/readings-api", async (original) => ({
  ...(await original<typeof import("#/shell/readings-api")>()),
  requestJson: vi.fn(async () => ({})),
  callOp: vi.fn(async () => ({ levels: [], regions: [] })),
}));
vi.mock("#/shell/readings-use", () => ({ subscriptionSource: () => ({ open: () => undefined }) }));
afterEach(() => vi.clearAllMocks());
const context = (page: object) =>
  ({
    page,
    target: { kind: "document", ref: { session: "owned", openId: "exact-open" } },
    inputs: {},
    signal: new AbortController().signal,
  }) as ReadingContext;

test("takeoff acquisition sends the chosen views and zones before subscribing", async () => {
  const scope = {
    views: ["Zoning plan"],
    zones: ["0281501e-aa76-430e-bf50-565376295ec4"],
    work: "",
  };
  const source = takeoffSources()["takeoffs.snapshot"]!;
  if (source.kind !== "use") throw Error("Expected native source");
  await source.open(context(scope), vi.fn());
  expect(requestJson).toHaveBeenCalledWith(
    expect.objectContaining({
      body: { key: "takeoffs.snapshot", request: { views: [], zoneGuids: scope.zones } },
      headers: expect.objectContaining({ [HOST_RPC_BRIDGE_SESSION_HEADER]: "owned" }),
    }),
    expect.anything(),
    expect.anything(),
  );
});

test("rooms entry reads the roster until a view is chosen, then reads only that view", async () => {
  const deliver = vi.fn();
  const release = roomsSnapshotSource().open(context({ view: "" }), deliver);
  await vi.waitFor(() =>
    expect(callOp).toHaveBeenCalledWith(expect.anything(), "rooms.roster", {}),
  );
  if (typeof release === "function") release();
  const detail = roomsSnapshotSource().open(context({ view: "Zoning plan" }), deliver);
  await vi.waitFor(() =>
    expect(callOp).toHaveBeenCalledWith(expect.anything(), "rooms.snapshot", {
      view: "Zoning plan",
    }),
  );
  if (typeof detail === "function") detail();
});
