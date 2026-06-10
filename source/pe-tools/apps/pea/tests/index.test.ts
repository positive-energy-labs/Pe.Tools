import { expect, test } from "vite-plus/test";
import { createRuntimeAcpCliOptions, createRuntimeAgUiCliOptions } from "@pe/runtime";
import {
  createPeaCliCommand,
  defaultPeaRuntimeToolCatalog,
  defaultPeaRuntimeToolProfile,
  getPeaCliCommandNames,
} from "../src/index.ts";
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

test("pea exports the product tool profile used by the default runtime", () => {
  expect(defaultPeaRuntimeToolProfile.id).toBe("pea-product");
  expect(
    [...defaultPeaRuntimeToolCatalog.keys()].sort((left, right) => left.localeCompare(right)),
  ).toEqual([
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

test("pea root command exposes runtime protocol flags", () => {
  expect(Object.keys(createPeaCliCommand().args ?? {})).toEqual(
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

test("pea runtime protocol CLI values map to nested transport options", () => {
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
