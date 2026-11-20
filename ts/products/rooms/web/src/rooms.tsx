import { Button } from "@pe/kit/lang/button";
import { useState } from "react";
import { emptyListState, useList } from "@pe/kit/lang/collection";
import { Input } from "@pe/kit/lang/input";
import { PlainList } from "@pe/kit/lang/list-view";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { refusalOf } from "@pe/web-kernel/route/typed-route";
import { product, ROOM_FIELDS } from "@pe/rooms-contract/product";
import { plans, type RoomsContext } from "../routes/rooms/route.ts";
import { useStaged } from "./staged.ts";

type Region = RoomsContext["value"]["value"]["regions"][number];
type Field = (typeof ROOM_FIELDS)[number];
const roleWord = { zone: "Zone", room: "Room", held: "Held" } as const;
/** An unset type is said, never shown as an empty cell or as the first choice. */
export const typeWord = (type: string) => type.trim() || "No type";
/** Locked and stale are separate facts: a locked room can also be stale. */
export const factsOf = (row: Pick<Region, "locked" | "stale" | "touched" | "reason">) =>
  [
    row.locked && "locked",
    row.stale && "stale",
    row.touched && "edited",
    row.reason && `held: ${row.reason}`,
  ].filter((fact): fact is string => !!fact);

export function RosterBody({ ctx }: { ctx: RoomsContext }) {
  const page = ctx.page.read();
  const catalogue = ctx.read(plans);
  const levels = "value" in catalogue ? (catalogue.value?.levels ?? []) : [];
  const staged = useStaged(ctx.cells);
  const selected = new Set(page.selected.map(({ id }) => id));
  const regions = ctx.value.value.regions;
  const merging = regions.filter((row) => row.role === "room" && selected.has(row.subject));
  // The picked rooms are the page's selection: the list and the plan picture show the same picks.
  const [view, setView] = useState(emptyListState);
  const list = useList({
    items: regions,
    keyOf: (row) => row.subject,
    search: (row) => ({ text: [roleWord[row.role], row.name] }),
    select: "multi",
    // A plain click picks that one room; Ctrl and Shift add to the picks, as in any list.
    onPick: (row) => ctx.selection.set([{ kind: "focus", id: row.subject }]),
    state: { ...view, selected: [...selected] },
    onState: (next) => {
      setView(next);
      if (next.selected.join() !== [...selected].join())
        ctx.selection.set(
          regions
            .filter((row) => next.selected.includes(row.subject))
            .map((row) => ({ kind: "focus", id: row.subject })),
        );
    },
  });
  const busy = ctx.value.state === "refreshing";
  const blocked = staged.pending ? "Preparing Work" : refusalOf(ctx.cells.state);
  return (
    <section aria-label="Rooms" className="py-2 whitespace-normal">
      <label>
        Plan{" "}
        <select
          aria-label="Plan"
          value={page.view}
          // The plan is the address: another plan clears the picked rooms.
          onChange={(event) => {
            ctx.selection.set([]);
            ctx.page.query({ view: event.target.value });
          }}
        >
          <option value="">Choose a plan</option>
          {levels.flatMap((level) =>
            level.views.map((plan) => (
              // Two plans of a level may share a name; the type tells them apart.
              <option key={plan.view} value={plan.view}>
                {level.name} · {plan.name} · {plan.type}
              </option>
            )),
          )}
        </select>
      </label>
      {"value" in catalogue ? null : ctx.absent(catalogue)}
      {ctx.value.value.missing && (
        <OutcomeLine kind="refused" label="Plan" says={`${ctx.value.value.missing} Choose a plan.`} />
      )}
      {ctx.value.value.unreadable.map((row, index) => (
        <OutcomeLine
          key={index}
          kind="refused"
          label="can't read, kept"
          says={`${row.parameter}: ${row.reason}`}
        />
      ))}
      {staged.problem && <OutcomeLine kind="error" label="Rooms" says={staged.problem} />}
      <div className="flex gap-2 py-1">
        <Button
          label="Partition"
          busy={staged.pending === "rooms.partition" || ctx.verb("partition").pending}
          refusal={blocked ?? (page.view ? null : "Choose a plan")}
          onClick={() =>
            void staged.run(
              "rooms.partition",
              { view: page.view },
              ctx.verb("partition"),
              "Prepare partition",
            )
          }
        >
          Partition
        </Button>
        <Button
          label="Merge"
          busy={staged.pending === "rooms.merge" || ctx.verb("merge").pending}
          refusal={blocked ?? (merging.length >= 2 ? null : "Pick two or more rooms on the plan")}
          onClick={() =>
            void staged.run(
              "rooms.merge",
              { view: page.view, regions: merging.map((row) => row.subject) },
              ctx.verb("merge"),
              "Prepare merge",
            )
          }
        >
          Merge
        </Button>
      </div>
      {busy && <p role="status">Reading the plan; showing the last rooms</p>}
      <PlainList
        list={list}
        aria-label="Regions"
        empty={{
          message: "No zones or rooms on this plan",
          exit: "Draw a zone in Revit, then partition this plan",
        }}
        row={(row) => ({
          label: `${roleWord[row.role]} ${row.name || "Unnamed"}`,
          meta: [`${Math.round(row.sqft)} sf`, ...factsOf(row)].join(" · "),
        })}
      />
    </section>
  );
}

const cells = product.cells;
const shown = (value: unknown) => (value == null ? "" : String(value));

export function FieldsBody({ ctx }: { ctx: RoomsContext }) {
  const doc = ctx.cells.doc;
  const editable = ctx.cells.state.state === "ready";
  const rooms = ctx.value.value.regions.filter((row) => row.role !== "held");
  const stage = (field: Field, row: Region, text: string) => {
    const value: unknown =
      cells[field].domain.kind === "number" ? (text.trim() === "" ? NaN : Number(text)) : text;
    if (typeof value === "number" && !(value >= 0)) return;
    void ctx.cells
      .at([field, row.subject])
      .stage(value, { label: `${cells[field].label} of ${row.name || "room"}` });
  };
  if (!rooms.length) return null;
  return (
    // A real table: seven rooms stay rows at a narrow body, and the columns scroll sideways.
    <div className="overflow-x-auto">
      <table aria-label="Room fields">
        <thead>
          <tr>
            {ROOM_FIELDS.map((field) => (
              <th key={field} scope="col">
                {cells[field].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rooms.map((row) => (
            <tr key={row.subject}>
              {ROOM_FIELDS.map((field) => {
                const staged = doc?.[field]?.[row.subject]?.edit?.value;
                const model = shown(row[field]);
                const value = staged === undefined ? model : shown(staged);
                const name = `${cells[field].label} of ${row.name || "room"}`;
                return (
                  <td key={field} data-staged={staged === undefined ? undefined : true}>
                    {field === "role" ? (
                      <select
                        aria-label={name}
                        value={value}
                        disabled={!editable}
                        onChange={(event) => stage(field, row, event.target.value)}
                      >
                        <option value="room">Room</option>
                        <option value="zone">Zone</option>
                      </select>
                    ) : (
                      <Input
                        aria-label={name}
                        // Remounts on a landed value, so Work stays the one source between edits.
                        key={value}
                        defaultValue={value}
                        placeholder={field === "type" ? typeWord("") : undefined}
                        // A pending Work blocks edits; reading and picking stay open.
                        disabled={!editable}
                        onBlur={(event) =>
                          event.target.value !== value && stage(field, row, event.target.value)
                        }
                        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
