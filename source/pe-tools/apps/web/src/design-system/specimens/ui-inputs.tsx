import { Search } from "lucide-react";

import { Input, inputRecipe } from "#/components/lang/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  inputGroupRecipe,
} from "#/components/lang/input-group";
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
        name="InputGroup"
        importPath="#/components/lang/input-group"
        recipe={inputGroupRecipe}
        render={(props) => (
          <div className="w-56">
            <InputGroup>
              <InputGroupAddon
                align={props.align as "inline-start" | "inline-end" | "block-start" | "block-end"}
              >
                <InputGroupButton
                  size={props.size as "xs" | "sm" | "icon-xs" | "icon-sm"}
                  aria-label="search"
                >
                  <Search />
                </InputGroupButton>
              </InputGroupAddon>
              <InputGroupInput placeholder="search" />
            </InputGroup>
          </div>
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
