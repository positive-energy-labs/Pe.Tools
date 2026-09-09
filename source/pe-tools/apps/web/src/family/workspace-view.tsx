import { useAtomValue } from "@effect/atom-react";
import { Verb } from "#/components/lang/verb";
import { Workspace } from "#/components/anatomy";
import { FactChip } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { VerbLane } from "#/components/lang/verb-lane";
import { TargetingHead } from "#/targeting/head";
import { FamilyWorkspaceAnatomy } from "#/family/workspace-anatomy";
import { FamilyWorkspaceDocPane } from "#/family/workspace-doc-pane";
import { FamilyWorkspaceTable } from "#/family/workspace-table";
import { useFamilyWorkspace } from "#/family/workspace-context";
import { warningLine } from "#/host/familyfoundry";

export function FamilyWorkspaceView() {
  const {
    product,
    bindings,
    runner,
    store,
    lane,
    snapshot,
    requestedFamily,
    validation,
    validationSays,
    draft,
    unsavedCount,
    anatomyCollapsed,
    setAnatomyCollapsed,
  } = useFamilyWorkspace();
  const reconciliation = useAtomValue(store.atoms.reconciliation);
  const evidence = useAtomValue(store.atoms.evidence);
  const sharedEdit = useAtomValue(store.atoms.sharedEdit);
  return (
    <Workspace
      className="[&_[data-slot=pane-header]_h2]:text-ink [&_[data-kind=content]_[data-slot=pane-header]]:boundary-t [&_[data-kind=inspector]_[data-slot=pane-body]]:p-0"
      headRail={
        <TargetingHead
          product={product}
          b={bindings}
          runner={runner}
          receipt={
            <VerbLane
              atoms={store.atoms}
              standing={
                lane.parseError != null ? (
                  <OutcomeLine
                    kind="error"
                    label="the open document will not parse"
                    says={`${snapshot?.documentId.relativePath ?? "it"} — ${lane.parseError}`}
                  />
                ) : requestedFamily != null ? (
                  <OutcomeLine
                    kind="advisory"
                    label={`?family=${requestedFamily} ignored`}
                    says="this surface opens an authored family.json, not a placed element — pick the profile"
                  />
                ) : undefined
              }
            />
          }
          fact={
            <>
              <FactChip title="Coverage is reported by native Revit capture; authored fixtures do not imply capture coverage.">
                {evidence && "modelJson" in evidence
                  ? `coverage ${Object.entries(evidence.coverage)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(" / ")} / ${evidence.unmodeledCount} unmodeled`
                  : "coverage not captured / unmodeled not captured"}
              </FactChip>
              {evidence && "modelJson" in evidence && (
                <details>
                  <summary>native capture / {evidence.unmodeledCount} unmodeled</summary>
                  <pre className="max-h-64 max-w-2xl overflow-auto">
                    {JSON.stringify(evidence.coverage, null, 2)}
                    {"\n"}
                    {evidence.modelJson}
                  </pre>
                </details>
              )}
              {snapshot && (
                <details>
                  <summary>authored JSON</summary>
                  <pre className="max-h-64 max-w-2xl overflow-auto">{snapshot.rawContent}</pre>
                  <details>
                    <summary>expanded JSON</summary>
                    <pre className="max-h-64 max-w-2xl overflow-auto">
                      {snapshot.composedContent}
                    </pre>
                  </details>
                </details>
              )}
              {sharedEdit && (
                <OutcomeLine
                  kind="advisory"
                  label={`edit shared source / ${sharedEdit.pointer}`}
                  says="No local edit was staged. Open the referenced source below; nested fragments may contribute different fields."
                />
              )}
              {(snapshot?.dependencies ?? []).map((dependency) => (
                <a
                  key={dependency.directivePath}
                  href="/settings"
                  title="Edit the shared source JSON. Changes affect every profile that includes it."
                  onClick={(event) => {
                    event.preventDefault();
                    void store.actions
                      .openShared(dependency.documentId)
                      .then(() => {
                        const url = new URL(window.location.href);
                        url.pathname = "/settings";
                        url.searchParams.delete("fixture");
                        url.searchParams.delete("family");
                        window.location.assign(url.href);
                      })
                      .catch((error: unknown) =>
                        store.actions.say(error instanceof Error ? error.message : String(error)),
                      );
                  }}
                >
                  {sharedEdit?.directives.includes(dependency.directivePath)
                    ? "open referenced source "
                    : "edit shared "}
                  {dependency.directivePath}
                </a>
              ))}
              {!lane.fixture && (
                <>
                  <Verb
                    tone="act"
                    label="plan current family"
                    reason="Plan the saved JSON against the current family document."
                    onClick={() => void store.verbs.plan.run?.().catch(() => undefined)}
                  />
                  <Verb
                    tone="commit"
                    label="apply reviewed plan"
                    disabled={!reconciliation.plan || reconciliation.plan.entry.refusals.length > 0}
                    reason="Review a valid plan first. Applies the saved JSON without saving the Revit document."
                    onClick={() => void store.verbs.apply.run?.().catch(() => undefined)}
                  />
                  {reconciliation.plan && (
                    <details>
                      <summary>
                        {reconciliation.plan.entry.changes.length} changes ?{" "}
                        {reconciliation.plan.entry.refusals.length} refusals ?{" "}
                        {reconciliation.plan.entry.warnings.length} warnings
                      </summary>
                      {reconciliation.plan.entry.warnings.map((warning) => (
                        <OutcomeLine
                          key={`${warning.code}:${warning.message}`}
                          kind="advisory"
                          label={warning.code}
                          says={warningLine(warning)}
                        />
                      ))}
                      <pre className="max-h-64 max-w-2xl overflow-auto">
                        {JSON.stringify(reconciliation.plan.entry, null, 2)}
                      </pre>
                    </details>
                  )}
                  {reconciliation.apply && (
                    <details>
                      <summary>apply receipts</summary>
                      <pre className="max-h-64 max-w-2xl overflow-auto">
                        {JSON.stringify(reconciliation.apply, null, 2)}
                      </pre>
                    </details>
                  )}
                </>
              )}
              {validation && (
                <FactChip
                  tone={validation.isValid ? "done" : "caution"}
                  title={
                    validation.isValid
                      ? "The host validated this document against its schema on the last read or save."
                      : `The host reports ${validation.issues.length} schema issue(s): ${validationSays}`
                  }
                >
                  {validation.isValid
                    ? "schema valid"
                    : `${validation.issues.length} schema issue${validation.issues.length === 1 ? "" : "s"}`}
                </FactChip>
              )}
              <FactChip
                tone={draft.dirty ? "caution" : "meta"}
                title="Whether the family profile has edits that are not saved to its document."
              >
                {draft.dirty ? `unsaved draft · ${unsavedCount}` : "saved"}
              </FactChip>
              {lane.fixture && (
                <FactChip
                  dashed
                  title="This page reads the checked-in family fixture. Bind a session and pick a profile to replace it with host state."
                >
                  fixture · no host
                </FactChip>
              )}
            </>
          }
        />
      }
      visual={<FamilyWorkspaceAnatomy />}
      table={<FamilyWorkspaceTable />}
      sidePanel={<FamilyWorkspaceDocPane />}
      pane={{
        inspectorSpan: "full",
        resize: {
          visual: {
            defaultSize: 220,
            minSize: 34,
            collapse: {
              collapsed: anatomyCollapsed,
              onCollapsedChange: setAnatomyCollapsed,
              collapsedSize: 34,
              collapseBelow: 90,
            },
          },
          inspector: { defaultSize: 340, minSize: 260, minOtherSize: 560 },
        },
      }}
    />
  );
}
