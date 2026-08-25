import { expect, test } from "vite-plus/test";

import { createRouteRegistrations } from "../src/pea/routes.ts";

test("route registry lists takeoffs", () => {
  expect(
    createRouteRegistrations({ hostBaseUrl: "http://127.0.0.1:1" }).map(
      (entry) => entry.spec.route,
    ),
  ).toContain("takeoffs");
});
