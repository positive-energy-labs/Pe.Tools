import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { ActionButton } from "#/components/lang/action-button";
import { Seam, SectionLabel } from "#/families/readout-primitives";
import { useFamiliesWorkspace } from "#/families/workspace-context";
import { cn } from "#/lib/utils";

/**
 * THE RECEIPTS TABLE, on the ruled idiom (2026-08-31): rows at `--item-h`, every rule drawn by
 * the CELL. It is a fixed-shape readout, not a `MasterTable`, which would bring a second search
 * box and summary row into the band. The plan's rows live on the kernel's confirmation sheet.
 */
const QUEUE_ROW = "h-(--item-h)";
const QUEUE_CELL = "hairline-b px-(--item-pad-x) align-middle";

/** What the last apply actually did, per family, as the op reported it. */
export function FamiliesReceiptsBand() {
  const { store, applyData } = useFamiliesWorkspace();
  return (
    <>
      {/* ── receipts ─────────────────────────────────────────────────────────────────────── */}
      {applyData && (
        <div className="hairline-b max-h-48 overflow-auto px-4 py-2">
          <div className="flex items-center gap-2">
            <SectionLabel>
              <span title="What apply actually did, per family, as the op reported it. Receipts are the fleet lane's trust layer — the counts here are the evidence, not the plan's promise.">
                receipts
              </span>
            </SectionLabel>
            <Seam op="host.shell.open link" />
          </div>
          {applyData.diagnostics.map((issue) => (
            <OutcomeLine
              key={`${issue.code}:${issue.path}`}
              kind="error"
              label={issue.code}
              says={issue.message}
            />
          ))}
          <table className="mt-1 w-full border-separate border-spacing-0 t-small">
            <tbody>
              {applyData.receipts.map((entry) => (
                <tr key={entry.familyId} className={QUEUE_ROW}>
                  <td className={cn(QUEUE_CELL, "face-mono w-56 truncate")}>
                    {entry.familyName ?? `element ${entry.familyId}`}
                  </td>
                  <td className={cn(QUEUE_CELL, "w-20")}>
                    <FactChip
                      tone={entry.converged ? "done" : "alarm"}
                      title={
                        entry.success
                          ? `The op reported this family written: ${entry.residue.length} change(s) remaining. This is the receipt, not the plan's promise.`
                          : (entry.error ??
                            "The op reported this family as failed and gave no reason. Re-plan and read the decision queue before retrying.")
                      }
                    >
                      {entry.converged ? "converged" : entry.success ? "residue" : "failed"}
                    </FactChip>
                  </td>
                  <td
                    className={cn(QUEUE_CELL, "t-small face-mono w-40 text-ink-2")}
                    title="Changes still present after apply and recapture. Zero residue plus no errors means converged."
                  >
                    {entry.residue.length} remaining
                  </td>
                  <td
                    className={cn(QUEUE_CELL, "t-small face-mono truncate text-ink-2")}
                    title={
                      entry.errors.length > 0
                        ? `Errors reported by this family: ${entry.errors.join(", ")}.`
                        : (entry.error ?? "No errors reported.")
                    }
                  >
                    {entry.errors.join(" · ") || (entry.error ?? "")}
                  </td>
                  <td className={cn(QUEUE_CELL, "w-24 text-right")}>
                    {entry.artifactDirectory && (
                      /* Leaving the app entirely — nav:out, which is the direction browsers
                         already taught. It writes nothing, so it is not blue-filled. */
                      <ActionButton
                        label="artifacts"
                        tone="nav"
                        direction="out"
                        onClick={() => void store.actions.openPath(entry.artifactDirectory ?? "")}
                        reason={`Open the artifact bundle for this family in your OS file browser (${entry.artifactDirectory}). The bundle stays on disk — this route never copies it.`}
                      />
                    )}
                  </td>
                </tr>
              ))}
              {applyData.receipts.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="py-1">
                      <EmptyState
                        story="scope"
                        exit="re-plan and read the decision queue before retrying"
                      >
                        no receipts — apply ran and reported nothing
                      </EmptyState>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
