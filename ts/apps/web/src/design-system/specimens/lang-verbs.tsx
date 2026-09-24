import { RefreshCw, Save } from "lucide-react";

import { Press, pressRecipe } from "#/components/lang/press";
import { ActionButton, ActionGroup, actionRecipe } from "#/components/lang/action-button";
import { Section } from "#/components/lang/section";
import { SituationAction } from "#/route/situation-verbs";

import { RecipeGrid } from "./recipe-grid";

const noop = () => {};

/** A read verb, fresh or with Work Revit changed since the read: stale, the verb wears the mark. */
const handleOf = (changed: boolean) =>
  ({
    manifest: { actions: { read: { rereads: "work" } } },
    readings: {},
    work: { changed },
    outcome: null,
    busy: null,
    stop: noop,
  }) as never;
const readVerb = {
  label: "read families",
  says: "Read the drafted families from this exact document.",
  refusal: null,
  count: null,
  run: noop,
} as never;

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
        recipe={actionRecipe}
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
      <Section label="SituationAction · fresh · stale (caution edge and wash)">
        <span className="inline-flex gap-2">
          <SituationAction handle={handleOf(false)} name="read" action={readVerb} chord="R" />
          <SituationAction handle={handleOf(true)} name="read" action={readVerb} chord="R" />
        </span>
      </Section>
    </>
  );
}
