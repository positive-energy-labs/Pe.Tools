// @vitest-environment jsdom
import { expect, test, vi, afterEach } from "vite-plus/test";
import { callOp } from "../host/catalog-client";
import { takeoffSources } from "./sources";
import type { ReadingContext } from "#/shell/source-contract";

vi.mock("#/host/catalog-client", async (original) => ({
  ...(await original<typeof import("#/host/catalog-client")>()),
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
  expect(callOp).toHaveBeenCalledWith(
    expect.objectContaining({ target: context(scope).target }),
    "takeoffs.snapshot",
    { views: [], zoneGuids: scope.zones },
  );
});


test("takeoff metadata roster lists views without requesting a geometry snapshot", async () => {
  const source = takeoffSources()["takeoffs.roster"]!;
  if (source.kind !== "use") throw Error("Expected independent metadata source");
  const deliver = vi.fn();
  await source.open(context({ views: [], zones: [], work: "" }), deliver);
  expect(callOp).toHaveBeenCalledWith(expect.anything(), "revit.catalog.project-index", {
    sections: ["Views"],
    includeUnplacedViews: true,
    projection: { view: "Handles" },
  });

  expect(deliver).toHaveBeenCalledWith(
    expect.objectContaining({ value: expect.objectContaining({ zonesComplete: false }) }),
  );
});
