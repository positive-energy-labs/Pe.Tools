/**
 * PROTOTYPE — paradigm "circuit": every product page as a small wiring diagram. Throwaway
 * with the round.
 *
 * The PAGE is a chip on the left edge; every noun is a node wired to one of its ports.
 * DIRECTION is the wire itself: read = chevrons flowing INTO the page, write = chevrons
 * flowing OUT to the noun, sync = a duplex pair (two wires, opposing flow), read+write =
 * one wire with both flows, null dir = a plain attachment line with a mount tick (it is
 * the channel, not a flow). Liveness detached = the wire is physically BROKEN mid-run
 * with hollow connectors at the break (dashed is reserved for seams — never used here).
 * Granularity rank orders nodes top→bottom AND nests them rightward/smaller, big→small.
 * The per-product stage scrubber lights the demanded subgraph; undemanded nodes and wires
 * dim to 0.4 (never hidden — ruled). Clicking a node opens its options picker; multi
 * nouns get checkbox multi-pick. Unbound nouns render caution.
 */
import { useEffect, useRef, useState } from "react";

import {
  annotation,
  annotationColor,
  demandedKeys,
  PRODUCTS,
  type MockNoun,
  type MockProduct,
} from "#/targeting-proto/model";

// ── layout constants ─────────────────────────────────────────────────────────
const PAGE_X = 8;
const PAGE_W = 92;
const ROW_H = 58;
const TOP_PAD = 26;
const BOTTOM_PAD = 14;
const NOUN_X0 = 168; // rank-0 noun left edge; each rank nests 34px further right
const RANK_STEP = 34;
const SVG_W = 760;

interface NounGeom {
  noun: MockNoun;
  x: number; // node left edge
  cy: number; // wire / node vertical center
  top: number; // node top (HTML)
  h: number; // node height, shrinks with rank
}

function layout(product: MockProduct): { geoms: NounGeom[]; height: number } {
  const ordered = [...product.nouns].sort((a, b) => a.rank - b.rank);
  const geoms = ordered.map((noun, i) => {
    const h = Math.max(22, 30 - noun.rank * 2);
    const top = TOP_PAD + i * ROW_H + (30 - h) / 2;
    return { noun, x: NOUN_X0 + noun.rank * RANK_STEP, cy: top + h / 2, top, h };
  });
  return { geoms, height: TOP_PAD + ordered.length * ROW_H + BOTTOM_PAD };
}

// ── wire pieces ──────────────────────────────────────────────────────────────

/** Chevron along a horizontal wire. dir "in" points at the page (left), "out" at the noun. */
function Chevron({ x, y, dir, color, w }: { x: number; y: number; dir: "in" | "out"; color: string; w: number }) {
  const d =
    dir === "in"
      ? `M ${x + 4} ${y - 3.5} L ${x - 2.5} ${y} L ${x + 4} ${y + 3.5}`
      : `M ${x - 4} ${y - 3.5} L ${x + 2.5} ${y} L ${x - 4} ${y + 3.5}`;
  return <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />;
}

/** One horizontal conductor, broken with hollow connectors when detached. */
function Conductor({
  x1,
  x2,
  y,
  color,
  w,
  broken,
}: {
  x1: number;
  x2: number;
  y: number;
  color: string;
  w: number;
  broken: boolean;
}) {
  if (!broken) return <line x1={x1} x2={x2} y1={y} y2={y} stroke={color} strokeWidth={w} />;
  const mid = x1 + (x2 - x1) * 0.58;
  const gap = 7;
  return (
    <g>
      <line x1={x1} x2={mid - gap} y1={y} y2={y} stroke={color} strokeWidth={w} />
      <line x1={mid + gap} x2={x2} y1={y} y2={y} stroke={color} strokeWidth={w} />
      <circle cx={mid - gap} cy={y} r={2.5} fill="var(--r-page)" stroke={color} strokeWidth={w} />
      <circle cx={mid + gap} cy={y} r={2.5} fill="var(--r-page)" stroke={color} strokeWidth={w} />
    </g>
  );
}

/** The full wire for one noun: direction is the drawing, liveness is the continuity. */
function Wire({ g, dimmed }: { g: NounGeom; dimmed: boolean }) {
  const { noun, x, cy } = g;
  const x1 = PAGE_X + PAGE_W; // page port
  const x2 = x; // noun left edge
  const broken = noun.liveness === "detached";
  const loud = noun.dir === "write" || noun.dir === "sync" || noun.dir === "read+write";
  const color = noun.dir ? (loud ? "var(--r-ink)" : "var(--r-ink-2)") : "var(--r-ink-2)";
  const w = loud ? 2 : 1;
  const mA = x1 + (x2 - x1) * 0.32;
  const mB = x1 + (x2 - x1) * 0.8;

  return (
    <g opacity={dimmed ? 0.4 : 1}>
      {/* page-side port pad */}
      <rect x={x1 - 3.5} y={cy - 3.5} width={7} height={7} fill={color} />
      {noun.dir === "sync" ? (
        <g>
          {/* duplex pair: top conductor flows into the page, bottom flows out */}
          <Conductor x1={x1} x2={x2} y={cy - 2.5} color={color} w={1.75} broken={broken} />
          <Conductor x1={x1} x2={x2} y={cy + 2.5} color={color} w={1.75} broken={broken} />
          <Chevron x={mA} y={cy - 2.5} dir="in" color={color} w={1.75} />
          <Chevron x={mB} y={cy + 2.5} dir="out" color={color} w={1.75} />
        </g>
      ) : (
        <g>
          <Conductor x1={x1} x2={x2} y={cy} color={color} w={w} broken={broken} />
          {noun.dir === "read" ? <Chevron x={mA} y={cy} dir="in" color={color} w={w} /> : null}
          {noun.dir === "write" ? <Chevron x={mB} y={cy} dir="out" color={color} w={w} /> : null}
          {noun.dir === "read+write" ? (
            <g>
              <Chevron x={mA} y={cy} dir="in" color={color} w={w} />
              <Chevron x={mB} y={cy} dir="out" color={color} w={w} />
            </g>
          ) : null}
          {noun.dir === null ? (
            // mount tick: this noun is the channel itself — attachment, not flow
            <line x1={x2 - 8} x2={x2 - 8} y1={cy - 4.5} y2={cy + 4.5} stroke={color} strokeWidth={1} />
          ) : null}
        </g>
      )}
      {/* grammar joiner rides the wire at the page end; taxonomy annotation at the noun end */}
      <text x={x1 + 8} y={cy - 5.5} className="face-mono" fontSize={8.5} fill="var(--r-ink-2)">
        {noun.joiner}
      </text>
      <text x={x2 - 4} y={cy - 6.5} textAnchor="end" fontSize={8} fill={annotationColor(noun)} style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {annotation(noun)}
      </text>
    </g>
  );
}

// ── one product = one diagram ────────────────────────────────────────────────

function ProductCircuit({ product }: { product: MockProduct }) {
  const [stageKey, setStageKey] = useState(product.stages[0]!.key);
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [single, setSingle] = useState<Record<string, string | null>>({});
  const [multi, setMulti] = useState<Record<string, Set<string>>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  const stage = product.stages.find((s) => s.key === stageKey) ?? product.stages[0]!;
  const demanded = demandedKeys(stage);
  const { geoms, height } = layout(product);

  useEffect(() => {
    if (!openSlot) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenSlot(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openSlot]);

  const nounLabel = (noun: MockNoun): string | null => {
    if (noun.multi) {
      const picked = multi[noun.key];
      return picked && picked.size > 0 ? `${picked.size} of ${noun.options.length} ${noun.key}` : null;
    }
    return single[noun.key] ?? noun.label;
  };
  const pick = (noun: MockNoun, id: string) => {
    if (noun.multi) {
      setMulti((prev) => {
        const next = new Set(prev[noun.key] ?? []);
        next.has(id) ? next.delete(id) : next.add(id);
        return { ...prev, [noun.key]: next };
      });
    } else {
      const opt = noun.options.find((o) => o.id === id);
      setSingle((prev) => ({ ...prev, [noun.key]: opt?.label ?? null }));
      setOpenSlot(null);
    }
  };
  const isPicked = (noun: MockNoun, id: string) =>
    noun.multi
      ? (multi[noun.key] ?? new Set()).has(id)
      : nounLabel(noun) === noun.options.find((o) => o.id === id)?.label;

  const openGeom = geoms.find((g) => g.noun.key === openSlot) ?? null;
  const firstCy = geoms[0]?.cy ?? TOP_PAD;
  const lastCy = geoms[geoms.length - 1]?.cy ?? TOP_PAD;

  return (
    <div className="pb-8">
      {/* header: product + stress caption */}
      <div className="flex items-baseline gap-3 px-2">
        <span className="t-caption t-upper" style={{ color: "var(--r-ink)" }}>
          {product.name}
        </span>
        <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
          {product.stress}
        </span>
      </div>

      {/* stage scrubber: lights the demanded subgraph below */}
      <div className="flex items-baseline gap-1.5 px-2 pt-1">
        <span className="t-caption t-upper" style={{ color: "var(--r-ink-2)" }}>
          stage
        </span>
        {product.stages.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setStageKey(s.key)}
            className="face-mono t-caption px-1.5 py-0.5"
            style={{
              cursor: "pointer",
              background: s.key === stage.key ? "var(--r-select)" : "transparent",
              border: "0.5px solid var(--r-line-2)",
              borderRadius: 2,
              color: "var(--r-ink)",
            }}
          >
            {s.label}
          </button>
        ))}
        <span className="face-mono t-caption pl-2" style={{ color: "var(--r-ink-2)" }}>
          {stage.verbs.map((v) => `${v.label} (${v.demands.join(", ") || "none"})`).join(" · ")}
        </span>
      </div>

      {/* the diagram */}
      <div ref={rootRef} className="relative overflow-x-auto" style={{ height, minWidth: 0 }}>
        <svg
          width={SVG_W}
          height={height}
          viewBox={`0 0 ${SVG_W} ${height}`}
          className="absolute left-0 top-0"
          style={{ pointerEvents: "none" }}
          aria-hidden
        >
          {geoms.map((g) => (
            <Wire key={g.noun.key} g={g} dimmed={!demanded.has(g.noun.key)} />
          ))}
        </svg>

        {/* page chip — the central node every wire lands on */}
        <div
          className="absolute flex flex-col items-center justify-center"
          style={{
            left: PAGE_X,
            top: firstCy - 12,
            width: PAGE_W,
            height: Math.max(30, lastCy - firstCy + 24),
            border: "1.5px solid var(--r-ink)",
            borderRadius: 2,
            background: "var(--r-page)",
          }}
        >
          <span className="t-caption t-upper" style={{ color: "var(--r-ink)" }}>
            {product.name}
          </span>
          <span className="t-caption" style={{ color: "var(--r-ink-2)", fontSize: 8.5 }}>
            page
          </span>
        </div>

        {/* noun nodes — rank nests them rightward and smaller */}
        {geoms.map((g) => {
          const label = nounLabel(g.noun);
          const dimmed = !demanded.has(g.noun.key);
          const open = openSlot === g.noun.key;
          return (
            <button
              key={g.noun.key}
              type="button"
              title={g.noun.empty}
              onClick={() => setOpenSlot(open ? null : g.noun.key)}
              className="face-mono absolute flex items-center gap-1.5"
              style={{
                left: g.x,
                top: g.top,
                height: g.h,
                padding: `0 ${Math.max(5, 9 - g.noun.rank)}px`,
                cursor: "pointer",
                opacity: dimmed ? 0.4 : 1,
                background: open ? "var(--r-select)" : "var(--r-page)",
                border: `${label ? "1px" : "1.5px"} solid ${label ? "var(--r-ink)" : "var(--r-caution)"}`,
                borderRadius: 2,
                color: label ? "var(--r-ink)" : "var(--r-caution)",
                fontSize: Math.max(9.5, 11.5 - g.noun.rank * 0.5),
                whiteSpace: "nowrap",
              }}
            >
              <span className="t-caption t-upper" style={{ color: "var(--r-ink-2)", fontSize: 8 }}>
                {g.noun.key}
              </span>
              {label ?? g.noun.placeholder}
            </button>
          );
        })}

        {/* options picker anchored under the open node */}
        {openGeom ? (
          <div
            className="absolute z-40 max-h-64 w-80 overflow-y-auto px-2 py-1"
            style={{
              left: Math.min(openGeom.x, SVG_W - 330),
              top: openGeom.top + openGeom.h + 4,
              border: "0.5px solid var(--r-line-2)",
              background: "var(--r-page)",
              borderRadius: 2,
              boxShadow: "0 2px 8px color-mix(in srgb, var(--r-ink) 8%, transparent)",
            }}
          >
            <div className="t-caption t-upper pb-0.5" style={{ color: "var(--r-ink-2)" }}>
              {annotation(openGeom.noun)} — {openGeom.noun.placeholder}
              {openGeom.noun.multi ? " (pick many)" : ""}
            </div>
            {openGeom.noun.options.map((o) => (
              <div
                key={o.id}
                className="flex items-baseline gap-1.5 py-1"
                style={{ cursor: "pointer", borderTop: "0.5px solid var(--r-line)" }}
                onClick={() => pick(openGeom.noun, o.id)}
              >
                {openGeom.noun.multi ? (
                  <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                    {isPicked(openGeom.noun, o.id) ? "☑" : "☐"}
                  </span>
                ) : null}
                <span
                  className="face-mono t-caption"
                  style={{
                    color: "var(--r-ink)",
                    background:
                      !openGeom.noun.multi && isPicked(openGeom.noun, o.id) ? "var(--r-select)" : "transparent",
                  }}
                >
                  {o.label}
                </span>
                {o.sub ? (
                  <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                    {o.sub}
                  </span>
                ) : null}
              </div>
            ))}
            {openGeom.noun.options.length === 0 ? (
              <div className="face-mono t-caption py-1" style={{ color: "var(--r-ink-2)" }}>
                {openGeom.noun.empty}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CircuitParadigm() {
  return (
    <div>
      {/* wire legend — the paradigm's whole bet is that direction reads at a glance */}
      <div className="flex items-center gap-4 px-2 pb-3">
        <span className="t-caption t-upper" style={{ color: "var(--r-ink-2)" }}>
          wires
        </span>
        <svg width={430} height={14} aria-hidden>
          <line x1={0} x2={30} y1={7} y2={7} stroke="var(--r-ink-2)" strokeWidth={1} />
          <Chevron x={12} y={7} dir="in" color="var(--r-ink-2)" w={1} />
          <text x={36} y={10} fontSize={8.5} fill="var(--r-ink-2)">read</text>
          <line x1={70} x2={100} y1={7} y2={7} stroke="var(--r-ink)" strokeWidth={2} />
          <Chevron x={88} y={7} dir="out" color="var(--r-ink)" w={2} />
          <text x={106} y={10} fontSize={8.5} fill="var(--r-ink-2)">write</text>
          <line x1={142} x2={172} y1={4.5} y2={4.5} stroke="var(--r-ink)" strokeWidth={1.75} />
          <line x1={142} x2={172} y1={9.5} y2={9.5} stroke="var(--r-ink)" strokeWidth={1.75} />
          <Chevron x={152} y={4.5} dir="in" color="var(--r-ink)" w={1.5} />
          <Chevron x={162} y={9.5} dir="out" color="var(--r-ink)" w={1.5} />
          <text x={178} y={10} fontSize={8.5} fill="var(--r-ink-2)">sync</text>
          <line x1={212} x2={230} y1={7} y2={7} stroke="var(--r-ink-2)" strokeWidth={1} />
          <line x1={240} x2={258} y1={7} y2={7} stroke="var(--r-ink-2)" strokeWidth={1} />
          <circle cx={230} cy={7} r={2.5} fill="var(--r-page)" stroke="var(--r-ink-2)" strokeWidth={1} />
          <circle cx={240} cy={7} r={2.5} fill="var(--r-page)" stroke="var(--r-ink-2)" strokeWidth={1} />
          <text x={264} y={10} fontSize={8.5} fill="var(--r-ink-2)">detached</text>
          <line x1={318} x2={348} y1={7} y2={7} stroke="var(--r-ink-2)" strokeWidth={1} />
          <line x1={340} x2={340} y1={2.5} y2={11.5} stroke="var(--r-ink-2)" strokeWidth={1} />
          <text x={354} y={10} fontSize={8.5} fill="var(--r-ink-2)">channel (no flow)</text>
        </svg>
      </div>
      {PRODUCTS.map((p) => (
        <ProductCircuit key={p.key} product={p} />
      ))}
    </div>
  );
}
