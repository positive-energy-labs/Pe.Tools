import { Pane } from "#/components/lang/pane";
import { ActionButton } from "#/components/lang/action-button";
import { AnatomyDrawing } from "#/family/anatomy";
import { useFamilyWorkspace } from "#/family/workspace-context";

export function FamilyWorkspaceAnatomy() {
  const {
    lane,
    world,
    draft,
    stageType,
    setFocus,
    focusedParts,
    focusedParams,
    anatomyCollapsed,
    setAnatomyCollapsed,
    inspect,
    setInspect,
  } = useFamilyWorkspace();
  return (
    <Pane
      kind="visual"
      flush
      headerSurface="recess"
      title="anatomy"
      meta={anatomyCollapsed ? "collapsed" : stageType}
      help={
        anatomyCollapsed
          ? "The drawing is collapsed. Its header strip stays, so the drawing is one click away and nothing about the page's shape changes."
          : `Drawn from the ${stageType} type's own numbers in the profile — a reading of the document, not a render of Revit.`
      }
      actions={
        <ActionButton
          label={anatomyCollapsed ? "show" : "hide"}
          onClick={() => setAnatomyCollapsed((current) => !current)}
          reason={
            anatomyCollapsed
              ? "Show the drawing again. It is drawn from the profile's own numbers for the type on stage — it is a reading of the document, not a render of Revit."
              : "Collapse the drawing. Its header strip stays, so nothing about the page's shape changes except the height."
          }
        />
      }
    >
      <AnatomyDrawing
        world={world}
        draft={draft}
        typeName={stageType}
        model={lane.drawingModel}
        focusedParts={focusedParts}
        focusedParams={focusedParams}
        onFocus={setFocus}
        onInspect={(slug) => setInspect({ kind: "part", slug })}
        inspecting={inspect?.kind === "part" ? inspect.slug : null}
      />
    </Pane>
  );

  // ── the table pane, in whichever mode ─────────────────────────────────────────────────────────

  /**
   * Ghost rows are ORDINARY to the focus and rail laws and marked to the eye, and both halves of
   * that matter. The hairline opens the section; the muted band says "everything below here is a
   * number nothing can reach".
   *
   * That claim survives SORTING: both sortable columns carry a pin rank in front of their key
   * (see pinnedSort), so the partition holds in both directions and the hairline always means the
   * same thing.
   */
}
