import { Pane, PaneSplit, paneRecipe } from "@pe/kit/lang/pane";
import { paneSplitRecipe } from "@pe/kit/lang/pane-resize";
import { Switch, switchRecipe } from "@pe/kit/lang/switch";
import { Tooltip, TooltipTrigger, TooltipContent } from "@pe/kit/lang/tooltip";
import { Surface } from "@pe/kit/lang/surface";
import { Button } from "@pe/kit/lang/button";
import { RecipeGrid, SpecimenFrame } from "./recipe-grid";

export function UiLayoutSpecimens() {
  return (
    <>
      <SpecimenFrame name="Surface" importPath="@pe/kit/lang/surface">
        <Surface head={<span>scroll-away head</span>}>
          <span>surface body</span>
        </Surface>
      </SpecimenFrame>
      <RecipeGrid
        name="Pane"
        importPath="@pe/kit/lang/pane"
        recipe={paneRecipe}
        render={(props) => (
          <div className="h-32 w-56">
            <Pane scroll={props.scroll as "auto" | "clip" | "visible"} title="pane">
              body
            </Pane>
          </div>
        )}
      />
      <SpecimenFrame name="Pane work and local outcomes" importPath="@pe/kit/lang/pane">
        <div className="h-32 w-80">
          <Pane title="capture">
            <Button
              label="capture meshes"
              onPress={async () => {
                await new Promise((resolve) => setTimeout(resolve, 1200));
                return { kind: "receipt", label: "meshes captured" };
              }}
            >
              capture meshes
            </Button>
          </Pane>
        </div>
      </SpecimenFrame>
      <RecipeGrid
        name="PaneSplit"
        importPath="@pe/kit/lang/pane-resize"
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
      <SpecimenFrame name="Pane resize corners" importPath="@pe/kit/lang/pane-resize">
        <div className="h-32 w-80">
          <PaneSplit
            axis="horizontal"
            start={<Pane>subject</Pane>}
            end={<Pane>resize from either corner</Pane>}
            resize={{ target: "end", defaultSize: 160, minSize: 80 }}
          />
        </div>
      </SpecimenFrame>
      <RecipeGrid
        name="Switch"
        importPath="@pe/kit/lang/switch"
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
