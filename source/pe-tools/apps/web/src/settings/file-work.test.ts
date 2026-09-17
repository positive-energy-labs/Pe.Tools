import { expect, test } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fileAddressSearch, fileSearch } from "#/settings/file-workspace";

const id = (file: string) => ({
  moduleKey: "FamilyFoundry",
  rootKey: "models",
  relativePath: file,
});

// The two-pane sharing test that lived here is deleted: `createFamilyStore`'s injected registry,
// slices, host and writers are gone — the Family page is `useFamilyStore` over `useRoute` and the
// Pane independence is `useState` per hook; the route owner shares the keyed Work reading.

test("router navigation, back, and reload retain the selected file address", async () => {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/family",
    validateSearch: fileSearch,
  });
  const history = createMemoryHistory({
    initialEntries: ["/family?mode=file&module=FamilyFoundry&root=models&file=a.json"],
  });
  const router = createRouter({ routeTree: root.addChildren([route]), history });
  await router.load();
  await router.navigate({ to: "/family", search: fileAddressSearch({}, id("b.json")) });
  expect(router.state.location.search).toMatchObject({ file: "b.json" });
  history.back();
  await router.load();
  expect(router.state.location.search).toMatchObject({ file: "a.json", mode: "file" });
  const reload = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [router.state.location.href] }),
  });
  await reload.load();
  expect(reload.state.location.search).toMatchObject({
    file: "a.json",
    module: "FamilyFoundry",
    root: "models",
  });
});
