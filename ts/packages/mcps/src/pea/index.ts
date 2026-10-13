import { HostRpcCaller } from "../shared/host-rpc-caller.js";
import { readImage } from "../shared/read-image.ts";
import { createCaptureViewTool } from "../shared/capture-view.ts";
import { diagram } from "../shared/diagram.ts";
import { revitApiFetch, revitApiSearch } from "../shared/rvt-api.ts";
import { peDo, peFind, peRead, peaHostBaseUrl, scopeOf, targetSet } from "./capability-tools.ts";
import { documentRequestSchema, type DocumentRequest } from "@pe/agent-contracts";
import { createTool } from "../shared/tool.ts";
import z from "zod";
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
  publishPeaSkills,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
  resolvePeaStandardSkillsRoot,
  peaProductHomeEnvVar,
  peaStandardSkillsRoot,
} from "./skills.ts";

async function captureCaller(override?: DocumentRequest) {
  const target = override ?? (await scopeOf())?.defaultTarget;
  if (target?.kind !== "open")
    throw new Error(
      "capture_view requires an exact selected open document. Pass target {kind: open, ref: {session, openId}} from pe_find, or ask the user to select the thread head.",
    );
  return new HostRpcCaller({
    hostBaseUrl: peaHostBaseUrl(),
    bridgeSessionId: target.ref.session,
    openDocumentId: target.ref.openId,
  });
}

const capture = createCaptureViewTool(() => captureCaller());
const captureView = createTool({
  ...capture,
  description: `${capture.description} Reads need no grant. An exact document target overrides this capture only; omission follows the thread head.`,
  inputSchema: capture.inputSchema.extend({
    target: z
      .union([documentRequestSchema.options[0], capture.inputSchema.shape.target.unwrap().strict()])
      .optional()
      .describe(
        "Exact open document read override, or a view selector within the thread head's document. Omit to follow the current head.",
      ),
  }),
  execute: async (input) => {
    const { target, ...options } = input;
    const document = target && "kind" in target ? target : undefined;
    const tool = createCaptureViewTool(() => captureCaller(document));
    return tool.execute(
      { ...options, target: target && "kind" in target ? undefined : target },
      undefined,
    );
  },
});

/**
 * Pea's product surface: three capability doors over ONE catalog (`pe_find` ranks it, `pe_read`
 * runs rows that do not mutate, `pe_do` runs any row), one Target door (`target_set`), and the media
 * and docs helpers that do not fit a JSON row. Session lifecycle is in the catalog like everything
 * else. Writes cross the host grant check (ADR 0017); lifecycle checks cover the affected documents.
 * Document calls follow the live thread head (`/pe/scope/self`) unless an exact per-call target
 * is supplied. Reads need no grant; writes name Pea's own lifetimes or the granted head.
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
