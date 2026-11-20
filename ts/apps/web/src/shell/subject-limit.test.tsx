// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { stableFanKey } from "@pe/ducts-web/calc/model";
import { z } from "zod";
import { systemCode } from "@pe/ducts-web/identity";
import { fansCalcData, FAN_DETAIL_LIMIT, fanDetailLimitMessage } from "@pe/fans-contract/fans-read";
import {
  ductsPricingData,
  ductsOverviewData,
  DUCTS_DETAIL_LIMIT,
  ductDetailLimitMessage,
} from "@pe/duct-systems-contract/ducts-read";
import { module as fans } from "../../../../products/fans/web/route.ts";
import { module as ducts } from "../../../../products/duct-systems/web/route.ts";
import { StandaloneBand } from "./band.test-support.tsx";
import { mountTypedRoute, typedSubjectDoor } from "./typed-mount.ts";
import { admittedRouterAddress } from "./typed-place-boundary.tsx";
import { placeInput } from "./typed-place.test-support.ts";
import { TypedChrome } from "./typed-shell.tsx";

const products = [
  {
    route: fans,
    field: "fan",
    list: "fans",
    limit: FAN_DETAIL_LIMIT,
    message: fanDetailLimitMessage,
    coreArgs: { fan: [] },
    roster(data: unknown, size: number) {
      const base = fansCalcData.parse(data);
      const rows = Array.from({ length: size }, (_, i) => ({
        ...base.rows[0]!,
        portIndex: i,
        mark: `Port ${i}`,
      }));
      return { data: { ...base, rows }, ids: rows.map(stableFanKey) };
    },
  },
  {
    route: ducts,
    field: "system",
    list: "systems",
    limit: DUCTS_DETAIL_LIMIT,
    message: ductDetailLimitMessage,
    coreArgs: { system: [] },
    roster(data: unknown, size: number) {
      const base = ductsOverviewData.parse(data);
      const names = Array.from({ length: size }, (_, i) => `System ${i}`);
      const rows = names.map((name) => ({ ...base.rows[0]!, name, key: name }));
      return { data: { ...base, rows }, ids: names.map(systemCode) };
    },
  },
];

const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  closes.splice(0).forEach((close) => close());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function arrive(product: (typeof products)[number], size: number, choice?: "ids" | "all") {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("Fixture called the host");
    }),
  );
  const { route, field } = product;
  const core = route.spec.core!;
  const roster = route.spec.subject!.read!;
  const network = product.field === "system" ? ducts.spec.reads?.network : undefined;
  const walk = network ? vi.spyOn(network.source, "provide") : undefined;
  const rosterPacket = await roster.source.provide!(
    "layout",
    roster.input.parse(product.field === "fan" ? { fan: [] } : {}),
  );
  const batch = product.roster(rosterPacket.value!.data, size);
  vi.spyOn(roster.source, "provide").mockResolvedValue({
    ...rosterPacket,
    value: { ...rosterPacket.value!, data: batch.data },
  });
  const corePacket = await core.source.provide!("layout", product.coreArgs);
  const pricing =
    product.field === "system" ? ductsPricingData.parse(corePacket.value!.data) : null;
  const coreData = pricing
    ? {
        ...pricing,
        analysis: { ...pricing.analysis, systems: ductsOverviewData.parse(batch.data).rows },
      }
    : { ...fansCalcData.parse(corePacket.value!.data), rows: fansCalcData.parse(batch.data).rows };
  const acquire = vi.spyOn(core.source, "provide").mockResolvedValue({
    ...corePacket,
    value: { ...corePacket.value!, data: coreData },
  });
  const search = new URLSearchParams({ fixture: "layout" });
  if (choice)
    search.set(
      field,
      JSON.stringify(
        choice === "all"
          ? { kind: "all" }
          : {
              kind: "ids",
              ids: batch.ids,
              active: batch.ids.at(-1),
            },
      ),
    );
  const history = createMemoryHistory({ initialEntries: [`/${route.spec.key}?${search}`] });
  const address = admittedRouterAddress(history);
  const mount = mountTypedRoute(
    route,
    placeInput(address, {
      target: { kind: "document", ref: { session: "fixture", openId: "clinic" } },
    }),
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
  );
  closes.push(mount.dispose);
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <StandaloneBand>
          <TypedChrome mount={mount} document={<span>Fixture</span>} />
        </StandaloneBand>
      ),
    }),
    history,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("listbox", { name: product.list });
  return { mount, address, acquire, walk, ids: batch.ids };
}

test.each(products)(
  "$list refuses an extra row without losing or reacquiring the batch",
  async (product) => {
    const { mount, address, acquire, walk, ids } = await arrive(product, product.limit + 1);
    const batch = ids.slice(0, product.limit);
    act(() => typedSubjectDoor(mount)?.select(batch));
    await waitFor(() => expect(mount.value().state).toBe("ready"));
    const ready = mount.value();
    const search = address.read().toString();
    acquire.mockClear();
    walk?.mockClear();
    const extra = () =>
      within(screen.getByRole("listbox", { name: product.list })).getByRole("option", {
        name: new RegExp(`(?:Port|System) ${product.limit}\\b`, "i"),
      });
    fireEvent.click(extra());
    expect(mount.page.read()[product.field]).toEqual({ kind: "ids", ids: batch });
    expect(address.read().toString()).toBe(search);
    expect(mount.value()).toBe(ready);
    expect(acquire).not.toHaveBeenCalled();
    expect(walk?.mock.calls.length ?? 0).toBe(0);
    expect(typedSubjectDoor(mount)?.toggleRefusal(ids.at(-1))).toBe(product.message);
    await waitFor(() =>
      expect(extra().getAttribute("aria-disabled"), extra().outerHTML).toBe("true"),
    );
    expect(extra().getAttribute("aria-description")).toBe(product.message);
    expect(screen.getByText(new RegExp(`/ ${product.limit} open`))).toBeTruthy();
    const over = address.read();
    over.set(product.field, JSON.stringify({ kind: "ids", ids }));
    act(() => address.write(over, "push"));
    await waitFor(() => expect(address.read().toString()).toBe(search));
    expect(mount.value()).toBe(ready);
    expect(acquire).not.toHaveBeenCalled();
    expect(walk?.mock.calls.length ?? 0).toBe(0);
    act(() => typedSubjectDoor(mount)?.toggle(batch[0]));
    expect(mount.page.read()[product.field]).toEqual({ kind: "ids", ids: batch.slice(1) });
  },
);

test.each(
  products.flatMap((product) =>
    (["ids", "all"] as const)
      .filter((choice) => choice === "ids")
      .map((choice) => ({ product, choice, list: product.list })),
  ),
)(
  "$list opens only the first allowed batch from an oversized $choice address",
  async ({ product, choice }) => {
    const { mount, address, acquire, ids } = await arrive(product, product.limit + 1, choice);
    const expected = { kind: "ids", ids: ids.slice(0, product.limit) };
    await waitFor(() => expect(address.read().get(product.field)).toBe(JSON.stringify(expected)));
    expect(mount.page.read()[product.field]).toEqual(expected);
    const readSelections = acquire.mock.calls.map(
      ([, args]) => z.record(z.string(), z.unknown()).parse(args)[product.field],
    );
    expect(readSelections.length).toBeGreaterThan(0);
    expect(readSelections.at(-1)).toHaveLength(product.limit);
    expect(
      readSelections.every((value) => Array.isArray(value) && value.length <= product.limit),
    ).toBe(true);
    expect((await screen.findByRole("status", { name: "Subject limit" })).textContent).toBe(
      product.message,
    );
    const value = { kind: "ids", ids };
    const intent = mount.attention.read({ [product.field]: JSON.stringify(value) });
    act(() => {
      mount.move(intent, "push");
    });
    expect(mount.attention.write(intent)[product.field]).toBe(JSON.stringify(expected));
    expect(mount.page.read()[product.field]).toEqual(expected);
    expect(acquire).toHaveBeenCalledTimes(readSelections.length);
  },
);

test.each(products.filter((p) => p.field === "fan"))(
  "$list All opens a roster at its limit",
  async (product) => {
    const { mount, acquire } = await arrive(product, product.limit);
    const button = screen.getByRole("button", { name: `All ${product.list}` });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(button);
    await waitFor(() => expect(mount.value().state).toBe("ready"));
    expect(mount.page.read()[product.field]).toEqual({ kind: "all" });
    expect(acquire).toHaveBeenLastCalledWith(
      "layout",
      expect.objectContaining({ [product.field]: "all" }),
    );
    expect(
      within(screen.getByRole("listbox", { name: product.list })).getByRole("option", {
        name: /Port 0/,
      }),
    ).toBeTruthy();
    expect(screen.getByText(`${product.limit} fan ports / 0 open`)).toBeTruthy();
  },
);

test("Fans All keeps a large overview and opens a single worksheet on row selection", async () => {
  const product = products[0]!;
  const { mount, acquire, ids } = await arrive(product, 112);
  const all = screen.getByRole("button", { name: "All fans" });
  expect(all.getAttribute("aria-disabled")).not.toBe("true");
  fireEvent.click(all);
  await waitFor(() => expect(mount.value().state).toBe("ready"));
  expect(mount.page.read().fan).toEqual({ kind: "all" });
  expect(acquire).toHaveBeenLastCalledWith("layout", expect.objectContaining({ fan: "all" }));
  act(() => typedSubjectDoor(mount)?.toggle(ids[0]));
  await waitFor(() => expect(mount.value().state).toBe("ready"));
  expect(mount.page.read().fan).toEqual({ kind: "ids", ids: [ids[0]] });
  expect(acquire).toHaveBeenLastCalledWith("layout", expect.objectContaining({ fan: [ids[0]] }));
});

test("All admits a roster beyond the detail limit and opens detail only for the system picked", async () => {
  const product = products[1];
  if (!product) throw Error("No Duct Systems fixture");
  const { mount, acquire, walk } = await arrive(product, DUCTS_DETAIL_LIMIT + 1, "all");
  expect(mount.page.read().system).toEqual({ kind: "all" });
  expect(acquire).toHaveBeenLastCalledWith("layout", { system: [], fan: null });
  expect(
    walk?.mock.calls.every(([, args]) => JSON.stringify(args) === '{"system":[],"fan":null}'),
  ).toBe(true);
  const list = screen.getByRole("listbox", { name: "systems" });
  const row = list.querySelector<HTMLElement>("[data-key]");
  const name = row?.dataset.key;
  if (!row || !name) throw Error("The All overview shows no selectable row");
  fireEvent.click(row);
  await waitFor(() =>
    expect(mount.page.read().system).toEqual({ kind: "ids", ids: [systemCode(name)] }),
  );
  await waitFor(() =>
    expect(acquire).toHaveBeenLastCalledWith("layout", { system: [name], fan: null }),
  );
});
