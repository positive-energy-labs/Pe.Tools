// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

const callHostRpc = vi.hoisted(() => vi.fn());
const useHostOp = vi.hoisted(() => vi.fn());
vi.mock("#/host/client", () => ({ callHostRpc }));
vi.mock("#/host/queries", () => ({ useHostOp }));

import { DataTablesRoute, dataTablesSearch } from "./data-tables";

afterEach(cleanup);

test("renders and edits the selected fixture without crossing the Host boundary", () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  expect(dataTablesSearch({ source: "fixture" })).toEqual({ source: "fixture" });
  expect(dataTablesSearch({ source: "Fixture" })).toEqual({ source: undefined });
  expect(dataTablesSearch({ source: "fixture " })).toEqual({ source: undefined });

  render(<DataTablesRoute source="fixture" />);

  expect(screen.getByText("tables · 2")).toBeTruthy();
  expect(screen.getByDisplayValue("Air Terminal Schedule")).toBeTruthy();
  expect(screen.getByDisplayValue("SA-101")).toBeTruthy();
  expect(screen.getAllByText("6×6")).toHaveLength(2);

  fireEvent.change(screen.getByDisplayValue("SA-101"), { target: { value: "SA-101A" } });
  expect(screen.getByDisplayValue("SA-101A")).toBeTruthy();

  const apply = screen.getByRole("button", { name: "apply to revit" }) as HTMLButtonElement;
  expect(apply.disabled).toBe(true);
  fireEvent.click(apply);
  expect(useHostOp).not.toHaveBeenCalled();
  expect(callHostRpc).not.toHaveBeenCalled();
});
