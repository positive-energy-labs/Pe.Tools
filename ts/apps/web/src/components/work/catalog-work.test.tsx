// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const sealed = { previewOnly: true, derivedRequest: {}, seal: { requestHash: "h", work: {}, documentMark: { session: "s", openId: "o", observedSince: null, changedAt: null }, incarnation: {}, dependencies: "d" } };

test("a Page-less owner shows its staged cells with authors and plans then applies through the generated pair", async () => {
  const sent: ActionAdmission[] = [];
  const client: CatalogWorkClient = {
    read: vi.fn(async () => ({ doc, handle: workHandle(at as never, 4) })),
    submit: vi.fn(async (admission) => {
      sent.push(admission);
      return { id: admission.id, state: "succeeded", result: sealed } as never;
    }),
  };
  render(<CatalogWorkReview owner="data-tables" at={at as never} target={target} client={client} />);
  await screen.findByText(/r4 · 3 staged/);
  expect(document.querySelector('[data-catalog-cell="columns/text:0"] [data-catalog-author]')?.textContent).toBe("human");
  fireEvent.click(screen.getByRole("button", { name: /plan data-tables/ }));
  await waitFor(() => expect(document.querySelector("[data-write-action=armed]")).not.toBeNull());
  expect(sent.map((a) => [a.key, a.input])).toEqual([["data-table.apply.preview", { work: workHandle(at as never, 4) }]]);
  // Before is the model's and unread here: the popover says unknown, never a guess.
  expect(document.querySelectorAll("[data-write-cell]").length).toBe(3);
  fireEvent.click(screen.getByRole("button", { name: /apply data-tables/ }));
  await waitFor(() => expect(sent.at(-1)?.key).toBe("data-table.apply"));
});

test("nothing staged refuses the plan and sends nothing", async () => {
  const client: CatalogWorkClient = {
    read: async () => ({ doc: {}, handle: workHandle(at as never, 0) }),
    submit: vi.fn(),
  };
  render(<CatalogWorkReview owner="data-tables" at={at as never} target={target} client={client} />);
  await screen.findByText(/r0 · 0 staged/);
  fireEvent.click(screen.getByRole("button", { name: /plan data-tables/ }));
  expect(client.submit).not.toHaveBeenCalled();
});
