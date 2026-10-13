import { expect, test } from "vite-plus/test";
import { globalItems } from "./global-items";

test("global navigation includes Machine without adding it to the engineering directory", () => {
  const items = globalItems(null, "Tools");
  expect(items.find((item) => item.url === "/machine")?.label).toBe("Machine");
  expect(items.find((item) => item.url === "/settings")?.label).toBe("Settings");
  expect(globalItems(null, "Pea threads")).toEqual([]);
});
