import { Input, inputRecipe, Label, labelRecipe, Textarea, textareaRecipe } from "@pe/kit/lang/input";



import { RecipeGrid } from "./recipe-grid";

export function UiInputSpecimens() {
  return (
    <>
      <RecipeGrid
        name="Input"
        importPath="@pe/kit/lang/input"
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
        importPath="@pe/kit/lang/input"
        recipe={labelRecipe}
        render={() => <Label>parameter scope</Label>}
      />
      <RecipeGrid
        name="Textarea"
        importPath="@pe/kit/lang/input"
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
