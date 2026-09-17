import { useState } from "react";

import { Pane, PaneSplit, PaneWorkspace, paneRecipe } from "#/components/lang/pane";
import { PaneResizeHandle, paneSplitRecipe } from "#/components/lang/pane-resize";
import { paneWorkspaceRecipe } from "#/components/lang/pane-workspace";
import { PickList, pickListRecipe } from "#/components/lang/pick-list";
import { Switch, switchRecipe } from "#/components/lang/switch";
import { Tooltip, UiTooltipProvider, tooltipRecipe } from "#/components/lang/tooltip";
import { OutcomeStrip } from "#/components/lang/outcome-strip";
import { Surface } from "#/components/lang/surface";
import { CATEGORY_OPTIONS } from "#/design-system/specimens-data";
import { RecipeGrid, SpecimenFrame } from "./recipe-grid";

const ITEMS = CATEGORY_OPTIONS.slice(0, 4).map((x) => ({ id: x.value, label: x.label }));

export function UiLayoutSpecimens() {
  const [active, setActive] = useState<string | null>(ITEMS[0]?.id ?? null);
  return (
    <>
      <SpecimenFrame name="Surface" importPath="#/components/lang/surface">
        <Surface head={<span>scroll-away head</span>}>
          <span>surface body</span>
        </Surface>
      </SpecimenFrame>
      <RecipeGrid
        name="Pane"
        importPath="#/components/lang/pane"
        recipe={paneRecipe}
        render={(props) => (
          <div className="h-32 w-56">
            <Pane
              kind={(props.kind as "navigation" | "visual" | "content" | "inspector") ?? "content"}
              scroll={props.scroll as "auto" | "clip" | "visible"}
              title="pane"
            >
              body
            </Pane>
          </div>
        )}
      />
      <RecipeGrid
        name="PaneSplit"
        importPath="#/components/lang/pane-resize"
        recipe={paneSplitRecipe}
        render={(props) => (
          <div className="h-24 w-64">
            <PaneSplit
              axis={(props.axis as "horizontal" | "vertical") ?? "horizontal"}
              grow={props.grow as boolean}
              start={<span>start</span>}
              end={<span>end</span>}
            />
          </div>
        )}
      />
      <RecipeGrid
        name="PaneWorkspace"
        importPath="#/components/lang/pane-workspace"
        recipe={paneWorkspaceRecipe}
        render={(props) => (
          <div className="h-32 w-96">
            <PaneWorkspace
              grow={props.grow as boolean}
              visual={<span>visual</span>}
              content={<span>content</span>}
            />
          </div>
        )}
      />
      <SpecimenFrame name="PaneResizeHandle" importPath="#/components/lang/pane-resize">
        <div className="h-20">
          <PaneResizeHandle
            axis="horizontal"
            value={20}
            min={0}
            growth={1}
            containerSize={() => 100}
            onResize={() => {}}
            onReset={() => {}}
          />
        </div>
      </SpecimenFrame>
      <RecipeGrid
        name="PickList"
        importPath="#/components/lang/pick-list"
        recipe={pickListRecipe}
        render={() => (
          <div className="h-40 w-64">
            <PickList items={ITEMS} activeId={active} onPick={setActive} />
          </div>
        )}
      />
      <RecipeGrid
        name="Switch"
        importPath="#/components/lang/switch"
        recipe={switchRecipe}
        render={(props) => <Switch size={props.size as "sm" | "default"} />}
      />
      <RecipeGrid
        name="Tooltip"
        importPath="#/components/lang/tooltip"
        recipe={tooltipRecipe}
        render={(props) => (
          <UiTooltipProvider>
            <Tooltip.Root defaultOpen>
              <Tooltip.Trigger
                kind={props.kind as "icon" | "label"}
                size={props.size as "default" | "compact"}
              >
                ?
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Positioner>
                  <Tooltip.Popup>tooltip</Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            </Tooltip.Root>
          </UiTooltipProvider>
        )}
      />
      <SpecimenFrame name="OutcomeStrip" importPath="#/components/lang/outcome-strip">
        <OutcomeStrip standing={<span>standing</span>} />
      </SpecimenFrame>
    </>
  );
}
