import { expect, test } from "vite-plus/test";
import { defaultPeaRuntimeToolCatalog, getPeaCliCommandNames } from "../src/index.ts";
import { createPeaRuntimeAuthProfile } from "../src/runtime.ts";

test("pea composes product commands without dev", () => {
  expect(getPeaCliCommandNames()).toEqual(expect.arrayContaining(["host", "script"]));
  expect(getPeaCliCommandNames()).not.toContain("dev");
});

test("pea defaults to Pea Cloud Gateway auth", () => {
  const auth = createPeaRuntimeAuthProfile();

  expect(auth.descriptor.source).toBe("gateway");
  expect(auth.descriptor.methods.map((method) => method.id)).toEqual(["pea-cloud-gateway"]);
});

test("pea exports the product tool catalog used by the default runtime", () => {
  expect([...defaultPeaRuntimeToolCatalog.keys()].sort()).toEqual([
    "host_operation_call",
    "host_operation_search",
    "pe_logs",
    "pe_status",
    "request_access",
    "script_bootstrap",
    "script_execute",
    "script_pod_export",
    "script_pod_import",
  ]);
});
