// @vitest-environment jsdom
/** The fan sheet's data hook against a faked host: basis 409s, sequential compute-all, recompute. */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsRosterResponseSchema } from "@pe/agent-contracts";
import fixture from "./sheet.fixture.json";
import { useSheet } from "./use-sheet";
import { hostFetch } from "#/host/runtime";

vi.mock("#/host/runtime", () => ({ hostFetch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const roster = ductsRosterResponseSchema.parse(fixture.roster);

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
    if (body.detail.kind === "legs") return Response.json(
        {
          error: {
            code: "bridge",
            message: "Stale sheet basis; read a new overview before using detail handles",
          },
        },
        { status: 409 },
      );
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


test("input recomputation writes the current fan and updates assumed roster ESP", async () => {
  const requests: Record<string, unknown>[] = [];
  vi.mocked(hostFetch).mockImplementation(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (url.endsWith("roster")) return json(fixture.roster);
    if (body.detail)
      return json({
        ...(body.detail.kind === "inputs" ? fixture.inputs : fixture.elements),
        basis: body.basis,
      });
    return json(
      body.inputs
        ? {
            ...fixture.overview,
            basis: "recomputed",
            totals: { ...fixture.overview.totals, requiredEspAssumedInWg: 0.42 },
          }
        : fixture.overview,
    );
  });
  const { result } = renderHook(() => useSheet(roster.target));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(() => result.current.compute(roster.rows[0]!));
  await act(() => result.current.changeInputs({ splitPolicy: "proportional" }));
  expect(requests).toContainEqual({
    target: roster.target,
    mode: "fan",
    unitId: 14577391,
    portIndex: 2,
    inputs: { splitPolicy: "proportional" },
  });
  expect(result.current.rows[0]?.requiredEspAssumedInWg).toBe(0.42);
  expect(result.current.sheet?.overview.basis).toBe("recomputed");
  expect(result.current.error).toBeNull();
});

