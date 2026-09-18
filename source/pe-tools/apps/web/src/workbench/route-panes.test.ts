import { describe, expect, it } from "vite-plus/test";

import { CHAT_PLUGIN_ROUTES } from "./route-chat-plugins";
import { ROUTE_PANE_ROUTES, selectRoutePane } from "./route-panes";

describe("route pane registry", () => {
  it("has exactly one in-realm pane for every chat plugin route", () => {
    expect([...ROUTE_PANE_ROUTES].sort()).toEqual([...CHAT_PLUGIN_ROUTES].sort());
    for (const route of CHAT_PLUGIN_ROUTES) expect(selectRoutePane(route)).toBeTypeOf("function");
  });
});
