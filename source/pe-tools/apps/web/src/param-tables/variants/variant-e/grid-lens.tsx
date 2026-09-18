import type { StateCellProps } from "#/components/lang/cell";
import { fmtNum } from "#/components/lang/cell";
import type { Column } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import { useTableState } from "#/components/master-table/view";
import { token } from "#/lib/token";
import type { FcRow } from "#/param-tables/variants/data";
import type { Link, TypeGroup, TypeWrite } from "./type-values";
import { GROUPS, LINKS, muted, secondary } from "./type-values";

const CELL = "block truncate px-(--item-pad-x)";

/** A column head: its name, and a unit (or link) line under it. */
const head = (label: string, sub?: string) => (
  <>
    <span className="block" style={secondary}>
      {label}
    </span>
    <span className="block" style={muted}>
      {sub ?? " "}
    </span>
  </>
);

const plain = (
  key: string,
  label: string,
  value: (row: FcRow) => string | number,
  sub?: string,
): Column<FcRow> => ({
  key,
  label,
  header: head(label, sub),
  sort: value,
  cell: (row) => (
    <span className={CELL} style={key === "location" || key === "model" ? secondary : undefined}>
      {typeof value(row) === "number" ? value(row).toLocaleString() : value(row)}
    </span>
  ),
});

const shortName = (w: TypeWrite) => w.link.param.name.replace("PE_M_PerfHeat_Fluid", "");

/** The type-group band: one type write stages all of the group's rows together. */
function GroupBand({
  group,
  writes,
  refusals,
}: {
  group: TypeGroup;
  writes: TypeWrite[];
  refusals: TypeWrite[];
}) {
  const rows = `${group.rows.length} row${group.rows.length === 1 ? "" : "s"}`;
  return (
    <span className="block text-left">
      <span>{group.name}</span>
      <span className="ml-2" style={muted}>
        {rows} · perf params at type scope
      </span>
      {writes.length > 0 ? (
        <span className="ml-2" style={{ color: token("caution") }}>
          one type write — {writes.map(shortName).join(" + ")} stage {rows} together
        </span>
      ) : null}
      {refusals.length > 0 ? (
        <span className="ml-2" style={{ color: token("alarm") }}>
          {refusals.map(shortName).join(" + ")} refuses — formula-owned
        </span>
      ) : null}
    </span>
  );
}

export function VariantGridLens({
  applicable,
  refusals,
  linkedCellProps,
  factLabel,
}: {
  applicable: TypeWrite[];
  refusals: TypeWrite[];
  linkedCellProps: (group: TypeGroup, link: Link) => StateCellProps;
  factLabel: (link: Link) => string;
}) {
  // One view over every group: a sort applies to each group's rows alike.
  const [state, setState] = useTableState();
  const groupOf = (row: FcRow) => GROUPS.find((group) => group.rows.includes(row))!;
  const columns: Column<FcRow>[] = [
    plain("tag", "Tag", (row) => row.tag),
    plain("serves", "Serves", (row) => row.serves),
    plain("location", "Location", (row) => row.location),
    plain("model", "Model", (row) => row.model),
    {
      ...plain("heatCap", "Heat capacity", (row) => row.heat.capTotal, "Btu/h · inbound"),
      title: "inbound — read from PE_M_PerfHeat_CapacityDesignTotal on the type",
    },
    plain("heatGpm", "Heat flow", (row) => fmtNum(row.heat.gpm, 1), "GPM"),
    // The linked cells are the language's StateCell, a state column: the table draws them.
    ...LINKS.map(
      (link): Column<FcRow> => ({
        key: link.param.name,
        label: `${factLabel(link)} ⟵ authored`,
        header: head(`${factLabel(link)} ⟵ authored`, link.param.name),
        title: `linked column — every value flows from the authored fact "${factLabel(link)}"; edit it in the design-facts lane`,
        state: (row) => linkedCellProps(groupOf(row), link),
      }),
    ),
    plain("coolTotal", "Cool total", (row) => row.cool.total, "Btu/h"),
    plain("mca", "MCA", (row) => fmtNum(row.mca, 1), "A"),
  ];
  return (
    <div className="flex flex-col" style={{ ["--pe-on" as string]: token("artifact") }}>
      {GROUPS.map((group) => (
        <Table
          key={group.name}
          label={group.name}
          caption={
            <GroupBand
              group={group}
              writes={applicable.filter((w) => w.group.name === group.name)}
              refusals={refusals.filter((w) => w.group.name === group.name)}
            />
          }
          rows={group.rows}
          columns={columns}
          rowKey={(row) => row.tag}
          state={state}
          onStateChange={setState}
        />
      ))}
    </div>
  );
}
