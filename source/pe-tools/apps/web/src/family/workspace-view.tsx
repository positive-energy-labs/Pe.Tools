import { JsonView } from "#/settings-panes/json-editor";
import { ActionButton } from "#/components/lang/action-button";
import { Workspace } from "#/components/anatomy";
import { FactChip } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { RouteShell } from "#/route";
import { manifest } from "#/family/manifest";
import { FamilyWorkspaceAnatomy } from "#/family/workspace-anatomy";
import { FamilyWorkspaceDocPane } from "#/family/workspace-doc-pane";
import { FamilyWorkspaceTable } from "#/family/workspace-table";
import { useFamilyWorkspace } from "#/family/workspace-context";
import { warningLine } from "#/host/familyfoundry";

export function FamilyWorkspaceView() {
  const {
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
  const reconciliation = store.reconciliation;
  const evidence = store.evidence;
  const sharedEdit = store.sharedEdit;
  return (
    <Workspace
      className="[&_[data-slot=pane-header]_h2]:text-ink [&_[data-kind=content]_[data-slot=pane-header]]:boundary-t [&_[data-kind=inspector]_[data-slot=pane-body]]:p-0"
      headRail={
        <RouteShell
          manifest={manifest}
          handle={store.handle}
          aside={
            <>
              {lane.parseError != null ? (
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
              ) : null}
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
                // Work's adopted rawContent, shown exactly as stored. composedContent is set
                // equal to rawContent by settingsWorkSnapshot, so a second pane would repeat
                // this string under a name that claims a composition nobody performed.
                <details>
                  <summary>Edit basis · raw text</summary>
                  <div className="max-h-64 max-w-2xl overflow-auto">
                    <JsonView code={snapshot.rawContent} />
                  </div>
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
              <>
                <ActionButton
                  tone="act"
                  label="plan current family"
                  reason="Plan the saved JSON against the current family document."
                  onClick={() => void store.actions.plan().catch(() => undefined)}
                />
                <ActionButton
                  tone="commit"
                  label="apply reviewed plan"
                  disabled={!reconciliation.plan || reconciliation.plan.entry.refusals.length > 0}
                  reason="Review a valid plan first. Applies the saved JSON without saving the Revit document."
                  onClick={() => void store.actions.apply().catch(() => undefined)}
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
              {validation && (
                <FactChip
                  tone={validation.isValid ? "done" : "caution"}
                  title={
                    validation.isValid
                      ? "This text parses as JSON. That is all this check proves — it is a local JSON.parse of the shown value, not host schema validation."
                      : `This text does not parse as JSON: ${validationSays}`
                  }
                >
                  {validation.isValid
                    ? "JSON parses"
                    : `${validation.issues.length} parse issue${validation.issues.length === 1 ? "" : "s"}`}
                </FactChip>
              )}
              <FactChip
                tone={draft.dirty ? "caution" : "meta"}
                title="Whether the family profile has edits that are not saved to its document."
              >
                {draft.dirty ? `unsaved draft · ${unsavedCount}` : "saved"}
              </FactChip>
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
