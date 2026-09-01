import { Workspace } from "#/components/anatomy";
import { FactChip } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { VerbLane } from "#/components/lang/verb-lane";
import { TargetingHead } from "#/targeting/head";
import { FamilyWorkspaceAnatomy } from "#/family/workspace-anatomy";
import { FamilyWorkspaceDocPane } from "#/family/workspace-doc-pane";
import { FamilyWorkspaceTable } from "#/family/workspace-table";
import { useFamilyWorkspace } from "#/family/workspace-context";

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
                    says={`${snapshot?.documentId.relativePath ?? "it"} — ${lane.parseError}. The page below is the declared fixture, not your file.`}
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
              {!lane.document && (
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
