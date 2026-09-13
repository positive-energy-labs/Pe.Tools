import type { ReactNode } from "react";
import { BOD_MAIN_HOUSE } from "#/param-tables/variants/data";
import type { FactKey } from "./type-values";
import { hairline, muted, secondary } from "./type-values";

export function VariantBodLens({ factCell }: { factCell: (key: FactKey) => ReactNode }) {
  return (
    <div className="p-6">
      <div className="mb-2" style={secondary}>
        <span className="">SXL - M_BOD_MainHouse</span> (sheet M001) · label × value projection of
        the same substrate — authored facts render through the same editor as the lane
      </div>
      <table className="">
        <tbody>
          {BOD_MAIN_HOUSE.map((entry) => (
            <tr key={entry.key} style={{ borderTop: hairline }}>
              <td className="max-w-xl px-2 py-1 pr-6">{entry.label}</td>
              <td className="px-2 py-1">
                {entry.key === "odt-winter" ? (
                  factCell("odtWinter")
                ) : entry.numeric != null ? (
                  entry.value
                ) : (
                  <span className="" style={secondary}>
                    {entry.value}
                  </span>
                )}
              </td>
              <td className="px-2 py-1" style={muted}>
                {entry.unit ?? ""}
                {entry.key === "odt-winter" ? " · authored design fact" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
