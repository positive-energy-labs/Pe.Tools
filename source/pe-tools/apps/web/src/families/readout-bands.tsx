import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { familyCellValueSchema } from "@pe/agent-contracts";

import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { ActionButton } from "#/components/lang/action-button";
import { fanOutWord, ReviewRow, runFanOut, type FanOutOutcome } from "#/components/lang/band";
import { ValueDiff } from "#/components/lang/value-diff";
import { familyCellEntries } from "#/families/staged";
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

/** What the latest capture saw, per family, beside the members it filed (as `/family` shows it). */
export function FamiliesCaptureBand() {
  const { store } = useFamiliesWorkspace();
  const captured = store.captured;
  if (!captured) return null;
  const { members, evidence } = captured;
  return (
    <section aria-label="capture evidence" className="hairline-b flex flex-col gap-1 px-4 py-1.5">
      <SectionLabel>
        captured {members.length} of {evidence.families.length} families into{" "}
        {members[0]?.pod ?? "the pod"}
      </SectionLabel>
      {evidence.diagnostics.map((issue) => (
        <OutcomeLine
          key={`${issue.code}:${issue.path}`}
          kind="error"
          label={issue.code}
          says={issue.message}
        />
      ))}
      {evidence.families.map((family) => (
        <div key={family.familyId} className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-2 t-small">
            <span className="face-mono w-56 truncate text-ink-2">
              {family.familyName ?? `element ${family.familyId}`}
            </span>
            {family.success ? (
              <>
                {Object.entries(family.coverage).map(([section, state]) => (
                  <FactChip
                    key={section}
                    tone={state === "Full" ? "done" : "caution"}
                    title={section}
                  >
                    {section}: {state}
                  </FactChip>
                ))}
                {/* The facts are the run's `unmodeled.json`, never the member (law 12). */}
                <FactChip tone={family.unmodeledCount ? "caution" : "done"} title="unmodeled facts">
                  {family.run && members[0] ? (
                    <Link
                      to="/pods"
                      search={{ pod: members[0].pod, path: `${family.run}/unmodeled.json` }}
                    >
                      {family.unmodeledCount} unmodeled
                    </Link>
                  ) : (
                    `${family.unmodeledCount} unmodeled`
                  )}
                </FactChip>
              </>
            ) : (
              <FactChip tone="alarm" title="nothing was filed for this family">
                failed
              </FactChip>
            )}
          </div>
          {family.error ? <OutcomeLine kind="error" label="capture" says={family.error} /> : null}
          {family.issues.map((issue, index) => (
            <OutcomeLine
              key={index}
              kind={issue.severity === "Error" ? "error" : "advisory"}
              label={issue.code}
              says={issue.message}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

/**
 * THE PROPOSALS BAND — every pending cell on the table, one `ReviewRow` each: the matrix cell's
 * own verbs (exactly `availableTransitions`, over the families wire), findable without scrolling
 * a large matrix. Its "all" verbs are aggregates only: one `runFanOut` each (an aggregate accept
 * skips contested cells, A7), with the outcome in the kit's words. Plan reads staged cells.
 */
export function FamiliesProposalsBand() {
  const { cells, rows, params, wire } = useFamiliesWorkspace();
  const [outcome, setOutcome] = useState<FanOutOutcome | null>(null);
  const entries = familyCellEntries(cells).filter(
    (entry) => entry.cell.proposal != null || entry.cell.staged != null,
  );
  if (!entries.length) return null;
  const current = (entry: (typeof entries)[number]) => {
    const key = params.find((param) => param.name === entry.parameter)?.key;
    const row = rows.find((r) => r.familyId === entry.familyId && r.typeName === entry.typeName);
    return key && row ? (row.values[key] ?? "") : null;
  };
  const keys = entries.map((entry) => entry.key);
  const open = entries.filter(({ cell }) => cell.proposal != null && cell.staged == null);
  const staged = entries.filter(({ cell }) => cell.staged != null);
  const all = (kind: "accept" | "deny") => void runFanOut(wire, cells, keys, kind).then(setOutcome);
  return (
    <section aria-label="proposals" className="hairline-b flex flex-col gap-1 px-4 py-1.5">
      <div className="flex items-center gap-2">
        <SectionLabel>
          <span title="Pea proposes; you stage reviewed values. Plan reads staged cells.">
            proposals
          </span>
        </SectionLabel>
        <FactChip tone={open.length ? "pea" : "meta"} title="Proposals nobody has staged yet.">
          {open.length} open
        </FactChip>
        <FactChip
          tone={staged.length ? "caution" : "meta"}
          title="Staged cells: what plan will generate."
        >
          {staged.length} staged
        </FactChip>
        <span className="ml-auto flex items-center gap-1">
          <ActionButton
            tone="agent"
            label="accept all"
            disabled={!open.length}
            reason={
              open.length
                ? `Accept every open proposal in one write; cells you staged yourself are skipped. Nothing reaches Revit until apply.`
                : "nothing is open to accept"
            }
            onClick={() => all("accept")}
          />
          <ActionButton
            label="deny all"
            reason="Clear every proposal on this table in one write. Staged values stay."
            onClick={() => all("deny")}
          />
        </span>
      </div>
      {outcome ? (
        <OutcomeLine
          kind={outcome.refusal ? "refused" : "receipt"}
          label={fanOutWord(outcome)}
          says={outcome.refusal ? "nothing was written" : undefined}
        />
      ) : null}
      {entries.map((entry) => (
        <ReviewRow
          key={entry.key}
          wire={wire}
          address={entry.key}
          label={
            <span className="face-mono text-ink-2" data-proposal-row={entry.key}>
              {(entry.cell.proposal ?? entry.cell.staged)?.value.familyName ?? "family"} ·{" "}
              {entry.typeName} · {entry.parameter}
            </span>
          }
          cell={entry.cell}
          facts={{
            value: (
              <ValueDiff
                from={current(entry)}
                to={(entry.cell.staged ?? entry.cell.proposal)?.value.value ?? ""}
              />
            ),
          }}
          show={(value) => familyCellValueSchema.parse(value).value}
        />
      ))}
    </section>
  );
}
