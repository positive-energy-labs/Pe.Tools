import type { RuntimeToolCatalog, RuntimeToolKind } from "@pe/agent-contracts";

const kinds = {
  pe_status: "read",
  pe_logs: "read",
  host_operation_search: "read",
  host_operation_call: "execute",
  request_access: "edit",
  read_image: "read",
  capture_view: "read",
  revit_api_docs_search: "read",
  revit_api_docs_fetch: "read",
  script_bootstrap: "edit",
  script_execute: "execute",
  route_state_read: "read",
  route_state_apply: "edit",
  route_command: "execute",
} as const satisfies Record<string, RuntimeToolKind>;

export const peaProductToolCatalog: RuntimeToolCatalog = new Map(
  Object.entries(kinds).map(([name, kind]) => [name, { name, kind }]),
);
