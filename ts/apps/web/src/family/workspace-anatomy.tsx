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
    inspect,
    setInspect,
    wire,
    cells,
    value,
  } = useFamilyWorkspace();
  return (
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
      refusalAt={(key) => wire.lockOf?.(key) ?? null}
      cells={cells}
      value={value}
    />
  );
}
