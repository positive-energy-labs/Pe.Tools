import { describe, expect, it } from "vite-plus/test";

import { addressingBarRecipe } from "#/components/lang/addressing-bar";
import { armingStripRecipe } from "#/components/lang/arming-strip";
import { artifactFrameRecipe } from "#/components/lang/artifact-frame";
import { cellStateKeyRecipe } from "#/components/lang/cell-key";
import { stateCellRecipe } from "#/components/lang/cell";
import { chipRecipe } from "#/components/lang/chip";
import { coverageBarRecipe } from "#/components/lang/coverage-bar";
import { emptyStateRecipe } from "#/components/lang/empty";
import { helpTipRecipe } from "#/components/lang/help";
import { outcomeLineRecipe } from "#/components/lang/outcome";
import { pressRecipe } from "#/components/lang/press";
import { sectionRecipe } from "#/components/lang/section";
import { switcherRecipe } from "#/components/lang/switcher";
import { verbRecipe } from "#/components/lang/verb";
import { dialogRecipe } from "#/components/ui/dialog";
import { inputGroupRecipe } from "#/components/ui/input-group";
import { selectRecipe } from "#/components/ui/select";

import { recipeVariantProps } from "./recipe-grid";

const RECIPES = {
  addressingBarRecipe,
  armingStripRecipe,
  artifactFrameRecipe,
  cellStateKeyRecipe,
  stateCellRecipe,
  chipRecipe,
  coverageBarRecipe,
  emptyStateRecipe,
  helpTipRecipe,
  outcomeLineRecipe,
  pressRecipe,
  sectionRecipe,
  switcherRecipe,
  verbRecipe,
  dialogRecipe,
  inputGroupRecipe,
  selectRecipe,
};

describe("recipe swatch grids", () => {
  for (const [name, recipe] of Object.entries(RECIPES)) {
    it(`${name} renders every closed variant value`, () => {
      const specimens = recipeVariantProps(recipe);
      expect(specimens.length).toBeGreaterThan(0);
      for (const [axis, values] of Object.entries(recipe.variants))
        for (const value of Object.keys(values))
          expect(
            specimens.some((props) => String(props[axis]) === value),
            `${name}.${axis}=${value}`,
          ).toBe(true);
    });
  }
});
