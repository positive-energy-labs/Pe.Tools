import type { ToolCategory } from "@mastra/core/agent-controller";
import { bridgeSelector, emptyScope, turnOf } from "@pe/agent-contracts";
import { HostRpcCaller } from "../shared/host-rpc-caller.js";
import { readImage } from "../shared/read-image.ts";
import { createCaptureViewTool } from "../shared/capture-view.ts";
import { requestAccess } from "../shared/request-access.ts";
import { revitApiFetch, revitApiSearch } from "../shared/rvt-api.ts";
import { peDo, peFind, peRead, peaHostBaseUrl, scopeSet } from "./capability-tools.ts";
export {
  configurePeaProductToolContext,
  peDo,
  peFind,
  peRead,
  scopeSet,
} from "./capability-tools.ts";
export {
  buildCapabilities,
  createCapabilityCatalogSource,
  type CapabilityCatalogSource,
} from "./capabilities.ts";
export { type RouteRegistration, createRouteRegistrations } from "./routes.ts";
export { PeaCliCommands } from "./PeaCliCommands.ts";
export {
  bundledPeaSkills,
  materializeBundledPeaSkills,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
  resolvePeaStandardSkillsRoot,
  peaSkillPaths,
  peaProductHomeEnvVar,
  peaStandardSkillsRoot,
} from "./skills.ts";

export const captureView = createCaptureViewTool(
  (context) =>
    new HostRpcCaller({
      hostBaseUrl: peaHostBaseUrl(),
      bridgeSessionId: bridgeSelector(turnOf(context)?.scope ?? emptyScope),
    }),
);

/**
 * Pea's product surface: three capability doors over ONE catalog (`pe_find` ranks it, `pe_read`
 * runs rows that do not mutate, `pe_do` runs any row), one Scope door (`scope_set`), and the media
 * and docs helpers that do not fit a JSON row. Session lifecycle is in the catalog like everything
 * else: `route:instances.start` and `route:instances.open` run for any actor, the rest of the
 * lifecycle is `actor: human`. Every host-bound tool resolves its Revit session from the turn's
 * frozen Scope (`turnOf`); no tool input names a session or a document.
 */
export const peaProductTools = {
  [peFind.id]: peFind,
  [peRead.id]: peRead,
  [peDo.id]: peDo,
  [scopeSet.id]: scopeSet,
  [captureView.id]: captureView,
  [readImage.id]: readImage,
  [requestAccess.id]: requestAccess,
  [revitApiSearch.id]: revitApiSearch,
  [revitApiFetch.id]: revitApiFetch,
};

export const peaProductToolMetadata = {
  pe_find: { category: "read", requiresRevit: false },
  pe_read: { category: "read", requiresRevit: false },
  pe_do: { category: "execute", requiresRevit: false },
  scope_set: { category: "execute", requiresRevit: false },
  capture_view: { category: "read", requiresRevit: true },
  read_image: { category: "read", requiresRevit: false },
  request_access: { category: "edit", requiresRevit: false },
  revit_api_docs_search: { category: "read", requiresRevit: false },
  revit_api_docs_fetch: { category: "read", requiresRevit: false },
} satisfies Record<
  keyof typeof peaProductTools,
  { category: ToolCategory; requiresRevit: boolean }
>;
