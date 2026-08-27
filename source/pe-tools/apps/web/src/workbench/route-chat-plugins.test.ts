import { expect, test } from "vite-plus/test";
import { selectRouteChatPlugin } from "./route-chat-plugins.tsx";

test("route chat plugins select registered routes for only the three route tools", () => {
  for (const toolName of ["route_state_read", "route_state_apply", "route_command"]) {
    expect(selectRouteChatPlugin(toolName, { route: "parameter-links" })?.spec.route).toBe(
      "parameter-links",
    );
    expect(selectRouteChatPlugin(toolName, { route: "family-types" })?.spec.route).toBe(
      "family-types",
    );
  }
});

test("route chat plugins ignore unregistered routes, other tools, and non-args routes", () => {
  expect(selectRouteChatPlugin("host_operation_call", { route: "parameter-links" })).toBeNull();
  expect(selectRouteChatPlugin("route_state_read", {})).toBeNull();
  expect(selectRouteChatPlugin("route_state_read", { route: "other" })).toBeNull();
  expect(selectRouteChatPlugin("route_state_read", null)).toBeNull();
});
