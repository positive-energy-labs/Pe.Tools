// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  ductsRosterResponseSchema,
  ductsSheetOverviewSchema,
  ductsSheetResponseSchema,
} from "@pe/agent-contracts";
import fixture from "./sheet.fixture.json";
import { Roster, FanSheet } from "./view";
import { useSheet } from "./use-sheet";
import { hostFetch } from "#/host/runtime";

vi.mock("#/host/runtime", () => ({ hostFetch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const roster = ductsRosterResponseSchema.parse(fixture.roster);
const overview = ductsSheetOverviewSchema.parse(fixture.overview);
const inputs = ductsSheetResponseSchema.parse(fixture.inputs);
const elements = ductsSheetResponseSchema.parse(fixture.elements);
const legs = ductsSheetResponseSchema.parse(fixture.legs);
if (inputs.kind !== "inputs" || elements.kind !== "elements" || legs.kind !== "legs")
  throw Error("Fixture detail kinds");

test("fixture roster prioritizes blockers; sheet keeps incomplete subtotal distinct and renders anchored paths, blockers and ordered legs", () => {
  const select = vi.fn();
  const compute = vi.fn();
  const pickPath = vi.fn();
  const anchor = (id: number) => <button onClick={() => select(id)}>{id}</button>;
  render(
    <>
      <Roster rows={roster.rows} compute={compute} anchor={anchor} busy={false} />
      <FanSheet
        sheet={{ overview, inputs, elements, legs, worstLegs: [] }}
        anchor={anchor}
        pickPath={pickPath}
        busy={false}
      />
    </>,
  );
  const fanButtons = screen.getAllByRole("button", { name: /^Open .+ port/ });
  expect(fanButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
    "Open MUAS-1 port 2",
    "Open AHU-1 port 1",
    "Open FC-23 port 0",
  ]);
  fireEvent.click(fanButtons[0]!);
  expect(compute).toHaveBeenCalledWith(roster.rows[0]);
  expect(screen.getAllByText("incomplete: 1 blockers").length).toBeGreaterThan(0);
  expect(screen.queryByText("Required ESP: 0.0000 in-wg")).toBeNull();
  expect(screen.getByText("Vacant opposed connector needs a join ruling")).toBeTruthy();
  expect(screen.getByText("Preview the connector pair", { exact: false })).toBeTruthy();
  expect(screen.getByText("confirmed terminal slot")).toBeTruthy();
  expect(screen.getByText("friction · galvanized")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Inspect supply path 0" }));
  expect(pickPath).toHaveBeenCalledWith("0");
  fireEvent.click(screen.getAllByRole("button", { name: "14122436" })[0]!);
  expect(select).toHaveBeenCalledWith(14122436);
});

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
test("basis-bound legs returning 409 refresh the overview and discard old details", async () => {
  const requests: Record<string, unknown>[] = [];
  vi.mocked(hostFetch).mockImplementation(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (url.endsWith("roster")) return json(fixture.roster);
    if (!body.detail)
      return json({
        ...fixture.overview,
        basis: requests.length > 4 ? "fresh-basis" : fixture.overview.basis,
      });
    if (body.detail.kind === "legs") return new Response("stale", { status: 409 });
    return json(body.detail.kind === "inputs" ? fixture.inputs : fixture.elements);
  });
  const { result } = renderHook(() => useSheet(roster.target));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(() => result.current.compute(roster.rows[0]!));
  expect(result.current.sheet?.inputs?.blockers).toHaveLength(1);
  await act(() => result.current.pickPath("0"));
  const legRequest = requests.find(
    (request) => (request.detail as { kind?: string } | undefined)?.kind === "legs",
  );
  expect(legRequest?.basis).toBe(fixture.overview.basis);
  expect(result.current.sheet?.overview.basis).toBe("fresh-basis");
  expect(result.current.sheet?.inputs).toBeNull();
  expect(result.current.sheet?.legs).toBeNull();
  expect(result.current.error).toContain("Overview refreshed");
});

test("compute all is sequential and cancellation aborts the current request without starting another fan", async () => {
  let resolveFan: ((response: Response) => void) | undefined;
  let currentSignal: AbortSignal | undefined;
  let fanReads = 0;
  vi.mocked(hostFetch).mockImplementation(async (url, init) => {
    if (url.endsWith("roster")) return json(fixture.roster);
    fanReads++;
    currentSignal = init?.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      resolveFan = resolve;
    });
  });
  const { result } = renderHook(() => useSheet(roster.target));
  await waitFor(() => expect(result.current.loading).toBe(false));
  let batch: Promise<void>;
  act(() => {
    batch = result.current.computeAll();
  });
  expect(fanReads).toBe(1);
  expect(result.current.progress?.total).toBe(3);
  act(() => result.current.cancel());
  expect(currentSignal?.aborted).toBe(true);
  await act(async () => {
    resolveFan!(json(fixture.overview));
    await batch!;
  });
  expect(fanReads).toBe(1);
  expect(result.current.progress?.stopped).toBe(true);
  expect(result.current.progress?.done).toBe(0);
  expect(result.current.rows[0]?.blockerCount).toBe(1);
});
