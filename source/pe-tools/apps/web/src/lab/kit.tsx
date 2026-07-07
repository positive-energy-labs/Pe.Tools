/**
 * FakePage — a print-styled fake datasheet page (fixed 612×792 coordinate
 * space; consumers scale it with transforms). Provides the deterministic
 * grounding fixture behind the /family-sheet `?mock` demo.
 */
import type { ReactNode } from "react";

import { PAGE_H, PAGE_W, T1, T2, T3, T4, type TableSpec, tableH } from "#/lab/mock";

const DOC_FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function Tbl({ t }: { t: TableSpec }) {
  return (
    <div
      className="absolute"
      style={{ left: t.x, top: t.y, width: t.w, fontSize: 9, color: "#2a2a2a" }}
    >
      <div
        className="flex items-center font-semibold"
        style={{ height: t.headerH, borderBottom: "1.5px solid #3a3a3a", background: "#f2efe8" }}
      >
        {t.cols.map((c) => (
          <div key={c.key} className="px-1.5" style={{ width: c.w }}>
            {c.label}
          </div>
        ))}
      </div>
      {t.rows.map((r) => (
        <div
          key={r.key}
          className="flex items-center"
          style={{ height: t.rowH, borderBottom: "1px solid #ddd8ce" }}
        >
          <div className="px-1.5" style={{ width: t.cols[0].w, color: "#555" }}>
            {r.label}
          </div>
          {r.values.map((v, i) => (
            <div key={t.cols[i + 1].key} className="px-1.5" style={{ width: t.cols[i + 1].w }}>
              {v}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Draftsman-ish placeholder so the pages read as a real submittal, not wireframes. */
function DimDrawing({
  x,
  y,
  w,
  h,
  label,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}) {
  return (
    <div className="absolute" style={{ left: x, top: y, width: w, height: h }}>
      <div
        className="absolute"
        style={{
          left: 40,
          top: 16,
          width: w - 200,
          height: h - 70,
          border: "1.25px solid #6a6a6a",
        }}
      >
        <div className="absolute" style={{ inset: 10, border: "0.75px solid #b5b0a6" }} />
        <div
          className="absolute rounded-full"
          style={{ left: "38%", top: "30%", width: 46, height: 46, border: "1px solid #8a8a8a" }}
        />
        <div
          className="absolute"
          style={{ left: 0, bottom: 18, width: "100%", borderTop: "0.75px dashed #9a958b" }}
        />
      </div>
      {/* dimension line */}
      <div
        className="absolute"
        style={{ left: 40, top: h - 40, width: w - 200, borderTop: "0.75px solid #6a6a6a" }}
      />
      <div
        className="absolute"
        style={{ left: 40, top: h - 46, height: 12, borderLeft: "0.75px solid #6a6a6a" }}
      />
      <div
        className="absolute"
        style={{ left: w - 160, top: h - 46, height: 12, borderLeft: "0.75px solid #6a6a6a" }}
      />
      <div
        className="absolute"
        style={{
          left: 40,
          top: h - 38,
          width: w - 200,
          textAlign: "center",
          fontSize: 7.5,
          color: "#666",
        }}
      >
        W — see performance table
      </div>
      <div
        className="absolute"
        style={{ right: 0, top: 16, width: 128, fontSize: 7.5, lineHeight: "12px", color: "#666" }}
      >
        {label}
        <div className="mt-1" style={{ borderTop: "0.75px solid #b5b0a6", paddingTop: 3 }}>
          All dims in inches. Service clearance 18&quot; front.
        </div>
      </div>
    </div>
  );
}

/**
 * A page of the fake submittal, rendered at native page coordinates
 * (612×792 @ 72dpi). Wrap in `transform: scale()` to size; `children`
 * render inside page coordinate space (for bbox overlays).
 */
export function FakePage({ page, children }: { page: 1 | 2 | 3; children?: ReactNode }) {
  return (
    <div
      className="relative overflow-hidden bg-white"
      style={{ width: PAGE_W, height: PAGE_H, fontFamily: DOC_FONT, color: "#1f2422" }}
    >
      <div
        className="absolute font-bold"
        style={{ left: 48, top: 18, fontSize: 8, letterSpacing: "0.22em", color: "#9a958b" }}
      >
        ACME AIR SYSTEMS
      </div>
      <div className="absolute" style={{ right: 48, top: 18, fontSize: 8, color: "#9a958b" }}>
        SUBMITTAL 24-118
      </div>

      {page === 3 ? (
        <>
          <div className="absolute font-semibold" style={{ left: 48, top: 44, fontSize: 13 }}>
            Physical &amp; Sound Data
          </div>
          <div
            className="absolute"
            style={{
              left: 48,
              top: 72,
              width: 516,
              fontSize: 9,
              lineHeight: "14px",
              color: "#444",
            }}
          >
            Physical data below is listed per model. Sound power applies to all models at nominal
            airflow.
          </div>
          <Tbl t={T3} />
          <Tbl t={T4} />
          {/* row-spanning value: one cell covers the whole data row (edge case) */}
          <div
            className="absolute flex items-center"
            style={{
              left: T4.x,
              top: T4.y + tableH(T4),
              width: T4.w,
              height: 26,
              borderBottom: "1px solid #ddd8ce",
              fontSize: 9,
            }}
          >
            <div className="px-1.5" style={{ width: T4.cols[0].w, color: "#555" }}>
              Test condition
            </div>
            <div className="px-1.5" style={{ width: T4.w - T4.cols[0].w }}>
              All bands re 10<sup>-12</sup> W, measured per AHRI 260 — applies to every FCU-400
              model
            </div>
          </div>
          <div
            className="absolute italic"
            style={{ left: 48, top: 400, width: 516, fontSize: 8.5, color: "#777" }}
          >
            Weights are dry weights. Add 8 lb per unit for water charge.
          </div>
        </>
      ) : page === 1 ? (
        <>
          <div
            className="absolute font-semibold"
            style={{ left: 48, top: 44, width: 516, fontSize: 17 }}
          >
            ACME Fan Coil Unit — Model FCU-400 Series
          </div>
          <div
            className="absolute"
            style={{
              left: 48,
              top: 96,
              width: 516,
              fontSize: 9.5,
              lineHeight: "15px",
              color: "#444",
            }}
          >
            The FCU-400 series delivers quiet, high-efficiency hydronic cooling and heating for
            commercial fit-outs. All models share a common cabinet and differ in coil depth and
            motor size. Units are ETL listed and ship fully charged and run-tested.
          </div>
          <Tbl t={T1} />
          <div
            className="absolute italic"
            style={{ left: 48, top: 402, width: 516, fontSize: 8.5, color: "#777" }}
          >
            Capacities rated at 45°F entering water, 80°F/67°F entering air per AHRI 440.
          </div>
          <DimDrawing x={48} y={456} w={516} h={264} label="Fig. 1 — FCU-400 cabinet, plan view" />
        </>
      ) : (
        <>
          <div className="absolute font-semibold" style={{ left: 48, top: 44, fontSize: 13 }}>
            Electrical &amp; Connection Data
          </div>
          <Tbl t={T2} />
          <div
            className="absolute"
            style={{
              left: 48,
              top: 282,
              width: 516,
              fontSize: 9,
              lineHeight: "14px",
              color: "#444",
            }}
          >
            Note: all units ship with a factory-mounted disconnect. Field wiring must comply with
            NEC and local codes. MCA/MOCP shown apply to all FCU-400 models.
          </div>
          <DimDrawing
            x={48}
            y={372}
            w={516}
            h={276}
            label="Fig. 2 — Typical wiring, single-point power"
          />
        </>
      )}

      <div className="absolute" style={{ left: 48, bottom: 22, fontSize: 8, color: "#9a958b" }}>
        ACME Corp · Submittal 24-118 · Page {page} of 3
      </div>
      {children}
    </div>
  );
}

export { PAGE_H, PAGE_W, tableH, T1, T2, T3, T4 };
