import { Input, inputRecipe } from "#/components/lang/input";
import { Label, labelRecipe } from "#/components/lang/label";
import { Textarea, textareaRecipe } from "#/components/lang/textarea";
import { RecipeGrid } from "./recipe-grid";

export function UiInputSpecimens() {
  return (
    <>
      <RecipeGrid
        name="Input"
        importPath="#/components/lang/input"
        recipe={inputRecipe}
        render={(props) => (
          <Input
            type={props.kind === "check" ? "checkbox" : undefined}
            surface={props.surface as "field" | "embedded"}
            aria-label={props.kind === "check" ? "include row" : undefined}
            placeholder="search params"
            defaultChecked={props.kind === "check" ? true : undefined}
          />
        )}
      />
      <RecipeGrid
        name="Label"
        importPath="#/components/lang/label"
        recipe={labelRecipe}
        render={() => <Label>parameter scope</Label>}
      />
      <RecipeGrid
        name="Textarea"
        importPath="#/components/lang/textarea"
        recipe={textareaRecipe}
        render={(props) => (
          <Textarea
            size={props.size as "compact" | "normal" | "tall"}
            surface={props.surface as "field" | "embedded"}
            placeholder="why this write is happening"
          />
        )}
      />
    </>
  );
}
