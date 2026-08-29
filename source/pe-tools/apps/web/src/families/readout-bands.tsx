import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { Press } from "#/components/lang/press";
import { diagnosticLine } from "#/host/familyfoundry";
import { familyFlag, provenanceSummary } from "#/families/plan";
import { Seam, SectionLabel } from "#/families/readout-primitives";
import { useFamiliesWorkspace } from "#/families/workspace-context";

export function FamiliesReadoutBands() {
  const { store, plan, includedPlanned, outsideProfile, excludedIds, applyData, projection } =
    useFamiliesWorkspace();
  return (
    <>
      {plan && (
        <div className="max-h-56 shrink-0 overflow-auto border-b border-line px-4 py-2">
          <div className="flex items-center gap-2">
            <SectionLabel>
              <span title="One row per family the plan touched, plus the families in scope it did not claim. This is the last place to change your mind: apply runs exactly the rows still ticked here.">
                decision queue
              </span>
            </SectionLabel>
            <FactChip title="Included = ticked here AND carrying at least one lowered action. Unclaimed families are shown for honesty — the profile said nothing about them, so apply will not touch them.">
              {includedPlanned.length} of {plan.entries.length} planned families included
              {outsideProfile.length > 0
                ? ` · ${outsideProfile.length} in scope but unclaimed`
                : ""}
            </FactChip>
          </div>
          <table className="mt-1 w-full border-collapse">
            <tbody>
              {plan.entries.map((entry) => {
                const flag = familyFlag(entry);
                const excluded = excludedIds.has(entry.familyId);
                return (
                  <tr key={entry.familyId} className="border-b border-line">
                    <td className="w-8 py-0.5">
                      <Press
                        type="button"
                        disabled={flag !== null}
                        title={
                          flag
                            ? `${flag}. There is nothing to include, so this row cannot be ticked.`
                            : excluded
                              ? `${entry.familyName} is held back — apply will skip it. Click to put its ${entry.plan.loweredActions.length} action(s) back in.`
                              : `${entry.familyName} is in: apply will run its ${entry.plan.loweredActions.length} action(s) against the model. Click to hold it back without re-planning.`
                        }
                        onClick={() => void store.actions.exclude(entry.familyId)}
                        tone="quiet"
                        size="value"
                      >
                        {flag !== null ? "✕" : excluded ? "□" : "▪"}
                      </Press>
                    </td>
                    <td className="face-mono py-0.5 t-label">{entry.familyName}</td>
                    <td
                      className="face-mono w-24 py-0.5 t-label text-ink-2"
                      title="Lowered actions: the concrete parameter edits the plan compiled for this family. Zero means the family already matches the profile."
                    >
                      {entry.plan.loweredActions.length} action
                      {entry.plan.loweredActions.length === 1 ? "" : "s"}
                    </td>
                    <td
                      className="face-mono truncate py-0.5 t-caption text-ink-2"
                      title="Which layers of the profile decided this family's parameter facets, counted. It is a rollup of what the op reported, with no interpretation added — use it to see which part of the profile is doing the work."
                    >
                      {provenanceSummary(entry.plan)}
                    </td>
                    {/* A family the plan compiled nothing for is a verdict with nothing behind
                        it, not a warning about the model: quiet ink, off the meaning band. */}
                    <td
                      className="face-mono w-64 truncate py-0.5 t-caption text-ink-mute"
                      title={flag ?? ""}
                    >
                      {flag ?? ""}
                    </td>
                  </tr>
                );
              })}
              {outsideProfile.map((family) => (
                <tr key={`outside-${family.familyId}`} className="border-b border-line opacity-60">
                  <td className="w-8 py-0.5 text-center">
                    <span className="face-mono t-value text-ink-2">✕</span>
                  </td>
                  <td className="face-mono py-0.5 t-label">{family.familyName}</td>
                  <td className="face-mono w-24 py-0.5 t-label text-ink-2">—</td>
                  <td className="face-mono py-0.5 t-caption text-ink-2" colSpan={2}>
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
        <div className="max-h-48 shrink-0 overflow-auto border-b border-line px-4 py-2">
          <div className="flex items-center gap-2">
            <SectionLabel>
              <span title="What apply actually did, per family, as the op reported it. Receipts are the fleet lane's trust layer — the counts here are the evidence, not the plan's promise.">
                receipts
              </span>
            </SectionLabel>
            <Seam op="host.shell.open link" />
            {applyData.planHash && (
              <FactChip
                tone={plan?.planHash && applyData.planHash !== plan.planHash ? "alarm" : "meta"}
                title={`The hash the project compiled to at apply time (${applyData.planHash}). If it differs from the plan hash in the sentence row, apply refused rather than running a stale plan.`}
              >
                recompiled {applyData.planHash.slice(0, 12)}
              </FactChip>
            )}
          </div>
          <table className="mt-1 w-full border-collapse">
            <tbody>
              {applyData.receipts.map((entry) => (
                <tr key={entry.familyId} className="border-b border-line">
                  <td className="face-mono w-56 truncate py-0.5 t-label">
                    {entry.familyName ?? `element ${entry.familyId}`}
                  </td>
                  <td className="w-20 py-0.5">
                    <FactChip
                      tone={entry.success ? "done" : "alarm"}
                      title={
                        entry.success
                          ? `The op reported this family written: ${entry.parametersChanged} parameter(s) changed. This is the receipt, not the plan's promise.`
                          : (entry.error ??
                            "The op reported this family as failed and gave no reason. Re-plan and read the decision queue before retrying.")
                      }
                    >
                      {entry.success ? "applied" : "failed"}
                    </FactChip>
                  </td>
                  <td
                    className="face-mono w-40 py-0.5 t-caption text-ink-2"
                    title={`${entry.parametersChanged} parameter(s) written, breaking down as ${entry.diffSummary.added} added, ${entry.diffSummary.removed} removed, ${entry.diffSummary.modified} modified against the family's prior state.`}
                  >
                    {entry.parametersChanged} changed · +{entry.diffSummary.added} −
                    {entry.diffSummary.removed} ~{entry.diffSummary.modified}
                  </td>
                  <td
                    className="face-mono truncate py-0.5 t-caption text-ink-2"
                    title={
                      entry.operationsRun.length > 0
                        ? `Migrator operations that ran on this family, in order: ${entry.operationsRun.join(", ")}.`
                        : (entry.error ?? "No operations ran and no reason was reported.")
                    }
                  >
                    {entry.operationsRun.join(" · ") || (entry.error ?? "")}
                  </td>
                  <td className="w-24 py-0.5 text-right">
                    {entry.artifactDirectoryPath && (
                      /* Leaving the app entirely — nav:out, which is the direction browsers
                         already taught. It writes nothing, so it is not blue-filled. */
                      <Verb
                        label="artifacts"
                        tone="nav"
                        direction="out"
                        onClick={() =>
                          void store.actions.openPath(entry.artifactDirectoryPath ?? "")
                        }
                        reason={`Open the artifact bundle for this family in your OS file browser (${entry.artifactDirectoryPath}). The bundle stays on disk — this route never copies it.`}
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
        <details className="shrink-0 border-b border-line px-4 py-2" open>
          <summary className="cursor-pointer">
            <SectionLabel>
              <span title="Each picked family read back out of the model as profile JSON. Nothing is written anywhere — copy it into a profile document if you want to keep it.">
                projected profiles
              </span>
            </SectionLabel>
            <span className="ml-2">
              <FactChip title="How many picked families the projection read back out of the model.">
                {projection.projections.length} famil
                {projection.projections.length === 1 ? "y" : "ies"}
              </FactChip>
            </span>
          </summary>
          {projection.projections.length === 0 && projection.diagnostics.length === 0 && (
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
          {projection.projections.map((entry) => (
            <div key={entry.familyId} className="mt-2">
              <div className="flex items-center gap-2">
                <span className="face-mono t-label">{entry.familyName ?? entry.familyId}</span>
                {entry.profileJson && (
                  <Verb
                    label="copy"
                    onClick={() => void navigator.clipboard.writeText(entry.profileJson ?? "")}
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
              {entry.profileJson && (
                <pre className="face-mono mt-1 max-h-40 overflow-auto rounded-sm border border-line p-2 t-caption text-ink-2">
                  {entry.profileJson}
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
