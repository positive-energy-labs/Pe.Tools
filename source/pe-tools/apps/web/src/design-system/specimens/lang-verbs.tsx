import { RefreshCw, Save } from "lucide-react";

import { Press, pressRecipe } from "#/components/lang/press";
import { Verb, VerbGroup, verbRecipe } from "#/components/lang/verb";

import { RecipeGrid } from "./recipe-grid";

const noop = () => {};

export function LangVerbSpecimens() {
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
        name="Verb · VerbGroup"
        importPath="#/components/lang/verb"
        recipe={verbRecipe}
        render={(props) => {
          const tone = props.tone as "act" | "commit" | "nav" | "agent";
          const verb =
            tone === "nav" ? (
              <Verb
                tone="nav"
                direction="forward"
                label="open"
                reason="Opens the selected item"
                onClick={noop}
              />
            ) : (
              <Verb
                tone={tone}
                label={tone === "commit" ? "save profile" : tone}
                icon={tone === "commit" ? Save : RefreshCw}
                reason={`Runs the ${tone} action`}
                onClick={noop}
              />
            );
          return (
            <VerbGroup title="writes beyond the page" radius="document · model · external">
              {verb}
            </VerbGroup>
          );
        }}
      />
    </>
  );
}
