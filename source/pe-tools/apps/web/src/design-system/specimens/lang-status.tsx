import { FactChip } from "#/components/lang/chip";
import { CoverageBar, coverageBarRecipe } from "#/components/lang/coverage-bar";
import { EmptyState, emptyStateRecipe } from "#/components/lang/empty";
import { HelpTip, helpTipRecipe } from "#/components/lang/help";
import { OutcomeLine, outcomeLineRecipe, type OutcomeKind } from "#/components/lang/outcome";
import { Provenance, Section, sectionRecipe } from "#/components/lang/section";
import { Switcher, switcherRecipe } from "#/components/lang/switcher";

import { RecipeGrid } from "./recipe-grid";

const noop = () => {};

export function LangStatusSpecimens() {
  return (
    <>
      <RecipeGrid
        name="CoverageBar"
        importPath="#/components/lang/coverage-bar"
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
        importPath="#/components/lang/empty"
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
      <RecipeGrid
        name="HelpTip"
        importPath="#/components/lang/help"
        recipe={helpTipRecipe}
        render={() => <HelpTip>What this region shows and how to read it.</HelpTip>}
      />
      <RecipeGrid
        name="OutcomeLine"
        importPath="#/components/lang/outcome"
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
        importPath="#/components/lang/section"
        recipe={sectionRecipe}
        render={() => (
          <Section
            label="loaded families"
            help={<HelpTip>What this section shows.</HelpTip>}
            aside={<FactChip title="Rows currently in scope.">214 rows</FactChip>}
          >
            <p>section content sits unenclosed</p>
            <Provenance>read 2026-08-16 14:02 · 3 sessions · fixture data</Provenance>
          </Section>
        )}
      />
      <RecipeGrid
        name="Switcher"
        importPath="#/components/lang/switcher"
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
