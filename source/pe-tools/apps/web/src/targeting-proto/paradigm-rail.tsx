/**
 * PROTOTYPE — paradigm "rail": the workflow is the structure. Throwaway with the round.
 *
 * Each product is one horizontal pipeline (left→right = stage order) drawn as a literal
 * rail with a station node per stage. Bindings HANG OFF the rail: every noun gets a row,
 * and its chip spans exactly the stage columns whose verbs demand it (contiguous runs
 * span; a second run repeats with a continuity mark). Hovering a stage scrubs, clicking
 * pins; nouns undemanded by the mounted stage dim (never hide — round-2 ruling).
 * Write/sync nouns hang by a heavier tick — the loud half stays loud.
 */
import { useEffect, useRef, useState } from "react";

import {
  annotation,
  annotationColor,
  demandedKeys,
  PRODUCTS,
  type MockNoun,
  type MockProduct,
  type MockStage,
} from "#/targeting-proto/model";

/** Contiguous runs of stage indices (inclusive) that demand this noun. */
function demandRuns(noun: MockNoun, stages: MockStage[]): { start: number; end: number }[] {
  const hits = stages.map((s) => demandedKeys(s).has(noun.key));
  const runs: { start: number; end: number }[] = [];
  for (let i = 0; i < hits.length; i++) {
    if (!hits[i]) continue;
    const last = runs[runs.length - 1];
    if (last && last.end === i - 1) last.end = i;
    else runs.push({ start: i, end: i });
  }
  return runs;
}

const loud = (noun: MockNoun) =>
  noun.dir === "write" || noun.dir === "sync" || noun.dir === "read+write";

function Picker({
  noun,
  isPicked,
  onPick,
}: {
  noun: MockNoun;
  isPicked: (id: string) => boolean;
  onPick: (id: string) => void;
}) {
  return (
    <div
      className="absolute left-0 top-full z-40 mt-1 max-h-64 w-72 overflow-y-auto px-2 py-1"
      style={{
        border: "0.5px solid var(--r-line-2)",
        background: "var(--r-page)",
        borderRadius: 2,
        boxShadow: "0 2px 8px color-mix(in srgb, var(--r-ink) 8%, transparent)",
      }}
    >
      <div className="t-caption t-upper pb-0.5" style={{ color: "var(--r-ink-2)" }}>
        {annotation(noun)} — {noun.placeholder}
        {noun.multi ? " (pick many)" : ""}
      </div>
      {noun.options.map((o) => (
        <div
          key={o.id}
          className="flex items-baseline gap-1.5 py-1"
          style={{ cursor: "pointer", borderTop: "0.5px solid var(--r-line)" }}
          onClick={(e) => {
            e.stopPropagation();
            onPick(o.id);
          }}
        >
          {noun.multi ? (
            <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
              {isPicked(o.id) ? "☑" : "☐"}
            </span>
          ) : null}
          <span
            className="face-mono t-caption"
            style={{
              color: "var(--r-ink)",
              background: !noun.multi && isPicked(o.id) ? "var(--r-select)" : "transparent",
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
      {noun.options.length === 0 ? (
        <div className="face-mono t-caption py-1" style={{ color: "var(--r-ink-2)" }}>
          {noun.empty}
        </div>
      ) : null}
    </div>
  );
}

function ProductRail({ product }: { product: MockProduct }) {
  const [pinnedKey, setPinnedKey] = useState(product.stages[0]!.key);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [single, setSingle] = useState<Record<string, string | null>>({});
  const [multi, setMulti] = useState<Record<string, Set<string>>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  const stages = product.stages;
  const mounted =
    stages.find((s) => s.key === (hoverKey ?? pinnedKey)) ?? stages[0]!;
  const demanded = demandedKeys(mounted);
  const ordered = [...product.nouns].sort((a, b) => a.rank - b.rank);

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
      return picked && picked.size > 0 ? `${picked.size} of ${noun.options.length}` : null;
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

  return (
    <div ref={rootRef} className="px-4 pb-8">
      {/* product masthead */}
      <div className="flex items-baseline gap-3 pb-2">
        <span className="face-mono t-label" style={{ color: "var(--r-ink)" }}>
          {product.name}
        </span>
        <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
          {product.stress}
        </span>
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`,
          rowGap: 2,
        }}
      >
        {/* row 1 — the rail: continuous top stroke, a station node per stage */}
        {stages.map((s, i) => {
          const active = s.key === mounted.key;
          const pinned = s.key === pinnedKey;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setPinnedKey(s.key)}
              onMouseEnter={() => setHoverKey(s.key)}
              onMouseLeave={() => setHoverKey(null)}
              className="relative flex flex-col items-start gap-0.5 px-3 pb-2 pt-2 text-left"
              style={{
                gridRow: 1,
                gridColumn: i + 1,
                cursor: "pointer",
                border: "none",
                borderTop: `2px solid ${active ? "var(--r-ink)" : "var(--r-line-2)"}`,
                borderRadius: 0,
                background: active ? "var(--r-select)" : "transparent",
              }}
            >
              {/* station node on the rail */}
              <span
                className="absolute"
                style={{
                  top: -4,
                  left: 8,
                  width: 6,
                  height: 6,
                  borderRadius: 9999,
                  background: pinned ? "var(--r-ink)" : "var(--r-page)",
                  border: `1px solid ${active ? "var(--r-ink)" : "var(--r-line-2)"}`,
                }}
              />
              <span className="flex items-baseline gap-1.5">
                <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="t-caption t-upper" style={{ color: "var(--r-ink)" }}>
                  {s.label}
                </span>
              </span>
              <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                {s.verbs.map((v) => v.label).join(" · ") || "—"}
              </span>
            </button>
          );
        })}

        {/* one row per noun — chips hang off the stage segments that demand them */}
        {ordered.map((noun, ni) => {
          const runs = demandRuns(noun, stages);
          const label = nounLabel(noun);
          const dimmed = !demanded.has(noun.key);
          const heavy = loud(noun);
          // a noun no stage demands still renders (ruled: dim, never hide)
          const cells = runs.length > 0 ? runs : [{ start: 0, end: stages.length - 1 }];
          return cells.map((run, ri) => (
            <div
              key={`${noun.key}-${run.start}`}
              className="relative px-3 pt-2"
              style={{
                gridRow: ni + 2,
                gridColumn: `${run.start + 1} / ${run.end + 2}`,
                opacity: dimmed || runs.length === 0 ? 0.4 : 1,
                transition: "opacity 120ms",
              }}
            >
              {/* hanging tick: heavier for write/sync — the loud half */}
              <span
                className="absolute"
                style={{
                  top: 0,
                  left: 11,
                  width: heavy ? 2 : 1,
                  height: 10,
                  background: heavy ? "var(--r-ink)" : "var(--r-line-2)",
                }}
              />
              <div className="relative inline-flex flex-col items-start pl-2">
                <span className="flex items-baseline gap-1.5">
                  <span
                    className="t-caption t-upper"
                    style={{ color: annotationColor(noun), fontSize: 8.5, lineHeight: "10px" }}
                  >
                    {annotation(noun)}
                  </span>
                  {ri > 0 ? (
                    <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                      ⟳ same binding
                    </span>
                  ) : null}
                  {run.end > run.start ? (
                    <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                      spans {run.end - run.start + 1}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-baseline gap-1">
                  <span className="face-mono t-label" style={{ color: "var(--r-ink-2)" }}>
                    {noun.joiner}
                  </span>
                  <button
                    type="button"
                    title={noun.empty}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenSlot(openSlot === noun.key ? null : noun.key);
                    }}
                    className="face-mono t-label"
                    style={{
                      padding: 0,
                      cursor: "pointer",
                      background: openSlot === noun.key ? "var(--r-select)" : "transparent",
                      border: "none",
                      borderBottom: `0.5px solid ${label ? "var(--r-ink)" : "var(--r-caution)"}`,
                      borderRadius: 0,
                      color: label ? "var(--r-ink)" : "var(--r-caution)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label ?? noun.placeholder}
                  </button>
                </span>
                {openSlot === noun.key && ri === 0 ? (
                  <Picker
                    noun={noun}
                    isPicked={(id) => isPicked(noun, id)}
                    onPick={(id) => pick(noun, id)}
                  />
                ) : null}
              </div>
            </div>
          ));
        })}
      </div>
    </div>
  );
}

export function RailParadigm() {
  return (
    <div className="pt-2">
      {PRODUCTS.map((p) => (
        <ProductRail key={p.key} product={p} />
      ))}
    </div>
  );
}
