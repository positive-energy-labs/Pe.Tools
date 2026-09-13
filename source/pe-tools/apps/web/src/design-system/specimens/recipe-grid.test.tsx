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
import { verbRecipe } from "#/components/lang/action-button";
import { dialogRecipe } from "#/components/lang/dialog";
import { inputGroupRecipe } from "#/components/lang/input-group";
import { selectRecipe } from "#/components/lang/select";
import { cardRecipe } from "#/components/lang/card";
import { comboboxRecipe } from "#/components/lang/combobox";
import { commandRecipe } from "#/components/lang/command";
import { inputRecipe } from "#/components/lang/input";
import { labelRecipe } from "#/components/lang/label";
import { paneRecipe } from "#/components/lang/pane";
import { paneSplitRecipe } from "#/components/lang/pane-resize";
import { paneWorkspaceRecipe } from "#/components/lang/pane-workspace";
import { sidePaneRecipe } from "#/components/lang/side-pane";
import { switchRecipe } from "#/components/lang/switch";
import { textareaRecipe } from "#/components/lang/textarea";
import { valueDiffRecipe } from "#/components/lang/value-diff";
import { pickListRecipe } from "#/components/lang/pick-list";
import { tooltipRecipe } from "#/components/lang/tooltip";

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
  cardRecipe,
  comboboxRecipe,
  commandRecipe,
  inputRecipe,
  labelRecipe,
  paneRecipe,
  paneSplitRecipe,
  paneWorkspaceRecipe,
  sidePaneRecipe,
  switchRecipe,
  textareaRecipe,
  valueDiffRecipe,
  pickListRecipe,
  tooltipRecipe,
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
