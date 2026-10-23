import { LeaderDiagram } from "@pe/kit/lang/leader-diagram";
import { CellStateKey, cellStateKeyRecipe, StateCell, stateCellRecipe } from "@pe/kit/lang/cell";

import { FactChip, FileChip, MentionChip, NarrowChip, Tag, chipRecipe } from "@pe/kit/lang/chip";

import { RecipeGrid } from "./recipe-grid";

const noop = () => {};

const CFM = { label: "cfm" };
const INWG = { label: "in-wg", short: "wg" };

/** Cells keep their editing width and wrap at the left edge; notes yield before the values. */
function UnitCellSpecimen({ width }: { width: number }) {
  const item = (value: string, unit: typeof CFM, note: string) => (
    <span className="dl-cells-item">
      <StateCell
        damage={value === "" ? "no price" : undefined}
        value={value}
        cap="editable"
        scale="row"
        unit={unit}
        numeric={{ min: 0, digits: 2 }}
        onCommit={noop}
      />
      <span className="dl-cells-note t-small">{note}</span>
    </span>
  );
  return (
    <div style={{ width }} data-specimen-width={width}>
      <span className="dl-cells">
        {item("1200", CFM, "override")}
        {item("", INWG, "from table")}
        {item("0.5", INWG, "Pea proposes")}
      </span>
    </div>
  );
}

export function LangCellSpecimens() {
  return (
    <>
      <LeaderDiagram
        label="Leader diagram"
        items={[
          { key: "duct", at: [0.25], label: "duct", value: "0.200" },
          { key: "fitting", at: [0.75], label: "fitting", value: "0.200" },
        ]}
      />
      <div className="flex flex-col gap-3 p-2" data-specimen="unit-cell">
        <p className="t-small text-ink-2">StateCell unit (always-on suffix) at 270, 360, 520 px</p>
        {[270, 360, 520].map((w) => (
          <UnitCellSpecimen key={w} width={w} />
        ))}
      </div>
      <RecipeGrid
        name="StateCell"
        importPath="@pe/kit/lang/cell"
        recipe={stateCellRecipe}
        render={(props) => {
          const row = props.size === "row";
          const locate = props.state === "locate" ? noop : undefined;
          return (
            <div className={row ? "w-36" : "w-44"}>
              <StateCell
                value="36 in"
                scale={row ? "row" : "card"}
                stage="staged"
                onLocate={locate}
              />
            </div>
          );
        }}
      />
      <RecipeGrid
        name="CellStateKey"
        importPath="@pe/kit/lang/cell"
        recipe={cellStateKeyRecipe}
        render={() => <CellStateKey />}
      />
      <RecipeGrid
        name="FactChip · NarrowChip · FileChip · MentionChip · Tag"
        importPath="@pe/kit/lang/chip"
        recipe={chipRecipe}
        render={(props) => (
          <div className="flex flex-wrap items-center gap-2">
            <FactChip dashed={props.state === "seam"} title={`neutral fact · ${props.state}`}>
              42 written
            </FactChip>
            <NarrowChip
              label="needs a person"
              count={3}
              title="Removing this widens the view."
              onRemove={noop}
            />
            <FileChip
              name="damper-submittal.pdf"
              meta="180.0 KB"
              title="A PDF opens in the browser"
              open={noop}
            />
            <FileChip
              name="riser-notes.txt"
              meta="640 B"
              title="Attached to the next message"
              onRemove={noop}
            />
            <NarrowChip
              label="Count"
              detail="> 1"
              title="Click the label to edit; removing it widens the view."
              onRemove={noop}
              onEdit={noop}
            />
            <MentionChip
              label="Operations Demo.rvt"
              kind="document"
              pointer="doc:pe.app-26/open-1"
              facts={{ session: "pe.app-26", openId: "open-1", family: false }}
              takenAt="2026-08-30T19:29:00.000Z"
              onRemove={noop}
            />
            <Tag>door 421</Tag>
          </div>
        )}
      />
    </>
  );
}
