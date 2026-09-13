import { RefreshCw, Save } from "lucide-react";

import { Press, pressRecipe } from "#/components/lang/press";
import { ActionButton, ActionGroup, verbRecipe } from "#/components/lang/action-button";

import { RecipeGrid } from "./recipe-grid";

const noop = () => {};

export function LangPressSpecimens() {
  return (
    <>
      <RecipeGrid
        name="Press"
        importPath="#/components/lang/press"
        recipe={pressRecipe}
        render={(props) => (
          <Press
            tone={props.tone as React.ComponentProps<typeof Press>["tone"]}
            size={props.size as React.ComponentProps<typeof Press>["size"]}
            state={props.state as React.ComponentProps<typeof Press>["state"]}
            aria-pressed={props.state === "selectable"}
          >
            {String(props.size).startsWith("icon") ? <RefreshCw className="size-3" /> : "raw json"}
          </Press>
        )}
      />
      <RecipeGrid
        name="ActionButton · ActionGroup"
        importPath="#/components/lang/action-button"
        recipe={verbRecipe}
        render={(props) => {
          const tone = props.tone as "act" | "commit" | "nav" | "agent";
          const verb =
            tone === "nav" ? (
              <ActionButton
                tone="nav"
                direction="forward"
                label="open"
                reason="Opens the selected item"
                onClick={noop}
              />
            ) : (
              <ActionButton
                tone={tone}
                label={tone === "commit" ? "save profile" : tone}
                icon={tone === "commit" ? Save : RefreshCw}
                reason={`Runs the ${tone} action`}
                onClick={noop}
              />
            );
          return (
            <ActionGroup title="writes beyond the page" radius="document · model · external">
              {verb}
            </ActionGroup>
          );
        }}
      />
    </>
  );
}
