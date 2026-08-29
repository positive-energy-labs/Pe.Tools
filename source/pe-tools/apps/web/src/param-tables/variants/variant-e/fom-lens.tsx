import { StateCell } from "#/components/lang/cell";
import { FC_UNITS, FOM_HWCH_PLANT } from "#/param-tables/variants/fixture";
import { HEAT_CAP_SUM, hairline, muted, secondary } from "./type-values";

export function VariantFomLens() {
  return (
    <div className="p-6">
      <div className="mb-2" style={secondary}>
        <span className="">SXL - FOM HWCH Plant</span> → sheet exhibit · a saved projection of the
        same {FC_UNITS.length}-row substrate — switching lens re-projects, nothing is retyped
      </div>
      <table className="" style={{ border: hairline }}>
        <tbody>
          <tr>
            <td
              colSpan={3}
              className="px-3 py-1 text-center"
              style={{ border: hairline, ...secondary }}
            >
              {FOM_HWCH_PLANT.groupRow[0]}
            </td>
            <td
              colSpan={4}
              className="px-3 py-1 text-center"
              style={{ border: hairline, ...secondary }}
            >
              {FOM_HWCH_PLANT.groupRow[3]}
            </td>
            <td
              colSpan={4}
              className="px-3 py-1 text-center"
              style={{ border: hairline, ...secondary }}
            >
              {FOM_HWCH_PLANT.groupRow[7]}
            </td>
          </tr>
          <tr>
            {FOM_HWCH_PLANT.headRow.map((head, i) => (
              <td
                key={i}
                className="px-3 py-1 text-center"
                style={{ border: hairline, ...secondary }}
              >
                {head}
              </td>
            ))}
          </tr>
          <tr>
            {FOM_HWCH_PLANT.dataRow.map((cell, i) =>
              i === 9 ? (
                // LANG GAP (2): the inbound cell has no reserved mark either — hover carries it.
                <td key={i} className="px-3 py-1 text-center" style={{ border: hairline }}>
                  <StateCell
                    scale="row"
                    value={HEAT_CAP_SUM.toLocaleString()}
                    agree="drift"
                    note={`inbound — Σ PE_M_PerfHeat_CapacityDesignTotal over ${FC_UNITS.length} fan-coil rows; the printed SXL exhibit held ${cell} (stale dead text)`}
                  />
                </td>
              ) : (
                <td
                  key={i}
                  className={`px-3 py-1 text-center ${i >= 3 ? "" : ""}`}
                  style={{ border: hairline }}
                  title={
                    i >= 3
                      ? "dead text in the SXL exhibit — would become an authored fact or an inbound reading"
                      : undefined
                  }
                >
                  {cell}
                </td>
              ),
            )}
          </tr>
          <tr>
            <td colSpan={11} className="px-3 py-1 text-left" style={{ border: hairline, ...muted }}>
              {FOM_HWCH_PLANT.footnote}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-2" style={muted}>
        heating Load reads live from the grid's rows — the printed exhibit disagreed, and the
        squiggle says so
      </div>
    </div>
  );
}
