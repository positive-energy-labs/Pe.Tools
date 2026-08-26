import { expect, test } from "vite-plus/test";
import { peaProductToolMetadata, peaProductTools } from "../src/index.ts";

test("Pea metadata marks the exact seven Revit-required tools", () => {
  const requiresRevit = Object.entries(peaProductToolMetadata)
    .filter(([, metadata]) => metadata.requiresRevit)
    .map(([name]) => name);
  const noRevit = Object.entries(peaProductToolMetadata)
    .filter(([, metadata]) => !metadata.requiresRevit)
    .map(([name]) => name);

  expect(Object.keys(peaProductTools)).toHaveLength(14);
  expect(requiresRevit).toEqual([
    "pe_status",
    "pe_logs",
    "host_operation_search",
    "host_operation_call",
    "capture_view",
    "script_bootstrap",
    "script_execute",
  ]);
  expect(noRevit).toEqual([
    "request_access",
    "read_image",
    "revit_api_docs_search",
    "revit_api_docs_fetch",
    "route_state_read",
    "route_state_apply",
    "route_command",
  ]);
});
