import { actionControls } from "@pe/agent-contracts";
import { expect, test, vi } from "vite-plus/test";
import { checkoutServiceName, devHostProxy } from "./dev-proxy";
import config from "./vite.config";

test("served web binds checkout identity while distributable web binds installed identity", async () => {
  const read = (command: string) => (config as Function)({ command, mode: "test" });
  expect((await read("serve")).define["import.meta.env.PE_RUNTIME_SERVICE"]).toBe(
    JSON.stringify(checkoutServiceName()),
  );
  expect((await read("build")).define["import.meta.env.PE_RUNTIME_SERVICE"]).toBe(
    JSON.stringify("host"),
  );
});

test("borrowed production bundles retain the explicit host owner for preview", async () => {
  const { checkoutRoot } = await import("./checkout-paths");
  try {
    vi.stubEnv("PE_WEB_READ_HOST_CHECKOUT", checkoutRoot);
    vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:12345");
    const built = await (config as Function)({ command: "build", mode: "production" });
    expect(built.define["import.meta.env.PE_RUNTIME_SERVICE"]).toBe(
      JSON.stringify(checkoutServiceName()),
    );
    expect(built.define["import.meta.env.PE_RUNTIME_ORIGIN"]).toBe(
      JSON.stringify("http://127.0.0.1:12345"),
    );
    expect(
      built.plugins.find((plugin: { name?: string }) => plugin?.name === "pe:checkout-ingress")
        .configurePreviewServer,
    ).toBeTypeOf("function");
  } finally {
    vi.unstubAllEnvs();
  }
});
test("the dev proxy forwards every host action-control route", () => {
  // The host mounts POST /actions/<verb> for each control but action.read (GET /actions).
  // w8-revit: /actions/cancel was missing here and the stop control 404'd in dev.
  const keys = Object.keys(devHostProxy("http://host"));
  for (const key of Object.keys(actionControls)) {
    const path = key === "action.read" ? "/actions" : `/actions/${key.slice("action.".length)}`;
    expect(
      keys.filter((pattern) => new RegExp(pattern).test(path)),
      path,
    ).toHaveLength(1);
  }
});
