/**
 * PROTOTYPE — paradigm "patchbay": safety by geography. Throwaway with the round.
 *
 * Direction becomes WHERE, not a word: reads dock on the LEFT rail (safe), writes dock on
 * the RIGHT rail (blast — visually heavier), sync/read+write nouns are BRIDGE cables that
 * span both rails, and no-direction nouns (world; family's host rvt channel) sit on TOP as
 * the chassis everything runs through. Liveness is the connector: attached = solid plug
 * flush in its socket; detached = hollow socket with a visible gap (never dashed — seam
 * only). Unbound = empty caution socket holding the placeholder. Stage scrubbing lights the
 * demanded jacks and dims the rest to 0.4 (never hidden — ruled).
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

type Side = "top" | "left" | "right" | "bridge";

function sideOf(noun: MockNoun): Side {
  if (noun.dir === null) return "top";
  if (noun.dir === "read") return "left";
  if (noun.dir === "write") return "right";
  return "bridge"; // sync + read+write — flows both ways, spans both rails
}

/**
 * Connector glyph. Attached: stub line runs flush into a FILLED plug (plugged in).
 * Detached: stub stops short — visible gap — and the socket is HOLLOW (unplugged).
 * Unbound: hollow caution socket, no cable at all.
 */
function Connector({
  noun,
  bound,
  flip,
  heavy,
  vertical,
}: {
  noun: MockNoun;
  bound: boolean;
  flip?: boolean; // point left (right-rail jacks face the center on their left)
  heavy?: boolean; // writes are the loud half
  vertical?: boolean; // chassis jacks drop their cable downward
}) {
  const attached = noun.liveness === "attached";
  const stroke = !bound ? "var(--r-caution)" : heavy ? "var(--r-ink)" : "var(--r-ink-2)";
  const w = heavy ? 2 : 1;
  const r = heavy ? 4 : 3.5;
  // socket at x=21, cable enters from x=0; gap when detached, none when attached
  const cableEnd = attached ? 21 - r : 21 - r - 5;
  const glyph = (
    <svg width={28} height={12} aria-hidden style={{ display: "block", overflow: "visible" }}>
      {bound ? (
        <line x1={0} y1={6} x2={cableEnd} y2={6} stroke={stroke} strokeWidth={w} />
      ) : null}
      <circle
        cx={21}
        cy={6}
        r={r}
        fill={bound && attached ? stroke : "transparent"}
        stroke={stroke}
        strokeWidth={w}
      />
    </svg>
  );
  const rot = vertical ? "rotate(90deg)" : flip ? "rotate(180deg)" : undefined;
  return (
    <span style={{ display: "inline-flex", transform: rot, flexShrink: 0 }}>{glyph}</span>
  );
}

function Picker({
  noun,
  align,
  isPicked,
  onPick,
}: {
  noun: MockNoun;
  align: "left" | "right" | "below";
  isPicked: (id: string) => boolean;
  onPick: (id: string) => void;
}) {
  const pos =
    align === "left"
      ? { left: "100%", top: 0, marginLeft: 6 }
      : align === "right"
        ? { right: "100%", top: 0, marginRight: 6 }
        : { left: 0, top: "100%", marginTop: 6 };
  return (
    <div
      className="absolute z-40 max-h-72 w-72 overflow-y-auto px-2 py-1"
      style={{
        ...pos,
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
          onClick={() => onPick(o.id)}
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

interface JackApi {
  label: (noun: MockNoun) => string | null;
  open: string | null;
  toggle: (key: string) => void;
  isPicked: (noun: MockNoun, id: string) => boolean;
  pick: (noun: MockNoun, id: string) => void;
  demanded: Set<string>;
}

/** An edge jack: connector glyph + labeled socket box, annotation riding small on top. */
function Jack({ noun, side, api }: { noun: MockNoun; side: Side; api: JackApi }) {
  const label = api.label(noun);
  const bound = label !== null;
  const heavy = side === "right";
  const dimmed = !api.demanded.has(noun.key);
  const open = api.open === noun.key;
  const align: "left" | "right" | "below" =
    side === "left" ? "left" : side === "right" ? "right" : "below";

  const box = (
    <button
      type="button"
      title={noun.empty}
      onClick={(e) => {
        e.stopPropagation();
        api.toggle(noun.key);
      }}
      className="face-mono t-label px-1.5 py-0.5 text-left"
      style={{
        cursor: "pointer",
        background: open ? "var(--r-select)" : "transparent",
        border: `${heavy ? "1.5px" : "0.5px"} solid ${
          bound ? (heavy ? "var(--r-ink)" : "var(--r-line-2)") : "var(--r-caution)"
        }`,
        borderRadius: 2,
        color: bound ? "var(--r-ink)" : "var(--r-caution)",
        fontWeight: heavy ? 650 : 400,
        maxWidth: 190,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {label ?? noun.placeholder}
    </button>
  );

  return (
    <div
      className="relative flex flex-col"
      style={{
        opacity: dimmed ? 0.4 : 1,
        alignItems: side === "right" ? "flex-end" : "flex-start",
      }}
    >
      <span
        className="t-caption t-upper"
        style={{ color: annotationColor(noun), fontSize: 8.5, lineHeight: "10px" }}
      >
        {annotation(noun)}
      </span>
      <span className="flex items-center gap-0.5">
        {side === "right" ? (
          <Connector noun={noun} bound={bound} flip heavy />
        ) : null}
        {box}
        {side === "left" ? <Connector noun={noun} bound={bound} /> : null}
        {side === "top" ? <Connector noun={noun} bound={bound} vertical /> : null}
      </span>
      {open ? (
        <Picker
          noun={noun}
          align={align}
          isPicked={(id) => api.isPicked(noun, id)}
          onPick={(id) => api.pick(noun, id)}
        />
      ) : null}
    </div>
  );
}

/** A bridge cable: reads AND writes, so it spans the whole bay — light half left, loud half right. */
function Bridge({ noun, api }: { noun: MockNoun; api: JackApi }) {
  const label = api.label(noun);
  const bound = label !== null;
  const attached = noun.liveness === "attached";
  const dimmed = !api.demanded.has(noun.key);
  const open = api.open === noun.key;
  const cable = (side: "read" | "write") => {
    const stroke = !bound
      ? "var(--r-caution)"
      : side === "write"
        ? "var(--r-ink)"
        : "var(--r-ink-2)";
    const w = side === "write" ? 2 : 1;
    // detached: the cable stops short of the jack — a visible gap at the near end
    const gap = attached ? 0 : 10;
    return (
      <svg
        height={12}
        aria-hidden
        style={{ flex: 1, minWidth: 24, display: "block" }}
        preserveAspectRatio="none"
        viewBox="0 0 100 12"
      >
        {bound ? (
          <line
            x1={side === "read" ? 0 : gap}
            y1={6}
            x2={side === "read" ? 100 - gap : 100}
            y2={6}
            stroke={stroke}
            strokeWidth={w}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <circle
          cx={side === "read" ? 3 : 97}
          cy={6}
          r={3}
          fill={bound && attached ? stroke : "transparent"}
          stroke={stroke}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  };
  return (
    <div
      className="relative flex items-center gap-1 px-1"
      style={{ opacity: dimmed ? 0.4 : 1 }}
    >
      {cable("read")}
      <span className="flex flex-col items-center">
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
            api.toggle(noun.key);
          }}
          className="face-mono t-label px-1.5 py-0.5"
          style={{
            cursor: "pointer",
            background: open ? "var(--r-select)" : "transparent",
            border: `1px solid ${bound ? "var(--r-ink)" : "var(--r-caution)"}`,
            borderRadius: 2,
            color: bound ? "var(--r-ink)" : "var(--r-caution)",
            whiteSpace: "nowrap",
          }}
        >
          {label ?? noun.placeholder}
        </button>
        {open ? (
          <Picker
            noun={noun}
            align="below"
            isPicked={(id) => api.isPicked(noun, id)}
            onPick={(id) => api.pick(noun, id)}
          />
        ) : null}
      </span>
      {cable("write")}
    </div>
  );
}

function RailHead({ text, right }: { text: string; right?: boolean }) {
  return (
    <div
      className="t-caption t-upper pb-1"
      style={{
        color: "var(--r-ink-2)",
        textAlign: right ? "right" : "left",
        fontWeight: right ? 650 : 400,
      }}
    >
      {text}
    </div>
  );
}

function ProductBay({ product }: { product: MockProduct }) {
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

  const api: JackApi = {
    demanded,
    open: openSlot,
    toggle: (key) => setOpenSlot((cur) => (cur === key ? null : key)),
    label: (noun) => {
      if (noun.multi) {
        const picked = multi[noun.key];
        return picked && picked.size > 0
          ? `${picked.size} of ${noun.options.length} ${noun.key}`
          : null;
      }
      return single[noun.key] ?? noun.label;
    },
    pick: (noun, id) => {
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
    },
    isPicked: (noun, id) =>
      noun.multi
        ? (multi[noun.key] ?? new Set()).has(id)
        : api.label(noun) === noun.options.find((o) => o.id === id)?.label,
  };

  const ordered = [...product.nouns].sort((a, b) => a.rank - b.rank);
  const top = ordered.filter((n) => sideOf(n) === "top");
  const reads = ordered.filter((n) => sideOf(n) === "left");
  const writes = ordered.filter((n) => sideOf(n) === "right");
  const bridges = ordered.filter((n) => sideOf(n) === "bridge");

  return (
    <div
      ref={rootRef}
      className="mb-5"
      style={{ border: "0.5px solid var(--r-line-2)", borderRadius: 2 }}
    >
      {/* chassis — no-direction nouns everything runs through */}
      <div
        className="flex items-start justify-center gap-6 px-3 pb-0.5 pt-2"
        style={{ borderBottom: "0.5px solid var(--r-line)" }}
      >
        <span className="t-caption t-upper pt-2.5" style={{ color: "var(--r-ink-2)" }}>
          chassis
        </span>
        {top.length > 0 ? (
          top.map((n) => <Jack key={n.key} noun={n} side="top" api={api} />)
        ) : (
          <span className="face-mono t-caption pt-2.5" style={{ color: "var(--r-ink-2)" }}>
            —
          </span>
        )}
      </div>

      {/* the bay: reads left, product center, writes right */}
      <div
        className="grid gap-x-3 px-3 py-2"
        style={{ gridTemplateColumns: "minmax(120px, 200px) 1fr minmax(120px, 200px)" }}
      >
        <div>
          <RailHead text="reads" />
          <div className="flex flex-col gap-2">
            {reads.map((n) => (
              <Jack key={n.key} noun={n} side="left" api={api} />
            ))}
            {reads.length === 0 ? (
              <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                no read jacks
              </span>
            ) : null}
          </div>
        </div>

        <div
          className="px-3 py-1.5"
          style={{ border: "0.5px solid var(--r-line-2)", borderRadius: 2 }}
        >
          <div className="flex items-baseline gap-2">
            <span className="t-label" style={{ color: "var(--r-ink)", fontWeight: 650 }}>
              {product.name}
            </span>
            <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
              {product.stress}
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-1.5 pt-1.5">
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
          </div>
          <div className="flex flex-col gap-0.5 pt-1.5">
            {stage.verbs.map((v) => (
              <div key={v.key} className="flex items-baseline gap-1.5">
                <span className="face-mono t-label" style={{ color: "var(--r-ink)" }}>
                  {v.label}
                </span>
                <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                  {v.demands.length > 0 ? `⟵ ${v.demands.join(" · ")}` : "no jacks demanded"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <RailHead text="writes" right />
          <div className="flex flex-col items-end gap-2">
            {writes.map((n) => (
              <Jack key={n.key} noun={n} side="right" api={api} />
            ))}
            {writes.length === 0 ? (
              <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                no write jacks
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* bridges — sync + read+write cables spanning both rails */}
      {bridges.length > 0 ? (
        <div
          className="flex flex-col gap-1 px-3 pb-2"
          style={{ borderTop: "0.5px solid var(--r-line)" }}
        >
          <span className="t-caption t-upper pt-1" style={{ color: "var(--r-ink-2)" }}>
            spans both rails
          </span>
          {bridges.map((n) => (
            <Bridge key={n.key} noun={n} api={api} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PatchbayParadigm() {
  return (
    <div>
      <div className="flex items-baseline gap-3 px-1 pb-2">
        <span className="t-caption t-upper" style={{ color: "var(--r-ink-2)" }}>
          prototype — throwaway
        </span>
        <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
          patchbay: left = safe reads · right = blast writes · top = chassis · cables span for sync
        </span>
      </div>
      {PRODUCTS.map((p) => (
        <ProductBay key={p.key} product={p} />
      ))}
    </div>
  );
}
