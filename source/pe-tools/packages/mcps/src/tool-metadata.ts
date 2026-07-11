import { createRuntimeToolCatalog, type RuntimeToolCatalog } from "@pe/runtime";

export const peaProductToolCatalog: RuntimeToolCatalog = createRuntimeToolCatalog({
  pe_status: {
    title: "Pe Status",
    kind: "read",
    provenance: { source: "app", label: "Pea product" },
  },
  pe_logs: {
    title: "Pe Logs",
    kind: "read",
    provenance: { source: "app", label: "Pea product" },
  },
  host_operation_search: {
    title: "Host Operation Search",
    kind: "read",
    provenance: { source: "app", label: "Pea product" },
  },
  host_operation_call: {
    title: "Host Operation Call",
    kind: "read",
    provenance: { source: "app", label: "Pea product" },
  },
  request_access: {
    title: "Request Access",
    kind: "edit",
    provenance: { source: "app", label: "Pea product" },
  },
  read_image: {
    title: "Read Image",
    kind: "read",
    provenance: { source: "app", label: "Pea product" },
  },
  capture_view: {
    title: "Capture View",
    kind: "read",
    provenance: { source: "app", label: "Pea product" },
  },
  revit_api_docs_search: {
    title: "Revit API Docs Search",
    kind: "read",
    provenance: { source: "app", label: "Pea product" },
  },
  revit_api_docs_fetch: {
    title: "Revit API Docs Fetch",
    kind: "read",
    provenance: { source: "app", label: "Pea product" },
  },
  script_bootstrap: {
    title: "Script Bootstrap",
    kind: "edit",
    provenance: { source: "app", label: "Pea product" },
  },
  script_execute: {
    title: "Script Execute",
    kind: "execute",
    provenance: { source: "app", label: "Pea product" },
  },
  family_sheet_status: {
    title: "Family Sheet Status",
    kind: "read",
    provenance: { source: "app", label: "Pea product" },
  },
  family_sheet_doc: {
    title: "Family Sheet Doc",
    kind: "read",
    provenance: { source: "app", label: "Pea product" },
  },
  family_sheet_propose: {
    title: "Family Sheet Propose",
    kind: "edit",
    provenance: { source: "app", label: "Pea product" },
  },
  family_sheet_mark: {
    title: "Family Sheet Mark",
    kind: "edit",
    provenance: { source: "app", label: "Pea product" },
  },
  family_sheet_refresh: {
    title: "Family Sheet Refresh",
    kind: "read",
    provenance: { source: "app", label: "Pea product" },
  },
  family_sheet_parse_spec: {
    title: "Family Sheet Parse Spec",
    kind: "execute",
    provenance: { source: "app", label: "Pea product" },
  },
});

export const peCodeToolCatalog: RuntimeToolCatalog = createRuntimeToolCatalog({
  live_loop_context: {
    title: "Live Loop Context",
    kind: "read",
    provenance: { source: "app", label: "peco" },
  },
  script_execute: {
    title: "Script Execute",
    kind: "execute",
    provenance: { source: "app", label: "peco" },
  },
  talk_to_pea: {
    title: "Talk To Pea",
    kind: "execute",
    provenance: { source: "app", label: "peco" },
  },
  talk_to_peco_zellij: {
    title: "Talk To Peco Zellij",
    kind: "execute",
    provenance: { source: "app", label: "peco" },
  },
});
