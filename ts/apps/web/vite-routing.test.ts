import { expect, test, vi } from "vite-plus/test";
import { actionControls } from "@pe/agent-contracts";
import config from "./vite.config";
import { devHostProxy } from "./dev-proxy";
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
test("explicit dev proxy routes action/Family APIs and leaves page/foreign paths alone", async () => {
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://explicit-host:8123");
  const read = () => (config as Function)({ command: "serve", mode: "test" });
  try {
    const configured = await read();
    const proxies = configured.server.proxy;
    const keys = Object.keys(proxies).filter((key) => key.startsWith("^"));
    const matches = (path: string) => keys.filter((key) => new RegExp(key).test(path));
    for (const path of [
      "/actions",
      "/actions?id=original",
      "/actions/recover",
      "/actions/resume?x=1",
      "/family/readings",
      "/family/readings?id=capture",
      "/families/readings",
      "/families/readings?work=scope",
    ]) {
      expect(matches(path), path).toHaveLength(1);
      expect(proxies[matches(path)[0]].target).toBe("http://explicit-host:8123");
    }
    for (const path of [
      "/family",
      "/family?mode=file",
      "/family/readings-other",
      "/family/readings/foreign",
      "/families/readings-other",
      "/actions-extra",
      "/actions/foreign",
      "/else/actions",
    ])
      expect(matches(path), path).toEqual([]);
    vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "");
    expect((await read()).server.proxy).toBeUndefined();
  } finally {
    vi.unstubAllEnvs();
  }
});
