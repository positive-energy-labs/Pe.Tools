// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { workHandle, type ActionAdmission } from "@pe/agent-contracts";
import { CatalogWorkReview, type CatalogWorkClient } from "./catalog-work";

afterEach(cleanup);

const at = { binding: "address" as const, target: "c:\\models\\a.rvt", route: "data-tables" };
const target = { session: "s", openId: "o" };
const doc = {
  name: { edit: { value: "T", by: "pea" } },
  columns: { "text:0": { edit: { value: "A", by: "human" } } },
  rows: { r1: { "text:0": { edit: { value: "a1", by: "pea" } } } },
};
const sealed = {
  previewOnly: true,
  derivedRequest: {},
  seal: {
    requestHash: "h",
    work: {},
    documentMark: { session: "s", openId: "o", observedSince: null, changedAt: null },
    incarnation: {},
    dependencies: "d",
  },
};

test("a Page-less owner shows its staged cells with authors and plans then applies through the generated pair", async () => {
  const sent: ActionAdmission[] = [];
  const client: CatalogWorkClient = {
    watch: (_key, receive) => {
      receive({ doc, handle: workHandle(at as never, 4) });
      return () => {};
    },
    write: vi.fn(async () => null),
    submit: vi.fn(async (admission) => {
      sent.push(admission);
      return { id: admission.id, state: "succeeded", result: sealed } as never;
    }),
  };
  render(
    <CatalogWorkReview owner="data-tables" at={at as never} target={target} client={client} />,
  );
  await screen.findByText(/r4 · 3 staged/);
  expect(
    document
      .querySelector('[data-catalog-cell="columns/text:0"] [data-catalog-author]')
      ?.getAttribute("data-catalog-author"),
  ).toBe("human");
  fireEvent.click(screen.getByRole("button", { name: /plan data-tables/ }));
  await waitFor(() => expect(document.querySelector("[data-write-action=armed]")).not.toBeNull());
  expect(sent.map((a) => [a.key, a.input])).toEqual([
    ["data-table.apply.plan", { work: workHandle(at as never, 4) }],
  ]);
  // Before is the model's and unread here: the popover says unknown, never a guess.
  expect(document.querySelectorAll("[data-write-cell]").length).toBe(3);
  fireEvent.click(screen.getByRole("button", { name: /apply data-tables/ }));
  await waitFor(() => expect(sent.at(-1)?.key).toBe("data-table.apply"));
});

test("nothing staged refuses the plan and sends nothing", async () => {
  const client: CatalogWorkClient = {
    watch: (_key, receive) => {
      receive({ doc: {}, handle: workHandle(at as never, 0) });
      return () => {};
    },
    write: vi.fn(async () => null),
    submit: vi.fn(),
  };
  render(
    <CatalogWorkReview owner="data-tables" at={at as never} target={target} client={client} />,
  );
  await screen.findByText(/r0 · 0 staged/);
  fireEvent.click(screen.getByRole("button", { name: /plan data-tables/ }));
  expect(client.submit).not.toHaveBeenCalled();
});

test("a host Work update disarms the plan without reopening its review", async () => {
  let receive: Parameters<CatalogWorkClient["watch"]>[1] = () => {};
  const client: CatalogWorkClient = {
    watch: (_key, update) => {
      receive = update;
      update({ doc, handle: workHandle(at as never, 4) });
      return () => {};
    },
    write: vi.fn(async () => null),
    submit: async (admission) =>
      ({ id: admission.id, state: "succeeded", result: sealed }) as never,
  };
  render(
    <CatalogWorkReview owner="data-tables" at={at as never} target={target} client={client} />,
  );
  await screen.findByText(/r4 · 3 staged/);
  fireEvent.click(screen.getByRole("button", { name: /plan data-tables/ }));
  await waitFor(() => expect(document.querySelector("[data-write-action=armed]")).not.toBeNull());
  act(() => receive({ doc, handle: workHandle(at as never, 5) }));
  expect(document.querySelector("[data-write-action=armed]")).toBeNull();
  expect(screen.getByText(/r5 · 3 staged/)).toBeTruthy();
});

test("parameter links: the held plan shows before and after per touched id with its author, from the plan response", async () => {
  const links = { binding: "address" as const, target: "c:\models\a.rvt", route: "parameter-links" };
  const d = (name: string) => ({ sourceCategoryId: -2001040, sourceParameter: { name: "MOCP" }, relationship: "sameElement", targetParameter: { name } });
  const client: CatalogWorkClient = {
    watch: (_key, receive) => {
      receive({ doc: { definitions: { D1: { edit: { value: d("B1-new"), by: "human" } }, D3: { edit: { value: d("B3"), by: "pea" } } }, assignments: {} }, handle: workHandle(links as never, 2) });
      return () => {};
    },
    write: vi.fn(async () => null),
    submit: vi.fn(async (admission) => ({
      id: admission.id,
      state: "succeeded",
      result: {
        ...sealed,
        evidence: {
          before: { formatVersion: 1, definitions: [{ id: "D1", ...d("B1") }, { id: "D2", ...d("B2") }], assignments: [] },
          touched: [
            { path: ["definitions", "D1"], before: { id: "D1", ...d("B1") }, after: { id: "D1", ...d("B1-new") }, by: "human" },
            { path: ["definitions", "D3"], before: null, after: { id: "D3", ...d("B3") }, by: "pea" },
          ],
        },
      },
    }) as never),
  };
  render(<CatalogWorkReview owner="parameter-links" at={links as never} target={target} client={client} />);
  await screen.findByText(/r2 · 2 staged/);
  fireEvent.click(screen.getByRole("button", { name: /plan parameter-links/ }));
  await waitFor(() => expect(document.querySelector("[data-write-action=armed]")).not.toBeNull());
  const d1 = document.querySelector('[data-write-cell="definitions/D1"]')!;
  const d3 = document.querySelector('[data-write-cell="definitions/D3"]')!;
  expect(d1.querySelector("[data-write-author]")?.getAttribute("data-write-author")).toBe("human");
  expect(d3.querySelector("[data-write-author]")?.getAttribute("data-write-author")).toBe("pea");
  // A known absence, never an inferred "unknown"; the stored before is the plan's own read.
  expect(d3.textContent).toContain("(none)");
  expect(d3.textContent).not.toContain("unknown");
  expect(d1.textContent).toContain("B1-new");
  // D2 is untouched: the review names only what the plan changes.
  expect(document.querySelector('[data-write-cell="definitions/D2"]')).toBeNull();
});
