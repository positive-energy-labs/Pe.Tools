import {
  bridgeSelector,
  type FamiliesRouteDocument,
  type RouteStateCommandHandlers,
} from "@pe/agent-contracts";

import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";
import { executionContent } from "./settings-commands.ts";

const PROFILE_MODULE = { moduleKey: "FamilyFoundry", rootKey: "patches" } as const;

export function createFamiliesCommandHandlers(
  options: { hostBaseUrl?: string } = {},
): RouteStateCommandHandlers<FamiliesRouteDocument> {
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const caller = (target?: string) => new HostRpcCaller({ hostBaseUrl, bridgeSessionId: target });

  return {
    plan: async (raw, ctx) => {
      const input = raw as {
        profilePath: string;
        scope: { familyNames: string[] };
      };
      const rpc = caller(bridgeSelector(ctx.scope));
      const opened = await rpc.call("settings.document.open", {
        documentId: { ...PROFILE_MODULE, relativePath: input.profilePath },
        includeComposedContent: true,
      });
      const result = await rpc.call("familyfoundry.plan", {
        patchJson: executionContent(opened),
      });
      if (result.diagnostics.length > 0)
        throw new Error(result.diagnostics.map(diagnosticLine).join(" · "));

      const allowed = new Set(input.scope.familyNames);
      const document = ctx.getDoc();
      document.profilePath = input.profilePath;
      document.plan = {
        entries: result.families.filter((entry) => allowed.has(entry.familyName)),
      };
      document.excludedIds = [];
      document.apply = null;
      await ctx.setDoc(document);
      return { families: document.plan.entries.length, entries: document.plan.entries };
    },

    apply: async (raw, ctx) => {
      const input = raw as { expectedPlanHashes: Record<string, string>; target?: string };
      const document = ctx.getDoc();
      const plan = document.plan;
      if (!document.profilePath || !plan) throw new Error("No plan is ready. Plan first.");
      const expectedPlanHashes = Object.fromEntries(
        plan.entries
          .filter(
            (entry) =>
              !document.excludedIds.includes(entry.familyId) &&
              entry.refusals.length === 0 &&
              (entry.changes.length > 0 || entry.runEffects.length > 0),
          )
          .map((entry) => [String(entry.familyId), entry.planHash]),
      );
      if (
        Object.keys(input.expectedPlanHashes).length !== Object.keys(expectedPlanHashes).length ||
        Object.entries(expectedPlanHashes).some(
          ([id, hash]) => input.expectedPlanHashes[id] !== hash,
        )
      )
        throw new Error("The reviewed family plans or exclusions changed. Review and apply again.");
      if (Object.keys(expectedPlanHashes).length === 0)
        throw new Error("No included family has changes to apply.");

      const rpc = caller(bridgeSelector(ctx.scope));
      const opened = await rpc.call("settings.document.open", {
        documentId: { ...PROFILE_MODULE, relativePath: document.profilePath },
        includeComposedContent: true,
      });
      const result = await rpc.call("familyfoundry.apply", {
        patchJson: executionContent(opened),
        expectedPlanHashes,
      });

      const latest = ctx.getDoc();
      latest.apply = {
        diagnostics: result.diagnostics,
        appliedAt: new Date().toISOString(),
        receipts: result.receipts,
        artifacts: [
          ...new Set(
            result.receipts.flatMap((receipt) =>
              receipt.artifactDirectory ? [receipt.artifactDirectory] : [],
            ),
          ),
        ],
      };
      await ctx.setDoc(latest);
      return {
        applied: result.receipts.filter((receipt) => receipt.success).length,
        converged: result.receipts.filter((receipt) => receipt.converged).length,
        receipts: result.receipts,
        diagnostics: result.diagnostics,
      };
    },
  };
}

function diagnosticLine(diagnostic: { code: string; path: string; message: string }) {
  return `${diagnostic.code} · ${diagnostic.path} — ${diagnostic.message}`;
}
