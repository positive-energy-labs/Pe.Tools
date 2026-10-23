import { ActivityDisclosure } from "@pe/kit/lang/activity";
import { FactChip } from "@pe/kit/lang/chip";
import { CoverageBar, coverageBarRecipe } from "@pe/kit/lang/coverage-bar";
import { EmptyState, emptyStateRecipe } from "@pe/kit/lang/empty";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { OutcomeLine, outcomeLineRecipe, type OutcomeKind } from "@pe/kit/lang/outcome";
import { Provenance, Section, sectionRecipe } from "@pe/kit/lang/section";
import { Switcher, switcherRecipe } from "@pe/kit/lang/switcher";

import { RecipeGrid, SpecimenFrame } from "./recipe-grid";

const noop = () => {};

export function LangStatusSpecimens() {
  return (
    <>
      <SpecimenFrame name="ActivityDisclosure" importPath="@pe/kit/lang/activity">
        <ActivityDisclosure summary="2 unresolved" tone="caution">
          <div>lost write: the document moved on before the apply landed</div>
          <div className="text-ink-2">reading families: waiting on the session</div>
        </ActivityDisclosure>
      </SpecimenFrame>
      <RecipeGrid
        name="CoverageBar"
        importPath="@pe/kit/lang/coverage-bar"
        recipe={coverageBarRecipe}
        render={() => (
          <div className="w-[28rem]">
            <CoverageBar
              segments={[
                { label: "grounded", count: 34, viz: 2 },
                { label: "staged", count: 11, viz: 1 },
                { label: "unread", count: 6, viz: 6 },
              ]}
              total={60}
            />
          </div>
        )}
      />
      <RecipeGrid
        name="EmptyState"
        importPath="@pe/kit/lang/empty"
        recipe={emptyStateRecipe}
        render={(props) => (
          <EmptyState
            story={props.state as "scope" | "filter"}
            exit={props.state === "scope" ? "run capture on this level" : "clear the filter"}
          >
            {props.state === "scope" ? "no zones on this level" : "0 of 124 rooms match"}
          </EmptyState>
        )}
      />
      <SpecimenFrame name="TooltipHint" importPath="@pe/kit/lang/tooltip">
        <TooltipHint>
          <TooltipHint content="Return to the swatch">
            <a href="/design-system/swatch">swatch¹</a>
          </TooltipHint>
        </TooltipHint>
      </SpecimenFrame>
      <RecipeGrid
        name="OutcomeLine"
        importPath="@pe/kit/lang/outcome"
        recipe={outcomeLineRecipe}
        render={(props) => (
          <OutcomeLine
            kind={props.state as OutcomeKind}
            label={props.state === "receipt" ? "42 parameters written" : `${props.state} outcome`}
            says="fixture result"
          />
        )}
      />
      <RecipeGrid
        name="Section · Provenance"
        importPath="@pe/kit/lang/section"
        recipe={sectionRecipe}
        render={() => (
          <Section
            label="loaded families"
            help={<TooltipHint>What this section shows.</TooltipHint>}
            aside={<FactChip title="Rows currently in scope.">214 rows</FactChip>}
          >
            <p>section content sits unenclosed</p>
            <Provenance>read 2026-08-16 14:02 · 3 sessions · fixture data</Provenance>
          </Section>
        )}
      />
      <RecipeGrid
        name="Switcher"
        importPath="@pe/kit/lang/switcher"
        recipe={switcherRecipe}
        render={(props) => {
          const state = props.state;
          return (
            <Switcher
              ariaLabel="parameter scope"
              value={state === "active" ? "target" : "other"}
              onChange={noop}
              options={[
                {
                  value: "target",
                  label: String(state),
                  title: `state=${state}`,
                  disabled: state === "disabled",
                },
                { value: "other", label: "other", title: "comparison" },
              ]}
            />
          );
        }}
      />
    </>
  );
}
