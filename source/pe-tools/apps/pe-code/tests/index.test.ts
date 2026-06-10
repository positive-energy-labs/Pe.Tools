import { expect, test } from "vite-plus/test";
import { defaultPeCodeRuntimeToolCatalog, getPeCodeCliCommandNames } from "../src/index.ts";
import { createPeCodeRuntimeAuthProfile } from "../src/runtime.ts";

test("pe-code composes dev commands", () => {
  expect(getPeCodeCliCommandNames()).toEqual(
    expect.arrayContaining(["live", "script", "talk-to-pea"]),
  );
});

test("pe-code keeps configurable local model auth by default", () => {
  const auth = createPeCodeRuntimeAuthProfile();

  expect(auth.descriptor.source).toBe("auto");
  expect(auth.descriptor.methods.map((method) => method.id)).toEqual(["openai-api-key"]);
});

test("pe-code default catalog includes Pea product and dev tool ids", () => {
  expect([...defaultPeCodeRuntimeToolCatalog.keys()].sort()).toEqual([
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
