import { Button } from "@pe/kit/lang/button";
import { EmptyState } from "@pe/kit/lang/empty";
import { useList } from "@pe/kit/lang/collection";
import { Input } from "@pe/kit/lang/input";
import { PlainList } from "@pe/kit/lang/list-view";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { captures, plans, type AdoptionContext } from "../routes/takeoffs/route.ts";
import { PreviewAction } from "@pe/kit/lang/write-action";

type Row = AdoptionContext["value"]["value"]["rows"][number];
export function AdoptionBody({ ctx }: { ctx: AdoptionContext }) {
  const page = ctx.page.read();
  const { rows, unreadable, missingViews } = ctx.value.value;
  const catalogue = ctx.read(plans);
  const levels = "value" in catalogue ? (catalogue.value?.levels ?? []) : [];
  const saved = ctx.read(captures);
  const archive = "value" in saved ? saved.value : undefined;
  const choose = (row: Row, patch: Partial<Pick<Row, "checked" | "name" | "systemTag">>) =>
    void ctx.cells
      .at(["adopt", row.key])
      .stage(
        { checked: row.checked, name: row.name, systemTag: row.systemTag, ...patch },
        { label: "Edit adoption choice" },
      );
  return (
    <section aria-label="Adopt zoning regions" className="py-2 whitespace-normal">
      {unreadable.map((row, index) => (
        <OutcomeLine
          key={index}
          kind="refused"
          label="Unreadable record"
          says={`${row.parameter}: ${row.reason}`}
        />
      ))}
      {"value" in catalogue ? null : ctx.absent(catalogue)}
      <fieldset>
        <legend>Plans</legend>
        {levels.flatMap((level) =>
          level.views
            .filter((plan) => !missingViews.includes(plan.view))
            .map((plan) => (
              <label key={plan.view} className="flex items-center gap-2">
                <Input
                  type="checkbox"
                  checked={page.views.includes(plan.view)}
                  onChange={(event) =>
                    ctx.page.query({
                      views: event.target.checked
                        ? [...page.views, plan.view]
                        : page.views.filter((view) => view !== plan.view),
                    })
                  }
                />
                {level.name} · {plan.name} · {plan.type}
              </label>
            )),
        )}
        {missingViews.map((view) => (
          <label key={view} className="flex items-center gap-2">
            <Input
              type="checkbox"
              checked={page.views.includes(view)}
              onChange={() => ctx.page.query({ views: page.views.filter((id) => id !== view) })}
            />
            Missing plan: {view}
          </label>
        ))}
      </fieldset>
      <div className="flex gap-2 py-1">
        <Button label="refresh" onClick={() => ctx.refresh()}>
          refresh
        </Button>
        <PreviewAction
          handle={ctx.verb("adopt")}
          label="adopt"
          refusal={rows.some((row) => row.checked) ? null : "Select regions to adopt"}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState story="scope" exit="Choose plans that hold designer-drawn regions">
          No regions on the chosen plans
        </EmptyState>
      ) : (
        rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2 py-1">
            <Input
              type="checkbox"
              aria-label={`Select ${row.name} in ${row.viewName}`}
              checked={row.checked}
              onChange={(event) => choose(row, { checked: event.target.checked })}
            />
            <Input
              aria-label={`Name of ${row.name}`}
              key={row.name}
              defaultValue={row.name}
              onBlur={(event) =>
                event.target.value !== row.name && choose(row, { name: event.target.value })
              }
            />
            <Input
              aria-label={`System tag of ${row.name}`}
              key={`tag:${row.systemTag}`}
              defaultValue={row.systemTag}
              placeholder="System tag"
              onBlur={(event) =>
                event.target.value !== row.systemTag &&
                choose(row, { systemTag: event.target.value })
              }
            />
            <span>
              {row.viewName} · {Math.round(row.sqft)} sf{row.adopted ? " · adopted" : ""}
              {row.unreadable ? ` · can't read: ${row.unreadable}` : ""}
            </span>
          </div>
        ))
      )}
      <fieldset>
        <legend>Saved captures</legend>
        <select
          aria-label="Saved capture"
          value={page.capture}
          onChange={(event) => ctx.page.query({ capture: event.target.value })}
        >
          <option value="">Live document</option>
          {archive?.captures.map((row) => (
            <option key={row.id} value={row.id}>
              {row.title || row.id} · {row.capturedAt}
            </option>
          ))}
        </select>
        {archive?.saved && <SavedZones zones={archive.saved.snapshot.world.zones} />}
      </fieldset>
    </section>
  );
}

/** The zones a saved capture holds: read only, nothing to pick. */
function SavedZones({
  zones,
}: {
  zones: readonly {
    name: string;
    stage: string;
    zone: { guid: string; declaredSqft: number; lane: { label: string } };
  }[];
}) {
  const list = useList({
    items: zones,
    keyOf: (row) => row.zone.guid,
    search: (row) => ({ text: [row.name] }),
    select: "none",
  });
  return (
    <PlainList
      list={list}
      aria-label="Saved takeoff zones"
      empty={{ message: "No adopted zones in this saved takeoff", exit: "Open the live document" }}
      row={(row) => ({
        label: row.name,
        meta: `${row.zone.lane.label} · ${row.zone.declaredSqft} sf · ${row.stage}`,
      })}
    />
  );
}
