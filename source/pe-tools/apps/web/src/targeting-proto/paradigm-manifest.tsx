/**
 * PROTOTYPE — paradigm "manifest": the binding manifest rendered LITERALLY as a census
 * table. One row per noun (granularity order), columns noun · bound-to · direction ·
 * liveness · demanded-by. The bet: a table answers "what does this page reach and how
 * safely" faster than any sentence — so the sentence is demoted to a FOOTNOTE under
 * each table (inverting the baseline). The stage scrubber is GLOBAL (every product has
 * three stages; this paradigm is census-shaped): scrubbing highlights demanded rows and
 * dims the rest (0.4, never hidden — ruled). Throwaway with the round.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  demandedKeys,
  PRODUCTS,
  type MockNoun,
  type MockProduct,
  type MockStage,
} from "#/targeting-proto/model";

/** Ordinal scrub position across ALL products' stage lists, or null = no scrub. */
type Scrub = number | null;

const CELL_PAD = "px-2 py-1";

function dirWeight(noun: MockNoun): { color: string; fontWeight: number } {
  // Writes/syncs are the loud half — scannable by weight/ink, never hue.
  if (noun.dir === "write" || noun.dir === "sync" || noun.dir === "read+write")
    return { color: "var(--r-ink)", fontWeight: 650 };
  return { color: "var(--r-ink-2)", fontWeight: 400 };
}

/** Stages (with their demanding verbs) that demand this noun. */
function demandedBy(product: MockProduct, noun: MockNoun): { stage: MockStage; verbs: string[] }[] {
  return product.stages
    .map((stage) => ({
      stage,
      verbs: stage.verbs.filter((v) => v.demands.includes(noun.key)).map((v) => v.label),
    }))
    .filter((d) => d.verbs.length > 0);
}

function ProductManifest({ product, scrub }: { product: MockProduct; scrub: Scrub }) {
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [single, setSingle] = useState<Record<string, string | null>>({});
  const [multi, setMulti] = useState<Record<string, Set<string>>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  const activeStage: MockStage | null = scrub === null ? null : (product.stages[scrub] ?? null);
  const demanded = activeStage ? demandedKeys(activeStage) : null;

  useEffect(() => {
    if (!openSlot) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenSlot(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openSlot]);

  const boundLabel = (noun: MockNoun): string | null => {
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
        if (next.has(id)) next.delete(id);
        else next.add(id);
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
      : (single[noun.key] ?? noun.label) === noun.options.find((o) => o.id === id)?.label;

  const ordered = [...product.nouns].sort((a, b) => a.rank - b.rank);

  const headStyle: CSSProperties = {
    color: "var(--r-ink-2)",
    textAlign: "left",
    borderBottom: "0.5px solid var(--r-line-2)",
    fontWeight: 400,
  };

  return (
    <div ref={rootRef} className="pb-7">
      {/* Product head: name + active-stage verbs (the demand source), stress as fixture caption. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2 pb-1">
        <span className="face-mono t-label" style={{ color: "var(--r-ink)" }}>
          {product.name}
        </span>
        {activeStage ? (
          <span className="face-mono t-caption" style={{ color: "var(--r-ink)" }}>
            <span style={{ background: "var(--r-select)", padding: "0 3px" }}>{activeStage.label}</span>
            <span style={{ color: "var(--r-ink-2)" }}>
              {" "}
              {activeStage.verbs.map((v) => `${v.label} (${v.demands.join(", ") || "none"})`).join(" · ")}
            </span>
          </span>
        ) : (
          <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
            all stages
          </span>
        )}
        <span
          className="t-caption"
          style={{ color: "var(--r-ink-2)", borderBottom: "0.5px dashed var(--r-line-2)" }}
        >
          {product.stress}
        </span>
      </div>

      {/* The manifest table — the primary surface of this paradigm. */}
      <table className="w-full" style={{ borderCollapse: "collapse", tableLayout: "auto" }}>
        <thead>
          <tr className="t-caption t-upper">
            <th className={CELL_PAD} style={{ ...headStyle, width: "8%" }}>
              noun
            </th>
            <th className={CELL_PAD} style={{ ...headStyle, width: "34%" }}>
              bound to
            </th>
            <th className={CELL_PAD} style={{ ...headStyle, width: "12%" }}>
              direction
            </th>
            <th className={CELL_PAD} style={{ ...headStyle, width: "10%" }}>
              liveness
            </th>
            <th className={CELL_PAD} style={headStyle}>
              demanded by
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((noun) => {
            const label = boundLabel(noun);
            const dim = demanded !== null && !demanded.has(noun.key);
            const dw = dirWeight(noun);
            const demands = demandedBy(product, noun);
            const open = openSlot === noun.key;
            return (
              <tr
                key={noun.key}
                style={{ borderBottom: "0.5px solid var(--r-line)", opacity: dim ? 0.4 : 1 }}
              >
                <td className={`face-mono t-label ${CELL_PAD}`} style={{ color: "var(--r-ink)", whiteSpace: "nowrap" }}>
                  {noun.key}
                </td>
                <td className={CELL_PAD} style={{ position: "relative", whiteSpace: "nowrap" }}>
                  <button
                    type="button"
                    title={noun.empty}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenSlot(open ? null : noun.key);
                    }}
                    className="face-mono t-label"
                    style={{
                      padding: "0 2px",
                      cursor: "pointer",
                      background: open ? "var(--r-select)" : "transparent",
                      border: "none",
                      borderBottom: `0.5px solid ${label ? "var(--r-ink)" : "var(--r-caution)"}`,
                      borderRadius: 0,
                      color: label ? "var(--r-ink)" : "var(--r-caution)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label ?? noun.placeholder}
                  </button>
                  {open ? (
                    <div
                      className="absolute left-0 top-full z-40 mt-0.5 max-h-72 w-80 overflow-y-auto px-2 py-1"
                      style={{
                        border: "0.5px solid var(--r-line-2)",
                        background: "var(--r-page)",
                        borderRadius: 2,
                        boxShadow: "0 2px 8px color-mix(in srgb, var(--r-ink) 8%, transparent)",
                      }}
                    >
                      <div className="t-caption t-upper pb-0.5" style={{ color: "var(--r-ink-2)" }}>
                        {noun.placeholder}
                        {noun.multi ? " (pick many)" : ""}
                      </div>
                      {noun.options.map((o) => (
                        <div
                          key={o.id}
                          className="flex items-baseline gap-1.5 py-1"
                          style={{ cursor: "pointer", borderTop: "0.5px solid var(--r-line)" }}
                          onClick={() => pick(noun, o.id)}
                        >
                          {noun.multi ? (
                            <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                              {isPicked(noun, o.id) ? "☑" : "☐"}
                            </span>
                          ) : null}
                          <span
                            className="face-mono t-caption"
                            style={{
                              color: "var(--r-ink)",
                              background: !noun.multi && isPicked(noun, o.id) ? "var(--r-select)" : "transparent",
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
                  ) : null}
                </td>
                <td className={`face-mono t-caption ${CELL_PAD}`} style={{ ...dw, whiteSpace: "nowrap" }}>
                  {noun.dir ?? "—"}
                </td>
                <td
                  className={`face-mono t-caption ${CELL_PAD}`}
                  style={{ color: "var(--r-ink-2)", whiteSpace: "nowrap" }}
                >
                  {noun.liveness ?? "—"}
                </td>
                <td className={`face-mono t-caption ${CELL_PAD}`} style={{ whiteSpace: "nowrap" }}>
                  {demands.length === 0 ? (
                    <span style={{ color: "var(--r-ink-2)" }}>—</span>
                  ) : (
                    demands.map(({ stage, verbs }, i) => {
                      const active = activeStage?.key === stage.key;
                      return (
                        <span key={stage.key} title={verbs.join(", ")}>
                          {i > 0 ? <span style={{ color: "var(--r-ink-2)" }}> · </span> : null}
                          <span
                            style={{
                              color: active ? "var(--r-ink)" : "var(--r-ink-2)",
                              background: active ? "var(--r-select)" : "transparent",
                              padding: active ? "0 3px" : 0,
                            }}
                          >
                            {stage.label}
                            <span style={{ opacity: 0.75 }}>
                              {"("}
                              {verbs.join(", ")}
                              {")"}
                            </span>
                          </span>
                        </span>
                      );
                    })
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* The sentence as a FOOTNOTE of the manifest — inverting the baseline. */}
      <div className="px-2 pt-1 t-caption" style={{ color: "var(--r-ink-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {ordered.map((noun, i) => {
          const label = boundLabel(noun);
          return (
            <span key={noun.key}>
              {i > 0 ? " " : ""}
              {noun.joiner}{" "}
              <span
                className="face-mono"
                style={{ color: label ? "var(--r-ink-2)" : "var(--r-caution)" }}
              >
                {label ?? noun.placeholder}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function ManifestParadigm() {
  // Global scrub: every product has three stages, so one ordinal scrubs the whole census.
  const [scrub, setScrub] = useState<Scrub>(null);
  const maxStages = Math.max(...PRODUCTS.map((p) => p.stages.length));

  return (
    <div>
      <div className="flex items-baseline gap-1.5 px-2 pb-4">
        <span className="t-caption t-upper" style={{ color: "var(--r-ink-2)" }}>
          scrub stage (global)
        </span>
        <button
          type="button"
          onClick={() => setScrub(null)}
          className="face-mono t-caption px-1.5 py-0.5"
          style={{
            cursor: "pointer",
            background: scrub === null ? "var(--r-select)" : "transparent",
            border: "0.5px solid var(--r-line-2)",
            borderRadius: 2,
            color: "var(--r-ink)",
          }}
        >
          all
        </button>
        {Array.from({ length: maxStages }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setScrub(i)}
            className="face-mono t-caption px-1.5 py-0.5"
            style={{
              cursor: "pointer",
              background: scrub === i ? "var(--r-select)" : "transparent",
              border: "0.5px solid var(--r-line-2)",
              borderRadius: 2,
              color: "var(--r-ink)",
            }}
          >
            {i + 1} · {PRODUCTS.map((p) => p.stages[i]?.label ?? "—").join("/")}
          </button>
        ))}
      </div>
      {PRODUCTS.map((p) => (
        <ProductManifest key={p.key} product={p} scrub={scrub} />
      ))}
    </div>
  );
}
