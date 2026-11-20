import { Button } from "@pe/kit/lang/button";
import { EmptyState } from "@pe/kit/lang/empty";
import { useList } from "@pe/kit/lang/collection";
import { Input } from "@pe/kit/lang/input";
import { PlainList } from "@pe/kit/lang/list-view";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { refusalOf } from "@pe/web-kernel/route/typed-route";
import { captures, plans, type AdoptionContext } from "../routes/takeoffs/route.ts";
import { useStaged } from "./staged.ts";

type Row = AdoptionContext["value"]["value"]["rows"][number];
/** The ticked rows as the adopt command takes them: one entry per plan, by its UniqueId. */
export function adoptRequest(rows: readonly Row[]) {
  const views = new Map<string, { elementId: number; name: string; systemTag: string }[]>();
  for (const row of rows.filter((row) => row.checked))
    views.set(row.view, [
      ...(views.get(row.view) ?? []),
      { elementId: row.elementId, name: row.name, systemTag: row.systemTag },
    ]);
  return views.size ? { views: [...views].map(([view, items]) => ({ view, items })) } : null;
}

export function AdoptionBody({ ctx }: { ctx: AdoptionContext }) {
  const page = ctx.page.read();
  const { rows, carriers, unreadable } = ctx.value.value;
  const catalogue = ctx.read(plans);
  const levels = "value" in catalogue ? (catalogue.value?.levels ?? []) : [];
  const saved = ctx.read(captures);
  const archive = "value" in saved ? saved.value : undefined;
  const staged = useStaged(ctx.cells);
  const request = adoptRequest(rows);
  const blocked = staged.pending ? "Preparing Work" : refusalOf(ctx.cells.state);
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
          label="can't read, kept"
          says={`${row.parameter}: ${row.reason}`}
        />
      ))}
      {staged.problem && <OutcomeLine kind="error" label="Adoption" says={staged.problem} />}
      {"value" in catalogue ? null : ctx.absent(catalogue)}
      <fieldset>
        <legend>Plans</legend>
        {levels.flatMap((level) =>
          level.views.map((plan) => (
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
      </fieldset>
      <div className="flex gap-2 py-1">
        <Button label="refresh" onClick={() => ctx.refresh()}>
          refresh
        </Button>
        <Button
          label="initialize"
          busy={staged.pending === "takeoffs.initialize" || ctx.verb("initialize").pending}
          refusal={
            blocked ??
            (carriers.status === "needs-initialization"
              ? null
              : "The document already carries every shared parameter")
          }
          onClick={() =>
            void staged.run(
              "takeoffs.initialize",
              { stage: carriers.stage },
              ctx.verb("initialize"),
              "Prepare initialize",
            )
          }
        >
          initialize
        </Button>
        <Button
          label="adopt"
          busy={staged.pending === "takeoffs.adopt" || ctx.verb("adopt").pending}
          refusal={blocked ?? (request ? null : "Select regions to adopt")}
          onClick={() =>
            void staged.run("takeoffs.adopt", request, ctx.verb("adopt"), "Prepare adopt")
          }
        >
          adopt
        </Button>
      </div>
      {carriers.missing.length > 0 && (
        <p>
          {carriers.stage}: {carriers.missing.length} shared parameters are missing.
        </p>
      )}
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
        {archive?.saved && (
          <SavedZones zones={archive.saved.snapshot.world.zones} />
        )}
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
