import { Pane, PaneSplit, paneRecipe } from "#/components/lang/pane";
import { PaneResizeHandle, paneSplitRecipe } from "#/components/lang/pane-resize";
import { Switch, switchRecipe } from "#/components/lang/switch";
import { Tooltip, TooltipTrigger, TooltipContent } from "@pe/kit/lang/tooltip";
import { Surface } from "#/components/lang/surface";
import { RecipeGrid, SpecimenFrame } from "./recipe-grid";

export function UiLayoutSpecimens() {
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
            <Pane scroll={props.scroll as "auto" | "clip" | "visible"} title="pane">
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
        name="Switch"
        importPath="#/components/lang/switch"
        recipe={switchRecipe}
        render={(props) => <Switch size={props.size as "sm" | "default"} />}
      />
      <SpecimenFrame name="Tooltip" importPath="@pe/kit/lang/tooltip">
        <Tooltip>
          <TooltipTrigger>Hover or focus</TooltipTrigger>
          <TooltipContent>A shared hint.</TooltipContent>
        </Tooltip>
      </SpecimenFrame>
    </>
  );
}
