import { Fragment, type ReactNode } from "react";
import { token } from "#/lib/token";
import { fmtNum, StateCell, type StateCellProps } from "#/components/lang/cell";
import type { Link, TypeGroup, TypeWrite } from "./type-values";
import { COLS, GROUPS, LINKS, hairline, muted, secondary } from "./type-values";

export function VariantGridLens({
  applicable,
  refusals,
  linkedCellProps,
  linkedHead,
  plainHead,
}: {
  applicable: TypeWrite[];
  refusals: TypeWrite[];
  linkedCellProps: (group: TypeGroup, link: Link) => StateCellProps;
  linkedHead: (link: Link) => ReactNode;
  plainHead: (label: string, sub?: string) => ReactNode;
}) {
  return (
    // OWED (census #12, accident): moves onto Table with the /param-tables cutover, not separately.
    <table className="w-full" style={{ ["--pe-on" as string]: token("artifact") }}>
      <thead>
        <tr
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            backgroundColor: token("artifact"),
            boxShadow: `inset 0 -1px ${token("line")}`,
          }}
        >
          {plainHead("Tag")}
          {plainHead("Serves")}
          {plainHead("Location")}
          {plainHead("Model")}
          {plainHead("Heat capacity", "Btu/h · inbound")}
          {plainHead("Heat flow", "GPM")}
          {linkedHead(LINKS[0] as Link)}
          {linkedHead(LINKS[1] as Link)}
          {plainHead("Cool total", "Btu/h")}
          {plainHead("MCA", "A")}
        </tr>
      </thead>
      <tbody>
        {GROUPS.map((group) => {
          const groupWrites = applicable.filter((w) => w.group.name === group.name);
          const groupRefusals = refusals.filter((w) => w.group.name === group.name);
          return (
            <Fragment key={group.name}>
              {/* LANG GAP (4): no primitive for a type group-header row — this hand-rolled band
                  is what makes "one type write = N rows stage together" legible. */}
              <tr
                style={{ backgroundColor: token("recess"), ["--pe-on" as string]: token("recess") }}
              >
                <td colSpan={COLS} className="px-2 py-1" style={{ borderTop: hairline }}>
                  <span className="">{group.name}</span>
                  <span className="ml-2" style={muted}>
                    {group.rows.length} row{group.rows.length === 1 ? "" : "s"} · perf params at
                    type scope
                  </span>
                  {groupWrites.length > 0 ? (
                    <span className="ml-2" style={{ color: token("caution") }}>
                      one type write —{" "}
                      {groupWrites
                        .map((w) => w.link.param.name.replace("PE_M_PerfHeat_Fluid", ""))
                        .join(" + ")}{" "}
                      stage {group.rows.length} row{group.rows.length === 1 ? "" : "s"} together
                    </span>
                  ) : null}
                  {groupRefusals.length > 0 ? (
                    <span className="ml-2" style={{ color: token("alarm") }}>
                      {groupRefusals
                        .map((w) => w.link.param.name.replace("PE_M_PerfHeat_Fluid", ""))
                        .join(" + ")}{" "}
                      refuses — formula-owned
                    </span>
                  ) : null}
                </td>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.tag} style={{ borderTop: hairline }}>
                  <td className="px-2 py-0.5">{row.tag}</td>
                  <td className="px-2 py-0.5">{row.serves}</td>
                  <td className="px-2 py-0.5" style={secondary}>
                    {row.location}
                  </td>
                  <td className="px-2 py-0.5" style={secondary}>
                    {row.model}
                  </td>
                  <td
                    className="px-2 py-0.5"
                    title="inbound — read from PE_M_PerfHeat_CapacityDesignTotal on the type"
                  >
                    {row.heat.capTotal.toLocaleString()}
                  </td>
                  <td className="px-2 py-0.5">{fmtNum(row.heat.gpm, 1)}</td>
                  {LINKS.map((link) => (
                    <td key={link.param.name} className="px-2 py-0.5">
                      <StateCell {...linkedCellProps(group, link)} />
                    </td>
                  ))}
                  <td className="px-2 py-0.5">{row.cool.total.toLocaleString()}</td>
                  <td className="px-2 py-0.5">{fmtNum(row.mca, 1)}</td>
                </tr>
              ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
