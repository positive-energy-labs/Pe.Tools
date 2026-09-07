import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { Press } from "#/components/lang/press";
import { diagnosticLine, warningLine } from "#/host/familyfoundry";
import { familyFlag, provenanceSummary } from "#/families/plan";
import { Seam, SectionLabel } from "#/families/readout-primitives";
import { useFamiliesWorkspace } from "#/families/workspace-context";
import { cn } from "#/lib/utils";

/**
 * THE TWO READOUT TABLES, on the ruled idiom (2026-08-31, `MasterTable` draws SEPARATE borders).
 * A row is `--item-h` and every rule is drawn by the CELL, because a collapsed border belongs to
 * the table and does not travel with its cell. Neither of these is a `MasterTable`: they are
 * fixed-shape readouts inside a 176px band that already carries its own label and chips, and a
 * `MasterTable` would bring a second search box, scope label and summary row into it. Porting the
 * decision queue when it grows sort/filter/facet needs is recorded as owed.
 */
const QUEUE_ROW = "h-(--item-h)";
const QUEUE_CELL = "hairline-b px-(--item-pad-x) align-middle";

export function FamiliesReadoutBands() {
  const {
    fixture,
    store,
    plan,
    includedPlanned,
    outsideProfile,
    excludedIds,
    applyData,
    projection,
  } = useFamiliesWorkspace();
  const warningCount = plan?.entries.reduce((sum, entry) => sum + entry.warnings.length, 0) ?? 0;
  return (
    <>
      {plan && (
        <div className="hairline-b max-h-44 overflow-auto px-2 py-1.5">
          <div
            className="sticky top-0 z-[1] flex flex-wrap items-center gap-1.5 py-0.5"
            data-surface="page"
          >
            <SectionLabel>
              <span title="One row per family the plan touched, plus the families in scope it did not claim. This is the last place to change your mind: apply runs exactly the rows still ticked here.">
                decision queue
              </span>
            </SectionLabel>
            <FactChip title="Included = ticked here AND carrying at least one lowered action.">
              {includedPlanned.length} / {plan.entries.length} included
            </FactChip>
            {outsideProfile.length > 0 && (
              <FactChip title="These families are in scope, but the profile made no claim about them, so apply will not touch them.">
                {outsideProfile.length} unclaimed
              </FactChip>
            )}
            {warningCount > 0 && (
              <FactChip tone="caution" title="Capture warnings reported by the reviewed plan.">
                {warningCount} warning{warningCount === 1 ? "" : "s"}
              </FactChip>
            )}
          </div>
          {plan.entries.flatMap((entry) =>
            entry.warnings.map((warning) => (
              <OutcomeLine
                key={`${entry.familyId}:${warning.code}:${warning.message}`}
                kind="advisory"
                label={`${entry.familyName} · ${warning.code}`}
                says={warningLine(warning)}
              />
            )),
          )}
          {/* THE RULED TABLE IDIOM (2026-08-31): separate borders at zero spacing, rows at
              `--item-h`, tier type. This queue was the last table in the app drawn the old way —
              `border-collapse` + a raw compact leading + rows that measured 12.5-15px, stacked
              directly above the 20px families matrix on the same page. A collapsed border belongs
              to the TABLE, so every rule here is drawn by the CELL instead (`hairline-b`), which
              is the same move `MasterTable` made and the reason its rules survive a sticky cell. */}
          <table className="mt-0.5 w-full table-fixed border-separate border-spacing-0 t-small">
            <thead className="t-small face-mono t-upper text-ink-mute">
              <tr className={QUEUE_ROW}>
                <th className={cn(QUEUE_CELL, "w-8 font-normal")}>
                  <span className="sr-only">include</span>
                </th>
                <th className={cn(QUEUE_CELL, "w-56 text-left font-normal")}>family</th>
                <th className={cn(QUEUE_CELL, "w-20 text-left font-normal")}>actions</th>
                <th className={cn(QUEUE_CELL, "text-left font-normal")}>profile source</th>
                <th className={cn(QUEUE_CELL, "w-80 text-left font-normal")}>exception</th>
              </tr>
            </thead>
            <tbody>
              {plan.entries.map((entry) => {
                const flag = familyFlag(entry);
                const excluded = excludedIds.has(entry.familyId);
                return (
                  <tr
                    key={entry.familyId}
                    className={cn(QUEUE_ROW, (flag !== null || excluded) && "text-ink-mute")}
                  >
                    <td className={cn(QUEUE_CELL, "w-8 text-center")}>
                      <Press
                        type="button"
                        disabled={flag !== null}
                        title={
                          flag
                            ? `${flag}. There is nothing to include, so this row cannot be ticked.`
                            : excluded
                              ? `${entry.familyName} is held back — apply will skip it. Click to put its ${entry.changes.length + entry.runEffects.length} action(s) back in.`
                              : `${entry.familyName} is in: apply will run its ${entry.changes.length + entry.runEffects.length} action(s) against the model. Click to hold it back without re-planning.`
                        }
                        onClick={() => void store.actions.exclude(entry.familyId)}
                        tone="quiet"
                        size="value"
                        state={flag !== null ? "disabled" : excluded ? "rest" : "selected"}
                      >
                        {flag !== null ? "✕" : excluded ? "□" : "▪"}
                      </Press>
                    </td>
                    <td className={cn(QUEUE_CELL, "face-mono w-56 truncate")}>
                      {entry.familyName}
                    </td>
                    <td
                      className={cn(QUEUE_CELL, "face-mono w-20 truncate")}
                      title="Lowered actions: the concrete parameter edits the plan compiled for this family. Zero means the family already matches the profile."
                    >
                      {entry.changes.length + entry.runEffects.length} action
                      {entry.changes.length + entry.runEffects.length === 1 ? "" : "s"}
                    </td>
                    <td
                      className={cn(QUEUE_CELL, "t-small face-mono truncate text-ink-2")}
                      title="Which layers of the profile decided this family's parameter facets, counted. It is a rollup of what the op reported, with no interpretation added — use it to see which part of the profile is doing the work."
                    >
                      {provenanceSummary(entry)}
                    </td>
                    {/* A family the plan compiled nothing for is a verdict with nothing behind
                        it, not a warning about the model: quiet ink, off the meaning band. */}
                    <td
                      className={cn(QUEUE_CELL, "t-small face-mono w-80 truncate text-ink-mute")}
                      title={flag ?? ""}
                    >
                      {flag ?? ""}
                    </td>
                  </tr>
                );
              })}
              {outsideProfile.map((family) => (
                <tr key={`outside-${family.familyId}`} className={cn(QUEUE_ROW, "opacity-60")}>
                  <td className={cn(QUEUE_CELL, "w-8 text-center")}>
                    <span className="face-mono text-ink-2">✕</span>
                  </td>
                  <td className={cn(QUEUE_CELL, "face-mono w-56 truncate text-ink-mute")}>
                    {family.familyName}
                  </td>
                  <td className={cn(QUEUE_CELL, "face-mono w-20 text-ink-mute")}>—</td>
                  <td
                    className={cn(QUEUE_CELL, "t-small face-mono truncate text-ink-mute")}
                    colSpan={2}
                  >
                    in scope, but the bound profile does not claim this family
                  </td>
                </tr>
              ))}
              {plan.entries.length === 0 && outsideProfile.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="py-1">
                      <EmptyState
                        story="scope"
                        exit="widen the categories above, or bind a profile that covers this project"
                      >
                        no family in this scope is claimed by the bound profile — the plan compiled
                        cleanly and matched nothing
                      </EmptyState>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

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
                      <Verb
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

      {/* ── projection: a lazily-rendered document, copyable ─────────────────────────────── */}
      {projection && (
        <details className="hairline-b px-4 py-2" open={fixture ? true : undefined}>
          <summary className="cursor-pointer">
            <SectionLabel>
              <span title="Each picked family read back out of the model as profile JSON. Nothing is written anywhere — copy it into a profile document if you want to keep it.">
                projected profiles
              </span>
            </SectionLabel>
            <span className="ml-2">
              <FactChip title="How many picked families the projection read back out of the model.">
                {projection.families.length} famil
                {projection.families.length === 1 ? "y" : "ies"}
              </FactChip>
            </span>
          </summary>
          {projection.families.length === 0 && projection.diagnostics.length === 0 && (
            <div className="mt-1">
              <EmptyState
                story="scope"
                exit="re-pick families in the table's pick column and run it again"
              >
                nothing projected — the picked set read back empty
              </EmptyState>
            </div>
          )}
          {/* Projection is read-only and blocks nothing, which is exactly what the outcome
              lane's `advisory` means — "a dry run blocks nothing". */}
          {projection.diagnostics.map((diagnostic) => (
            <div key={`${diagnostic.code}:${diagnostic.path}`} className="mt-1">
              <OutcomeLine
                kind="advisory"
                label={diagnosticLine(diagnostic)}
                says={diagnostic.suggestion ?? undefined}
              />
            </div>
          ))}
          {projection.families.map((entry) => (
            <div key={entry.familyId} className="mt-2">
              <div className="flex items-center gap-2">
                <span className="t-small t-upper">{entry.familyName ?? entry.familyId}</span>
                <span className="t-small text-ink-2">
                  {Object.keys(entry.coverage).length
                    ? `coverage ${Object.entries(entry.coverage)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(" / ")} / ${entry.unmodeledCount} unmodeled`
                    : "coverage not captured / unmodeled not captured"}
                </span>
                {entry.modelJson && (
                  <Verb
                    label="copy"
                    onClick={() => void navigator.clipboard.writeText(entry.modelJson ?? "")}
                    reason="Copy this family's projected profile JSON to the clipboard. There is no profile editor here by design — profiles are files, so paste it into one."
                  />
                )}
                {!entry.success && (
                  <OutcomeLine
                    kind="error"
                    label="projection failed"
                    says={entry.error ?? "no reason reported"}
                  />
                )}
              </div>
              {entry.modelJson && (
                <pre
                  className="t-small face-mono mt-1 max-h-40 overflow-auto p-2 text-ink-2 inset-ring"
                  data-surface="recess"
                >
                  {entry.modelJson}
                </pre>
              )}
            </div>
          ))}
        </details>
      )}

      {/* ── THE table: everything currently in scope ─────────────────────────────────────── */}
    </>
  );
}
