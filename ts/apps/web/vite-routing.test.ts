import { actionControls } from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";
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
