import type { DocumentRequest } from "@pe/agent-contracts";
import { HostRpcCaller } from "../shared/host-rpc-caller.js";
import { readImage } from "../shared/read-image.ts";
import { createCaptureViewTool } from "../shared/capture-view.ts";
import { diagram } from "../shared/diagram.ts";
import { revitApiFetch, revitApiSearch } from "../shared/rvt-api.ts";
import { peDo, peFind, peRead, peaHostBaseUrl, scopeOf, targetSet } from "./capability-tools.ts";
export { peDo, peFind, peRead } from "./capability-tools.ts";
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

const captureView = createCaptureViewTool(async () => {
  const target = (await scopeOf())?.defaultTarget;
  // view-image needs an exact open document; a session alone is refused by the host.
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
 * lifecycle is `actor: human`. Every host-bound tool resolves its Revit session from the thread
 * head's default Target (`PE_THREAD`); no tool input names a session or a document.
 */
export const peaProductTools = {
  [peFind.id]: peFind,
  [peRead.id]: peRead,
  [peDo.id]: peDo,
  [targetSet.id]: targetSet,
  [captureView.id]: captureView,
  [readImage.id]: readImage,
  [diagram.id]: diagram,
  [revitApiSearch.id]: revitApiSearch,
  [revitApiFetch.id]: revitApiFetch,
};
