import { expect, test, vi } from "vite-plus/test";
vi.mock("#/pages-bind/picker", () => ({ BindRoute: () => null }));
import { Route } from "./bind";

test("the bind manifest preserves Page viewing links and defaults to the binding picker", () => {
  const read = Route.options.validateSearch as (search: Record<string, unknown>) => unknown;
  for (const view of ["1", 1, true])
    expect(read({ page: "snowdon-circuits--tour", view })).toEqual({
      page: "snowdon-circuits--tour",
      view: true,
    });
  expect(read({ page: "snowdon-ducts--tour" })).toEqual({
    page: "snowdon-ducts--tour",
    view: false,
  });
  expect(read({ view: "0" })).toEqual({ page: "", view: false });
});
