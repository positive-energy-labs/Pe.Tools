import { expect, test } from "vite-plus/test";
import { filterItems } from "@pe/kit/lang/collection";
import { destinationDetail, destinationLabel, globalItems } from "./global-items";
import { matches } from "./model";

test("global navigation includes Machine without adding it to the engineering directory", () => {
  const items = globalItems(null, "Tools");
  expect(items.find((item) => item.url === "/machine")?.label).toBe("Machine");
  expect(items.find((item) => item.url === "/settings")?.label).toBe("Settings");
  expect(globalItems(null, "Pea threads")).toEqual([]);
});

test("global thread search matches full and partial ID while retaining human title and aliases", () => {
  const id = "019c6e27-e55b-73d1-87d8-4e01f1f75043";
  const [item] = globalItems(
    {
      observedAt: "2026-10-13T00:00:00Z",
      works: [],
      threads: [
        {
          id,
          route: "chat",
          revision: null,
          label: "A renamed conversation",
          context: "Engineering",
          state: "Ready",
          url: `/pea?thread=${id}`,
          reason: null,
        },
      ],
      observations: [],
      truncated: false,
    },
    "Pea threads",
  );
  const searchText = `${item!.label} ${item!.context} ${item!.aliases} ${item!.state}`;
  expect(matches(searchText, id)).toBe(true);
  expect(matches(searchText, "E55B-73D1")).toBe(true);
  expect(matches(searchText, "renamed conversation")).toBe(true);
  expect(matches(searchText, "pea chat")).toBe(true);
  expect(item!.url).toBe(`/pea?thread=${id}`);
});

test('"duct" finds Duct Loss first and no tool that only scatters its letters', () => {
  const hits = filterItems(
    globalItems(null, "Tools"),
    destinationLabel,
    "words",
    "duct",
    destinationDetail,
  ).map((tool) => tool.label);
  expect(hits[0]).toBe("Duct Loss");
  for (const stray of ["Schedules", "Data Tables", "Doc Lab", "Parameter Tables", "Design System"])
    expect(hits).not.toContain(stray);
  expect(hits).toEqual(["Duct Loss"]);
});
