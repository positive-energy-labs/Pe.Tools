/**
 * PROTOTYPE — paradigm "baseline": the round-2 winner rendered for every product.
 * Joined sentence (joiners + two-axis annotations above nouns), granularity order,
 * per-product stage scrubber in place, idle bindings DIMMED (round-2 verdict — hide retired).
 * Throwaway with the round.
 */
import { useEffect, useRef, useState } from "react";

import { AddressingBar } from "#/components/lang/addressing-bar";
import {
  annotation,
  annotationColor,
  demandedKeys,
  PRODUCTS,
  type MockNoun,
  type MockProduct,
} from "#/targeting-proto/model";

function ProductSection({ product }: { product: MockProduct }) {
  const [stageKey, setStageKey] = useState(product.stages[0]!.key);
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [single, setSingle] = useState<Record<string, string | null>>({});
  const [multi, setMulti] = useState<Record<string, Set<string>>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  const stage = product.stages.find((s) => s.key === stageKey) ?? product.stages[0]!;
  const demanded = demandedKeys(stage);

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

  const openNoun = product.nouns.find((n) => n.key === openSlot) ?? null;
  const ordered = [...product.nouns].sort((a, b) => a.rank - b.rank);

  return (
    <div ref={rootRef} className="pb-6">
      <AddressingBar
        name={product.name}
        sentence={
          <span className="relative inline-block min-w-0 flex-1 basis-72">
            <div
              className="flex items-end gap-2 overflow-visible px-2 pb-1 pt-0.5"
              style={{ border: "0.5px solid var(--r-line-2)", borderRadius: 2, minHeight: 40 }}
            >
              {ordered.map((noun) => {
                const label = nounLabel(noun);
                const dimmed = !demanded.has(noun.key);
                return (
                  <span
                    key={noun.key}
                    className="relative flex items-end gap-1"
                    style={{ whiteSpace: "nowrap", opacity: dimmed ? 0.4 : 1 }}
                  >
                    <span
                      className="face-mono t-label"
                      style={{ color: "var(--r-ink-2)", borderBottom: "0.5px solid transparent" }}
                    >
                      {noun.joiner}
                    </span>
                    <span className="flex flex-col items-start">
                      <span
                        className="t-caption t-upper"
                        style={{ color: annotationColor(noun), fontSize: 8.5, lineHeight: "10px" }}
                      >
                        {annotation(noun)}
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
                  </span>
                );
              })}
            </div>
            {openNoun ? (
              <div
                className="absolute left-0 top-full z-40 mt-1 max-h-72 w-80 overflow-y-auto px-2 py-1"
                style={{
                  border: "0.5px solid var(--r-line-2)",
                  background: "var(--r-page)",
                  borderRadius: 2,
                  boxShadow: "0 2px 8px color-mix(in srgb, var(--r-ink) 8%, transparent)",
                }}
              >
                <div className="t-caption t-upper pb-0.5" style={{ color: "var(--r-ink-2)" }}>
                  {annotation(openNoun)} — {openNoun.placeholder}
                  {openNoun.multi ? " (pick many)" : ""}
                </div>
                {openNoun.options.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-baseline gap-1.5 py-1"
                    style={{ cursor: "pointer", borderTop: "0.5px solid var(--r-line)" }}
                    onClick={() => pick(openNoun, o.id)}
                  >
                    {openNoun.multi ? (
                      <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                        {isPicked(openNoun, o.id) ? "☑" : "☐"}
                      </span>
                    ) : null}
                    <span
                      className="face-mono t-caption"
                      style={{
                        color: "var(--r-ink)",
                        background:
                          !openNoun.multi && isPicked(openNoun, o.id) ? "var(--r-select)" : "transparent",
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
                {openNoun.options.length === 0 ? (
                  <div className="face-mono t-caption py-1" style={{ color: "var(--r-ink-2)" }}>
                    {openNoun.empty}
                  </div>
                ) : null}
              </div>
            ) : null}
          </span>
        }
        seam={
          <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
            {product.stress}
          </span>
        }
      />
      <div className="flex items-baseline gap-1.5 px-2 pt-1.5">
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
    </div>
  );
}

export function BaselineParadigm() {
  return (
    <div>
      {PRODUCTS.map((p) => (
        <ProductSection key={p.key} product={p} />
      ))}
    </div>
  );
}
