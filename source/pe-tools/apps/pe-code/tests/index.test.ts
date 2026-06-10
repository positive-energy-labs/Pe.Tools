import { expect, test } from "vite-plus/test";
import { createRuntimeAcpCliOptions, createRuntimeAgUiCliOptions } from "@pe/runtime";
import {
  createPeCodeCliCommand,
  defaultPeCodeRuntimeToolCatalog,
  defaultPeCodeRuntimeToolProfile,
  getPeCodeCliCommandNames,
} from "../src/index.ts";
import { createPeCodeRuntimeAuthProfile } from "../src/runtime.ts";

test("peco composes dev commands", () => {
  expect(getPeCodeCliCommandNames()).toEqual(
    expect.arrayContaining(["live", "script", "talk-to-pea"]),
  );
});

test("peco keeps configurable local model auth by default", () => {
  const auth = createPeCodeRuntimeAuthProfile();

  expect(auth.descriptor.source).toBe("auto");
  expect(auth.descriptor.methods.map((method) => method.id)).toEqual(["openai-api-key"]);
});

test("peco default profile includes Pea product and dev tool ids", () => {
  expect(defaultPeCodeRuntimeToolProfile.id).toBe("peco");
  expect(
    [...defaultPeCodeRuntimeToolCatalog.keys()].sort((left, right) => left.localeCompare(right)),
  ).toEqual([
    "host_operation_call",
    "host_operation_search",
    "live_loop_context",
    "live_rrd_restart",
    "live_rrd_sync",
    "pe_logs",
    "pe_status",
    "request_access",
    "script_bootstrap",
    "script_execute",
    "script_pod_export",
    "script_pod_import",
    "talk_to_pea",
    "test",
  ]);
});

test("peco root command exposes runtime protocol flags", () => {
  expect(Object.keys(createPeCodeCliCommand().args ?? {})).toEqual(
    expect.arrayContaining([
      "acp",
      "acpTransport",
      "acpPort",
      "acpToken",
      "agUi",
      "agUiPort",
      "agUiToken",
    ]),
  );
});

test("peco runtime protocol CLI values map to nested transport options", () => {
  expect(
    createRuntimeAcpCliOptions(
      { acp: true, acpTransport: "http", acpPort: "43111", acpToken: "t" },
      {},
    ),
  ).toEqual({ protocolTransport: "http", transport: { port: 43111, token: "t" } });
  expect(
    createRuntimeAgUiCliOptions({ agUi: true, agUiPort: "43112", agUiToken: "t" }, {}),
  ).toEqual({ transport: { port: 43112, token: "t" } });
});
