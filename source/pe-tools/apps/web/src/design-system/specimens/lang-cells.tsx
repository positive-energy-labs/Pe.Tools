import { CellStateKey, cellStateKeyRecipe } from "#/components/lang/cell-key";
import { StateCell, stateCellRecipe } from "#/components/lang/cell";
import { FactChip, NarrowChip, Tag, chipRecipe } from "#/components/lang/chip";

import { RecipeGrid } from "./recipe-grid";

const noop = () => {};

export function LangCellSpecimens() {
  return (
    <>
      <RecipeGrid
        name="StateCell"
        importPath="#/components/lang/cell"
        recipe={stateCellRecipe}
        render={(props) => {
          const row = props.size === "row";
          const locate = props.state === "locate" ? noop : undefined;
          return (
            <div className={row ? "w-36" : "w-44"}>
              <StateCell
                value="36 in"
                scale={row ? "row" : "card"}
                stage="staged"
                onLocate={locate}
              />
            </div>
          );
        }}
      />
      <RecipeGrid
        name="CellStateKey"
        importPath="#/components/lang/cell-key"
        recipe={cellStateKeyRecipe}
        render={() => <CellStateKey />}
      />
      <RecipeGrid
        name="FactChip · NarrowChip · Tag"
        importPath="#/components/lang/chip"
        recipe={chipRecipe}
        render={(props) => (
          <div className="flex flex-wrap items-center gap-2">
            <FactChip
              tone={props.tone as "meta" | "caution" | "done" | "alarm" | "pea"}
              dashed={props.state === "seam"}
              title={`${props.tone} · ${props.state}`}
            >
              42 written
            </FactChip>
            <NarrowChip
              label="needs a person"
              count={3}
              title="Removing this widens the view."
              onRemove={noop}
            />
            <Tag>door 421</Tag>
          </div>
        )}
      />
    </>
  );
}
