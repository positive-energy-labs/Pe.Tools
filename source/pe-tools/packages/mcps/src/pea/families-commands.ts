import {
  resolveTarget,
  type FamiliesRouteDocument,
  type RouteStateCommandHandlers,
} from "@pe/agent-contracts";

import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";

const PROFILE_MODULE = { moduleKey: "CmdFFDesiredMigrator", rootKey: "profiles" } as const;

export { familiesRouteState } from "@pe/agent-contracts";

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
        target?: string;
      };
      const rpc = caller(resolveTarget(input, ctx.getDoc()));
      const opened = await rpc.call("settings.document.open", {
        documentId: { ...PROFILE_MODULE, relativePath: input.profilePath },
      });
      const result = await rpc.call("familyfoundry.plan", { profileJson: opened.rawContent });
      if (result.diagnostics.length > 0)
        throw new Error(result.diagnostics.map(diagnosticLine).join(" · "));
      if (!result.planHash) throw new Error("The compiled plan did not report a plan hash.");

      const allowed = new Set(input.scope.familyNames);
      const document = ctx.getDoc();
      document.profilePath = input.profilePath;
      document.plan = {
        planHash: result.planHash,
        takenAt: new Date().toISOString(),
        entries: result.families.filter((entry) => allowed.has(entry.familyName)),
      };
      document.excludedIds = [];
      document.apply = null;
      await ctx.setDoc(document);
      return { planHash: result.planHash, families: document.plan.entries.length };
    },

    apply: async (raw, ctx) => {
      const input = raw as { expectedPlanHash: string; target?: string };
      const document = ctx.getDoc();
      const plan = document.plan;
      if (!document.profilePath || !plan) throw new Error("No plan is ready. Plan first.");
      if (input.expectedPlanHash !== plan.planHash) {
        throw new Error(
          `plan drift — the project recompiled to ${plan.planHash.slice(0, 12)}…, not ${input.expectedPlanHash.slice(0, 12)}…. Re-plan and review the decision queue before applying.`,
        );
      }

      const rpc = caller(resolveTarget(input, document));
      const opened = await rpc.call("settings.document.open", {
        documentId: { ...PROFILE_MODULE, relativePath: document.profilePath },
      });
      const excluded = new Set(document.excludedIds);
      const result = await rpc.call("familyfoundry.apply", {
        profileJson: opened.rawContent,
        familyIds: plan.entries
          .filter((entry) => !excluded.has(entry.familyId) && entry.plan.loweredActions.length > 0)
          .map((entry) => entry.familyId),
        expectedPlanHash: plan.planHash,
      });
      if (result.refused) {
        throw new Error(
          result.planHash && result.planHash !== plan.planHash
            ? `plan drift — the project recompiled to ${result.planHash.slice(0, 12)}…, not ${plan.planHash.slice(0, 12)}…. Re-plan and review the decision queue before applying.`
            : `apply refused — ${result.diagnostics.map(diagnosticLine).join(" · ") || "no reason reported"}`,
        );
      }

      const latest = ctx.getDoc();
      latest.apply = {
        planHash: result.planHash ?? plan.planHash,
        appliedAt: new Date().toISOString(),
        receipts: result.receipts,
        artifacts: [
          ...new Set(
            result.receipts.flatMap((receipt) =>
              receipt.artifactDirectoryPath ? [receipt.artifactDirectoryPath] : [],
            ),
          ),
        ],
      };
      await ctx.setDoc(latest);
      return { applied: result.receipts.filter((receipt) => receipt.success).length };
    },
  };
}

function diagnosticLine(diagnostic: { code: string; path: string; message: string }) {
  return `${diagnostic.code} · ${diagnostic.path} — ${diagnostic.message}`;
}
