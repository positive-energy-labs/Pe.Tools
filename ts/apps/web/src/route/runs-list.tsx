/**
 * A pod's run receipts on the one List. Scoped to the open member, or to the whole pod: a run made
 * from a draft (origin `SuppliedDraft`) belongs to no member, so only the pod scope can show it.
 */
import { List } from "#/components/lang/list-popup";
import type { Run } from "#/route/pods";

/** Where a run's source came from, said as the person reads it. */
export function runSource(run: Run, memberSha256?: string): string {
  const receipt = run.receipt;
  if (!receipt) return "receipt unreadable";
  if (receipt.origin === "SuppliedDraft") return "draft · filed nowhere";
  if (receipt.origin === "Operation") return "operation input · no member";
  if (!receipt.memberSha256) return "source not recorded";
  const bytes = receipt.memberSha256 === memberSha256 ? " · these bytes" : " · older bytes";
  return `${receipt.memberSha256.slice(0, 12)}${memberSha256 ? bytes : ""}`;
}

export function RunsList({
  runs,
  memberSha256,
  scope,
  failure,
}: {
  runs: readonly Run[];
  memberSha256?: string;
  scope: "member" | "pod";
  failure?: string | null;
}) {
  return (
    <List<Run>
      aria-label={scope === "pod" ? "the pod's runs" : "this member's runs"}
      items={runs}
      keyOf={(run) => run.runId}
      labelOf={(run) => run.runId}
      failure={failure ?? undefined}
      empty={
        scope === "pod"
          ? "no runs in this pod — apply a spec or a draft from its product route"
          : "no runs for this member — apply this spec from its product route"
      }
      row={(run) =>
        run.receipt
          ? {
              label: `${run.receipt.operation} · ${run.receipt.outcome}`,
              lines: 2,
              sub: [
                runSource(run, memberSha256),
                scope === "pod" && run.receipt.memberPath ? run.receipt.memberPath : null,
                ...(run.receipt.outputs ?? []),
              ]
                .filter(Boolean)
                .join(" · "),
              meta: <span className="face-mono">{run.runId}</span>,
            }
          : {
              // A crashed run leaves its folder on disk; the op reports it, not hides it.
              label: "receipt unreadable",
              lines: 2,
              sub: run.error ?? "unreadable",
              meta: <span className="face-mono">{run.runId}</span>,
              failed: true,
            }
      }
    />
  );
}
