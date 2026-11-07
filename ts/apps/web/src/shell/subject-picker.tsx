import { z } from "zod";
import { Button } from "@pe/kit/lang/button";
import { NarrowChip } from "@pe/kit/lang/chip";
import { ListPopup } from "@pe/kit/lang/list-popup";
import type { RouteGraphJson } from "@pe/agent-contracts";
import { canonicalEnvironmentInput as identity } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import { openSet, type OpenSet } from "./open-set.neutral";
const rosterSchema = z.array(z.object({ id: z.unknown(), label: z.string() }));
interface SubjectMount {
  picker(field: string): unknown;
  page: { read(): Readonly<Record<string, unknown>> };
  controls: { subject(value: any): unknown };
}
export function subjectOf(mount: SubjectMount, data: RouteGraphJson) {
  const field = data.fields[data.subject!.field];
  if (field?.role !== "subject") return null;
  const options = rosterSchema.parse(mount.picker(data.subject!.field) ?? []);
  const value = mount.page.read()[data.subject!.field];
  const many = field.cardinality === "many";
  const known = (id: unknown) => options.some((o) => identity(o.id) === identity(id));
  const set = openSet(
    identity,
    options.map((o) => o.id),
  );
  const current = (
    many ? value : { kind: "ids", ids: value == null ? [] : [value] }
  ) as OpenSet<unknown>;
  const all = current.kind === "all";
  const ids = set.members(current);
  // Ids outside the roster stay out of every move; the alert below names that they were dropped.
  const open: OpenSet<unknown> =
    current.kind === "all"
      ? current
      : {
          kind: "ids",
          ids: ids.filter(known),
          ...(current.active !== undefined && known(current.active)
            ? { active: current.active }
            : {}),
        };
  const move = (next: OpenSet<unknown>) =>
    next === open ? undefined : mount.controls.subject(next);
  const one = (id: unknown) => mount.controls.subject(id ?? null);
  return {
    options,
    many,
    all,
    selected: set.members(open).map(identity),
    active: set.active(open) === undefined ? null : identity(set.active(open)),
    unknown: !all && set.members(open).length < ids.length,
    clear: () => (many ? move({ kind: "ids", ids: [] }) : one(null)),
    toggle: (id: unknown) => (many ? move(set.toggle(open, id)) : one(id)),
    select: (ids: readonly unknown[]) => (many ? move(set.select(open, ids)) : one(ids.at(-1))),
    add: (more: readonly unknown[]) => (many ? move(set.add(open, more)) : one(more.at(-1))),
    remove: (id: unknown) => (many ? move(set.remove(open, id)) : one(null)),
    setActive: (id: unknown) => (many ? move(set.setActive(open, id)) : one(id)),
  };
}
export function SubjectPicker({ mount, data, single = false }: { mount: SubjectMount; data: RouteGraphJson; single?: boolean }) {
  const subject = subjectOf(mount, data);
  if (!subject) return null;
  const { options, many, all, selected, active, unknown } = subject;
  const noun = data.subject!.noun;
  const open = options.filter((o) => selected.includes(identity(o.id)));
  return (
    <>
      {/* Many: every open subject is its own chip with its own ×; the trigger only adds. */}
      {many &&
        (all ? (
          <NarrowChip
            label={`All ${noun}`}
            title={`Every ${noun} is open`}
            onRemove={subject.clear}
          />
        ) : (
          open.map((o) => (
            <NarrowChip
              key={identity(o.id)}
              label={o.label}
              selected={identity(o.id) === active}
              title={`Close this ${noun}; the others stay open`}
              onRemove={() => subject.remove(o.id)}
            />
          ))
        ))}
      <ListPopup
        anchor="trigger"
        face="control"
        triggerLabel={`Choose ${noun}`}
        trigger={many ? `Choose ${noun}` : open.map((o) => o.label).join(", ") || `Choose ${noun}`}
        aria-label={noun}
        items={options}
        keyOf={(o) => identity(o.id)}
        labelOf={(o) => o.label}
        filter="substring"
        select={many && !single ? "multi" : "single"}
        selected={selected}
        empty={`No ${noun} available`}
        row={(o) => ({ label: o.label })}
        onPick={(option) => single ? subject.select([option.id]) : subject.toggle(option.id)}
        onSelectedChange={
          many && !single
            ? (keys) =>
                subject.select(
                  options.filter((o) => keys.includes(identity(o.id))).map((o) => o.id),
                )
            : undefined
        }
      />
      {many && !single && (
        <>
          <Button label={`All ${noun}`} onClick={() => mount.controls.subject({ kind: "all" })}>
            All
          </Button>
          <Button label={`No ${noun}`} onClick={subject.clear}>
            None
          </Button>
        </>
      )}
      {unknown && (
        <span role="alert">Some selected {noun} are outside the current roster. Choose again.</span>
      )}
    </>
  );
}
