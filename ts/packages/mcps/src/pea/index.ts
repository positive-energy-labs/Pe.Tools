import type { ToolCategory } from "@mastra/core/agent-controller";
import { turnOf, type DocumentRequest } from "@pe/agent-contracts";
import { HostRpcCaller } from "../shared/host-rpc-caller.js";
import { readImage } from "../shared/read-image.ts";
import { createCaptureViewTool } from "../shared/capture-view.ts";
import { diagram } from "../shared/diagram.ts";
import { requestAccess } from "../shared/request-access.ts";
import { revitApiFetch, revitApiSearch } from "../shared/rvt-api.ts";
import { peDo, peFind, peRead, peaHostBaseUrl, targetSet } from "./capability-tools.ts";
export {
  configurePeaProductToolContext,
  ownedTurnDocuments,
  peDo,
  peFind,
  peRead,
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
  peaProductHomeEnvVar,
  peaStandardSkillsRoot,
} from "./skills.ts";

/** The session a frozen default Target names, for the tools that take a selector, not a Target. */
const sessionOf = (target: DocumentRequest | null | undefined): string | undefined =>
  target ? (target.kind === "open" ? target.ref.session : target.session) : undefined;

const captureView = createCaptureViewTool((context) => {
  const target = turnOf(context)?.defaultTarget;
  return new HostRpcCaller({
    hostBaseUrl: peaHostBaseUrl(),
    bridgeSessionId: sessionOf(target),
    openDocumentId: target?.kind === "open" ? target.ref.openId : undefined,
  });
});

/**
 * Pea's product surface: three capability doors over ONE catalog (`pe_find` ranks it, `pe_read`
 * runs rows that do not mutate, `pe_do` runs any row), one Target door (`target_set`), and the media
 * and docs helpers that do not fit a JSON row. Session lifecycle is in the catalog like everything
 * else: `route:instances.start` and `route:instances.open` run for any actor, the rest of the
 * lifecycle is `actor: human`. Every host-bound tool resolves its Revit session from the turn's
 * frozen default Target (`turnOf`); no tool input names a session or a document.
 */
export const peaProductTools = {
  [peFind.id]: peFind,
  [peRead.id]: peRead,
  [peDo.id]: peDo,
  [targetSet.id]: targetSet,
  [captureView.id]: captureView,
  [readImage.id]: readImage,
  [diagram.id]: diagram,
  [requestAccess.id]: requestAccess,
  [revitApiSearch.id]: revitApiSearch,
  [revitApiFetch.id]: revitApiFetch,
};

export const peaProductToolMetadata = {
  pe_find: { category: "read", requiresRevit: false },
  pe_read: { category: "read", requiresRevit: false },
  pe_do: { category: "execute", requiresRevit: false },
  target_set: { category: "execute", requiresRevit: false },
  capture_view: { category: "read", requiresRevit: true },
  read_image: { category: "read", requiresRevit: false },
  diagram: { category: "read", requiresRevit: false },
  request_access: { category: "edit", requiresRevit: false },
  revit_api_docs_search: { category: "read", requiresRevit: false },
  revit_api_docs_fetch: { category: "read", requiresRevit: false },
} satisfies Record<
  keyof typeof peaProductTools,
  { category: ToolCategory; requiresRevit: boolean }
>;
